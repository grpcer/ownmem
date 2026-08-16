import { randomBytes } from 'node:crypto';
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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { compileMemoryIndex } from './memory-compiler.mjs';
import {
  createMemoryEmbeddingClient,
  memoryEmbeddingPaths,
  memoryEmbeddingSetupConfig,
  validateMemoryEmbeddingConfig,
} from './memory-embedding-provider.mjs';
import {
  decodeFloat32Vector,
  encodeFloat32Vector,
  loadMemoryEmbeddingCorpus,
  readUsableMemoryEmbeddingArtifact,
  reconcileMemoryEmbeddingArtifact,
} from './memory-embedding-store.mjs';
import {
  createMemoryEmbeddingCandidatesFromVector,
  createMemoryEmbeddingPlanner,
  MEMORY_EMBEDDING_SUGGESTED_WEIGHT,
} from './memory-embedding-channel.mjs';
import { stableJson, sha256 } from './memory-index-store.mjs';
import { loadMemoryQueryPlanner, planMemoryQuery } from './memory-query-planner.mjs';
import { rankPlannedMemoryQuery } from './memory-ranker.mjs';
import { MEMORY_RECALL_RUNTIME_VERSION } from './memory-runtime.mjs';
import { normalizeMemoryText } from './memory-tokenizer.mjs';

export const MEMORY_EMBEDDING_EVAL_CACHE_SCHEMA = 'ownmem-embedding-eval-cache/v1';
export const MEMORY_EMBEDDING_AB_SCHEMA = 'ownmem-embedding-ab/v1';
export { MEMORY_EMBEDDING_SUGGESTED_WEIGHT, MEMORY_RECALL_RUNTIME_VERSION };

