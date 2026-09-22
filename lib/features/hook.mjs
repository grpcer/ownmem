#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  currentAgentIdentity,
  MEMORY_DECLARABLE_AGENTS,
  resolveAgentIdentity,
  setProcessAgentIdentity,
} from '../memory-agent-identity.mjs';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';

/**
 * Hook subcommands 0.6.0 wrote into host configurations and this version no longer has.
 *
 * Stated here rather than imported from memory-init.mjs, which owns the removal specs: that module
 * sits in the core layer and pulling it in costs this entry about 20ms of module load, on a path
 * that runs on every Edit, Write and Read a session performs. Same arrangement as the feedback
 * verdicts, which are declared independently on each side for the same reason -- and as there, a
 * self-test holds the two lists together so they cannot drift apart silently.
 */
const RETIRED_MEMORY_HOOK_COMMANDS = Object.freeze(['posttool', 'stop']);
import { memoryIndexDir, resolveMemoryDir, resolveRepositoryRoot } from '../memory-paths.mjs';
import { memoryQueryId } from '../memory-observability.mjs';
import {
  createMemoryHookServer,
  formatClaudePreToolHook,
  isMemoryHookDisabled,
  isMemoryObservationDisabled,
  memoryHookPaths,
  MEMORY_HOOK_CONSUME_REQUEST_SCHEMA,
  MEMORY_HOOK_REQUEST_SCHEMA,
  memoryHookDaemonAlive,
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

export function spawnUnattendedEvolution() {
  return false;
}

export function parseCommand(rawArgs) {
  const args = [...rawArgs];
  const command = args[0] && !args[0].startsWith('--') ? args.shift() : 'hook';
  // grok reads this repository's Claude hook configuration through a compatibility layer, so
  // `CLAUDE_PROJECT_DIR` is the portable name for "the checkout" rather than a Claude-only one.
  // Codex sets neither it nor anything else, so there the working directory is walked up instead.
  let root = process.env.CLAUDE_PROJECT_DIR || resolveRepositoryRoot();
  let declaredHost = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--root') {
      if (!args[index + 1]) throw new Error('--root requires a value');
      root = args[index + 1];
      index += 1;
    } else if (args[index] === '--host') {
      // Each host declares itself in its own hook configuration. Codex documents that it injects
      // no CODEX_* variable into hook processes, so for that host there is nothing to sniff and
      // the declaration is the only evidence that exists.
      if (!args[index + 1]) throw new Error('--host requires a value');
      declaredHost = args[index + 1];
      if (!MEMORY_DECLARABLE_AGENTS.includes(declaredHost)) {
        throw new Error(`--host must be one of: ${MEMORY_DECLARABLE_AGENTS.join(', ')}`);
      }
      index += 1;
    } else {
      throw new Error(`unknown option: ${args[index]}`);
    }
  }
  if (!['hook', 'warm', 'serve', 'enable', 'disable', 'observe-enable', 'observe-disable', 'status'].includes(command)) {
    // A retired name is named as retired, with the one command that fixes it. This is the first
    // thing a 0.6.0 installation does after `npm install ownmem@latest`: its settings still carry
    // `hook posttool` on PostToolUse and PostToolUseFailure and `hook stop` on Stop, so the failure
    // fires on every Bash, WebFetch, WebSearch and MCP call and at the end of every turn. Measured
    // 2026-09-20 on a real 0.6.0 checkout upgraded in place, the message was
    // `unknown memory hook command: posttool` and nothing else -- true, useless, and repeated
    // hundreds of times a day. The remedy existed the whole time and nobody was told.
    if (RETIRED_MEMORY_HOOK_COMMANDS.includes(command)) {
      throw new Error(`memory hook '${command}' was retired; this installation's hook configuration is out of date.`
        + ' Run `ownmem init --update` to remove the retired entries (`ownmem init --check` reports them as drift).');
    }
    throw new Error(`unknown memory hook command: ${command}`);
  }
  return { command, root: path.resolve(root), declaredHost };
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
 * Start the resident daemon for this repository if it is not already running.
 *
 * Registered on SessionStart, where it is the only work this hook does. The first Edit or Write of
 * a session otherwise pays the daemon start itself: measured 2026-09-18 on this repository, an Edit
 * hook costs 530ms against a cold daemon and 110ms against a warm one. Starting it while the
 * session is opening moves that 420ms off the first tool call the user is waiting on.
 *
 * Racing another starter is harmless and needs no lock here: a second daemon fails to take the lock
 * directory and exits on its own, which is the same contract the pre-tool path already relies on.
 */
export function warmResidentRuntime(root, { spawnDaemon = spawnMemoryHookDaemon } = {}) {
  // A disabled hook must not leave a resident process behind. `ownmem hook disable` is the one
  // documented way to say "stop putting memories in my context", and starting the daemon anyway
  // would make that switch quietly cost what it was flipped to avoid.
  if (isMemoryHookDisabled(root)) return 0;
  if (memoryHookDaemonAlive(root)) return 0;
  try {
    // Injectable so a test can assert that nothing was started. Observing the daemon itself cannot
    // answer that: the spawn is detached and asynchronous, so checking immediately after the call
    // reports "not running" whether or not one is on its way up.
    spawnDaemon({ root, entryPath: ENTRY_PATH });
  } catch (error) {
    // Warm-up is an optimisation. A session must open whether or not it succeeded.
    recordMemoryHookDiagnostic(root, 'WARM_FAIL_OPEN', error);
  }
  return 0;
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
  // Pin the identity before anything can emit an event, and publish it to the daemon and the
  // resident recall process this invocation may start -- neither of them sees this argv.
  setProcessAgentIdentity(resolveAgentIdentity({ declaredHost: options.declaredHost }));
  if (options.command === 'hook') return runPreToolHook({ root: options.root });
  if (options.command === 'warm') return warmResidentRuntime(options.root);
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
