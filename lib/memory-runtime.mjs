import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { budgetMemoryContext } from './memory-context-budgeter.mjs';
import {
  compileMemoryIndex,
  DEFAULT_MEMORY_INDEX_DIRECTORY,
} from './memory-compiler.mjs';
import {
  decideMemoryIndexRead,
  validateMemoryQueryResult,
} from './memory-contracts.mjs';
import { readPublishedMemorySnapshot } from './memory-index-store.mjs';
import {
  createMemoryQueryPlanner,
  planMultiMemoryQuery,
  planMemoryQuery,
} from './memory-query-planner.mjs';
import { classifyMemoryQuery } from './memory-query-classifier.mjs';
import { rankPlannedMemoryQuery } from './memory-ranker.mjs';
import { estimateMemoryTokens } from './memory-token-budget.mjs';
import { normalizeMemoryText } from './memory-tokenizer.mjs';
/**
 * Recall-stack behavior version recorded as component_version and required by A/B activation.
 * Bump it whenever ranker, channel, or abstention behavior changes so old evidence cannot unlock
 * weighting for a new behavior contract.
 */
export const MEMORY_RECALL_RUNTIME_VERSION = '0.6.2';

const MULTI_QUERY_SEPARATOR = '\n\u241E\n';

function nestedErrorMessages(error, seen = new Set()) {
  if (!error || seen.has(error)) return [];
  seen.add(error);
  const messages = error.message ? [String(error.message)] : [];
  for (const nested of error.errors || []) messages.push(...nestedErrorMessages(nested, seen));
  if (error.cause) messages.push(...nestedErrorMessages(error.cause, seen));
  return messages;
}

function rebuildTriggerForError(error) {
  const message = nestedErrorMessages(error).join(' | ').toLowerCase();
  if (/checksum|byte count|record count|snapshot id mismatch/.test(message)) return 'checksum-mismatch';
  if (/schema-incompatible|newer reader|requires validated|artifact contract/.test(message)) return 'schema-incompatible';
  if (/pointer is missing|enoent|no such file|snapshot is available/.test(message)) return 'missing';
  return 'manifest-invalid';
}

function rebuiltSource(manifest, trigger) {
  return {
    mode: 'snapshot',
    status: 'rebuilt',
    snapshot_id: manifest.snapshot.id,
    snapshot_schema: manifest.schema,
    degraded: false,
    rebuild_trigger: trigger,
    fallback_reason: null,
  };
}

/**
 * Source marker used when rebuild fails but the previous immutable snapshot remains intact.
 * It retains n-gram, exact-map, and graph lanes that a Markdown fallback cannot provide, and may
 * be the last valid state before source corruption. budgetMemoryContext verifies source hashes
 * before excerpting, so stale offsets never extract mismatched text.
 */
function previousSource(manifest, trigger) {
  return {
    mode: 'snapshot',
    status: 'previous',
    snapshot_id: manifest.snapshot.id,
    snapshot_schema: manifest.schema,
    // Content may lag one compilation; degraded tells callers that this is not the optimal source.
    degraded: true,
    rebuild_trigger: trigger,
    fallback_reason: 'rebuild-failed',
  };
}

function fallbackSource(snapshot, trigger) {
  return {
    mode: 'markdown-fallback',
    status: 'fallback',
    snapshot_id: snapshot?.manifest?.snapshot?.id || null,
    snapshot_schema: snapshot?.manifest?.schema === 'ownmem-index/v1'
      ? snapshot.manifest.schema
      : null,
    degraded: true,
    rebuild_trigger: trigger,
    fallback_reason: 'rebuild-failed',
  };
}

function observeBuild(observer, details, warnings) {
  if (!observer?.recordBuild) return;
  try {
    const warning = observer.recordBuild(details);
    if (warning) warnings.push(warning);
  } catch (error) {
    warnings.push(error.message);
  }
}

function snapshotRuntime(options, snapshot, source, started, warnings, observer) {
  const planner = createMemoryQueryPlanner(snapshot, { root: options.root });
  return {
    mode: 'snapshot',
    options,
    planner,
    source,
    activeTopics: planner.documents.size,
    topicIds: new Set(planner.documents.keys()),
    loadMs: performance.now() - started,
    warnings,
    observer,
  };
}

