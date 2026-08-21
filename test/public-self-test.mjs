#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPublicBenchmark } from '../benchmarks/public-benchmark.mjs';
import { runMultilingualTokenizerSelfTest } from './tokenizer-multilingual-self-test.mjs';

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENTRY = path.join(PACKAGE_ROOT, 'bin', 'ownmem.mjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(args, cwd, expected = 0) {
  const result = spawnSync(process.execPath, [ENTRY, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert(result.status === expected, `memory ${args.join(' ')} exited ${result.status}: ${result.stderr || result.stdout}`);
  return result;
}

function runCommand(command, args, cwd, expected = 0, extra = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    // The npm steps download into a cold fixture-owned cache, so their duration is
    // set by the registry route, not this machine: a slow or proxied route
    // legitimately takes minutes. 60s killed the warm install on such networks.
    timeout: 300_000,
    ...extra,
  });
  const outcome = result.status === null ? `was killed (${result.signal || 'timeout'})` : `exited ${result.status}`;
  assert(result.status === expected, `${command} ${args.join(' ')} ${outcome}: ${result.stderr || result.stdout}`);
  return result;
}

// npm must be launched as `node npm-cli.js`: Windows ships npm as a .cmd shim, which spawnSync
// cannot execute without a shell, and a shell would mangle the deliberately space-laden fixture
// paths. Under any `npm run`/`npm test` invocation npm_execpath points at the CLI script; the
// Bundled-layout probes cover direct `node test/public-self-test.mjs` runs.
function npmCliScript() {
  const fromEnv = process.env.npm_execpath;
  if (fromEnv && /\.[cm]?js$/.test(fromEnv) && existsSync(fromEnv)) return fromEnv;
  const nodeDirectory = path.dirname(process.execPath);
  for (const candidate of [
    path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('npm CLI script was not found; run this self-test through `npm test`');
}

function runNpm(args, cwd, expected = 0, extra = {}) {
  return runCommand(process.execPath, [npmCliScript(), ...args], cwd, expected, extra);
}

function packedOfflineInstall(fixture) {
  const packDirectory = path.join(fixture, 'packed artifact');
  const consumer = path.join(fixture, 'offline consumer 空格');
  const cache = path.join(fixture, 'npm cache');
  mkdirSync(packDirectory, { recursive: true });
  mkdirSync(consumer, { recursive: true });
  // scripts/ is this repository's own private toolbox (firebase-admin, clear:user-data, private:true
  // and no name/version), so npm pack refuses it outright. What a consumer installs is the standalone
  // release the whitelist generates, so the tarball has to be built from that instead.
  // Shelled out rather than imported: lib/memory-public-release.mjs is release tooling and is not part
  // of any shipped layer, so importing it here would fail the layer-completeness check. Driving the CLI
  // is also closer to how a release is actually cut. In a standalone release checkout that tool is
  // intentionally absent; there the package root already is the shippable release, so pack it directly.
  const releaseTool = path.join(PACKAGE_ROOT, 'memory-public-release.mjs');
  let release = PACKAGE_ROOT;
  if (existsSync(releaseTool)) {
    release = path.join(fixture, 'generated release');
    runCommand('node', [releaseTool, '--output', release, '--no-git'], PACKAGE_ROOT);
  }
  const packed = JSON.parse(runNpm([
    'pack', release, '--json', '--ignore-scripts', '--pack-destination', packDirectory,
  ], release).stdout)[0];
  const tarball = path.join(packDirectory, packed.filename);
  // The offline assertion is only meaningful against a cache this test controls: a developer's
  // global cache hides missing-metadata failures, while a fresh CI cache holds tarballs but no
  // packuments (npm ci never fetches them), so dependency-range resolution dies with ENOTCACHED.
  // One online install of the same tarball into a throwaway consumer fills the fixture cache with
  // exactly what the offline install needs.
  const warmConsumer = path.join(fixture, 'warm consumer');
  mkdirSync(warmConsumer, { recursive: true });
  runNpm([
    'install', '--ignore-scripts', '--no-audit', '--no-fund', tarball,
  ], warmConsumer, 0, { env: { ...process.env, npm_config_cache: cache } });
  runNpm([
    'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', tarball,
  ], consumer, 0, { env: { ...process.env, npm_config_offline: 'true', npm_config_cache: cache } });
  const installedEntry = path.join(consumer, 'node_modules', 'ownmem', 'bin', 'ownmem.mjs');
  assert(existsSync(installedEntry), 'offline tarball install did not materialize the package');
  const help = runNpm(['exec', '--offline', '--', 'ownmem', '--help'], consumer, 0, {
    env: { ...process.env, npm_config_offline: 'true', npm_config_cache: cache },
  });
  assert(help.stdout.includes('Usage: ownmem <command>'), 'offline installed npm bin did not execute');
  const apiProbe = runCommand(process.execPath, ['--input-type=module', '--eval', `
    import { readFileSync } from 'node:fs';
    import { classifyIntent } from 'ownmem';
    if (classifyIntent('do you remember this?') !== 'recall') throw new Error('package API export failed');
    // import.meta.resolve is only unflagged from Node 20.6.0, which is the floor
    // package.json declares. Say so instead of dying on a bare TypeError below.
    if (typeof import.meta.resolve !== 'function') {
      throw new Error('ownmem requires Node 20.6.0 or newer: import.meta.resolve is unavailable on ' + process.version);
    }
    const schema = JSON.parse(readFileSync(new URL(import.meta.resolve('ownmem/schemas/memory.schema.json')), 'utf8'));
    if (!schema.$id.endsWith('/schemas/memory.schema.json')) throw new Error('schema subpath export failed');
  `], consumer);
  assert(!apiProbe.stderr, `offline installed package API probe failed: ${apiProbe.stderr}`);
  const project = path.join(consumer, 'initialized project');
  mkdirSync(project, { recursive: true });
  const initialized = runNpm([
    'exec', '--offline', '--', 'ownmem', 'init', '--root', project, '--hosts', 'generic', '--command', 'ownmem',
  ], consumer, 0, { env: { ...process.env, npm_config_offline: 'true', npm_config_cache: cache } });
  assert(initialized.stdout.includes('ownmem init: ready'), 'offline installed npm bin did not initialize a clean consumer');
  const recalled = JSON.parse(runNpm([
    'exec', '--offline', '--', 'ownmem', 'recall', '--root', project, '--json', '--', 'repository constraint',
  ], consumer, 0, { env: { ...process.env, npm_config_offline: 'true', npm_config_cache: cache } }).stdout);
  assert(recalled.results[0]?.memory_id === 'example_repository_memory', 'offline installed npm bin did not recall from the initialized consumer');
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}

async function dashboardLifecycle(project) {
  const child = spawn(process.execPath, [ENTRY, 'dashboard', '--root', project, '--memory-dir', '.ownmem', '--json'], {
    cwd: project,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  const instanceFile = path.join(project, '.local-test', 'memory-dashboard', 'server.json');
  try {
    const instance = await waitFor(() => existsSync(instanceFile) && JSON.parse(readFileSync(instanceFile, 'utf8')));
    assert(instance.host === '127.0.0.1', 'dashboard must bind the numeric loopback host');
    const ping = await fetch(`http://${instance.host}:${instance.port}/api/ping`, {
      headers: { 'X-Memory-Token': instance.token },
      signal: AbortSignal.timeout(2_000),
    });
    assert(ping.ok, `dashboard ping failed with HTTP ${ping.status}`);
    const page = await fetch(`http://${instance.host}:${instance.port}/?lang=ar`, {
      signal: AbortSignal.timeout(2_000),
    });
    const html = await page.text();
    assert(page.headers.get('content-language') === 'ar', 'dashboard did not negotiate Arabic');
    assert(/<html[^>]+lang="ar"[^>]+dir="rtl"/.test(html), 'dashboard did not render the RTL document contract');
    const status = JSON.parse(run(['dashboard', '--root', project, '--status', '--json'], project).stdout);
    assert(status.running && status.pid === child.pid, 'dashboard status did not resolve the live instance');
    const stopped = JSON.parse(run(['dashboard', '--root', project, '--stop', '--json'], project).stdout);
    assert(stopped.stopped && stopped.pid === child.pid, 'dashboard stop did not terminate the live instance');
    await waitFor(() => child.exitCode !== null, 5_000);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
    assert(!stderr, `dashboard wrote unexpected stderr: ${stderr}`);
  }
}

async function main() {
  runMultilingualTokenizerSelfTest();
  const fixture = mkdtempSync(path.join(tmpdir(), 'memory-public-e2e-'));
  const project = path.join(fixture, 'consumer project 测试');
  mkdirSync(path.join(project, '.claude'), { recursive: true });
  writeFileSync(path.join(project, 'AGENTS.md'), '# Project instructions\n', 'utf8');
  try {
    run(['init', '--root', project, '--layers', 'dashboard', '--locale', 'ar-EG', '--hosts', 'claude,codex', '--command', 'ownmem', '--hook'], project);
    const config = JSON.parse(readFileSync(path.join(project, '.ownmem', 'config.json'), 'utf8'));
    assert(config.layers.join(',') === 'core,gates,compiler,dashboard', 'dashboard init did not close layer dependencies');
    assert(config.adapters.join(',') === 'claude,codex', 'Claude Code and Codex adapters were not both installed');
    assert(config.locale === 'ar-EG' && config.hook_enabled, 'locale or Claude hook configuration was not preserved');
    assert(readFileSync(path.join(project, 'AGENTS.md'), 'utf8').startsWith('# Project instructions'), 'Codex adapter overwrote project-owned instructions');
    assert(existsSync(path.join(project, '.claude', 'commands', 'ownmem.md')), 'Claude Code command adapter is missing');
    assert(run(['init', '--root', project, '--check', '--json'], project).status === 0, 'init check reported drift immediately after installation');

    const recalled = JSON.parse(run(['recall', '--root', project, '--json', '--', 'repository constraint'], project).stdout);
    assert(recalled.results[0]?.memory_id === 'example_repository_memory', 'initialized memory was not recalled');
    run(['recall', '--root', project, '--feedback', 'correct', '--', 'repository constraint'], project);
    const feedback = readFileSync(path.join(project, '.local-test', 'memory-recall-feedback.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line));
    assert(feedback.length === 1 && feedback[0].verdict === 'correct'
      && feedback[0].expected === 'example_repository_memory', 'explicit recall feedback was not stored in the local review inbox');
    run(['audit', '--root', project, '--skip-benchmark', '--no-observability'], project);
    run(['compile', '--root', project, '--json'], project);
    const recalledByTopicPath = JSON.parse(run([
      'recall', '--root', project, '--json', '--', '.ownmem/example_repository_memory.md',
    ], project).stdout);
    assert(recalledByTopicPath.results[0]?.memory_id === 'example_repository_memory', 'compiled topic source path was not recalled exactly');

    // The consumer install must observe itself: recalls, deliveries, feedback, and gates all land
    // as local events, and the report reads them back. This is exactly the loop that a bundled
    // optional-adapter import once silently disabled.
    run(['audit', '--root', project, '--skip-benchmark'], project);
    const observabilityDirectory = path.join(project, '.local-test', 'memory-observability');
    const events = readdirSync(observabilityDirectory)
      .filter(name => name.startsWith('events-'))
      .flatMap(name => readFileSync(path.join(observabilityDirectory, name), 'utf8').trim().split('\n'))
      .map(line => JSON.parse(line));
    assert(events.every(event => event.schema === 'ownmem-observability.event/v1'), 'a local observability event failed its schema identity');
    for (const expected of ['recall.completed', 'recall.delivered', 'feedback.recorded', 'gate.completed']) {
      assert(events.some(event => event.event === expected), `consumer usage did not produce a local ${expected} event`);
    }
    assert(existsSync(path.join(observabilityDirectory, 'recent-recalls.jsonl')), 'delivered recalls were not remembered for consumption pairing');
    const reported = run(['report', '--root', project, '--since', '7d'], project).stdout;
    assert(reported.includes('install local-'), 'report did not attribute the initialized local install');
    assert(!reported.includes('scripts/memory-'), 'report referenced a private repository script');

    if (process.platform !== 'win32') {
      const linked = path.join(fixture, 'memory bin');
      symlinkSync(ENTRY, linked);
      const result = spawnSync(process.execPath, [linked, '--help'], { cwd: project, encoding: 'utf8' });
      assert(result.status === 0 && result.stdout.includes('ownmem dashboard'), 'real-path/symlink CLI entry contract failed');
    }

    await dashboardLifecycle(project);
    packedOfflineInstall(fixture);
    const benchmark = await runPublicBenchmark({ iterations: 2 });
    assert(benchmark.gates.quality_passed && benchmark.gates.passed, 'public multilingual retrieval smoke gate failed');
    assert(!benchmark.gates.performance_enforced && benchmark.gates.release_passed === null, 'short public self-test must not fabricate release latency evidence');
    assert(benchmark.engines.core.negative_abstention.rate === 1, 'public negative-query abstention lock failed');
    assert(Object.values(benchmark.engines.core.by_language).every(item => item.recall_at_1 === 1 && item.mrr === 1 && item.negative_abstention.rate === 1), 'a per-language quality lock failed');
    assert(Object.values(benchmark.engines.core.by_script).every(item => item.recall_at_1 === 1 && item.mrr === 1 && item.negative_abstention.rate === 1), 'a per-script quality lock failed');
    process.stdout.write(`memory public self-test: passed on ${process.platform} ${process.arch}\n`);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`memory public self-test: ${error.message}\n`);
  process.exitCode = 1;
});
