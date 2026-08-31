import { randomUUID } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  createMemoryObservabilityEvent,
  DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  memoryQueryId,
  recordMemoryDelivery,
  recordMemoryObservabilityEvent,
} from './memory-observability.mjs';
import { MEMORY_RECALL_RUNTIME_VERSION } from './memory-runtime.mjs';

export { MEMORY_RECALL_RUNTIME_VERSION };

/**
 * Local recall/build event producer for the observability files that `report` and the dashboard
 * read. Every write stays inside the repository's ignored observability directory; a failed write
 * degrades to a warning on the caller's side and never blocks recall itself.
 */

/** Map an envelope source onto the shared degradation registry in MEMORY_RECALL_COMPONENTS. */
export function recallComponent(source) {
  if (source?.mode !== 'snapshot') return 'memory-recall-fallback';
  return source.status === 'previous' ? 'memory-recall-previous' : 'memory-recall-snapshot';
}

function nonNegative(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Number(numeric.toFixed(3));
}

function nonNegativeInt(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) return 0;
  return numeric;
}

function channelCounts(planResult) {
  const channels = {};
  const union = new Set();
  for (const [channel, candidates] of Object.entries(planResult?.channels || {})) {
    if (!Array.isArray(candidates)) continue;
    channels[channel] = candidates.length;
    for (const candidate of candidates) union.add(candidate.document_id);
  }
  return { channels, rrfCandidates: union.size };
}

const ABSTAIN_REASONS = new Set(['no-trusted-candidate', 'below-threshold', 'below-coverage', 'budget-empty', 'all-candidates-excluded']);

function normalizedAbstainReason(envelope) {
  if (!envelope.abstain?.abstained) return null;
  const reason = envelope.abstain.reason;
  return ABSTAIN_REASONS.has(reason) ? reason : 'no-trusted-candidate';
}

function normalizedEmbedding(embedding) {
  if (embedding?.active !== true) return null;
  return {
    active: true,
    ...(embedding.mode ? { mode: embedding.mode } : {}),
    ...(Number.isFinite(embedding.rrf_weight) ? { rrf_weight: embedding.rrf_weight } : {}),
    latency_ms: nonNegative(embedding.latency_ms),
    cache_hit: Boolean(embedding.cache_hit),
    degraded_reason: embedding.degraded_reason ?? null,
  };
}

function directoryBytes(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .reduce((sum, entry) => sum + statSync(path.join(directory, entry.name)).size, 0);
  } catch {
    return 0;
  }
}

function buildErrorCode(error) {
  const code = String(error?.code || '').toUpperCase();
  return /^[A-Z0-9_-]{1,64}$/.test(code) ? code : 'REBUILD_FAILED';
}

export function createMemoryRuntimeObserver(options = {}) {
  if (!options || options.observability === false || !options.root) return null;
  const root = options.root;
  const directory = options.observabilityDirectory || DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY;
  const surface = options.surface === 'claude-hook' ? 'claude-hook' : 'cli';
  const consumptionEligible = options.consumptionEligible !== false;

  return {
    recordRecall({ runtime, query, envelope, metrics, execution, episodeId = null } = {}) {
      const traceId = randomUUID();
      const { channels, rrfCandidates } = channelCounts(metrics?.planResult);
      const abstained = Boolean(envelope.abstain?.abstained);
      const returnedTopics = envelope.results.map((result) => result.memory_id).slice(0, 20);
      const embedding = normalizedEmbedding(metrics?.embedding);
      const event = createMemoryObservabilityEvent({
        event: 'recall.completed',
        traceId,
        snapshotId: envelope.source?.snapshot_id ?? null,
        component: recallComponent(envelope.source),
        componentVersion: MEMORY_RECALL_RUNTIME_VERSION,
        payload: {
          surface,
          consumption_eligible: Boolean(consumptionEligible && !abstained && returnedTopics.length > 0),
          // Already keyed by whoever knew the turn; a surface with no turn reports null rather than
          // having one invented for it.
          episode_id: /^[a-f0-9]{64}$/u.test(String(episodeId ?? '')) ? episodeId : null,
          query_id: memoryQueryId({ root, query, directory }),
          query_class: envelope.query?.classifications?.length ? envelope.query.classifications : ['natural'],
          execution: execution === 'hot' ? 'hot' : 'cold',
          total_ms: nonNegative(metrics?.total),
          stage_ms: {
            load: nonNegative(runtime?.loadMs),
            plan: nonNegative(metrics?.plan),
            rank: nonNegative(metrics?.rank),
            context: nonNegative(metrics?.context),
          },
          channels,
          rrf_candidates: rrfCandidates,
          abstained,
          abstain_reason: normalizedAbstainReason(envelope),
          returned_topics: returnedTopics,
          estimated_tokens: nonNegativeInt(Math.round(envelope.budget?.estimated_tokens ?? 0)),
          // Production recall has no result cache; null keeps the field honest instead of a fake false.
          cache_hit: null,
          truncated: Boolean(envelope.budget?.truncated),
          dropped_topics: nonNegativeInt(envelope.budget?.dropped_topics ?? 0),
          ...(embedding ? { embedding } : {}),
        },
      });
      const recorded = recordMemoryObservabilityEvent({ root, directory, event });
      if (!recorded.written) return { traceId: null, warning: recorded.error };
      const trustBlocked = metrics?.ranked?.diagnostics?.trust_blocked || [];
      if (trustBlocked.length > 0) {
        const quarantine = createMemoryObservabilityEvent({
          event: 'trust.quarantined',
          traceId,
          snapshotId: envelope.source?.snapshot_id ?? null,
          component: recallComponent(envelope.source),
          componentVersion: MEMORY_RECALL_RUNTIME_VERSION,
          payload: {
            topics: [...new Set(trustBlocked.map(item => item.document_id))].slice(0, 20),
            gates: [...new Set(trustBlocked.map(item => item.gate).filter(Boolean))],
            reasons: [...new Set(trustBlocked.flatMap(item => Object.values(item.verdicts || {})
              .map(verdict => verdict.reason).filter(Boolean)))],
            use_time_revalidation: true,
          },
        });
        const quarantineWrite = recordMemoryObservabilityEvent({ root, directory, event: quarantine });
        if (!quarantineWrite.written) return { traceId, warning: quarantineWrite.error };
      }
      return { traceId, warning: null };
    },

    recordBuild(details = {}) {
      try {
        const stats = details.result?.stats || null;
        const event = createMemoryObservabilityEvent({
          event: 'index.build',
          snapshotId: details.result?.manifest?.snapshot?.id ?? null,
          component: 'memory-compile',
          componentVersion: MEMORY_RECALL_RUNTIME_VERSION,
          payload: {
            mode: stats?.mode === 'incremental' ? 'incremental' : 'full',
            changed_files: nonNegativeInt(stats?.changed_sources),
            compiled_topics: nonNegativeInt(stats?.compiled_topics),
            reused_topics: nonNegativeInt(stats?.reused_topics),
            deleted_topics: nonNegativeInt(stats?.deleted_topics),
            duration_ms: nonNegative(details.durationMs),
            snapshot_bytes: details.result?.directory ? directoryBytes(details.result.directory) : 0,
            success: !details.error,
            fallback: Boolean(details.error || details.result?.previous_fallback_used),
            // The rebuild path does not read the prior manifest's age; null means unobserved, not zero.
            previous_snapshot_age_ms: null,
            error_code: details.error ? buildErrorCode(details.error) : null,
          },
        });
        const recorded = recordMemoryObservabilityEvent({ root, directory, event });
        return recorded.written ? null : recorded.error;
      } catch (error) {
        return error.message;
      }
    },
  };
}