function fallbackRuntime(options, fallback, snapshot, trigger, started, warnings, observer) {
  const legacyIndex = fallback.load(options);
  return {
    mode: 'markdown-fallback',
    options,
    legacyIndex,
    source: fallbackSource(snapshot, trigger),
    activeTopics: legacyIndex.documents.length,
  // Report fallback-skipped topics so a partial corpus is distinguishable from a complete small one.
    skippedTopics: legacyIndex.skippedTopics || [],
    topicIds: new Set(legacyIndex.documents.map((document) => document.name)),
    loadMs: performance.now() - started,
    warnings,
    fallback,
    observer,
  };
}

function rebuildSnapshotRuntime({ options, compile, readSnapshot, indexRoot, trigger, started, warnings, observer }) {
  const rebuildStarted = performance.now();
  const result = compile({
    root: options.root,
    memoryDir: options.memoryDir,
    indexDirectory: options.indexDirectory || DEFAULT_MEMORY_INDEX_DIRECTORY,
  });
  const rebuilt = readSnapshot({ indexRoot, allowPrevious: false });
  const compatibility = decideMemoryIndexRead({ manifest: rebuilt.manifest });
  if (compatibility.action !== 'use-snapshot') {
    throw new Error('rebuilt memory index is incompatible with the current reader');
  }
  observeBuild(observer, {
    options,
    result,
    durationMs: performance.now() - rebuildStarted,
  }, warnings);
  return snapshotRuntime(options, rebuilt, rebuiltSource(rebuilt.manifest, trigger), started, warnings, observer);
}

export function createMemoryRecallRuntime(options, {
  compile = compileMemoryIndex,
  readSnapshot = readPublishedMemorySnapshot,
  fallback = null,
  observer = null,
} = {}) {
  const started = performance.now();
  const indexRoot = path.resolve(options.root, options.indexDirectory || DEFAULT_MEMORY_INDEX_DIRECTORY);
  const warnings = [];
  let snapshot = null;
  let initialError = null;
  let trigger = null;
  try {
    snapshot = readSnapshot({ indexRoot, allowPrevious: true });
    trigger = snapshot.selected === 'previous' ? rebuildTriggerForError(snapshot.currentError) : null;
  } catch (error) {
    initialError = error;
    trigger = rebuildTriggerForError(error);
  }
  if (!trigger && snapshot?.selected === 'current') {
    const decision = decideMemoryIndexRead({ manifest: snapshot.manifest });
    if (decision.action === 'use-snapshot') {
      return snapshotRuntime(options, snapshot, decision.source, started, warnings, observer);
    }
    trigger = decision.trigger;
  }
  const rebuildStarted = performance.now();
  try {
    return rebuildSnapshotRuntime({ options, compile, readSnapshot, indexRoot, trigger, started, warnings, observer });
  } catch (rebuildError) {
    observeBuild(observer, {
      options,
      error: rebuildError,
      durationMs: performance.now() - rebuildStarted,
    }, warnings);
    const resolvedTrigger = trigger || rebuildTriggerForError(initialError || rebuildError);
      // Prefer the checksum-validated previous snapshot and preserve all retrieval lanes.
      // Fall back to Markdown only when that snapshot is also unavailable or incompatible.
    if (snapshot?.selected === 'previous'
      && decideMemoryIndexRead({ manifest: snapshot.manifest }).action === 'use-snapshot') {
      return snapshotRuntime(
        options,
        snapshot,
        previousSource(snapshot.manifest, resolvedTrigger),
        started,
        warnings,
        observer,
      );
    }
    if (!fallback?.load || !fallback?.search) throw rebuildError;
    return fallbackRuntime(options, fallback, snapshot, resolvedTrigger, started, warnings, observer);
  }
}

function queryCacheKey(query, snapshotId) {
  return createHash('sha256')
    .update(`${normalizeMemoryText(query).trim().replace(/\s+/g, ' ')}\0${snapshotId || 'markdown-fallback'}`)
    .digest('hex');
}

function estimateEnvelope(envelope) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const estimated = estimateMemoryTokens(envelope);
    if (estimated === envelope.budget.estimated_tokens) return estimated;
    envelope.budget.estimated_tokens = estimated;
  }
  throw new Error('memory fallback token estimate did not converge');
}

const MAX_ENVELOPE_WARNING_LENGTH = 160;

/**
 * Surface invalid fallback topics in envelope warnings. They do not belong in dropped_topics,
 * which measures token-budget exclusion; merging those losses would corrupt the metric.
 */
