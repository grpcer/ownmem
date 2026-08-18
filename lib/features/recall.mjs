#!/usr/bin/env node

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import readline from 'node:readline';
import path from 'node:path';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import {
  loadMemoryIndex,
  rankMemory,
  searchMemory,
  tokenize,
} from '../memory-markdown-index.mjs';
import {
  DEFAULT_MEMORY_INDEX_DIRECTORY,
} from '../memory-compiler.mjs';
import {
  validateMemoryStdioRequest,
  validateMemoryStdioResponse,
} from '../memory-contracts.mjs';
import {
  createMemoryRecallRuntime as createMemoryRecallRuntimeCore,
  MEMORY_RECALL_RUNTIME_VERSION,
  queryMemoryRuntime,
  queryMemoryRuntimeMulti,
} from '../memory-runtime.mjs';
let createMemoryRuntimeObserver = () => null;
let createMemoryObservabilityEvent = value => value;
let recordMemoryObservabilityEvent = () => ({ written: false, error: 'observability adapter is not installed' });
let recordMemoryDelivery = () => ({ write: { written: true, error: null } });
let DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY = '.local-test/memory-observability';
let rememberMemoryRecall = () => ({ written: false, reason: 'recall ledger is not installed' });
// Public packages may omit host telemetry; without it, retain the legacy mode-only component split.
let recallComponent = source => (source?.mode === 'snapshot' ? 'memory-recall-snapshot' : 'memory-recall-fallback');
// Each adapter degrades independently: bundling these imports once disabled every event writer
// whenever a single optional module was absent, which silently blanked report and dashboard.
try {
  const observability = await import('../memory-observability.mjs');
  createMemoryObservabilityEvent = observability.createMemoryObservabilityEvent;
  recordMemoryObservabilityEvent = observability.recordMemoryObservabilityEvent;
  recordMemoryDelivery = observability.recordMemoryDelivery;
  DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY = observability.DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY;
} catch {
  // A build without the observability adapter keeps recall itself fully functional.
}
try {
  const runtimeObservability = await import('../memory-runtime-observability.mjs');
  createMemoryRuntimeObserver = runtimeObservability.createMemoryRuntimeObserver;
  recallComponent = runtimeObservability.recallComponent;
} catch {
  // Without the observer no trace IDs are issued, so delivery and feedback events stay silent too.
}
try {
  const ledger = await import('../memory-recall-ledger.mjs');
  rememberMemoryRecall = ledger.rememberMemoryRecall;
} catch {
  // Without the ledger a full-text open simply cannot pair with the recall that produced it.
}

const DEFAULT_ROOT = process.cwd();
const DEFAULT_MEMORY_DIR = '.claude/memory';
const DEFAULT_LIMIT = 5;
const DEFAULT_FEEDBACK_FILE = '.local-test/memory-recall-feedback.jsonl';
const DEFAULT_USAGE_FILE = '.local-test/memory-recall-usage.jsonl';
const MEMORY_STDIO_RESPONSE_SCHEMA = 'ownmem-stdio-response/v1';
const MAX_STDIO_LINE_BYTES = 64 * 1024;

export { loadMemoryIndex, rankMemory, searchMemory, tokenize };

export function createMemoryRecallRuntime(options, dependencies = {}) {
  return createMemoryRecallRuntimeCore(options, {
    ...dependencies,
    fallback: dependencies.fallback || {
    // Only the final fallback skips invalid topics. Compilation remains strict by design.
      load: (options) => loadMemoryIndex({ ...options, skipInvalidTopics: true }),
      search: searchMemory,
    },
    observer: dependencies.observer === undefined
      ? createMemoryRuntimeObserver(options)
      : dependencies.observer,
  });
}

