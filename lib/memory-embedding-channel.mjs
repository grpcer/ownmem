import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import {
  readMemoryEmbeddingConfig,
} from './memory-embedding-provider.mjs';
import {
  executeMemoryEmbeddingQueryBatch,
  memoryEmbeddingQueryFailureReason,
} from './memory-embedding-query.mjs';
import {
  loadMemoryEmbeddingCorpus,
  readMemoryEmbeddingArtifact,
  reconcileMemoryEmbeddingArtifact,
  topKMemoryEmbeddingMatches,
} from './memory-embedding-store.mjs';
import {
  MEMORY_EMBEDDING_CANDIDATES_SCHEMA,
  retrieveMemoryEmbeddingCandidates,
} from './memory-embedding-adapter.mjs';

export const MEMORY_EMBEDDING_QUERY_LIMIT = 50;
export const MEMORY_EMBEDDING_STALE_RATIO_LIMIT = 0.2;
export const MEMORY_EMBEDDING_SUGGESTED_WEIGHT = 4;
const MEMORY_EMBEDDING_QUERY_WORKER = new URL('./memory-embedding-query-worker.mjs', import.meta.url);
const MEMORY_EMBEDDING_QUERY_WORKER_SCHEMA = 'ownmem-embedding-query-worker-result/v1';
const MEMORY_EMBEDDING_QUERY_FAILURE_REASONS = new Set(['auth', 'contract', 'network', 'quota', 'timeout']);

function normalizedQueries(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 3) {
    throw new Error('memory embedding channel requires 1-3 queries');
  }
  const queries = values.map((value) => String(value || '').trim());
  if (queries.some((query) => !query)) throw new Error('memory embedding channel query must not be blank');
  return queries;
}

function degradedReason(error) {
  return memoryEmbeddingQueryFailureReason(error);
}

function warningFor(reason) {
  return `Embedding channel degraded (${reason}); lexical results are unchanged`;
}

function degradedResult(started, reason, details = {}) {
  return {
    active: true,
    responses: null,
    planner: details.planner || null,
    latencyMs: details.latencyMs ?? started.latencyMs ?? 0,
    cacheHit: false,
    degradedReason: reason,
    rrfWeight: started.config?.rrf_weight ?? 0,
    warning: warningFor(reason),
    stale: details.stale ?? null,
    total: details.total ?? null,
  };
}

function queryError(reason) {
  const error = new Error(`memory embedding query failed (${reason})`);
  error.memoryEmbeddingDegradedReason = reason;
  return error;
}

function validatedWorkerOutcome(message, expectedCount) {
  if (!message || message.schema !== MEMORY_EMBEDDING_QUERY_WORKER_SCHEMA || typeof message.ok !== 'boolean') {
    throw queryError('contract');
  }
  if (!message.ok) {
    const reason = MEMORY_EMBEDDING_QUERY_FAILURE_REASONS.has(message.degraded_reason)
      ? message.degraded_reason
      : 'contract';
    throw queryError(reason);
  }
  if (!Number.isFinite(message.latency_ms) || message.latency_ms < 0) throw queryError('contract');
  if (!Array.isArray(message.vectors) || message.vectors.length !== expectedCount) throw queryError('contract');
  const vectors = message.vectors.map((vector) => {
    const values = ArrayBuffer.isView(vector) ? [...vector] : vector;
    if (!Array.isArray(values) || values.length === 0 || values.some((value) => !Number.isFinite(value))) {
      throw queryError('contract');
    }
    return Float32Array.from(values);
  });
  return { vectors, latencyMs: message.latency_ms };
}

function executeIsolatedMemoryEmbeddingQueryBatch(config, queries) {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
      void worker?.terminate();
    };
    try {
      worker = new Worker(MEMORY_EMBEDDING_QUERY_WORKER, {
        workerData: { config, queries },
      });
    } catch (error) {
      finish(reject, queryError('contract'));
      return;
    }
    worker.once('message', (message) => {
      try {
        finish(resolve, validatedWorkerOutcome(message, queries.length));
      } catch (error) {
        finish(reject, error);
      }
    });
    worker.once('error', () => finish(reject, queryError('contract')));
    worker.once('exit', () => {
      if (!settled) finish(reject, queryError('contract'));
    });
  }).catch((error) => {
    error.memoryEmbeddingLatencyMs ??= performance.now() - startedAt;
    throw error;
  });
}

function startQueryBatch(config, queries, { fetchImpl, sleepImpl } = {}) {
  if (fetchImpl !== undefined || sleepImpl !== undefined) {
    return executeMemoryEmbeddingQueryBatch(config, queries, { fetchImpl, sleepImpl });
  }
  return executeIsolatedMemoryEmbeddingQueryBatch(config, queries);
}

export function startMemoryEmbeddingQueries({
  root,
  directory,
  indexDirectory,
  queries,
  fetchImpl,
  sleepImpl,
} = {}) {
  const values = normalizedQueries(queries);
  let config;
  try {
    config = readMemoryEmbeddingConfig({ root, directory });
  } catch {
    return {
      active: true,
      config: null,
      artifact: null,
      directory,
      indexDirectory,
      queries: values,
      latencyMs: 0,
      degradedReason: 'config-invalid',
      pending: null,
    };
  }
  if (!config || !config.enabled) {
    return {
      active: false,
      config,
      artifact: null,
      directory,
      indexDirectory,
      queries: values,
      latencyMs: 0,
      degradedReason: null,
      pending: null,
    };
  }

  let artifact;
  try {
    artifact = readMemoryEmbeddingArtifact({ root, directory, config });
  } catch {
    return {
      active: true,
      config,
      artifact: null,
      directory,
      indexDirectory,
      queries: values,
      latencyMs: 0,
      degradedReason: 'artifact-invalid',
      pending: null,
    };
  }
  if (!artifact) {
    return {
      active: true,
      config,
      artifact: null,
      directory,
      indexDirectory,
      queries: values,
      latencyMs: 0,
      degradedReason: 'artifact-missing',
      pending: null,
    };
  }

  const pending = startQueryBatch(config, values, { fetchImpl, sleepImpl })
    .then(({ vectors, latencyMs }) => ({ vectors, error: null, latencyMs }))
    .catch((error) => ({
      vectors: null,
      error,
      latencyMs: error.memoryEmbeddingLatencyMs ?? 0,
    }));
  return {
    active: true,
    config,
    artifact,
    directory,
    indexDirectory,
    queries: values,
    latencyMs: 0,
    degradedReason: null,
    pending,
  };
}