function skippedTopicWarnings(runtime) {
  const skipped = runtime.skippedTopics || [];
  if (skipped.length === 0) return [];
  const shown = [];
  let warning = `Markdown fallback skipped ${skipped.length} corrupt topic file(s)`;
  for (const file of skipped) {
    const remaining = skipped.length - shown.length - 1;
    const candidate = `Markdown fallback skipped ${skipped.length} corrupt topic file(s): ${[...shown, file].join(', ')}${remaining > 0 ? ` (+${remaining} more)` : ''}`;
    if (candidate.length > MAX_ENVELOPE_WARNING_LENGTH) break;
    shown.push(file);
    warning = candidate;
  }
  return [warning];
}

function uniqueStrings(values, limit) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function fallbackResult(result, rank) {
  const excerpt = result.excerpt?.text?.trim()
    ? { field: result.excerpt.field, text: result.excerpt.text.slice(0, 160) }
    : null;
  return {
    rank,
    memory_id: result.document.name,
    path: result.document.relativePath,
    score: Number(Math.max(0, result.score).toFixed(6)),
    channels: ['bm25f'],
    matched_fields: uniqueStrings(result.fields.length > 0 ? result.fields : ['body'], 12),
    matched_terms: uniqueStrings(result.matchedTerms.map(({ term }) => term), 6),
    excerpt,
    authority_docs: uniqueStrings(result.document.parsed.authorityDocs || [], 2),
    explanation: ['Markdown BM25F fallback after snapshot rebuild failed'],
  };
}

function compactFallbackEnvelope(envelope) {
  while (envelope.results.length > envelope.budget.max_topics) {
    envelope.results.pop();
    envelope.budget.truncated = true;
  }
  if (estimateEnvelope(envelope) <= envelope.budget.max_tokens) return;
  envelope.budget.truncated = true;
  for (const result of envelope.results) {
    // The contract requires at least one explanation. Compress it without emptying the fallback envelope.
    result.explanation = ['markdown-fallback'];
    result.authority_docs = result.authority_docs.slice(0, 1);
    result.matched_terms = result.matched_terms.slice(0, 3);
    if (result.excerpt?.text.length > 80) result.excerpt.text = `${result.excerpt.text.slice(0, 79)}…`;
  }
  while (envelope.results.length > 1 && estimateEnvelope(envelope) > envelope.budget.max_tokens) {
    envelope.results.pop();
  }
  if (estimateEnvelope(envelope) > envelope.budget.max_tokens && envelope.results[0]) {
    const result = envelope.results[0];
    result.excerpt = null;
    result.matched_terms = [];
    result.authority_docs = [];
  }
  if (estimateEnvelope(envelope) > envelope.budget.max_tokens) {
    envelope.results = [];
    envelope.abstain = { abstained: true, reason: 'budget-empty' };
  }
  envelope.results.forEach((result, index) => { result.rank = index + 1; });
  estimateEnvelope(envelope);
}

function fallbackEnvelope(runtime, query, { limit, tier }, warnings = []) {
  const results = runtime.fallback.search(runtime.legacyIndex, query, { limit: Math.min(limit, 3) })
    .slice(0, 3)
    .map((result, index) => fallbackResult(result, index + 1));
  const maxTokens = tier === 'expanded' ? 1_200 : 400;
  const envelope = {
    schema: 'ownmem-query-result/v1',
    trace_id: randomBytes(16).toString('hex'),
    query: {
      classifications: classifyMemoryQuery(query),
      cache_key_sha256: queryCacheKey(query, runtime.source.snapshot_id),
    },
    source: structuredClone(runtime.source),
    results,
    abstain: results.length > 0
      ? { abstained: false, reason: null }
      : { abstained: true, reason: 'no-trusted-candidate' },
    budget: {
      tier,
      max_topics: tier === 'expanded' ? 3 : 1,
      max_tokens: maxTokens,
      estimated_tokens: 0,
      estimator: 'cjk1-ascii4-v1',
      truncated: false,
    },
    warnings: [...new Set([
      'Snapshot rebuild failed; using validated Markdown BM25F fallback',
      ...skippedTopicWarnings(runtime),
      ...warnings,
    ])].slice(0, 5),
  };
  compactFallbackEnvelope(envelope);
  validateMemoryQueryResult(envelope);
  return envelope;
}

function fallbackMultiResults(runtime, queries, limit) {
  const k = 10;
  const fused = new Map();
  for (const query of queries) {
    const results = runtime.fallback.search(runtime.legacyIndex, query, { limit: 50 });
    results.forEach((result, index) => {
      let aggregate = fused.get(result.document.name);
      if (!aggregate) aggregate = { result, score: 0 };
      aggregate.score += 1 / (k + index + 1);
      if (index < (aggregate.bestRank ?? Infinity)) {
        aggregate.result = result;
        aggregate.bestRank = index;
      }
      fused.set(result.document.name, aggregate);
    });
  }
  return [...fused.values()]
    .sort((left, right) => right.score - left.score
      || left.bestRank - right.bestRank
      || left.result.document.name.localeCompare(right.result.document.name, 'en'))
    .slice(0, Math.min(limit, 3))
    .map((item, index) => fallbackResult({ ...item.result, score: item.score }, index + 1));
}