/**
 * Event writer for the core `ownmem recall` CLI, which ranks Markdown directly and never builds a
 * runtime. It reports under the shared trace so hook-observed full-text opens can pair with it.
 */
export function recordCoreCliRecall({
  root,
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  traceId,
  query,
  classifications,
  returnedTopics = [],
  abstained,
  rrfCandidates = 0,
  loadMs = 0,
  rankMs = 0,
  totalMs = 0,
  feedback = null,
  expectedInTopK = null,
} = {}) {
  const warnings = [];
  const topics = returnedTopics.slice(0, 20);
  const completed = createMemoryObservabilityEvent({
    event: 'recall.completed',
    traceId,
    snapshotId: null,
    component: 'memory-recall-cli',
    componentVersion: MEMORY_RECALL_RUNTIME_VERSION,
    payload: {
      surface: 'cli',
      consumption_eligible: !abstained && topics.length > 0,
      // A command-line recall has no user turn to belong to. Null is the honest value; deriving one
      // from the clock would make episode membership a guess presented as a fact.
      episode_id: null,
      query_id: memoryQueryId({ root, query, directory }),
      query_class: classifications?.length ? classifications : ['natural'],
      execution: 'cold',
      total_ms: nonNegative(totalMs),
      stage_ms: { load: nonNegative(loadMs), rank: nonNegative(rankMs) },
      channels: {},
      rrf_candidates: nonNegativeInt(rrfCandidates),
      abstained: Boolean(abstained),
      abstain_reason: abstained ? 'no-trusted-candidate' : null,
      returned_topics: topics,
      estimated_tokens: 0,
      cache_hit: null,
      truncated: false,
      dropped_topics: 0,
    },
  });
  const wroteCompleted = recordMemoryObservabilityEvent({ root, directory, event: completed });
  if (!wroteCompleted.written) return { written: false, warnings: [wroteCompleted.error] };
  if (topics.length > 0) {
    const delivery = recordMemoryDelivery({
      root,
      directory,
      traceId,
      snapshotId: null,
      topics,
      surface: 'cli',
      component: 'memory-recall-cli',
      componentVersion: MEMORY_RECALL_RUNTIME_VERSION,
    });
    if (!delivery.write.written) warnings.push(delivery.write.error);
  }
  if (feedback) {
    const feedbackEvent = createMemoryObservabilityEvent({
      event: 'feedback.recorded',
      traceId,
      snapshotId: null,
      component: 'memory-recall-cli',
      componentVersion: MEMORY_RECALL_RUNTIME_VERSION,
      payload: { verdict: feedback, expected_in_top_k: expectedInTopK },
    });
    const wroteFeedback = recordMemoryObservabilityEvent({ root, directory, event: feedbackEvent });
    if (!wroteFeedback.written) warnings.push(wroteFeedback.error);
  }
  return { written: true, warnings };
}