function staleState(started, runtime) {
  const documentIds = new Set(runtime.planner.documents.keys());
  if (started.artifact.corpus_snapshot_id === runtime.planner.snapshotId) {
    const staleIds = new Set([...documentIds].filter((documentId) => !started.artifact.entries[documentId]));
    return { documentIds, staleIds, stale: staleIds.size, total: documentIds.size };
  }
  const corpus = loadMemoryEmbeddingCorpus({
    root: runtime.options.root,
    indexDirectory: started.indexDirectory || runtime.options.indexDirectory,
  });
  const reconciliation = reconcileMemoryEmbeddingArtifact({
    config: started.config,
    corpus,
    artifact: started.artifact,
  });
  return {
    documentIds,
    staleIds: new Set(reconciliation.pending.map((document) => document.document_id)),
    stale: reconciliation.stale,
    total: reconciliation.total,
  };
}

export function createMemoryEmbeddingPlanner(planner, config, {
  rrfWeight = config.rrf_weight,
  confidenceContribution = config.confidence_contribution,
} = {}) {
  if (!planner?.snapshotId || !planner?.ranking) throw new Error('memory embedding ranking requires a query planner');
  if (!Number.isFinite(rrfWeight) || rrfWeight < 0 || rrfWeight > 100) {
    throw new Error('memory embedding RRF weight must be between 0 and 100');
  }
  const ranking = structuredClone(planner.ranking);
  ranking.rrf.channel_weights.embedding = rrfWeight;
  ranking.features.weights.embedding_similarity = rrfWeight;
  ranking.features.confidence_weights.embedding.embedding_similarity = confidenceContribution ? 1 : 0;
  return { ...planner, ranking };
}

export async function createMemoryEmbeddingCandidatesFromVector({
  artifact,
  query,
  queryVector,
  allowedDocumentIds,
  limit = MEMORY_EMBEDDING_QUERY_LIMIT,
} = {}) {
  const adapter = {
    async retrieve(request) {
      return {
        schema: MEMORY_EMBEDDING_CANDIDATES_SCHEMA,
        candidates: topKMemoryEmbeddingMatches(artifact, queryVector, {
          limit: request.limit,
          allowedDocumentIds,
        }),
      };
    },
  };
  return retrieveMemoryEmbeddingCandidates(adapter, query, { limit });
}

export async function completeMemoryEmbeddingQueries(started, runtime) {
  if (!started?.active) return null;
  if (!started.config || !started.artifact || started.degradedReason) {
    return degradedResult(started, started.degradedReason || 'config-invalid', { planner: runtime.planner });
  }
  if (runtime.mode !== 'snapshot') {
    return degradedResult(started, 'snapshot-unavailable', { planner: runtime.planner });
  }

  let freshness;
  try {
    freshness = staleState(started, runtime);
  } catch {
    return degradedResult(started, 'artifact-stale', { planner: runtime.planner });
  }
  const staleRatio = freshness.total === 0 ? 1 : freshness.stale / freshness.total;
  if (staleRatio > MEMORY_EMBEDDING_STALE_RATIO_LIMIT) {
    return degradedResult(started, 'artifact-stale', {
      planner: runtime.planner,
      stale: freshness.stale,
      total: freshness.total,
    });
  }

  const outcome = await started.pending;
  if (outcome.error) {
    return degradedResult(started, degradedReason(outcome.error), {
      planner: runtime.planner,
      latencyMs: outcome.latencyMs,
      stale: freshness.stale,
      total: freshness.total,
    });
  }
  if (outcome.vectors.some((vector) => vector.length !== started.artifact.dimensions)) {
    return degradedResult(started, 'contract', {
      planner: runtime.planner,
      latencyMs: outcome.latencyMs,
      stale: freshness.stale,
      total: freshness.total,
    });
  }

  const allowedDocumentIds = new Set([...freshness.documentIds]
    .filter((documentId) => !freshness.staleIds.has(documentId) && started.artifact.entries[documentId]));
  try {
    const responses = await Promise.all(started.queries.map((query, index) => (
      createMemoryEmbeddingCandidatesFromVector({
        artifact: started.artifact,
        query,
        queryVector: outcome.vectors[index],
        allowedDocumentIds,
      })
    )));
    const planner = createMemoryEmbeddingPlanner(runtime.planner, started.config);
    const weight = started.config.rrf_weight;
    return {
      active: true,
      responses,
      planner,
      latencyMs: outcome.latencyMs,
      cacheHit: false,
      degradedReason: null,
      rrfWeight: weight,
      warning: weight === 0
        ? 'Embedding channel active in observation mode (ranking weight 0)'
        : `Embedding channel active with local ranking weight ${weight}`,
      stale: freshness.stale,
      total: freshness.total,
    };
  } catch {
    return degradedResult(started, 'contract', {
      planner: runtime.planner,
      latencyMs: outcome.latencyMs,
      stale: freshness.stale,
      total: freshness.total,
    });
  }
}