export { queryMemoryRuntime, queryMemoryRuntimeMulti };
function parseArgs(rawArgs) {
  const options = {
    root: process.env.OWNMEM_ROOT || process.env.ORIVEO_MEMORY_ROOT || DEFAULT_ROOT,
    memoryDir: process.env.OWNMEM_DIR || process.env.ORIVEO_MEMORY_DIR || DEFAULT_MEMORY_DIR,
    indexDirectory: DEFAULT_MEMORY_INDEX_DIRECTORY,
    limit: 3,
    tier: 'default',
    excludeMemoryIds: [],
    json: false,
    stdio: false,
    multi: false,
    usageLog: false,
    observability: true,
    observabilityDirectory: DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
    surface: 'cli',
    embeddingDirectory: process.env.OWNMEM_EMBEDDING_DIR || process.env.ORIVEO_MEMORY_EMBEDDING_DIR || '.local-test/memory-embedding',
    queries: [],
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];
    if (['--root', '--memory-dir', '--index-dir', '--embedding-dir', '--limit', '--tier', '--exclude-memory-id', '--feedback', '--expected', '--feedback-file', '--usage-file', '--observability-dir', '--surface'].includes(argument)) {
      const value = rawArgs[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === '--root') options.root = path.resolve(value);
      if (argument === '--memory-dir') options.memoryDir = value;
      if (argument === '--index-dir') options.indexDirectory = value;
      if (argument === '--embedding-dir') options.embeddingDirectory = value;
      if (argument === '--tier') options.tier = value;
      if (argument === '--exclude-memory-id') options.excludeMemoryIds.push(value);
      if (argument === '--feedback') options.feedback = value;
      if (argument === '--expected') options.expected = value;
      if (argument === '--feedback-file') options.feedbackFile = value;
      if (argument === '--usage-file') {
        options.usageFile = value;
        options.usageLog = true;
      }
      if (argument === '--observability-dir') options.observabilityDirectory = value;
      if (argument === '--surface') options.surface = value;
      if (argument === '--limit') {
        options.limit = Number.parseInt(value, 10);
        if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 3) {
          throw new Error('--limit must be an integer between 1 and 3');
        }
      }
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--stdio') {
      options.stdio = true;
    } else if (argument === '--multi') {
      options.multi = true;
    } else if (argument === '--no-usage-log') {
      options.usageLog = false;
    } else if (argument === '--no-observability') {
      options.observability = false;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument.startsWith('--')) {
      throw new Error(`unknown option: ${argument}`);
    } else {
      options.queries.push(argument);
    }
  }
  if (options.feedback && !['correct', 'wrong', 'miss'].includes(options.feedback)) {
    throw new Error('--feedback must be correct, wrong, or miss');
  }
  if (options.feedback && options.queries.length !== 1) throw new Error('--feedback requires exactly one query');
  if (options.multi && (options.queries.length < 2 || options.queries.length > 3)) {
    throw new Error('--multi requires 2-3 distinct query phrasings');
  }
  if (options.multi && options.feedback) throw new Error('--multi cannot be combined with --feedback');
  if (['wrong', 'miss'].includes(options.feedback) && !options.expected) {
    throw new Error(`--feedback ${options.feedback} requires --expected <memory-name>`);
  }
  if (!['default', 'expanded'].includes(options.tier)) throw new Error('--tier must be default or expanded');
  if (!['cli', 'claude-hook'].includes(options.surface)) throw new Error('--surface must be cli or claude-hook');
  options.consumptionEligible = options.stdio ? options.surface === 'claude-hook' : true;
  if (options.stdio && (options.queries.length > 0 || options.feedback || options.json || options.usageLog || options.multi)) {
    throw new Error('--stdio cannot be combined with queries, feedback, --json, --multi, or usage logging');
  }
  return options;
}

