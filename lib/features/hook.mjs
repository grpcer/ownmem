#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import {
  createMemoryHookServer,
  formatClaudePreToolHook,
  isMemoryHookDisabled,
  memoryHookPaths,
  MEMORY_HOOK_CONSUME_REQUEST_SCHEMA,
  MEMORY_HOOK_REQUEST_SCHEMA,
  recordMemoryHookDiagnostic,
  requestMemoryHook,
  resolveReadMemoryTopic,
  resolvePreToolMemoryQuery,
  setMemoryHookEnabled,
  spawnMemoryHookDaemon,
  StdioMemoryRuntimeClient,
} from '../memory-hook.mjs';

const ENTRY_PATH = fileURLToPath(import.meta.url);

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
  if (!['hook', 'serve', 'enable', 'disable', 'status'].includes(command)) {
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
      resolveConfiguredMemoryDir(resolvedRoot) || undefined,
    );
    if (consumed) {
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

function resolveConfiguredMemoryDir(root) {
  for (const directory of ['.ownmem', '.memory']) {
    try {
      const config = JSON.parse(readFileSync(path.join(root, directory, 'config.json'), 'utf8'));
      if (['ownmem.config/v1', 'oriveo.memory.config/v1'].includes(config.schema)) {
        return config.memory_dir;
      }
    } catch {
      // Legacy installations keep the historical .claude/.local-test defaults.
    }
  }
  return null;
}

async function runServer(root) {
  const configuredMemoryDir = resolveConfiguredMemoryDir(root);
  const memoryDir = configuredMemoryDir || '.claude/memory';
  const indexDirectory = configuredMemoryDir ? `${configuredMemoryDir}/index` : '.local-test/memory-index';
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
  if (options.command === 'serve') return runServer(options.root);
  if (options.command === 'status') return printStatus(options.root);
  const enabled = options.command === 'enable';
  const result = setMemoryHookEnabled(options.root, enabled);
  process.stdout.write(`memory hook ${enabled ? 'enabled' : 'disabled'} (${path.relative(options.root, result.marker)})\n`);
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
