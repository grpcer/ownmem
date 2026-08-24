#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import { memoryIndexDir, resolveMemoryDir } from '../memory-paths.mjs';
import {
  createMemoryObservabilityEvent,
  memoryQueryId,
  recordMemoryObservabilityEvent,
} from '../memory-observability.mjs';
import { reduceExternalContextEvent, reduceHostToolEvent } from '../memory-tool-events.mjs';
import { reduceTurnCorrection } from '../memory-turn-events.mjs';
import {
  createMemoryHookServer,
  formatClaudePreToolHook,
  isMemoryHookDisabled,
  isMemoryObservationDisabled,
  memoryHookPaths,
  MEMORY_HOOK_CONSUME_REQUEST_SCHEMA,
  MEMORY_HOOK_REQUEST_SCHEMA,
  recordMemoryHookDiagnostic,
  requestMemoryHook,
  resolveReadMemoryTopic,
  resolvePreToolMemoryQuery,
  setMemoryHookEnabled,
  setMemoryObservationEnabled,
  spawnMemoryHookDaemon,
  StdioMemoryRuntimeClient,
} from '../memory-hook.mjs';

const ENTRY_PATH = fileURLToPath(import.meta.url);

export function spawnUnattendedEvolution(root) {
  const bin = path.resolve(path.dirname(ENTRY_PATH), '..', '..', 'bin', 'ownmem.mjs');
  if (!existsSync(bin)) return false;
  try {
    const child = spawn(process.execPath, [
      bin, 'evolve', 'run', '--root', root, '--memory-dir', resolveMemoryDir(root),
      '--source', 'claude-stop', '--quiet',
    ], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return true;
  } catch (error) {
    recordMemoryHookDiagnostic(root, 'EVOLUTION_SPAWN_FAIL_OPEN', error);
    return false;
  }
}

function parseCommand(rawArgs) {
  const args = [...rawArgs];
  const command = args[0] && !args[0].startsWith('--') ? args.shift() : 'hook';
  let root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--root') {
      if (!args[index + 1]) throw new Error('--root requires a value');
      root = args[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown option: ${args[index]}`);
    }
  }
  if (!['hook', 'posttool', 'stop', 'serve', 'enable', 'disable', 'observe-enable', 'observe-disable', 'status'].includes(command)) {
    throw new Error(`unknown memory hook command: ${command}`);
  }
  return { command, root: path.resolve(root) };
}

async function readHookInput(input = process.stdin) {
  let value = '';
  for await (const chunk of input) {
    value += chunk.toString('utf8');
    if (Buffer.byteLength(value) > 1024 * 1024) throw new Error('Claude hook input exceeds 1 MiB');
  }
  if (!value.trim()) throw new Error('Claude hook input is empty');
  return JSON.parse(value);
}

async function waitForDaemon(root, request, deadline = Date.now() + 1_500) {
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await requestMemoryHook({ root, request });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError || new Error('memory hook daemon did not become ready');
}

async function queryResidentRuntime(root, request) {
  try {
    return await requestMemoryHook({ root, request });
  } catch {
    spawnMemoryHookDaemon({ root, entryPath: ENTRY_PATH });
    return waitForDaemon(root, request);
  }
}

export async function runPreToolHook({ root, input = process.stdin, output = process.stdout } = {}) {
  let resolvedRoot = path.resolve(root || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  try {
    const hookInput = await readHookInput(input);
    resolvedRoot = path.resolve(root || process.env.CLAUDE_PROJECT_DIR || hookInput.cwd || process.cwd());
    if (isMemoryHookDisabled(resolvedRoot)) return 0;
    // A Read of a topic file is only recognizable under the installation's configured memory dir;
    // the historical `.claude/memory` default silently missed every `.ownmem` installation.
    const consumed = resolveReadMemoryTopic(
      hookInput,
      resolvedRoot,
      resolveMemoryDir(resolvedRoot),
    );
    if (consumed) {
      // Recording that a full text was opened is collection, so it follows the collection switch.
      if (isMemoryObservationDisabled(resolvedRoot)) return 0;
      const request = {
        schema: MEMORY_HOOK_CONSUME_REQUEST_SCHEMA,
        id: `consume-${randomUUID()}`,
        session_id: consumed.sessionId,
        memory_id: consumed.memoryId,
      };
      await queryResidentRuntime(resolvedRoot, request);
      return 0;
    }
    const target = resolvePreToolMemoryQuery(hookInput, resolvedRoot);
    if (!target) return 0;
    const request = {
      schema: MEMORY_HOOK_REQUEST_SCHEMA,
      id: `hook-${randomUUID()}`,
      session_id: target.sessionId,
      query: target.query,
      // Keyed here rather than in the daemon: the raw turn id then never crosses the socket, and
      // the recall it produces can still be joined to the commands from the same turn.
      episode_id: target.promptId ? memoryQueryId({ root: resolvedRoot, query: target.promptId }) : null,
    };
    const response = await queryResidentRuntime(resolvedRoot, request);
    if (!response.ok) throw new Error(response.error.message);
    const rendered = formatClaudePreToolHook(response);
    if (rendered) output.write(`${rendered}\n`);
    return 0;
  } catch (error) {
    recordMemoryHookDiagnostic(resolvedRoot, 'PRETOOL_FAIL_OPEN', error);
    return 0;
  }
}

/**
 * Record what a host tool call did, for the signals a debug lesson is made of.
 *
 * This runs after the tool has already finished, so it can never delay or block anything the user
 * is waiting on, and it fails open for the same reason the pre-tool hook does: telemetry that can
 * break a session is worse than telemetry that is missing. The reduction to an allowlisted, hashed
 * payload happens in memory-tool-events.mjs, which is the only place that ever sees the command.
 */
export async function runPostToolHook({ root, input = process.stdin } = {}) {
  let resolvedRoot = path.resolve(root || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  try {
    const hookInput = await readHookInput(input);
    resolvedRoot = path.resolve(root || process.env.CLAUDE_PROJECT_DIR || hookInput.cwd || process.cwd());
    if (isMemoryObservationDisabled(resolvedRoot)) return 0;
    const hmac = value => memoryQueryId({ root: resolvedRoot, query: value });
    // Untrusted text arriving is recorded on the same hook as command outcomes, because it is the
    // same event stream and because the alternative -- asking whoever runs a scan to remember to
    // pass a flag -- makes the poisoning defence depend on a person's memory.
    const external = reduceExternalContextEvent(hookInput, { hmac });
    if (external) {
      recordMemoryObservabilityEvent({
        root: resolvedRoot,
        event: createMemoryObservabilityEvent({
          event: 'external.context.observed',
          component: 'memory-hook',
          payload: external,
        }),
      });
      return 0;
    }
    const payload = reduceHostToolEvent(hookInput, { hmac });
    if (!payload) return 0;
    recordMemoryObservabilityEvent({
      root: resolvedRoot,
      event: createMemoryObservabilityEvent({
        event: 'command.completed',
        component: 'memory-hook',
        payload,
      }),
    });
    return 0;
  } catch (error) {
    recordMemoryHookDiagnostic(resolvedRoot, 'POSTTOOL_FAIL_OPEN', error);
    return 0;
  }
}

/**
 * Record whether the turn that just ended began with the user pushing back.
 *
 * Runs on Stop, which the host already fires once per turn, and reads the transcript the host has
 * already written -- so the strongest signal in the plan costs no new hook on the prompt path and
 * needs no guess about which turn a correction belongs to. Fails open like the others: this is
 * telemetry, and telemetry that can end a turn badly is worse than telemetry that is missing.
 *
 * Nothing is written unless the reduction produced something, and the reduction never carries text.
 */
export async function runStopHook({ root, input = process.stdin, scheduleEvolution = spawnUnattendedEvolution } = {}) {
  let resolvedRoot = path.resolve(root || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  try {
    const hookInput = await readHookInput(input);
    resolvedRoot = path.resolve(root || process.env.CLAUDE_PROJECT_DIR || hookInput.cwd || process.cwd());
    if (isMemoryObservationDisabled(resolvedRoot)) return 0;
    const transcript = hookInput.transcript_path;
    if (typeof transcript !== 'string' || !existsSync(transcript)) return 0;
    const rows = [];
    for (const line of readFileSync(transcript, 'utf8').split('\n')) {
      if (!line.startsWith('{')) continue;
      try { rows.push(JSON.parse(line)); } catch { /* a partially flushed line is not an error */ }
    }
    const payload = reduceTurnCorrection(rows, {
      hmac: value => memoryQueryId({ root: resolvedRoot, query: value }),
    });
    if (!payload) return 0;
    recordMemoryObservabilityEvent({
      root: resolvedRoot,
      event: createMemoryObservabilityEvent({
        event: 'correction.observed',
        component: 'memory-hook',
        payload,
      }),
    });
    return 0;
  } catch (error) {
    recordMemoryHookDiagnostic(resolvedRoot, 'STOP_FAIL_OPEN', error);
    return 0;
  } finally {
    // Safe maintenance is deliberately off the latency path. The child owns its lock, debounce,
    // transaction and failure record; Stop only schedules it and always returns to the host.
    try { scheduleEvolution(resolvedRoot); } catch (error) {
      recordMemoryHookDiagnostic(resolvedRoot, 'EVOLUTION_SPAWN_FAIL_OPEN', error);
    }
  }
}

async function runServer(root) {
  const memoryDir = resolveMemoryDir(root);
  const indexDirectory = memoryIndexDir(memoryDir);
  const runtime = new StdioMemoryRuntimeClient({
    root,
    recallScript: path.join(path.dirname(ENTRY_PATH), 'recall.mjs'),
    memoryDir,
    indexDirectory,
  });
  let onMemoryConsumed = null;
  let onMemoryDelivered = null;
  const localSink = path.join(path.dirname(ENTRY_PATH), '..', 'memory-hook-observability.mjs');
  if (existsSync(localSink)) {
    try {
      const module = await import(pathToFileURL(localSink).href);
      onMemoryConsumed = module.createMemoryHookConsumptionSink({ root });
      onMemoryDelivered = module.createMemoryHookDeliverySink({ root });
    } catch (error) {
      recordMemoryHookDiagnostic(root, 'CONSUMPTION_SINK_UNAVAILABLE', error);
    }
  }
  const running = await createMemoryHookServer({ root, runtime, onMemoryConsumed, onMemoryDelivered });
  if (!running) return 0;
  const shutdown = async () => {
    await running.close();
    process.exitCode = 0;
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return new Promise((resolve) => running.server.once('close', () => resolve(0)));
}

function readOwner(paths) {
  try {
    return JSON.parse(readFileSync(paths.lockOwner, 'utf8'));
  } catch {
    return null;
  }
}

function printStatus(root) {
  const paths = memoryHookPaths(root);
  const owner = readOwner(paths);
  const status = {
    schema: 'ownmem-hook-status/v1',
    enabled: !isMemoryHookDisabled(root),
    observation_enabled: !isMemoryObservationDisabled(root),
    daemon_running: Boolean(owner?.pid),
    daemon_pid: owner?.pid || null,
    endpoint: paths.endpoint,
    diagnostics_present: existsSync(paths.diagnostics),
  };
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  return 0;
}

export async function runMemoryHookCli(rawArgs = process.argv.slice(2)) {
  const options = parseCommand(rawArgs);
  if (options.command === 'hook') return runPreToolHook({ root: options.root });
  if (options.command === 'posttool') return runPostToolHook({ root: options.root });
  if (options.command === 'stop') return runStopHook({ root: options.root });
  if (options.command === 'serve') return runServer(options.root);
  if (options.command === 'status') return printStatus(options.root);
  if (options.command === 'observe-enable' || options.command === 'observe-disable') {
    const observing = options.command === 'observe-enable';
    const result = setMemoryObservationEnabled(options.root, observing);
    process.stdout.write(`memory observation ${observing ? 'enabled' : 'disabled'} (${path.relative(options.root, result.marker)})`
      + '; recall is a separate switch\n');
    return 0;
  }
  const enabled = options.command === 'enable';
  const result = setMemoryHookEnabled(options.root, enabled);
  process.stdout.write(`memory hook ${enabled ? 'enabled' : 'disabled'} (${path.relative(options.root, result.marker)})`
    + '; collection is a separate switch (observe-enable / observe-disable)\n');
  return 0;
}

if (isMemoryCliEntry(import.meta.url)) {
  Promise.resolve(runMemoryHookCli()).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`memory-hook: ${error.message}\n`);
    process.exitCode = 1;
  });
}
