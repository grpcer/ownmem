#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import {
  createMemoryEmbeddingClient,
  createMemoryEmbeddingConfig,
  DEFAULT_MEMORY_EMBEDDING_DIRECTORY,
  MEMORY_EMBEDDING_PRESETS,
  memoryEmbeddingSetupConfig,
  publicMemoryEmbeddingConfig,
  readMemoryEmbeddingConfig,
  writeMemoryEmbeddingConfig,
} from '../memory-embedding-provider.mjs';
import {
  createMemoryEmbeddingArtifact,
  encodeFloat32Vector,
  loadMemoryEmbeddingCorpus,
  memoryEmbeddingArtifactPath,
  readMemoryEmbeddingArtifact,
  readUsableMemoryEmbeddingArtifact,
  reconcileMemoryEmbeddingArtifact,
  writeMemoryEmbeddingArtifact,
} from '../memory-embedding-store.mjs';
import { compileMemoryIndex } from '../memory-compiler.mjs';
import { memoryIndexDir, memoryRecallCasesFile, resolveMemoryDir } from '../memory-paths.mjs';
import {
  evaluateMemoryEmbeddingAb,
  MEMORY_EMBEDDING_SUGGESTED_WEIGHT,
} from '../memory-embedding-evaluation.mjs';

const DEFAULT_ROOT = process.cwd();

function usage() {
  return `Usage: ownmem embed <command> [options]

Commands:
  config   Write a private local provider configuration
  test     Test provider connectivity and embedding dimensions
  build    Incrementally build local vectors, checkpointing every batch
  status   Compare local vectors with the current memory corpus
  ab       Evaluate observation mode against a suggested embedding weight

Global options:
  --root PATH        Repository root
  --memory-dir PATH  Memory directory (default: the one this project installed)
  --directory PATH   Local embedding directory (default .local-test/memory-embedding)
  --index-dir PATH   Local compiled memory index (default <memory-dir>/index)
  --json             Output structured JSON

ab options:
  --offline          Require every evaluation query to hit eval-cache.json
  --weight N         Suggested B ranking weight (default ${MEMORY_EMBEDDING_SUGGESTED_WEIGHT})
  --cases PATH       ownmem-recall-benchmark/v4 cases (default ${memoryRecallCasesFile('<memory-dir>')})

config options:
  --provider ID      siliconflow | cloudflare | gemini | jina | custom
  --base-url URL     Override the preset OpenAI-compatible base URL
  --model ID         Override the preset embedding model
  --api-key VALUE    API key (prefer --api-key-env to avoid shell history)
  --api-key-env NAME Read the API key from an environment variable
  --account-id ID    Required when using the Cloudflare preset URL
  --dimensions N     Request a fixed output dimension when supported
  --timeout-ms N     Per-request timeout (default 800)

With a TTY, omitted config fields are prompted and the API key input is masked.`;
}

