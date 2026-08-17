import {
  DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  recordMemoryConsumption,
  recordMemoryDelivery,
} from './memory-observability.mjs';

/**
 * Telemetry sinks for the hook daemon. Both are best-effort by contract: the coordinator already
 * wraps them in setImmediate + catch, so a failed write costs one event, never a hook response.
 */

export function createMemoryHookDeliverySink({ root, directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY } = {}) {
  if (!root) throw new Error('createMemoryHookDeliverySink requires a repository root');
  return ({ traceId, snapshotId = null, topics = [] } = {}) => {
    if (!traceId || topics.length === 0) return;
    recordMemoryDelivery({
      root,
      directory,
      traceId,
      snapshotId,
      topics,
      surface: 'claude-hook',
      component: 'memory-hook',
    });
  };
}

export function createMemoryHookConsumptionSink({ root, directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY } = {}) {
  if (!root) throw new Error('createMemoryHookConsumptionSink requires a repository root');
  return (match = {}) => {
    if (!match.traceId || !Array.isArray(match.topics) || match.topics.length === 0) return;
    recordMemoryConsumption({
      root,
      directory,
      traceId: match.traceId,
      snapshotId: match.snapshotId ?? null,
      topics: match.topics,
      // A Read of the topic file proves the open, not whether authority docs were then followed.
      authorityFollowed: null,
      component: 'memory-hook',
      via: match.via || 'claude-hook',
      match: match.match || 'recent',
    });
  };
}
