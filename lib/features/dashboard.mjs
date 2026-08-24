#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import { memoryIndexDir, resolveMemoryDir } from '../memory-paths.mjs';
import {
  DEFAULT_MEMORY_DASHBOARD_DIRECTORY,
  MEMORY_DASHBOARD_HOST,
  createMemoryDashboardServer,
} from '../memory-dashboard-server.mjs';

const DEFAULT_ROOT = process.cwd();
const INSTANCE_SCHEMA = 'ownmem-dashboard-instance/v1';
const PROBE_TIMEOUT_MS = 1500;

function usage() {
  return `Usage: npx ownmem dashboard [options]

Serve OwnMem Console locally. It binds 127.0.0.1 only. Default
metrics stay local; an optional embedding provider is contacted only after explicit setup.

Options:
  --open              Open the dashboard URL in the default browser
  --stop              Stop the running instance and exit
  --status            Print the running instance (if any) and exit
  --port PORT         Listen on a fixed port (default: random)
  --root PATH         Repository root
  --memory-dir PATH   Memory directory (default: the one this project installed)
  --rotate-token      Issue a fresh access token instead of reusing the stored one
  --json              Machine-readable output`;
}

function parseArgs(args) {
  const options = {
    root: DEFAULT_ROOT,
    memoryDir: null,
    directory: DEFAULT_MEMORY_DASHBOARD_DIRECTORY,
    port: 0,
    open: false,
    stop: false,
    status: false,
    json: false,
    help: false,
    rotateToken: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--root') options.root = path.resolve(args[++index]);
    else if (argument === '--memory-dir') options.memoryDir = args[++index];
    else if (argument === '--dashboard-dir') options.directory = args[++index];
    else if (argument === '--port') options.port = Number.parseInt(args[++index], 10);
    else if (argument === '--open') options.open = true;
    else if (argument === '--stop') options.stop = true;
    else if (argument === '--status') options.status = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--rotate-token') options.rotateToken = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error('--port must be an integer between 0 and 65535');
  }
  options.memoryDir = resolveMemoryDir(options.root, options.memoryDir);
  return options;
}

function instanceFile({ root, directory }) {
  const absoluteRoot = path.resolve(root);
  const absoluteDirectory = path.resolve(absoluteRoot, directory);
  const relative = path.relative(absoluteRoot, absoluteDirectory);
  const insideLocalTest = relative === '.local-test' || relative.startsWith(`.local-test${path.sep}`);
  if (!insideLocalTest) {
    throw new Error('dashboard directory must stay under the gitignored .local-test directory');
  }
  return path.join(absoluteDirectory, 'server.json');
}

// Keep the 0600 token across restarts. Rotating on every code restart invalidated an open browser tab,
// while browsers often reused that tab when only the URL fragment changed and never reloaded it.
// The token already stays in a private local file, so reuse does not change the threat model.
// Pass --rotate-token when an explicit rotation is required.
function tokenFile(options) {
  return path.join(path.dirname(instanceFile(options)), 'token');
}

function readOrCreateToken(file, rotate) {
  if (!rotate && existsSync(file)) {
    try {
      const value = readFileSync(file, 'utf8').trim();
      if (/^[a-f0-9]{64}$/.test(value)) return value;
    } catch { /* Regenerate an unreadable token. */ }
  }
  const value = randomBytes(32).toString('hex');
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${value}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return value;
}

function readInstance(file) {
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (value.schema !== INSTANCE_SCHEMA) return null;
    return value;
  } catch {
    return null;
  }
}

function writeInstance(file, value) {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.tmp-${process.pid}-${randomBytes(6).toString('hex')}`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
    chmodSync(file, 0o600);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// Recover stale server.json state after an ungraceful exit when the PID or probe is no longer live.
async function probeInstance(instance) {
  if (!instance || !processAlive(instance.pid)) return false;
  try {
    const response = await fetch(`http://${MEMORY_DASHBOARD_HOST}:${instance.port}/api/ping`, {
      headers: { 'X-Memory-Token': instance.token },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function openInBrowser(url) {
  // Launch the system browser with fixed argv arrays, no shell, and no user-built command string.
  const command = process.platform === 'darwin'
    ? ['open', [url]]
    : (process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]);
  try {
    const child = spawn(command[0], command[1], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function emit(options, io, value, humanLines) {
  if (options.json) io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else io.stdout.write(`${humanLines.join('\n')}\n`);
}

export async function runCli(rawArgs = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  const options = parseArgs(rawArgs);
  if (options.help) {
    io.stdout.write(`${usage()}\n`);
    return 0;
  }
  const file = instanceFile(options);
  const existing = readInstance(file);
  const alive = await probeInstance(existing);

  if (options.stop) {
    if (!alive) {
      rmSync(file, { force: true });
      emit(options, io, { schema: INSTANCE_SCHEMA, stopped: false, reason: 'no running instance' }, ['ownmem dashboard: no running instance']);
      return 0;
    }
    try {
      process.kill(existing.pid, 'SIGTERM');
    } catch { /* The process may have exited concurrently; treat it as stopped. */ }
    rmSync(file, { force: true });
    emit(options, io, { schema: INSTANCE_SCHEMA, stopped: true, pid: existing.pid, port: existing.port }, [`ownmem dashboard: stopped pid ${existing.pid}`]);
    return 0;
  }

  if (options.status) {
    if (!alive) {
      emit(options, io, { schema: INSTANCE_SCHEMA, running: false }, ['ownmem dashboard: not running']);
      return 0;
    }
    emit(options, io, { schema: INSTANCE_SCHEMA, running: true, ...existing }, [`ownmem dashboard: running at ${existing.url}`]);
    return 0;
  }

  if (alive) {
    if (options.open) openInBrowser(existing.url);
    emit(options, io, { schema: INSTANCE_SCHEMA, reused: true, ...existing }, [
      `ownmem dashboard: reusing instance at ${existing.url}`,
      `pid ${existing.pid} · stop with: npx ownmem dashboard --stop`,
    ]);
    return 0;
  }
  const token = readOrCreateToken(tokenFile(options), options.rotateToken);
  if (existing) rmSync(file, { force: true });

  const dashboard = createMemoryDashboardServer({
    root: options.root,
    memoryDir: options.memoryDir,
    indexDirectory: memoryIndexDir(options.memoryDir),
    token,
  });
  const { port, url } = await dashboard.listen(options.port);
  const instance = {
    schema: INSTANCE_SCHEMA,
    pid: process.pid,
    host: MEMORY_DASHBOARD_HOST,
    port,
    token: dashboard.token,
    url,
    started_at: new Date().toISOString(),
  };
  writeInstance(file, instance);

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const current = readInstance(file);
    if (current && current.pid === process.pid) rmSync(file, { force: true });
    dashboard.close().then(() => process.exit(0), () => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (options.open) openInBrowser(url);
  emit(options, io, { schema: INSTANCE_SCHEMA, reused: false, ...instance }, [
    `ownmem dashboard: ${url}`,
    'local control plane · 127.0.0.1 only · token stays in the URL fragment',
    'stop with Ctrl-C, or: npx ownmem dashboard --stop',
  ]);
  return 0;
}

if (isMemoryCliEntry(import.meta.url)) {
  runCli().then(code => {
    process.exitCode = code;
  }, error => {
    process.stderr.write(`memory-dashboard: ${error.message}\n`);
    process.exitCode = 1;
  });
}
