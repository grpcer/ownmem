import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {
  validateMemoryHookConsumeRequest,
  validateMemoryHookRequest,
  validateMemoryHookResponse,
  validateMemoryStdioResponse,
} from './memory-contracts.mjs';

export const MEMORY_HOOK_REQUEST_SCHEMA = 'ownmem-hook-request/v1';
export const MEMORY_HOOK_CONSUME_REQUEST_SCHEMA = 'ownmem-hook-consume-request/v1';
export const MEMORY_HOOK_RESPONSE_SCHEMA = 'ownmem-hook-response/v1';
export const MEMORY_HOOK_PROTOCOL_VERSION = 1;
const MAX_LINE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 4_500;
const DEFAULT_IDLE_MS = 5 * 60 * 1_000;
// Grace period between lock-directory creation and owner.json publication.
const DAEMON_LOCK_SETTLE_MS = 2_000;
const MAX_SESSIONS = 128;
const MAX_SEEN_IDS = 64;

function isWindowsPipe(endpoint) {
  return endpoint.startsWith('\\\\.\\pipe\\');
}

export function memoryHookPaths(root) {
  const absoluteRoot = path.resolve(root);
  const directory = path.join(absoluteRoot, '.local-test', 'memory-hook');
  const suffix = createHash('sha256').update(absoluteRoot).digest('hex').slice(0, 16);
  return {
    root: absoluteRoot,
    directory,
    endpoint: process.platform === 'win32'
      ? `\\\\.\\pipe\\ownmem-hook-${suffix}`
      : path.join(tmpdir(), `ownmem-hook-${suffix}.sock`),
    disabled: path.join(directory, 'disabled'),
    diagnostics: path.join(directory, 'diagnostics.jsonl'),
    daemonLog: path.join(directory, 'daemon.log'),
    lockDirectory: path.join(directory, 'daemon.lock'),
    lockOwner: path.join(directory, 'daemon.lock', 'owner.json'),
  };
}

export function isMemoryHookDisabled(root, env = process.env) {
  const value = String(env.OWNMEM_HOOK ?? env.ORIVEO_MEMORY_HOOK ?? '').trim().toLowerCase();
  if (['0', 'false', 'off', 'disabled'].includes(value)) return true;
  return existsSync(memoryHookPaths(root).disabled);
}

export function setMemoryHookEnabled(root, enabled) {
  const paths = memoryHookPaths(root);
  mkdirSync(paths.directory, { recursive: true });
  if (enabled) rmSync(paths.disabled, { force: true });
  else writeFileSync(paths.disabled, 'disabled\n', { encoding: 'utf8', mode: 0o600 });
  return { enabled, marker: paths.disabled };
}

export function recordMemoryHookDiagnostic(root, code, error) {
  try {
    const paths = memoryHookPaths(root);
    mkdirSync(paths.directory, { recursive: true });
    if (existsSync(paths.diagnostics) && statSync(paths.diagnostics).size >= 1024 * 1024) {
      renameSync(paths.diagnostics, `${paths.diagnostics}.1`);
    }
    const entry = {
      schema: 'ownmem-hook-diagnostic/v1',
      recorded_at: new Date().toISOString(),
      code,
      message: String(error?.message || error || 'unknown error').slice(0, 300),
    };
    appendFileSync(paths.diagnostics, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Hook diagnostics are best effort and must never block the edit.
  }
}

export function resolvePreToolMemoryQuery(input, root) {
  if (!input || !['Edit', 'Write'].includes(input.tool_name)) return null;
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== 'string' || !filePath.trim()) return null;
  const absoluteRoot = path.resolve(root);
  const base = typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd : absoluteRoot;
  const absoluteTarget = path.resolve(base, filePath);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  const query = relative.split(path.sep).join('/');
  if (query.length > 512) return null;
  const sessionId = resolveHookSessionId(input);
  return { query, sessionId };
}

function resolveHookSessionId(input) {
  return typeof input.session_id === 'string' && input.session_id.trim()
    ? input.session_id.trim().slice(0, 256)
    : createHash('sha256')
      .update(String(input.transcript_path || input.cwd || 'unknown-session'))
      .digest('hex');
}