const SCRIPT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EVAL_CACHE_SCHEMA = JSON.parse(readFileSync(path.join(SCRIPT_DIR, 'memory-embedding-eval-cache.schema.json'), 'utf8'));
const AB_SCHEMA = JSON.parse(readFileSync(path.join(SCRIPT_DIR, 'memory-embedding-ab.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
const validateEvalCacheSchema = ajv.compile(EVAL_CACHE_SCHEMA);
const validateAbSchema = ajv.compile(AB_SCHEMA);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function schemaErrors(validator) {
  return (validator.errors || []).slice(0, 5).map((error) => (
    `${error.instancePath || '/'} ${error.message}`
  )).join('; ');
}

function atomicPrivateJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(file), `.tmp-${process.pid}-${randomBytes(8).toString('hex')}`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, stableJson(value), 'utf8');
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

function normalizedQuery(query) {
  const value = normalizeMemoryText(query).trim().replace(/\s+/g, ' ');
  if (!value) throw new Error('memory embedding evaluation query must not be blank');
  return value;
}

export function memoryEmbeddingEvalCacheKey(model, query) {
  return sha256(`${model}\0${querySha256(query)}`);
}

function querySha256(query) {
  return sha256(normalizedQuery(query));
}

export function memoryEmbeddingEvalCachePath({ root, directory } = {}) {
  return path.join(memoryEmbeddingPaths({ root, directory }).directory, 'eval-cache.json');
}

export function validateMemoryEmbeddingEvalCache(value) {
  if (!validateEvalCacheSchema(value)) {
    throw new Error(`memory embedding eval cache is invalid: ${schemaErrors(validateEvalCacheSchema)}`);
  }
  for (const [key, entry] of Object.entries(value.entries)) {
    decodeFloat32Vector(entry.vector_b64, value.dimensions);
    if (key !== sha256(`${value.model}\0${entry.query_sha256}`)) {
      throw new Error('memory embedding eval cache key does not match its model and query receipt');
    }
  }
  return value;
}

function emptyEvalCache(model, dimensions) {
  return { schema: MEMORY_EMBEDDING_EVAL_CACHE_SCHEMA, model, dimensions, entries: {} };
}

/**
 * The eval cache is purely derived — losing it only costs re-embedding the benchmark queries — yet
 * it lives in a single file shared across models. Failing hard on an unrecognized schema or damaged
 * contents blocks A/B behind a file nothing can rewrite, with no path back: a cache left by a
 * retired schema name kept every comparison run failing until the file was deleted by hand.
 *
 * An unusable cache is treated as cold and rebuilt. Writes stay strictly validated, so a bad file is
 * never produced here, and the discard reason is reported through onDiscard rather than swallowed.
 */
export function readMemoryEmbeddingEvalCache({ root, directory, model, dimensions, onDiscard } = {}) {
  const file = memoryEmbeddingEvalCachePath({ root, directory });
  if (!existsSync(file)) return emptyEvalCache(model, dimensions);
  let value;
  try {
    value = validateMemoryEmbeddingEvalCache(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    onDiscard?.({ reason: 'unusable', detail: String(error?.message || error) });
    return emptyEvalCache(model, dimensions);
  }
  if (value.model !== model || value.dimensions !== dimensions) {
    onDiscard?.({ reason: 'identity_changed', detail: `cached ${value.model} at ${value.dimensions} dimensions` });
    return emptyEvalCache(model, dimensions);
  }
  return value;
}

function writeMemoryEmbeddingEvalCache(options, value) {
  validateMemoryEmbeddingEvalCache(value);
  const file = memoryEmbeddingEvalCachePath(options);
  atomicPrivateJson(file, value);
  return file;
}

export async function ensureMemoryEmbeddingEvalVectors({
  root,
  directory,
  config,
  dimensions,
  queries,
  offline = false,
  fetchImpl,
  sleepImpl,
  onProgress,
} = {}) {
  validateMemoryEmbeddingConfig(config);
  const uniqueQueries = [...new Map(queries.map((query) => [normalizedQuery(query), query])).values()];
  let discarded = null;
  const cache = readMemoryEmbeddingEvalCache({
    root,
    directory,
    model: config.model,
    dimensions,
    onDiscard: (info) => { discarded = info; },
  });
  const missing = uniqueQueries.filter((query) => !cache.entries[memoryEmbeddingEvalCacheKey(config.model, query)]);
  if (offline && missing.length > 0) {
    const because = discarded ? `; existing cache was discarded (${discarded.reason}: ${discarded.detail})` : '';
    throw new Error(`memory embedding eval cache is missing ${missing.length} query vector(s) in offline mode${because}`);
  }

  let networkRequests = 0;
  if (missing.length > 0) {
    const evaluationConfig = memoryEmbeddingSetupConfig(config);
    const baseFetch = fetchImpl || globalThis.fetch;
    const countingFetch = (...args) => {
      networkRequests += 1;
      return baseFetch(...args);
    };
    const client = createMemoryEmbeddingClient(evaluationConfig, { fetchImpl: countingFetch, sleepImpl });
    await client.embed(missing, {
      onBatch: async ({ offset, vectors, dimensions: resultDimensions }) => {
        if (resultDimensions !== dimensions) throw new Error('memory embedding eval vector dimensions do not match the corpus artifact');
        for (let index = 0; index < vectors.length; index += 1) {
          const query = missing[offset + index];
          cache.entries[memoryEmbeddingEvalCacheKey(config.model, query)] = {
            query_sha256: querySha256(query),
            vector_b64: encodeFloat32Vector(vectors[index]),
          };
        }
        cache.entries = Object.fromEntries(Object.entries(cache.entries).sort(([left], [right]) => compareText(left, right)));
        writeMemoryEmbeddingEvalCache({ root, directory }, cache);
        await onProgress?.({ completed: Math.min(offset + vectors.length, missing.length), total: missing.length });
      },
    });
  }

  const vectors = new Map(uniqueQueries.map((query) => {
    const entry = cache.entries[memoryEmbeddingEvalCacheKey(config.model, query)];
    if (!entry || entry.query_sha256 !== querySha256(query)) {
      throw new Error('memory embedding eval cache query receipt mismatch');
    }
    return [normalizedQuery(query), decodeFloat32Vector(entry.vector_b64, dimensions)];
  }));
  return {
    cache,
    vectors,
    hits: uniqueQueries.length - missing.length,
    misses: missing.length,
    networkRequests,
    discarded,
    file: memoryEmbeddingEvalCachePath({ root, directory }),
  };
}

function expectedNames(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function outcome(result, expected) {
  const returned = result.candidates.map((candidate) => candidate.document_id);
  const rank = expected.length === 0 ? null : returned.findIndex((name) => expected.includes(name)) + 1;
  return {
    rank: rank || null,
    abstained: result.abstain.abstained,
    returned,
  };
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function rankingMetrics(items, side) {
  const collect = (values) => {
    let rankOne = 0;
    let rankFive = 0;
    let reciprocalRank = 0;
    for (const item of values) {
      const rank = item[side].rank;
      if (rank === 1) rankOne += 1;
      if (rank !== null && rank <= 5) rankFive += 1;
      if (rank !== null) reciprocalRank += 1 / rank;
    }
    const total = values.length;
    return {
      cases: total,
      recall_at_1: total === 0 ? 0 : rounded(rankOne / total),
      recall_at_5: total === 0 ? 0 : rounded(rankFive / total),
      mrr: total === 0 ? 0 : rounded(reciprocalRank / total),
    };
  };
  const groups = new Map();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) || []), item]);
  return {
    ...collect(items),
    by_group: Object.fromEntries([...groups.entries()].sort(([left], [right]) => compareText(left, right))
      .map(([group, values]) => [group, collect(values)])),
  };
}

function negativeMetrics(items, side) {
  const collect = (values) => {
    const abstained = values.filter((item) => item[side].abstained).length;
    return {
      cases: values.length,
      abstained,
      abstain_rate: values.length === 0 ? 0 : rounded(abstained / values.length),
    };
  };
  const groups = new Map();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) || []), item]);
  return {
    ...collect(items),
    by_group: Object.fromEntries([...groups.entries()].sort(([left], [right]) => compareText(left, right))
      .map(([group, values]) => [group, collect(values)])),
  };
}

