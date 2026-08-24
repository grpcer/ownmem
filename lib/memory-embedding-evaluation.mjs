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
import Ajv from 'ajv/dist/2020.js';
import { compileMemoryIndex } from './memory-compiler.mjs';
import {
  checkMemoryBehavioralCase,
  loadMemoryRecallCases,
  memoryEnvelopeOutcome,
  memoryRecallCaseId,
  MEMORY_RECALL_CASES_BENCHMARK_SCHEMA,
  selectMemoryRecallCases,
} from './memory-evaluation-cases.mjs';
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
import {
  createMemoryRecallRuntime,
  MEMORY_RECALL_RUNTIME_VERSION,
  memoryRankingProfileHash,
  queryMemoryRuntime,
} from './memory-runtime.mjs';
import { normalizeMemoryText } from './memory-tokenizer.mjs';
import { schemaPath } from './schema-paths.mjs';

export const MEMORY_EMBEDDING_EVAL_CACHE_SCHEMA = 'ownmem-embedding-eval-cache/v1';
export const MEMORY_EMBEDDING_AB_SCHEMA = 'ownmem-embedding-ab/v2';
export const MEMORY_RECALL_REPLAY_SCHEMA = 'ownmem-recall-replay/v1';
export { MEMORY_EMBEDDING_SUGGESTED_WEIGHT, MEMORY_RECALL_RUNTIME_VERSION };

const EVAL_CACHE_SCHEMA = JSON.parse(readFileSync(schemaPath('embedding', 'eval-cache.schema.json'), 'utf8'));
const AB_SCHEMA = JSON.parse(readFileSync(schemaPath('embedding', 'ab.schema.json'), 'utf8'));
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