function fallbackMultiEnvelope(runtime, queries, { limit, tier }, warnings = []) {
  const queryKey = queries.join(MULTI_QUERY_SEPARATOR);
  const results = fallbackMultiResults(runtime, queries, limit);
  const classifications = [];
  for (const query of queries) {
    for (const classification of classifyMemoryQuery(query)) {
      if (!classifications.includes(classification)) classifications.push(classification);
    }
  }
  const envelope = {
    schema: 'ownmem-query-result/v1',
    trace_id: randomBytes(16).toString('hex'),
    query: {
      classifications,
      cache_key_sha256: queryCacheKey(queryKey, runtime.source.snapshot_id),
    },
    source: structuredClone(runtime.source),
    results,
    abstain: results.length > 0
      ? { abstained: false, reason: null }
      : { abstained: true, reason: 'no-trusted-candidate' },
    budget: {
      tier,
      max_topics: tier === 'expanded' ? 3 : 1,
      max_tokens: tier === 'expanded' ? 1_200 : 400,
      estimated_tokens: 0,
      estimator: 'cjk1-ascii4-v1',
      truncated: false,
    },
    warnings: [...new Set([
      'Snapshot rebuild failed; using validated Markdown BM25F multi-query fallback',
      ...skippedTopicWarnings(runtime),
      ...warnings,
    ])].slice(0, 5),
  };
  compactFallbackEnvelope(envelope);
  validateMemoryQueryResult(envelope);
  return envelope;
}

function observeRecall(runtime, details) {
  if (!runtime.observer?.recordRecall) return { traceId: null, warning: null };
  try {
    return runtime.observer.recordRecall(details) || { traceId: null, warning: null };
  } catch (error) {
    return { traceId: null, warning: error.message };
  }
}
/** Degradation belongs in the envelope warnings, which both humans and agents already consume. */
function sourceWarnings(runtime) {
  if (runtime.source.status !== 'previous') return [];
  return ['Snapshot rebuild failed; serving the previous snapshot, which may lag the current memory files'];
}

function querySnapshotRuntime(runtime, query, { limit, tier, excludeMemoryIds }, embedding = null) {
  const planner = embedding?.planner || runtime.planner;
  let stage = performance.now();
  const planResult = planMemoryQuery(planner, query, {
    embeddingResponse: embedding?.responses?.[0],
  });
  const plan = performance.now() - stage;
  stage = performance.now();
  const ranked = rankPlannedMemoryQuery(planner, query, planResult, { limit });
  const rank = performance.now() - stage;
  stage = performance.now();
  const envelope = budgetMemoryContext(planner, query, ranked, {
    tier,
    excludeMemoryIds,
    source: runtime.source,
    warnings: [...sourceWarnings(runtime), ...(embedding?.warning ? [embedding.warning] : [])],
  });
  return { envelope, plan, rank, context: performance.now() - stage, planResult, ranked };
}

function querySnapshotRuntimeMulti(runtime, queries, { limit, tier, excludeMemoryIds }, embedding = null) {
  const planner = embedding?.planner || runtime.planner;
  const queryKey = queries.join(MULTI_QUERY_SEPARATOR);
  let stage = performance.now();
  const planResult = planMultiMemoryQuery(planner, queries, {
    embeddingResponses: embedding?.responses || undefined,
  });
  const plan = performance.now() - stage;
  stage = performance.now();
  const ranked = rankPlannedMemoryQuery(planner, queries[0], planResult, {
    limit,
    featureQueries: queries,
  });
  const rank = performance.now() - stage;
  stage = performance.now();
  const envelope = budgetMemoryContext(planner, queryKey, ranked, {
    tier,
    excludeMemoryIds,
    source: runtime.source,
    warnings: [...sourceWarnings(runtime), ...(embedding?.warning ? [embedding.warning] : [])],
  });
  return { envelope, plan, rank, context: performance.now() - stage, planResult, ranked };
}

function queryFallbackRuntime(runtime, query, { limit, tier }, embedding = null) {
  const started = performance.now();
  return {
    envelope: fallbackEnvelope(runtime, query, { limit, tier }, embedding?.warning ? [embedding.warning] : []),
    plan: 0,
    rank: performance.now() - started,
    context: 0,
    planResult: null,
    ranked: null,
  };
}