function usage() {
  return `Usage: ownmem recall [options] -- <keyword|path|natural-language question> [...]

Reads the compiled snapshot and runs a deterministic recall. An unusable snapshot is rebuilt, and
only a failed rebuild falls back to Markdown BM25F.

Options:
  --json                 one query emits memory-query-result/v1; several emit a batch wrapper
  --multi                fuse 2-3 natural phrasings with RRF inside the CLI, emitting one envelope
  --stdio                start JSON Lines resident mode: load once, answer many queries
  --index-dir PATH       local snapshot directory (default .local-test/memory-index)
  --embedding-dir PATH   local embedding config and artifact (default .local-test/memory-embedding)
  --limit N              return at most N entries per query (1-3, default 3)
  --tier TIER            default (400 tokens) or expanded (1200 tokens)
  --exclude-memory-id ID exclude an already loaded memory; repeatable
  --feedback VERDICT     record correct, wrong or miss into the local ignored directory
  --expected NAME        the correct memory name behind a wrong/miss verdict
  --observability-dir D  local HMAC run-event directory (default .local-test/memory-observability)
  --no-observability     skip writing local run events this time
  --usage-file PATH      compatibility SHA-256 usage file; written only when passed explicitly
  --no-usage-log         do not write the compatibility usage file (default)

Examples (replace the entry with \`npx ownmem recall --\` for everyday use):
  ownmem recall -- notifyContentDidChange
  ownmem recall -- 'history shows an empty page right after login'
  ownmem recall --multi -- 'body text is clipped on mobile' 'implicit grid track overflow' 'grid-cols-1'
  ownmem recall --stdio
  ownmem recall --feedback correct -- 'never stash in a shared worktree'
  ownmem recall --feedback miss --expected feedback_no_stash -- 'do not tuck my changes away'`;
}

function resultMemoryId(result) {
  return result?.memory_id || result?.document?.name || null;
}

function resultScore(result) {
  return Number(result?.score || 0);
}

export function recordFeedback({ file, query, verdict, expected, results, now = new Date() }) {
  const absoluteFile = path.resolve(file);
  mkdirSync(path.dirname(absoluteFile), { recursive: true });
  const entry = {
    schema: 'ownmem-recall-feedback/v1',
    recordedAt: now.toISOString(),
    query,
    verdict,
    expected: expected || (verdict === 'correct' ? resultMemoryId(results[0]) : null),
    returned: results.map(resultMemoryId).filter(Boolean),
  };
  appendFileSync(absoluteFile, `${JSON.stringify(entry)}\n`, 'utf8');
  return { file: absoluteFile, entry };
}

export function recordUsage({ file, query, results, now = new Date() }) {
  const absoluteFile = path.resolve(file);
  mkdirSync(path.dirname(absoluteFile), { recursive: true });
  const entry = {
    schema: 'ownmem-recall-usage/v1',
    recordedAt: now.toISOString(),
    query_sha256: createHash('sha256').update(query).digest('hex'),
    abstained: results.length === 0,
    returned: results.map((result) => ({
      name: resultMemoryId(result),
      score: Number(resultScore(result).toFixed(3)),
    })),
  };
  appendFileSync(absoluteFile, `${JSON.stringify(entry)}\n`, 'utf8');
  return { file: absoluteFile, entry };
}

function validateStdioRequest(value) {
  validateMemoryStdioRequest(value);
  if (!value.query.trim()) throw new Error('request query must not be blank');
  const tier = value.tier || 'default';
  const limit = value.limit ?? 3;
  const excludeMemoryIds = value.exclude_memory_ids || [];
  return { id: value.id, query: value.query, tier, limit, excludeMemoryIds };
}

function stdioResponse(id, result, observationTraceId = null) {
  const response = {
    schema: MEMORY_STDIO_RESPONSE_SCHEMA,
    id,
    ok: true,
    observation_trace_id: observationTraceId,
    result,
    error: null,
  };
  validateMemoryStdioResponse(response);
  return response;
}

function stdioError(id, error) {
  const response = {
    schema: MEMORY_STDIO_RESPONSE_SCHEMA,
    id,
    ok: false,
    observation_trace_id: null,
    result: null,
    error: {
      code: 'INVALID_REQUEST',
      message: String(error.message || error).slice(0, 300),
    },
  };
  validateMemoryStdioResponse(response);
  return response;
}

async function writeStdioLine(output, response) {
  if (!output.write(`${JSON.stringify(response)}\n`)) await once(output, 'drain');
}