function outcome(envelope, expected) {
  const returned = envelope.results.map((candidate) => candidate.memory_id);
  const rank = expected.length === 0 ? null : returned.findIndex((name) => expected.includes(name)) + 1;
  return {
    rank: rank || null,
    abstained: envelope.abstain.abstained,
    returned,
  };
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function runtimeProfile(planner) {
  return {
    version: MEMORY_RECALL_RUNTIME_VERSION,
    engine_lane: 'canonical',
    profile_id: planner.ranking.profile,
    ranking_profile_hash: memoryRankingProfileHash(planner.ranking),
  };
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

/**
 * Which metrics this corpus still has room to improve on, and which of them actually moved.
 *
 * The gate this replaces asked one question -- "did anything get worse?" -- and called a tie safe.
 * That is only an answer when the baseline can lose. On 2026-08-14 the adopted report had arm A at
 * 1.000 on every golden metric: arm B could tie or fall, never rise, so the comparison could not
 * express the benefit the gate exists to require. It tied, was stamped safe, and a channel with no
 * measured benefit was enabled on the strength of it. A saturated corpus does not certify a change;
 * it fails to have an opinion, and the report has to say which of those two happened.
 *
 * Ceiling comparisons are exact rather than epsilon-based: these metrics are rounded ratios of
 * whole case counts, so 1 means every case, not "close to every case".
 */
function benefitAnalysis({ goldenA, goldenB, negativeA, negativeB, holdoutA, holdoutB }) {
  const room = [];
  const gained = [];
  const consider = (id, a, b) => {
    if (a >= 1) return;
    room.push(id);
    if (b > a) gained.push(id);
  };
  consider('golden.recall_at_1', goldenA.recall_at_1, goldenB.recall_at_1);
  consider('golden.recall_at_5', goldenA.recall_at_5, goldenB.recall_at_5);
  consider('golden.mrr', goldenA.mrr, goldenB.mrr);
  consider('negative.abstain_rate', negativeA.abstain_rate, negativeB.abstain_rate);
  if (holdoutA && holdoutB) {
    consider('holdout.recall_at_1', holdoutA.recall_at_1, holdoutB.recall_at_1);
    consider('holdout.recall_at_5', holdoutA.recall_at_5, holdoutB.recall_at_5);
    consider('holdout.mrr', holdoutA.mrr, holdoutB.mrr);
  }
  return { headroom: room, gained };
}

/**
 * The verdict is deterministic, not statistical: both arms replay the same frozen cases through the
 * same ranker, so a difference is a fact about this corpus rather than a sample estimate. What it
 * is NOT is a claim about production queries, which is why `no_change` and `uninformative` are kept
 * apart -- one says the corpus could have shown a gain and none appeared, the other says the corpus
 * was never able to answer the question.
 */
function abVerdict({ goldenCases, notWorse, analysis }) {
  if (goldenCases === 0) return 'insufficient_evidence';
  if (!notWorse) return 'regresses';
  if (analysis.gained.length > 0) return 'improves';
  return analysis.headroom.length === 0 ? 'uninformative' : 'no_change';
}

/**
 * The whole guard block, derived from nothing but the two arms' metrics.
 *
 * Exported so the rule can be checked against metric shapes directly -- including the shape of the
 * report that actually enabled this channel -- without staging a provider, an artifact and a corpus
 * to reproduce them.
 */
export function memoryEmbeddingAbGuard({
  goldenCases, negativeNotWorse, holdoutNotWorse, goldenA, goldenB, negativeA, negativeB, holdoutA, holdoutB,
}) {
  const recommendedWeightSafe = negativeNotWorse
    && goldenB.recall_at_1 >= goldenA.recall_at_1
    && goldenB.recall_at_5 >= goldenA.recall_at_5
    && goldenB.mrr >= goldenA.mrr
    && holdoutNotWorse;
  const benefit = benefitAnalysis({ goldenA, goldenB, negativeA, negativeB, holdoutA, holdoutB });
  return {
    negative_not_worse: negativeNotWorse,
    recommended_weight_safe: recommendedWeightSafe,
    // `recommended_weight_safe` answers "did anything get worse". These answer "could this corpus
    // have shown a gain, and did one appear" -- the question a tie leaves open.
    benefit_measurable: benefit.headroom.length > 0,
    benefit_observed: benefit.gained.length > 0,
    headroom: benefit.headroom,
    gained: benefit.gained,
    verdict: abVerdict({ goldenCases, notWorse: recommendedWeightSafe, analysis: benefit }),
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

async function evaluateCases({ cases, kind, runtime, plannerA, plannerB, artifact, vectors, allowedDocumentIds }) {
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
    const a = outcome(queryMemoryRuntime(runtime, testCase.query, {
      tier: 'expanded',
      embedding: { active: true, planner: plannerA, responses: [response], rrfWeight: 0 },
    }).envelope, expected);
    const b = outcome(queryMemoryRuntime(runtime, testCase.query, {
      tier: 'expanded',
      embedding: { active: true, planner: plannerB, responses: [response], rrfWeight: plannerB.ranking.rrf.channel_weights.embedding },
    }).envelope, expected);
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

function replayCases({ runtime, cases, kind, limit }) {
  return cases.map((testCase, position) => {
    const expected = expectedNames(testCase.expected);
    const a = outcome(queryMemoryRuntime(runtime, testCase.query, {
      limit: Math.min(limit, 3),
      tier: 'expanded',
    }).envelope, expected);
    return {
      case_id: memoryRecallCaseId(testCase, kind, position),
      kind,
      partition: testCase.partition || 'unpartitioned',
      group: testCase.group || 'ungrouped',
      expected,
      a,
    };
  });
}

/**
 * Replays the behavioral cases on the deterministic lane.
 *
 * The replay used to run golden and negative only, which meant the one lane that works in a clean
 * checkout -- and the only shadow form this repository has ruled feasible -- had no coverage of
 * what the gates do. Everything golden and negative can express is "the right name came back" and
 * "nothing came back"; a refusal that is correct, a delivery that must carry an advisory trust
 * block, and a degraded provider that must not change the answer are all invisible to them.
 *
 * A case that asks for a lane this replay does not have is reported as not replayed, with the
 * reason. Running it on the deterministic lane anyway would score it against a contract it was not
 * written for, which is worse than an honest hole.
 */
function replayBehavioralCases({ runtime, cases, limit }) {
  return cases.map((testCase, position) => {
    const caseId = memoryRecallCaseId(testCase, 'behavioral', position);
    const shared = {
      case_id: caseId,
      kind: 'behavioral',
      dimension: testCase.dimension,
      partition: testCase.partition || 'unpartitioned',
      status: testCase.status || 'enforced',
    };
    if (testCase.channel && testCase.channel !== 'deterministic') {
      return {
        ...shared,
        replayed: false,
        reason: `requires the ${testCase.channel} channel, which the deterministic replay does not provide`,
        passed: null,
        outcome: null,
        gate: null,
        problems: [],
      };
    }
    const envelope = queryMemoryRuntime(runtime, testCase.query, {
      limit: Math.min(limit, 3),
      tier: testCase.tier || 'expanded',
    }).envelope;
    const problems = checkMemoryBehavioralCase(envelope, testCase);
    return {
      ...shared,
      replayed: true,
      reason: null,
      passed: problems.length === 0,
      outcome: memoryEnvelopeOutcome(envelope),
      gate: envelope.abstain.gate,
      problems,
    };
  });
}

function behavioralMetrics(items) {
  const collect = (values) => {
    const replayed = values.filter((item) => item.replayed);
    const enforced = replayed.filter((item) => item.status !== 'known_gap');
    return {
      cases: values.length,
      replayed: replayed.length,
      not_replayed: values.length - replayed.length,
      enforced: enforced.length,
      known_gaps: replayed.length - enforced.length,
      passed: enforced.filter((item) => item.passed).length,
      // A rate over an empty enforced set is not zero, and a fixture with no behavioral cases must
      // not read as a system that fails all of them.
      pass_rate: enforced.length === 0 ? null : rounded(enforced.filter((item) => item.passed).length / enforced.length),
    };
  };
  const groups = new Map();
  for (const item of items) groups.set(item.dimension, [...(groups.get(item.dimension) || []), item]);
  return {
    ...collect(items),
    // A known gap that starts passing is a fixture defect, not good news: the case guards nothing
    // from then on. The replay reports rather than throws -- it never fails for a condition it can
    // describe -- and the benchmark is where the same condition is a hard failure.
    known_gaps_now_passing: items.filter((item) => item.replayed && item.status === 'known_gap' && item.passed)
      .map((item) => item.case_id),
    failures: items.filter((item) => item.replayed && item.status !== 'known_gap' && !item.passed)
      .map((item) => `${item.case_id} [${item.dimension}] ${item.problems.join('; ')}`),
    by_dimension: Object.fromEntries([...groups.entries()].sort(([left], [right]) => compareText(left, right))
      .map(([dimension, values]) => [dimension, collect(values)])),
  };
}

function embeddingArmStatus({ root, directory, config }) {
  if (!config) {
    return {
      available: false,
      status: 'not_configured',
      reason: 'no local embedding configuration; the deterministic lane is the only measured arm',
    };
  }
  const { artifact, unusable } = readUsableMemoryEmbeddingArtifact({ root, directory, config });
  if (!artifact) {
    return { available: false, status: 'vectors_missing', reason: unusable || 'no usable embedding artifact' };
  }
  return {
    available: true,
    status: 'configured',
    provider: config.provider,
    model: config.model,
    dimensions: artifact.dimensions,
    reason: null,
  };
}

/**
 * Deterministic offline replay of a cases file: one ranker, no provider, no network, no writes.
 *
 * This is the arm that has to work in a clean checkout. The weighted A/B needs a provider, an API
 * key and a built vector artifact, so on a fresh clone it cannot run -- and for a long time the
 * honest version of that sentence did not exist anywhere in the output: the run either crashed or
 * reported nothing. Here the deterministic lane always produces metrics and the embedding lane
 * reports exactly why it did not, which is the difference between "unmeasured" and "zero".
 */
export function replayMemoryRecallCases({
  root,
  memoryDir,
  indexDirectory,
  directory,
  casesFile,
  config = null,
  smokeOnly = false,
  limit = 5,
  compile = compileMemoryIndex,
} = {}) {
  const loaded = loadMemoryRecallCases({ root, memoryDir, casesFile });
  if (!loaded.available) {
    return {
      schema: MEMORY_RECALL_REPLAY_SCHEMA,
      status: 'skipped',
      reason: loaded.reason,
      cases: loaded,
      selection: null,
      snapshot_id: null,
      component_version: MEMORY_RECALL_RUNTIME_VERSION,
      deterministic: null,
      embedding: { available: false, status: 'unmeasured', reason: loaded.reason },
    };
  }
  compile({ root, indexDirectory, memoryDir });
  const runtime = createMemoryRecallRuntime({ root, indexDirectory, memoryDir, observability: false }, { compile });
  const selected = selectMemoryRecallCases(loaded.cases, { smokeOnly });
  const golden = replayCases({ runtime, cases: selected.golden, kind: 'golden', limit });
  const negative = replayCases({ runtime, cases: selected.negative, kind: 'negative', limit });
  const behavioral = replayBehavioralCases({ runtime, cases: selected.behavioral || [], limit });
  const holdout = golden.filter((item) => item.partition === 'holdout');
  const scored = golden.filter((item) => item.partition !== 'holdout');
  return {
    schema: MEMORY_RECALL_REPLAY_SCHEMA,
    status: 'measured',
    reason: null,
    cases: {
      file: loaded.file,
      sha256: loaded.sha256,
      summary: loaded.summary,
    },
    selection: {
      smoke_only: smokeOnly,
      // False when --smoke was asked for and the fixture marks nothing: the full set ran, and a
      // report that called it a smoke run would be describing a subset that does not exist.
      smoke_marked: selected.marked,
      golden: golden.length,
      negative: negative.length,
      behavioral: behavioral.length,
      holdout: holdout.length,
    },
    snapshot_id: runtime.planner.snapshotId,
    component_version: MEMORY_RECALL_RUNTIME_VERSION,
    runtime: runtimeProfile(runtime.planner),
    cases_sha256: loaded.sha256,
    deterministic: {
      golden: rankingMetrics(scored, 'a'),
      negative: negativeMetrics(negative, 'a'),
      holdout: {
        available: holdout.length > 0,
        cases: holdout.length,
        metrics: holdout.length > 0 ? rankingMetrics(holdout, 'a') : null,
      },
      behavioral: {
        available: behavioral.length > 0,
        metrics: behavioral.length > 0 ? behavioralMetrics(behavioral) : null,
        cases: behavioral,
      },
    },
    embedding: embeddingArmStatus({ root, directory, config }),
  };
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
  casesFile,
  onProgress,
} = {}) {
  validateMemoryEmbeddingConfig(config);
  if (!Number.isFinite(suggestedWeight) || suggestedWeight <= 0 || suggestedWeight > 100) {
    throw new Error('memory embedding suggested weight must be greater than 0 and at most 100');
  }
  // Cases first, and a skip rather than a throw. The A/B used to read a fixture at a path that only
  // existed in the repository this package was extracted from, so a clean checkout could not run the
  // safety gate at all -- it crashed on ENOENT before reaching anything it could report.
  const loaded = loadMemoryRecallCases({ root, memoryDir, casesFile });
  if (!loaded.available) {
    return {
      schema: 'ownmem-embedding-ab-result/v1',
      status: 'skipped',
      reason: loaded.reason,
      cases: loaded,
      report: null,
      report_file: null,
    };
  }
  compile({ root, indexDirectory, memoryDir });
  const runtime = createMemoryRecallRuntime({ root, indexDirectory, memoryDir, observability: false }, { compile });
  const planner = runtime.planner;
  const corpus = loadMemoryEmbeddingCorpus({ root, indexDirectory });
  const { artifact, unusable } = readUsableMemoryEmbeddingArtifact({ root, directory, config });
  if (!artifact) {
    throw new Error(`memory embedding vectors are missing; run build before A/B evaluation${unusable ? ` (${unusable})` : ''}`);
  }
  const reconciliation = reconcileMemoryEmbeddingArtifact({ config, corpus, artifact });
  if (reconciliation.stale !== 0 || reconciliation.deleted !== 0) {
    throw new Error(`memory embedding vectors are stale (${reconciliation.stale} stale, ${reconciliation.deleted} deleted); run build before A/B evaluation`);
  }

  const benchmark = loaded.cases;
  if (benchmark.schema !== MEMORY_RECALL_CASES_BENCHMARK_SCHEMA) {
    throw new Error(`memory embedding A/B requires ${MEMORY_RECALL_CASES_BENCHMARK_SCHEMA} cases`);
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
    runtime,
    plannerA,
    plannerB,
    artifact,
    vectors: cache.vectors,
    allowedDocumentIds,
  });
  const negativeDiffs = await evaluateCases({
    cases: benchmark.negative,
    kind: 'negative',
    runtime,
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
  const guard = memoryEmbeddingAbGuard({
    goldenCases: nonHoldoutGolden.length,
    negativeNotWorse,
    holdoutNotWorse,
    goldenA,
    goldenB,
    negativeA,
    negativeB,
    holdoutA,
    holdoutB,
  });
  const body = {
    schema: MEMORY_EMBEDDING_AB_SCHEMA,
    snapshot_id: planner.snapshotId,
    provider: config.provider,
    model: config.model,
  // snapshot_id covers corpus and compiled ranking data, not ranker/channel code behavior.
  // Persist the recall-stack version so activation can reject evidence from older behavior.
    component_version: MEMORY_RECALL_RUNTIME_VERSION,
    runtime: {
      a: runtimeProfile(plannerA),
      b: runtimeProfile(plannerB),
    },
    cases_sha256: loaded.sha256,
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
    guard,
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
    runtime: report.runtime,
    cases_sha256: report.cases_sha256,
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
    status: 'measured',
    cases_file: loaded.file,
    cases_sha256: loaded.sha256,
    report: orderedReport,
    report_file: path.relative(root, file),
    cache_file: path.relative(root, cache.file),
    cache_hits: cache.hits,
    cache_misses: cache.misses,
    cache_discarded: cache.discarded,
    network_requests: cache.networkRequests,
  };
}