function embeddingMetrics(embedding) {
  if (!embedding?.active) return null;
  const rrfWeight = Number.isFinite(embedding.rrfWeight) ? embedding.rrfWeight : 0;
  return {
    active: true,
    mode: rrfWeight > 0 ? 'weighted' : 'observe',
    rrf_weight: rrfWeight,
    latency_ms: Number(Math.max(0, embedding.latencyMs || 0).toFixed(3)),
    cache_hit: Boolean(embedding.cacheHit),
    degraded_reason: embedding.degradedReason || null,
  };
}

function contractDegradedEmbedding(embedding, planner) {
  return {
    active: true,
    responses: null,
    planner,
    latencyMs: embedding?.latencyMs || 0,
    cacheHit: Boolean(embedding?.cacheHit),
    degradedReason: 'contract',
    rrfWeight: Number.isFinite(embedding?.rrfWeight) ? embedding.rrfWeight : 0,
    warning: 'Embedding channel degraded (contract); lexical results are unchanged',
  };
}

export function queryMemoryRuntime(runtime, query, options = {}) {
  const raw = String(query || '').trim();
  if (!raw) throw new Error('memory query must not be empty');
  const normalized = {
    limit: options.limit ?? 3,
    tier: options.tier || 'default',
    excludeMemoryIds: options.excludeMemoryIds || [],
  };
  const started = performance.now();
  let resolvedEmbedding = options.embedding || null;
  let result;
  try {
    result = runtime.mode === 'snapshot'
      ? querySnapshotRuntime(runtime, raw, normalized, resolvedEmbedding)
      : queryFallbackRuntime(runtime, raw, normalized, resolvedEmbedding);
  } catch (error) {
    if (!resolvedEmbedding?.active) throw error;
    resolvedEmbedding = contractDegradedEmbedding(resolvedEmbedding, runtime.planner);
    result = runtime.mode === 'snapshot'
      ? querySnapshotRuntime(runtime, raw, normalized, resolvedEmbedding)
      : queryFallbackRuntime(runtime, raw, normalized, resolvedEmbedding);
  }
  const metrics = { ...result, total: performance.now() - started };
  delete metrics.envelope;
  metrics.embedding = embeddingMetrics(resolvedEmbedding);
  const execution = options.execution || 'cold';
  const observation = observeRecall(runtime, {
    runtime,
    query: raw,
    envelope: result.envelope,
    metrics,
    execution,
  });
  return {
    envelope: result.envelope,
    observationTraceId: observation.traceId,
    warning: observation.warning,
    metrics,
  };
}

export function queryMemoryRuntimeMulti(runtime, queries, options = {}) {
  if (!Array.isArray(queries) || queries.length < 2 || queries.length > 3) {
    throw new Error('memory multi-query requires 2-3 phrasings');
  }
  const values = queries.map((query) => String(query || '').trim());
  if (values.some((query) => !query)) throw new Error('memory multi-query phrasing must not be empty');
  const normalized = {
    limit: options.limit ?? 3,
    tier: options.tier || 'default',
    excludeMemoryIds: options.excludeMemoryIds || [],
  };
  const started = performance.now();
  let resolvedEmbedding = options.embedding || null;
  let result;
  const query = () => runtime.mode === 'snapshot'
    ? querySnapshotRuntimeMulti(runtime, values, normalized, resolvedEmbedding)
    : {
      envelope: fallbackMultiEnvelope(
        runtime,
        values,
        normalized,
        resolvedEmbedding?.warning ? [resolvedEmbedding.warning] : [],
      ),
      plan: 0,
      rank: performance.now() - started,
      context: 0,
      planResult: null,
      ranked: null,
    };
  try {
    result = query();
  } catch (error) {
    if (!resolvedEmbedding?.active) throw error;
    resolvedEmbedding = contractDegradedEmbedding(resolvedEmbedding, runtime.planner);
    result = query();
  }
  const metrics = { ...result, total: performance.now() - started };
  delete metrics.envelope;
  metrics.embedding = embeddingMetrics(resolvedEmbedding);
  const observation = observeRecall(runtime, {
    runtime,
    query: values.join(MULTI_QUERY_SEPARATOR),
    envelope: result.envelope,
    metrics,
    execution: options.execution || 'cold',
  });
  return {
    envelope: result.envelope,
    observationTraceId: observation.traceId,
    warning: observation.warning,
    metrics,
  };
}