export async function runStdio(options, { input = process.stdin, output = process.stdout } = {}) {
  const runtime = createMemoryRecallRuntime(options);
  if (runtime.warnings.length > 0) {
    process.stderr.write(`memory-recall: local observability skipped: ${[...new Set(runtime.warnings)].join('; ')}\n`);
  }
  const lines = readline.createInterface({ input, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let id = null;
    try {
      if (Buffer.byteLength(line) > MAX_STDIO_LINE_BYTES) throw new Error('request line exceeds 64 KiB');
      const parsed = JSON.parse(line);
      if (typeof parsed?.id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(parsed.id)) id = parsed.id;
      const request = validateStdioRequest(parsed);
      id = request.id;
      const queried = queryMemoryRuntime(runtime, request.query, {
        limit: request.limit,
        tier: request.tier,
        excludeMemoryIds: request.excludeMemoryIds,
        execution: 'hot',
      });
      if (queried.warning) process.stderr.write(`memory-recall: local observability skipped: ${queried.warning}\n`);
      await writeStdioLine(output, stdioResponse(id, queried.envelope, queried.observationTraceId));
    } catch (error) {
      await writeStdioLine(output, stdioError(id, error));
    }
  }
  return 0;
}

function printHumanSearch(query, envelope) {
  process.stdout.write(`== ${query} ==\n`);
  if (envelope.results.length === 0) {
    process.stdout.write('  (no trusted hit; try a symbol name, an error code or a path fragment)\n\n');
    return 0;
  }
  for (const result of envelope.results) {
    process.stdout.write(`  ${result.memory_id}  [score=${result.score.toFixed(3)} channels=${result.channels.join(',')} fields=${result.matched_fields.join(',')}]\n`);
    process.stdout.write(`      matched ${result.matched_terms.join(',') || '(exact phrase)'}\n`);
    if (result.excerpt) process.stdout.write(`      excerpt(${result.excerpt.field}) ${result.excerpt.text}\n`);
    if (result.authority_docs.length > 0) process.stdout.write(`      authority ${result.authority_docs.join(',')}\n`);
    process.stdout.write(`      file ${result.path}\n`);
  }
  process.stdout.write('\n');
  return envelope.results.length;
}

function executeCliSearches(runtime, options, warnings, embeddings = []) {
  if (options.multi) {
    const queried = queryMemoryRuntimeMulti(runtime, options.queries, {
      limit: options.limit,
      tier: options.tier,
      excludeMemoryIds: options.excludeMemoryIds,
      execution: 'cold',
      embedding: embeddings[0] || null,
    });
    if (queried.warning) warnings.push(queried.warning);
    return [{ query: `multi (${options.queries.length} phrasings)`, usageQuery: options.queries.join('\n\u241E\n'), ...queried }];
  }
  return options.queries.map((query, queryIndex) => {
    const queried = queryMemoryRuntime(runtime, query, {
      limit: options.limit,
      tier: options.tier,
      excludeMemoryIds: options.excludeMemoryIds,
      execution: queryIndex === 0 ? 'cold' : 'hot',
      embedding: embeddings[queryIndex] || null,
    });
    if (queried.warning) warnings.push(queried.warning);
    return { query, usageQuery: query, ...queried };
  });
}

  // Cold CLI recall bypasses the broker and must record its own ledger entry for later consumption pairing.
function recordCliDelivery(options, searches, warnings) {
  if (!options.observability) return;
  for (const { envelope, observationTraceId } of searches) {
    if (!observationTraceId || envelope.results.length === 0) continue;
    const delivery = recordMemoryDelivery({
      root: options.root,
      directory: options.observabilityDirectory,
      traceId: observationTraceId,
      snapshotId: envelope.source.snapshot_id,
      topics: envelope.results.map((result) => result.memory_id),
      surface: 'cli',
      component: 'memory-recall-cli',
      componentVersion: MEMORY_RECALL_RUNTIME_VERSION,
    });
    if (!delivery.write.written) warnings.push(delivery.write.error);
    rememberMemoryRecall({
      root: options.root,
      directory: options.observabilityDirectory,
      traceId: observationTraceId,
      sessionId: null,
      snapshotId: envelope.source.snapshot_id,
      returnedTopics: envelope.results.map((result) => result.memory_id),
      source: 'cli',
    });
  }
}

function recordCliUsage(options, searches) {
  if (!options.usageLog) return [];
  return searches.map(({ usageQuery, envelope }) => recordUsage({
    file: options.usageFile || path.join(options.root, DEFAULT_USAGE_FILE),
    query: usageQuery,
    results: envelope.results,
  }));
}

function recordCliFeedback(options, searches, warnings) {
  if (!options.feedback) return null;
  const [{ query, envelope, observationTraceId }] = searches;
  if (options.feedback === 'correct' && envelope.results.length === 0) {
    throw new Error('--feedback correct requires a trusted top result; use miss with --expected when recall returned nothing');
  }
  const feedback = recordFeedback({
    file: options.feedbackFile || path.join(options.root, DEFAULT_FEEDBACK_FILE),
    query,
    verdict: options.feedback,
    expected: options.expected,
    results: envelope.results,
  });
  if (!options.observability || !observationTraceId) return feedback;
  const returned = envelope.results.map((result) => result.memory_id);
  const event = createMemoryObservabilityEvent({
    event: 'feedback.recorded',
    traceId: observationTraceId,
    snapshotId: envelope.source.snapshot_id,
    component: recallComponent(envelope.source),
    componentVersion: MEMORY_RECALL_RUNTIME_VERSION,
    payload: {
      verdict: options.feedback,
      expected_in_top_k: feedback.entry.expected ? returned.includes(feedback.entry.expected) : null,
    },
  });
  const recorded = recordMemoryObservabilityEvent({
    root: options.root,
    directory: options.observabilityDirectory,
    event,
  });
  if (!recorded.written) warnings.push(recorded.error);
  return feedback;
}

function writeCliJson(runtime, searches) {
  const output = searches.length === 1
    ? searches[0].envelope
    : {
      schema: 'ownmem-recall-batch/v1',
      source_mode: runtime.mode,
      active_topics: runtime.activeTopics,
      results: searches.map(({ envelope, observationTraceId }) => ({
        observation_trace_id: observationTraceId,
        envelope,
      })),
    };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function writeCliHuman(runtime, options, searches, feedback, usageEntries) {
  let totalHits = 0;
  for (const { query, envelope } of searches) totalHits += printHumanSearch(query, envelope);
  const sourceLabel = runtime.source.status === 'ready'
    ? 'snapshot ready'
    : runtime.source.status === 'rebuilt'
      ? `snapshot rebuilt (${runtime.source.rebuild_trigger})`
      : runtime.source.status === 'previous'
        ? `previous snapshot, may lag (${runtime.source.rebuild_trigger})`
        : `Markdown fallback (${runtime.source.rebuild_trigger})`;
  const deliveredLimit = searches[0]?.envelope.budget.max_topics ?? options.limit;
  process.stdout.write(`${totalHits} hit(s); ${sourceLabel}; at most ${deliveredLimit} per query, ${options.tier === 'default' ? 400 : 1200} tokens in the first pass. Read authority_docs first, then verify against live code.\n`);
  // Show this hint only in the CLI; hook envelopes must preserve their strict token budget.
  if (totalHits > 0) {
    process.stdout.write('Full text: open the topic file listed above; a Claude Code Read routed through the hook records the confirmed open automatically. Opening is not the same as the answer using it.\n');
  }
  // Offer feedback only on abstention or empty results, and never repeat it after feedback was supplied.
  if (!options.feedback) {
    const abstained = searches.find(({ envelope }) => envelope.abstain.abstained || envelope.results.length === 0);
    if (abstained) {
      const sample = options.multi ? '<original-query>' : String(abstained.query).replaceAll("'", "'\\''");
      process.stdout.write(`Should have been recalled but was not? Log it: npx ownmem recall --feedback miss --expected <memory-name> -- '${sample}'\n`);
    }
  }
  if (feedback) process.stdout.write(`Feedback recorded to ${path.relative(options.root, feedback.file)}.\n`);
  if (usageEntries.length > 0) process.stdout.write(`Compatibility usage: ${usageEntries.length} entr${usageEntries.length === 1 ? 'y' : 'ies'} recorded.\n`);
}

// Importing the embedding channel pulls in the HTTPS stack (TLS secure-context + undici) and the
// query worker. That is ~30 ms paid on startup, and until now it was paid unconditionally -- even
// though the default for a freshly written config is `enabled: false`, and most installs have no
// config at all. Measured end to end on this machine: 0.54 s with the channel active, 0.28 s
// without, so the semantic channel is roughly half the cost of a recall.
//
// The probe deliberately does NOT decide "disabled" for a config it cannot parse. A corrupt config
// is a real, reported condition (`config-invalid`, 25 occurrences in the current window); swallowing
// it here would turn a visible degradation into silence. Unreadable config => load the channel and
// let it produce the proper degraded result.
export function embeddingChannelNeeded({ root, embeddingDirectory }) {
  let raw;
  try {
    raw = readFileSync(path.resolve(root, embeddingDirectory, 'config.json'), 'utf8');
  } catch {
    return false; // No config: nothing to query, and no degradation to report.
  }
  try {
    return JSON.parse(raw)?.enabled === true;
  } catch {
    return true; // Corrupt: hand it to the channel so `config-invalid` is still recorded.
  }
}

async function loadEmbeddingChannel(options) {
  if (!embeddingChannelNeeded(options)) return null;
  return import('../memory-embedding-channel.mjs');
}

function startCliEmbeddings(channel, options, dependencies) {
  if (!channel) return [];
  const queryGroups = options.multi ? [options.queries] : options.queries.map((query) => [query]);
  return queryGroups.map((queries) => channel.startMemoryEmbeddingQueries({
    root: options.root,
    directory: options.embeddingDirectory,
    indexDirectory: options.indexDirectory,
    queries,
    fetchImpl: dependencies.fetchImpl,
    sleepImpl: dependencies.sleepImpl,
  }));
}

export async function runCli(rawArgs = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(rawArgs);
  if (options.help || (!options.stdio && options.queries.length === 0)) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (options.stdio) return runStdio(options);

  const embeddingChannel = await loadEmbeddingChannel(options);
  const startedEmbeddings = startCliEmbeddings(embeddingChannel, options, dependencies);
  const runtime = createMemoryRecallRuntime(options);
  const embeddings = embeddingChannel
    ? await Promise.all(startedEmbeddings.map((started) => (
      embeddingChannel.completeMemoryEmbeddingQueries(started, runtime)
    )))
    : [];
  if (options.expected && !runtime.topicIds.has(options.expected)) {
    throw new Error(`--expected must name an active L3 memory: ${options.expected}`);
  }
  const observabilityWarnings = [...runtime.warnings];
  const searches = executeCliSearches(runtime, options, observabilityWarnings, embeddings);
  const usageEntries = recordCliUsage(options, searches);
  const feedback = recordCliFeedback(options, searches, observabilityWarnings);
  if (options.json) {
    writeCliJson(runtime, searches);
  } else {
    writeCliHuman(runtime, options, searches, feedback, usageEntries);
  }
    // Record delivery only after stdout succeeds; completion alone is not evidence of delivery.
  recordCliDelivery(options, searches, observabilityWarnings);
  if (observabilityWarnings.length > 0) {
    process.stderr.write(`memory-recall: local observability skipped: ${[...new Set(observabilityWarnings)].join('; ')}\n`);
  }
  return 0;
}

if (isMemoryCliEntry(import.meta.url)) {
  Promise.resolve().then(() => runCli()).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`memory-recall: ${error.message}\n`);
    process.exitCode = 1;
  });
}