export function resolveReadMemoryTopic(input, root, memoryDir = '.claude/memory') {
  if (!input || input.tool_name !== 'Read') return null;
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== 'string' || !filePath.trim()) return null;
  const absoluteRoot = path.resolve(root);
  const absoluteMemoryDir = path.resolve(absoluteRoot, memoryDir);
  const base = typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd : absoluteRoot;
  const absoluteTarget = path.resolve(base, filePath);
  if (path.dirname(absoluteTarget) !== absoluteMemoryDir) return null;
  const fileName = path.basename(absoluteTarget);
  if (!fileName.endsWith('.md') || fileName === 'MEMORY.md' || fileName.startsWith('MEMORY-')) return null;
  const memoryId = fileName.slice(0, -3);
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(memoryId)) return null;
  return { memoryId, sessionId: resolveHookSessionId(input) };
}

function hookErrorResponse(id, error) {
  const response = {
    schema: MEMORY_HOOK_RESPONSE_SCHEMA,
    id,
    ok: false,
    result: null,
    deduplicated: false,
    error: {
      code: 'HOOK_RUNTIME_ERROR',
      message: String(error?.message || error || 'unknown hook error').slice(0, 300),
    },
  };
  validateMemoryHookResponse(response);
  return response;
}

function hookSuccessResponse(id, result, deduplicated = false) {
  const response = {
    schema: MEMORY_HOOK_RESPONSE_SCHEMA,
    id,
    ok: true,
    result,
    deduplicated,
    error: null,
  };
  validateMemoryHookResponse(response);
  return response;
}

function readSingleLine(stream, { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = MAX_LINE_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let value = '';
    const finish = (callback, payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.off('data', onData);
      stream.off('error', onError);
      stream.off('end', onEnd);
      callback(payload);
    };
    const onError = (error) => finish(reject, error);
    const onEnd = () => finish(reject, new Error('memory hook IPC ended before a response'));
    const onData = (chunk) => {
      value += chunk.toString('utf8');
      if (Buffer.byteLength(value) > maxBytes) {
        finish(reject, new Error('memory hook IPC response exceeds 64 KiB'));
        return;
      }
      const newline = value.indexOf('\n');
      if (newline >= 0) finish(resolve, value.slice(0, newline));
    };
    const timer = setTimeout(() => finish(reject, new Error('memory hook IPC timed out')), timeoutMs);
    timer.unref?.();
    stream.on('data', onData);
    stream.on('error', onError);
    stream.on('end', onEnd);
  });
}

export async function requestMemoryHook({ root, request, timeoutMs = DEFAULT_TIMEOUT_MS, endpoint = null }) {
  if (request?.schema === MEMORY_HOOK_CONSUME_REQUEST_SCHEMA) validateMemoryHookConsumeRequest(request);
  else validateMemoryHookRequest(request);
  const socket = net.createConnection(endpoint || memoryHookPaths(root).endpoint);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('memory hook IPC connection timed out')), timeoutMs);
      timer.unref?.();
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const responseLine = readSingleLine(socket, { timeoutMs });
    socket.write(`${JSON.stringify(request)}\n`);
    const response = JSON.parse(await responseLine);
    validateMemoryHookResponse(response);
    if (response.id !== request.id) throw new Error('memory hook response id mismatch');
    return response;
  } finally {
    socket.destroy();
  }
}

export function spawnMemoryHookDaemon({ root, entryPath }) {
  const paths = memoryHookPaths(root);
  mkdirSync(paths.directory, { recursive: true });
  const descriptor = openSync(paths.daemonLog, 'a', 0o600);
  try {
    const child = spawn(process.execPath, [entryPath, 'serve', '--root', paths.root], {
      cwd: paths.root,
      detached: true,
      stdio: ['ignore', descriptor, descriptor],
      env: { ...process.env, OWNMEM_HOOK_DAEMON: '1' },
    });
    child.unref();
    return child.pid;
  } finally {
    closeSync(descriptor);
  }
}