function optionValue(rawArgs, index, option) {
  const value = rawArgs[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function parseArgs(rawArgs) {
  const command = rawArgs[0];
  if (!command || command === '--help' || command === '-h') return { help: true };
  if (!['config', 'test', 'build', 'status', 'ab'].includes(command)) {
    throw new Error(`unknown memory-embed command: ${command}`);
  }
  const options = {
    command,
    root: DEFAULT_ROOT,
    memoryDir: null,
    directory: DEFAULT_MEMORY_EMBEDDING_DIRECTORY,
    indexDirectory: null,
    json: false,
    offline: false,
    suggestedWeight: MEMORY_EMBEDDING_SUGGESTED_WEIGHT,
    casesFile: null,
    config: {},
  };
  for (let index = 1; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--offline') {
      if (command !== 'ab') throw new Error('--offline is only valid with the ab command');
      options.offline = true;
    } else if (argument === '--weight') {
      if (command !== 'ab') throw new Error('--weight is only valid with the ab command');
      options.suggestedWeight = Number(optionValue(rawArgs, index, argument));
      index += 1;
    } else if (argument === '--cases') {
      if (command !== 'ab') throw new Error('--cases is only valid with the ab command');
      options.casesFile = optionValue(rawArgs, index, argument);
      index += 1;
    } else if (['--root', '--memory-dir', '--directory', '--index-dir'].includes(argument)) {
      const value = optionValue(rawArgs, index, argument);
      index += 1;
      if (argument === '--root') options.root = path.resolve(value);
      if (argument === '--memory-dir') options.memoryDir = value;
      if (argument === '--directory') options.directory = value;
      if (argument === '--index-dir') options.indexDirectory = value;
    } else if (['--provider', '--base-url', '--model', '--api-key', '--api-key-env', '--account-id', '--dimensions', '--timeout-ms'].includes(argument)) {
      if (command !== 'config') throw new Error(`${argument} is only valid with the config command`);
      const value = optionValue(rawArgs, index, argument);
      index += 1;
      const key = {
        '--provider': 'provider',
        '--base-url': 'baseUrl',
        '--model': 'model',
        '--api-key': 'apiKey',
        '--api-key-env': 'apiKeyEnv',
        '--account-id': 'accountId',
        '--dimensions': 'dimensions',
        '--timeout-ms': 'timeoutMs',
      }[argument];
      options.config[key] = value;
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }
  if (options.config.apiKey && options.config.apiKeyEnv) {
    throw new Error('use only one of --api-key or --api-key-env');
  }
  // Resolved after the loop so that --root is final. Embedding compiles the corpus itself, so the
  // .claude/memory default did not merely read the wrong directory: it aborted every command on a
  // healthy install with "memory directory does not exist".
  options.memoryDir = resolveMemoryDir(options.root, options.memoryDir);
  options.indexDirectory ??= memoryIndexDir(options.memoryDir);
  return options;
}

async function promptLine(label, defaultValue, { input, output }) {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const readline = createInterface({ input, output });
  try {
    const value = (await readline.question(`${label}${suffix}: `)).trim();
    return value || defaultValue || '';
  } finally {
    readline.close();
  }
}

async function promptSecret(label, { input, output }) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('interactive API key input requires a TTY; use --api-key-env in non-interactive shells');
  }
  output.write(`${label}: `);
  const wasRaw = Boolean(input.isRaw);
  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');
  let value = '';
  try {
    return await new Promise((resolve, reject) => {
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === '\u0003') {
            input.off('data', onData);
            output.write('\n');
            reject(new Error('configuration cancelled'));
            return;
          }
          if (character === '\r' || character === '\n') {
            input.off('data', onData);
            output.write('\n');
            resolve(value);
            return;
          }
          if (character === '\u007f' || character === '\b') {
            if (value.length > 0) {
              value = value.slice(0, -1);
              output.write('\b \b');
            }
          } else if (character >= ' ') {
            value += character;
            output.write('*');
          }
        }
      };
      input.on('data', onData);
    });
  } finally {
    input.setRawMode(wasRaw);
    input.pause();
  }
}

async function completeConfigInput(raw, { stdin, stderr, env }) {
  const input = { ...raw };
  const canPrompt = Boolean(stdin.isTTY);
  if (!input.provider) {
    if (!canPrompt) throw new Error('config requires --provider in non-interactive shells');
    input.provider = await promptLine('Provider', 'siliconflow', { input: stdin, output: stderr });
  }
  const preset = MEMORY_EMBEDDING_PRESETS[input.provider];
  if (!preset) throw new Error(`unknown memory embedding provider: ${input.provider}`);
  if (input.provider === 'cloudflare' && !input.baseUrl?.trim() && !input.accountId) {
    if (!canPrompt) throw new Error('Cloudflare config requires --account-id when the preset URL is used');
    input.accountId = await promptLine('Cloudflare Account ID', '', { input: stdin, output: stderr });
  }
  if (!input.baseUrl?.trim() && !preset.base_url) {
    if (!canPrompt) throw new Error('custom provider config requires --base-url');
    input.baseUrl = await promptLine('OpenAI-compatible base URL', '', { input: stdin, output: stderr });
  }
  if (!input.model?.trim() && !preset.default_model) {
    if (!canPrompt) throw new Error('custom provider config requires --model');
    input.model = await promptLine('Embedding model', '', { input: stdin, output: stderr });
  } else if (canPrompt && !input.model) {
    input.model = await promptLine('Embedding model', preset.default_model, { input: stdin, output: stderr });
  }
  if (input.apiKeyEnv) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.apiKeyEnv)) throw new Error('--api-key-env must be an environment variable name');
    input.apiKey = env[input.apiKeyEnv];
    if (!input.apiKey) throw new Error(`environment variable ${input.apiKeyEnv} is empty or missing`);
  }
  if (!input.apiKey) {
    if (!canPrompt) throw new Error('config requires --api-key-env or --api-key in non-interactive shells');
    input.apiKey = await promptSecret('API key', { input: stdin, output: stderr });
  }
  return input;
}