function changeFor(kind, a, b) {
  if (kind === 'negative') {
    if (a.abstained === b.abstained) return 'unchanged';
    return b.abstained ? 'improved' : 'regressed';
  }
  const aRank = a.rank ?? Infinity;
  const bRank = b.rank ?? Infinity;
  if (aRank === bRank) return 'unchanged';
  return bRank < aRank ? 'improved' : 'regressed';
}

async function evaluateCases({ cases, kind, plannerA, plannerB, artifact, vectors, allowedDocumentIds }) {
  const results = [];
  for (const testCase of cases) {
    const expected = expectedNames(testCase.expected);
    const vector = vectors.get(normalizedQuery(testCase.query));
    const response = await createMemoryEmbeddingCandidatesFromVector({
      artifact,
      query: testCase.query,
      queryVector: vector,
      allowedDocumentIds,
    });
    const planA = planMemoryQuery(plannerA, testCase.query, { embeddingResponse: response });
    const planB = planMemoryQuery(plannerB, testCase.query, { embeddingResponse: response });
    const a = outcome(rankPlannedMemoryQuery(plannerA, testCase.query, planA, { limit: 5 }), expected);
    const b = outcome(rankPlannedMemoryQuery(plannerB, testCase.query, planB, { limit: 5 }), expected);
    results.push({
      case_id: querySha256(testCase.query),
      kind,
      partition: testCase.partition,
      group: testCase.group,
      expected,
      a,
      b,
      change: changeFor(kind, a, b),
    });
  }
  return results;
}

export function validateMemoryEmbeddingAbReport(value) {
  if (!validateAbSchema(value)) {
    throw new Error(`memory embedding A/B report is invalid: ${schemaErrors(validateAbSchema)}`);
  }
  const { report_id: reportId, ...body } = value;
  if (sha256(stableJson(body)) !== reportId) throw new Error('memory embedding A/B report_id checksum mismatch');
  return value;
}

function abReportPath({ root, directory, report }) {
  const reports = path.join(memoryEmbeddingPaths({ root, directory }).directory, 'ab-reports');
  const model = sha256(report.model).slice(0, 12);
  return path.join(reports, `${report.snapshot_id.slice(0, 12)}-${model}-w${report.weights.b}-${report.report_id.slice(0, 12)}.json`);
}