export class StdioMemoryRuntimeClient {
  constructor({ root, recallScript, memoryDir = '.claude/memory', indexDirectory = '.local-test/memory-index' }) {
    this.root = path.resolve(root);
    this.recallScript = recallScript;
    this.memoryDir = memoryDir;
    this.indexDirectory = indexDirectory;
    this.child = null;
    this.pending = new Map();
    this.stderr = '';
  }

  start() {
    if (this.child && this.child.exitCode === null) return;
    const args = [
      this.recallScript,
      '--root', this.root,
      '--memory-dir', this.memoryDir,
      '--index-dir', this.indexDirectory,
      '--stdio',
      '--surface', 'claude-hook',
    ];
    const child = spawn(process.execPath, args, { cwd: this.root, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.stderr = '';
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity, terminal: false });
    lines.on('line', (line) => {
      try {
        const response = JSON.parse(line);
        validateMemoryStdioResponse(response);
        const pending = this.pending.get(response.id);
        if (!pending) return;
        this.pending.delete(response.id);
        clearTimeout(pending.timer);
        if (response.ok) pending.resolve({
          envelope: response.result,
          observationTraceId: response.observation_trace_id,
        });
        else pending.reject(new Error(response.error.message));
      } catch (error) {
        this.failAll(error);
      }
    });
    child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk.toString('utf8')}`.slice(-2_000);
    });
    child.once('error', (error) => this.failAll(error));
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      this.failAll(new Error(`memory stdio runtime exited (${signal || code})${this.stderr ? `: ${this.stderr.trim()}` : ''}`));
    });
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  queryObserved(query, excludeMemoryIds = [], timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.start();
    const id = randomUUID();
    const request = {
      schema: 'ownmem-stdio-request/v1',
      id,
      query,
      tier: 'default',
      limit: 3,
      exclude_memory_ids: [...new Set(excludeMemoryIds)].slice(0, MAX_SEEN_IDS),
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('memory stdio runtime query timed out'));
        this.invalidate();
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(error);
      });
    });
  }

  async query(query, excludeMemoryIds = [], timeoutMs = DEFAULT_TIMEOUT_MS) {
    const result = await this.queryObserved(query, excludeMemoryIds, timeoutMs);
    return result.envelope;
  }

  invalidate() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    child.kill();
  }

  close() {
    this.invalidate();
  }
}

function filterPreviouslyInjected(envelope, seen) {
  const filtered = envelope.results.filter((result) => !seen.has(result.memory_id));
  if (filtered.length === envelope.results.length) return { envelope, deduplicated: false };
  if (filtered.length === 0) return { envelope: null, deduplicated: true };
  const result = structuredClone(envelope);
  result.results = filtered;
  result.results.forEach((entry, index) => { entry.rank = index + 1; });
  return { envelope: result, deduplicated: true };
}

export class MemoryHookCoordinator {
  constructor(runtime, {
    maxSessions = MAX_SESSIONS,
    recentRecalls,
    onMemoryConsumed = null,
    onMemoryDelivered = null,
  } = {}) {
    this.runtime = runtime;
    this.maxSessions = maxSessions;
    this.recentRecalls = recentRecalls;
    this.onMemoryConsumed = onMemoryConsumed;
    this.onMemoryDelivered = onMemoryDelivered;
    this.sessions = new Map();
    this.queues = new Map();
  }

  session(id) {
    let session = this.sessions.get(id);
    if (!session) {
      session = { snapshotId: null, seen: new Set(), touchedAt: Date.now() };
      this.sessions.set(id, session);
    }
    session.touchedAt = Date.now();
    if (this.sessions.size > this.maxSessions) {
      const oldest = [...this.sessions.entries()]
        .sort((left, right) => left[1].touchedAt - right[1].touchedAt)[0]?.[0];
      if (oldest && oldest !== id) this.sessions.delete(oldest);
    }
    return session;
  }

  async execute(request) {
    validateMemoryHookRequest(request);
    const session = this.session(request.session_id);
    let observed = this.runtime.queryObserved
      ? await this.runtime.queryObserved(request.query, [...session.seen])
      : { envelope: await this.runtime.query(request.query, [...session.seen]), observationTraceId: null };
    let { envelope } = observed;
    const snapshotId = envelope.source.snapshot_id || envelope.source.mode;
    if (session.snapshotId && session.snapshotId !== snapshotId) {
      session.seen.clear();
      observed = this.runtime.queryObserved
        ? await this.runtime.queryObserved(request.query, [])
        : { envelope: await this.runtime.query(request.query, []), observationTraceId: null };
      ({ envelope } = observed);
    }
    session.snapshotId = envelope.source.snapshot_id || envelope.source.mode;
    if (envelope.abstain.abstained || envelope.results.length === 0) {
      return hookSuccessResponse(request.id, null, false);
    }
    const filtered = filterPreviouslyInjected(envelope, session.seen);
    if (!filtered.envelope) return hookSuccessResponse(request.id, null, true);
    for (const result of filtered.envelope.results) session.seen.add(result.memory_id);
    while (session.seen.size > MAX_SEEN_IDS) session.seen.delete(session.seen.values().next().value);
    this.recentRecalls?.remember({
      traceId: observed.observationTraceId,
      sessionId: request.session_id,
      snapshotId: filtered.envelope.source.snapshot_id,
      returnedTopics: filtered.envelope.results.map((result) => result.memory_id),
      source: 'claude-hook',
    });
    if (this.onMemoryDelivered && observed.observationTraceId) {
      setImmediate(() => {
        try {
          Promise.resolve(this.onMemoryDelivered({
            traceId: observed.observationTraceId,
            snapshotId: filtered.envelope.source.snapshot_id,
            topics: filtered.envelope.results.map((result) => result.memory_id),
          })).catch(() => {});
        } catch {
          // Delivery telemetry is best effort and never blocks the host adapter.
        }
      });
    }
    return hookSuccessResponse(request.id, filtered.envelope, filtered.deduplicated);
  }

  consume(request) {
    validateMemoryHookConsumeRequest(request);
    if (!this.recentRecalls) return hookSuccessResponse(request.id, null, true);
    const match = this.recentRecalls.consume({
      sessionId: request.session_id,
      memoryId: request.memory_id,
    });
    if (!match) return hookSuccessResponse(request.id, null, true);
    if (this.onMemoryConsumed) {
      setImmediate(() => {
        try {
          Promise.resolve(this.onMemoryConsumed(match)).catch(() => {});
        } catch {
          // Consumption telemetry is best effort and never blocks Read.
        }
      });
    }
    return hookSuccessResponse(request.id, null, false);
  }

  query(request) {
    const previous = this.queues.get(request.session_id) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => this.execute(request));
    this.queues.set(request.session_id, current);
    return current.finally(() => {
      if (this.queues.get(request.session_id) === current) this.queues.delete(request.session_id);
    });
  }
}

function daemonOwnerIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is not controllable; its lock remains live.
    return error.code === 'EPERM';
  }
}

/**
 * Decide whether to reclaim and retry an existing lock or yield to its owner.
 * A missing owner.json can mean either an owner between mkdir and publication or a process
 * killed before publication. Lock age distinguishes startup grace from an abandoned lock.
 */
function reclaimDaemonLock(paths) {
  let owner = null;
  try {
    owner = JSON.parse(readFileSync(paths.lockOwner, 'utf8'));
  } catch {
    let age;
    try {
      age = Date.now() - statSync(paths.lockDirectory).mtimeMs;
    } catch {
      return true; // The lock disappeared, so acquisition may retry immediately.
    }
    if (age < DAEMON_LOCK_SETTLE_MS) return false;
    return discardDaemonLock(paths);
  }
  if (owner.root === paths.root && daemonOwnerIsAlive(owner.pid)) return false;
  return discardDaemonLock(paths);
}

/**
 * Stale-lock reclamation must itself be exclusive. Atomically rename the lock before removal,
 * so only the process that won the rename may retry acquisition.
 */
function discardDaemonLock(paths) {
  const graveyard = `${paths.lockDirectory}.stale-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    renameSync(paths.lockDirectory, graveyard);
  } catch (error) {
    if (error.code === 'ENOENT') return false; // Another process already reclaimed it; yield.
    throw error;
  }
  rmSync(graveyard, { recursive: true, force: true });
  return true;
}