function outputResult(value, options, { stdout }) {
  if (options.json) stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function ensureCurrentCorpus(options, compile) {
  compile({
    root: options.root,
    memoryDir: options.memoryDir,
    indexDirectory: options.indexDirectory,
  });
  return loadMemoryEmbeddingCorpus({
    root: options.root,
    indexDirectory: options.indexDirectory,
  });
}

function prepareEmbeddingBuild({ root, memoryDir, directory, indexDirectory, config, compile }) {
  const corpus = ensureCurrentCorpus({ root, memoryDir, directory, indexDirectory }, compile);
  const { artifact: existing, unusable } = readUsableMemoryEmbeddingArtifact({ root, directory, config });
  const reconciliation = reconcileMemoryEmbeddingArtifact({ config, corpus, artifact: existing });
  const entries = reconciliation.requires_full_rebuild ? {} : { ...existing.entries };
  for (const documentId of reconciliation.deleted_document_ids) delete entries[documentId];
  return {
    corpus,
    existing,
    discardedArtifact: unusable,
    reconciliation,
    entries,
    dimensions: reconciliation.requires_full_rebuild ? config.dimensions : existing.dimensions,
  };
}

/**
 * An in-flight incremental build must not yet claim the new snapshot id.
 *
 * Checkpoints start from `{...existing.entries}`, so mid-build the artifact holds vectors the new
 * corpus has already invalidated. `staleState` in memory-embedding-channel.mjs takes a fast path
 * whenever the artifact's snapshot id equals the planner's, and that path compares **presence
 * only** -- every carried-over entry would read as fresh, the channel would report
 * `degraded_reason: null`, and ranking would silently run on vectors it knows are outdated. Keeping
 * the previous id until the final batch forces the reconciling path, which compares
 * `content_sha256`, so a partial build degrades honestly instead of lying cheaply.
 *
 * A full rebuild carries nothing forward, so presence alone is already a correct answer there and
 * the new id is safe from the first batch.
 */
function checkpointCorpus(state) {
  const previous = state.existing?.corpus_snapshot_id;
  if (!previous || state.reconciliation.requires_full_rebuild) return state.corpus;
  return { ...state.corpus, snapshot_id: previous };
}

function writeEmbeddingArtifact(state, { root, directory, config, now }, corpus) {
  const artifact = createMemoryEmbeddingArtifact({
    config,
    corpus,
    dimensions: state.dimensions,
    entries: state.entries,
    builtAt: now(),
  });
  writeMemoryEmbeddingArtifact({ root, directory, config }, artifact);
}

function checkpointEmbeddingBatch(state, writeContext, { offset, vectors, dimensions }) {
  state.dimensions ??= dimensions;
  for (let index = 0; index < vectors.length; index += 1) {
    const document = state.reconciliation.pending[offset + index];
    state.entries[document.document_id] = {
      content_sha256: document.content_sha256,
      vector_b64: encodeFloat32Vector(vectors[index]),
    };
  }
  writeEmbeddingArtifact(state, writeContext, checkpointCorpus(state));
}

// Only once every pending vector has landed does the artifact get to claim the new corpus. An
// aborted build simply never reaches this line, leaving the previous id in place.
function finalizeEmbeddingArtifact(state, writeContext) {
  writeEmbeddingArtifact(state, writeContext, state.corpus);
}

function refreshEmbeddingArtifactMetadata(state, { root, directory, config, now }) {
  if (!state.existing || (!state.reconciliation.deleted && !state.reconciliation.snapshot_changed)) return;
  const artifact = createMemoryEmbeddingArtifact({
    config,
    corpus: state.corpus,
    dimensions: state.dimensions,
    entries: state.entries,
    builtAt: now(),
  });
  writeMemoryEmbeddingArtifact({ root, directory, config }, artifact);
}

function memoryEmbeddingBuildResult(state, artifact, { root, directory, config }) {
  const final = reconcileMemoryEmbeddingArtifact({ config, corpus: state.corpus, artifact });
  return {
    schema: 'ownmem-embedding-build-result/v1',
    provider: config.provider,
    model: config.model,
    dimensions: artifact?.dimensions || null,
    mode: state.reconciliation.mode,
    embedded: state.reconciliation.pending.length,
    deleted: state.reconciliation.deleted,
    total: state.reconciliation.total,
    stale: final.stale,
    artifact: artifact ? path.relative(root, memoryEmbeddingArtifactPath({ root, directory, config })) : null,
    discarded_artifact: state.discardedArtifact ?? null,
    snapshot_id: state.corpus.snapshot_id,
  };
}

export async function buildMemoryEmbeddings({
  root,
  memoryDir = '.claude/memory',
  directory,
  indexDirectory,
  config,
  fetchImpl,
  sleepImpl,
  compile = compileMemoryIndex,
  now = () => new Date(),
  onProgress,
  signal,
} = {}) {
  const context = { root, memoryDir, directory, indexDirectory, config, compile };
  const state = prepareEmbeddingBuild(context);
  const writeContext = { root, directory, config, now };
  const client = createMemoryEmbeddingClient(memoryEmbeddingSetupConfig(config), { fetchImpl, sleepImpl });
  if (state.reconciliation.pending.length > 0) {
    await client.embed(state.reconciliation.pending.map((document) => document.text), {
      signal,
      onBatch: async (batch) => {
        checkpointEmbeddingBatch(state, writeContext, batch);
        await onProgress?.({
          completed: state.reconciliation.fresh + batch.offset + batch.vectors.length,
          total: state.reconciliation.total,
          batch: batch.vectors.length,
        });
      },
    });
    finalizeEmbeddingArtifact(state, writeContext);
  } else refreshEmbeddingArtifactMetadata(state, writeContext);
  const artifact = readMemoryEmbeddingArtifact({ root, directory, config });
  return memoryEmbeddingBuildResult(state, artifact, { root, directory, config });
}

export function inspectMemoryEmbeddingStatus({
  root,
  memoryDir = '.claude/memory',
  directory,
  indexDirectory,
  compile = compileMemoryIndex,
} = {}) {
  const config = readMemoryEmbeddingConfig({ root, directory });
  if (!config) {
    return {
      schema: 'ownmem-embedding-status/v1',
      configured: false,
      config: null,
      artifact_error: null,
      artifact: null,
      reconciliation: null,
    };
  }
  const corpus = ensureCurrentCorpus({ root, memoryDir, directory, indexDirectory }, compile);
  // An unreadable artifact reports as "never built" while staying configured, so the UI asks for a
  // rebuild that heals it instead of failing the whole status block as if the setup were lost.
  const { artifact, unusable } = readUsableMemoryEmbeddingArtifact({ root, directory, config });
  const reconciliation = reconcileMemoryEmbeddingArtifact({ config, corpus, artifact });
  return {
    schema: 'ownmem-embedding-status/v1',
    configured: true,
    config: publicMemoryEmbeddingConfig(config),
    artifact_error: unusable,
    artifact: artifact ? {
      path: path.relative(root, memoryEmbeddingArtifactPath({ root, directory, config })),
      dimensions: artifact.dimensions,
      built_at: artifact.built_at,
      corpus_snapshot_id: artifact.corpus_snapshot_id,
      entries: Object.keys(artifact.entries).length,
    } : null,
    reconciliation: {
      mode: reconciliation.mode,
      requires_full_rebuild: reconciliation.requires_full_rebuild,
      total: reconciliation.total,
      fresh: reconciliation.fresh,
      stale: reconciliation.stale,
      deleted: reconciliation.deleted,
      snapshot_id: corpus.snapshot_id,
    },
  };
}

async function runConfigCommand(options, io) {
  const input = await completeConfigInput(options.config, io);
  const config = createMemoryEmbeddingConfig(input);
  const file = writeMemoryEmbeddingConfig({ root: options.root, directory: options.directory }, config);
  const result = {
    schema: 'ownmem-embedding-config-result/v1',
    path: path.relative(options.root, file),
    config: publicMemoryEmbeddingConfig(config),
  };
  outputResult(result, options, io);
  if (!options.json) io.stdout.write(`memory embedding config: wrote ${result.path} (0600, key ${result.config.api_key_masked})\n`);
}

function runStatusCommand(options, io, compile) {
  const result = inspectMemoryEmbeddingStatus({
    root: options.root,
    memoryDir: options.memoryDir,
    directory: options.directory,
    indexDirectory: options.indexDirectory,
    compile,
  });
  outputResult(result, options, io);
  if (options.json) return;
  if (!result.configured) io.stdout.write('memory embedding: not configured\n');
  else io.stdout.write(`memory embedding: ${result.reconciliation.fresh}/${result.reconciliation.total} fresh, ${result.reconciliation.stale} stale, ${result.reconciliation.deleted} deleted\n`);
}

function requiredEmbeddingConfig(options) {
  const config = readMemoryEmbeddingConfig({ root: options.root, directory: options.directory });
  if (!config) throw new Error('memory embedding is not configured; run the config command first');
  return config;
}

async function runTestCommand(options, io, dependencies) {
  const client = createMemoryEmbeddingClient(memoryEmbeddingSetupConfig(requiredEmbeddingConfig(options)), {
    fetchImpl: dependencies.fetchImpl,
    sleepImpl: dependencies.sleepImpl,
  });
  const result = await client.test();
  outputResult(result, options, io);
  if (!options.json) io.stdout.write(`memory embedding test: ${result.provider}/${result.model}, ${result.dimensions} dimensions, ${result.latency_ms}ms\n`);
}

async function runBuildCommand(options, io, dependencies, compile) {
  const config = requiredEmbeddingConfig(options);
  const result = await buildMemoryEmbeddings({
    root: options.root,
    memoryDir: options.memoryDir,
    directory: options.directory,
    indexDirectory: options.indexDirectory,
    config,
    fetchImpl: dependencies.fetchImpl,
    sleepImpl: dependencies.sleepImpl,
    compile,
    now: dependencies.now,
    onProgress: options.json ? undefined : ({ completed, total }) => io.stderr.write(`memory embedding build: ${completed}/${total}\n`),
  });
  outputResult(result, options, io);
  if (!options.json) io.stdout.write(`memory embedding build: ${result.mode}, ${result.embedded} embedded, ${result.stale} stale\n`);
}

async function runAbCommand(options, io, dependencies, compile) {
  const result = await evaluateMemoryEmbeddingAb({
    root: options.root,
    memoryDir: options.memoryDir,
    directory: options.directory,
    indexDirectory: options.indexDirectory,
    config: requiredEmbeddingConfig(options),
    suggestedWeight: options.suggestedWeight,
    offline: options.offline,
    fetchImpl: dependencies.fetchImpl,
    sleepImpl: dependencies.sleepImpl,
    compile,
    casesFile: options.casesFile || dependencies.casesFile,
    onProgress: options.json ? undefined : ({ completed, total }) => (
      io.stderr.write(`memory embedding A/B cache: ${completed}/${total}\n`)
    ),
  });
  outputResult(result, options, io);
  if (!options.json) {
    const { metrics, guard } = result.report;
    io.stdout.write(
      `memory embedding A/B: golden R@1 ${metrics.golden.a.recall_at_1} -> ${metrics.golden.b.recall_at_1}; `
      + `negative abstain ${metrics.negative.a.abstain_rate} -> ${metrics.negative.b.abstain_rate}; `
      + `safe=${guard.recommended_weight_safe}; report ${result.report_file}\n`,
    );
  }
}

export async function runCli(rawArgs = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(rawArgs);
  const io = {
    stdin: dependencies.stdin || process.stdin,
    stdout: dependencies.stdout || process.stdout,
    stderr: dependencies.stderr || process.stderr,
    env: dependencies.env || process.env,
  };
  if (options.help) {
    io.stdout.write(`${usage()}\n`);
    return 0;
  }
  const compile = dependencies.compile || compileMemoryIndex;
  if (options.command === 'config') await runConfigCommand(options, io);
  else if (options.command === 'status') runStatusCommand(options, io, compile);
  else if (options.command === 'test') await runTestCommand(options, io, dependencies);
  else if (options.command === 'build') await runBuildCommand(options, io, dependencies, compile);
  else if (options.command === 'ab') await runAbCommand(options, io, dependencies, compile);
  else throw new Error(`unsupported memory-embed command: ${options.command}`);
  return 0;
}

if (isMemoryCliEntry(import.meta.url)) {
  runCli().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`ownmem embed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