export async function evaluateMemoryEmbeddingAb({
  root,
  directory,
  indexDirectory,
  memoryDir,
  config,
  suggestedWeight = MEMORY_EMBEDDING_SUGGESTED_WEIGHT,
  offline = false,
  fetchImpl,
  sleepImpl,
  compile = compileMemoryIndex,
  casesFile = path.join(SCRIPT_DIR, 'memory-recall-cases.json'),
  onProgress,
} = {}) {
  validateMemoryEmbeddingConfig(config);
  if (!Number.isFinite(suggestedWeight) || suggestedWeight <= 0 || suggestedWeight > 100) {
    throw new Error('memory embedding suggested weight must be greater than 0 and at most 100');
  }
  compile({ root, indexDirectory, memoryDir });
  const planner = loadMemoryQueryPlanner({ root, indexDirectory, allowPrevious: false });
  const corpus = loadMemoryEmbeddingCorpus({ root, indexDirectory });
  const { artifact, unusable } = readUsableMemoryEmbeddingArtifact({ root, directory, config });
  if (!artifact) {
    throw new Error(`memory embedding vectors are missing; run build before A/B evaluation${unusable ? ` (${unusable})` : ''}`);
  }
  const reconciliation = reconcileMemoryEmbeddingArtifact({ config, corpus, artifact });
  if (reconciliation.stale !== 0 || reconciliation.deleted !== 0) {
    throw new Error(`memory embedding vectors are stale (${reconciliation.stale} stale, ${reconciliation.deleted} deleted); run build before A/B evaluation`);
  }

  const benchmark = JSON.parse(readFileSync(casesFile, 'utf8'));
  if (benchmark.schema !== 'ownmem-recall-benchmark/v4'
      || !Array.isArray(benchmark.golden)
      || !Array.isArray(benchmark.negative)) {
    throw new Error('memory embedding A/B requires memory-recall-benchmark/v4 cases');
  }
  const allCases = [...benchmark.golden, ...benchmark.negative];
  const cache = await ensureMemoryEmbeddingEvalVectors({
    root,
    directory,
    config,
    dimensions: artifact.dimensions,
    queries: allCases.map((testCase) => testCase.query),
    offline,
    fetchImpl,
    sleepImpl,
    onProgress,
  });
  const allowedDocumentIds = new Set(corpus.documents.map((document) => document.document_id));
  const plannerA = createMemoryEmbeddingPlanner(planner, config, { rrfWeight: 0 });
  const plannerB = createMemoryEmbeddingPlanner(planner, config, { rrfWeight: suggestedWeight });
  const goldenDiffs = await evaluateCases({
    cases: benchmark.golden,
    kind: 'golden',
    plannerA,
    plannerB,
    artifact,
    vectors: cache.vectors,
    allowedDocumentIds,
  });
  const negativeDiffs = await evaluateCases({
    cases: benchmark.negative,
    kind: 'negative',
    plannerA,
    plannerB,
    artifact,
    vectors: cache.vectors,
    allowedDocumentIds,
  });
  const holdoutDiffs = goldenDiffs.filter((item) => item.partition === 'holdout');
  const nonHoldoutGolden = goldenDiffs.filter((item) => item.partition !== 'holdout');
  const goldenA = rankingMetrics(nonHoldoutGolden, 'a');
  const goldenB = rankingMetrics(nonHoldoutGolden, 'b');
  const negativeA = negativeMetrics(negativeDiffs, 'a');
  const negativeB = negativeMetrics(negativeDiffs, 'b');
  const holdoutA = holdoutDiffs.length > 0 ? rankingMetrics(holdoutDiffs, 'a') : null;
  const holdoutB = holdoutDiffs.length > 0 ? rankingMetrics(holdoutDiffs, 'b') : null;
  const negativeNotWorse = negativeB.abstain_rate >= negativeA.abstain_rate;
  const holdoutNotWorse = holdoutDiffs.length === 0
    || (holdoutB.recall_at_1 >= holdoutA.recall_at_1
      && holdoutB.recall_at_5 >= holdoutA.recall_at_5
      && holdoutB.mrr >= holdoutA.mrr);
  const recommendedWeightSafe = negativeNotWorse
    && goldenB.recall_at_1 >= goldenA.recall_at_1
    && goldenB.recall_at_5 >= goldenA.recall_at_5
    && goldenB.mrr >= goldenA.mrr
    && holdoutNotWorse;
  const body = {
    schema: MEMORY_EMBEDDING_AB_SCHEMA,
    snapshot_id: planner.snapshotId,
    provider: config.provider,
    model: config.model,
  // snapshot_id covers corpus and compiled ranking data, not ranker/channel code behavior.
  // Persist the recall-stack version so activation can reject evidence from older behavior.
    component_version: MEMORY_RECALL_RUNTIME_VERSION,
    dimensions: artifact.dimensions,
    weights: { a: 0, b: suggestedWeight },
    corpus: {
      golden: nonHoldoutGolden.length,
      negative: negativeDiffs.length,
      holdout: holdoutDiffs.length,
    },
    metrics: {
      golden: {
        a: goldenA,
        b: goldenB,
      },
      negative: { a: negativeA, b: negativeB },
      holdout: {
        available: holdoutDiffs.length > 0,
        cases: holdoutDiffs.length,
        a: holdoutA,
        b: holdoutB,
      },
    },
    guard: {
      negative_not_worse: negativeNotWorse,
      recommended_weight_safe: recommendedWeightSafe,
    },
    diffs: [...goldenDiffs, ...negativeDiffs],
  };
  const report = { ...body, report_id: sha256(stableJson(body)) };
  const orderedReport = {
    schema: report.schema,
    report_id: report.report_id,
    snapshot_id: report.snapshot_id,
    provider: report.provider,
    model: report.model,
    component_version: report.component_version,
    dimensions: report.dimensions,
    weights: report.weights,
    corpus: report.corpus,
    metrics: report.metrics,
    guard: report.guard,
    diffs: report.diffs,
  };
  validateMemoryEmbeddingAbReport(orderedReport);
  const file = abReportPath({ root, directory, report: orderedReport });
  atomicPrivateJson(file, orderedReport);
  return {
    schema: 'ownmem-embedding-ab-result/v1',
    report: orderedReport,
    report_file: path.relative(root, file),
    cache_file: path.relative(root, cache.file),
    cache_hits: cache.hits,
    cache_misses: cache.misses,
    cache_discarded: cache.discarded,
    network_requests: cache.networkRequests,
  };
}