function acquireDaemonLock(paths) {
  mkdirSync(paths.directory, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(paths.lockDirectory);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!reclaimDaemonLock(paths)) return false;
      continue;
    }
    try {
      writeFileSync(paths.lockOwner, `${JSON.stringify({
        schema: 'ownmem-hook-daemon/v1',
        pid: process.pid,
        root: paths.root,
        started_at: new Date().toISOString(),
      })}\n`, { encoding: 'utf8', mode: 0o600 });
      return true;
    } catch (error) {
      // Another process reclaimed the directory before owner publication; yield without crashing.
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
  return false;
}

export async function createMemoryHookServer({
  root,
  runtime,
  endpoint = null,
  idleMs = DEFAULT_IDLE_MS,
  watchMemory = true,
  acquireLock = true,
  onMemoryConsumed = null,
  onMemoryDelivered = null,
} = {}) {
  const paths = memoryHookPaths(root);
  const resolvedEndpoint = endpoint || paths.endpoint;
  mkdirSync(paths.directory, { recursive: true });
  if (acquireLock && !acquireDaemonLock(paths)) return null;
  if (!isWindowsPipe(resolvedEndpoint)) rmSync(resolvedEndpoint, { force: true });
  // The local ledger survives daemon idle exits and reconciles CLI and agent consumption reports.
  // Load it as an optional adapter; compiler-only packages omit host observability and ledger writes.
  let recentRecalls = null;
  try {
    const ledger = await import('./memory-recall-ledger.mjs');
    recentRecalls = new ledger.MemoryRecallLedger({ root: paths.root });
  } catch {
    recentRecalls = null;
  }
  const coordinator = new MemoryHookCoordinator(runtime, { onMemoryConsumed, onMemoryDelivered, recentRecalls });
  let idleTimer = null;
  let watcher = null;
  let closed = false;
  const server = net.createServer((socket) => {
    resetIdle();
    readSingleLine(socket).then(async (line) => {
      let id = null;
      try {
        if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error('memory hook request exceeds 64 KiB');
        const parsed = JSON.parse(line);
        if (typeof parsed?.id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(parsed.id)) id = parsed.id;
        const response = parsed?.schema === MEMORY_HOOK_CONSUME_REQUEST_SCHEMA
          ? coordinator.consume(parsed)
          : await coordinator.query(parsed);
        socket.end(`${JSON.stringify(response)}\n`);
      } catch (error) {
        socket.end(`${JSON.stringify(hookErrorResponse(id, error))}\n`);
      }
    }).catch((error) => {
      socket.end(`${JSON.stringify(hookErrorResponse(null, error))}\n`);
    });
  });
  const close = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(idleTimer);
    watcher?.close();
    runtime.close?.();
    await new Promise((resolve) => server.close(() => resolve()));
    if (!isWindowsPipe(resolvedEndpoint)) rmSync(resolvedEndpoint, { force: true });
    if (acquireLock) rmSync(paths.lockDirectory, { recursive: true, force: true });
  };
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => close().catch(() => {}), idleMs);
    idleTimer.unref?.();
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(resolvedEndpoint, () => {
      server.off('error', reject);
      resolve();
    });
  });
  if (!isWindowsPipe(resolvedEndpoint)) chmodSync(resolvedEndpoint, 0o600);
  if (watchMemory) {
    try {
      watcher = watch(path.join(paths.root, '.claude', 'memory'), { persistent: false }, () => runtime.invalidate?.());
    } catch {
      watcher = null;
    }
  }
  resetIdle();
  return { server, endpoint: resolvedEndpoint, close, coordinator };
}

export function formatClaudePreToolHook(response) {
  validateMemoryHookResponse(response);
  if (!response.ok || !response.result) return '';
  if (response.result.budget.tier !== 'default' || response.result.budget.estimated_tokens > 400) {
    throw new Error('memory hook refuses to inject an envelope above the 400-token default budget');
  }
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: JSON.stringify(response.result),
    },
  });
}
