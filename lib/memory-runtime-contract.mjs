import { createHash } from 'node:crypto';

export const MEMORY_RECALL_RUNTIME_VERSION = '0.8.0';

export function memoryRankingProfileHash(ranking) {
  const { quality_source: _evidenceReceipt, ...behavior } = ranking;
  return createHash('sha256').update(JSON.stringify(behavior)).digest('hex');
}

export function memoryEmbeddingMode({ enabled = true, rrfWeight = 0 } = {}) {
  if (!enabled) return 'off';
  return rrfWeight > 0 ? 'weighted' : 'observe';
}

/**
 * What a deterministic evaluation run did NOT measure, phrased for the line it prints on.
 *
 * The recall benchmark replays golden and negative cases with no embedding channel, so its headline
 * numbers describe the deterministic ranker and nothing else. Printed without that sentence, "92
 * golden Top-1, 100%" was quoted for months as a statement about recall in general -- including on
 * a machine whose own config put a channel into the ranking that the benchmark never ran. Passing
 * `config: undefined` means the local config could not be read, which is not the same as absent.
 */
export function memoryEmbeddingCoverageNote({ config } = {}) {
  const deterministic = 'embedding lane not exercised (deterministic ranking only)';
  if (config === undefined) return `${deterministic}; local channel config unreadable`;
  if (!config) return deterministic;
  const mode = memoryEmbeddingMode({ enabled: config.enabled, rrfWeight: config.rrf_weight });
  if (mode !== 'weighted') return `${deterministic}; local channel is ${mode}, which does not rank`;
  return `${deterministic}; WARNING: this machine ranks with the embedding channel at weight `
    + `${config.rrf_weight}, so these numbers do not describe its live path`;
}

/**
 * The tier table lives in this leaf module because the envelope no longer publishes max_topics,
 * max_tokens or estimator: those three are a pure function of budget.tier, and repeating them in
 * every envelope cost about 19 tokens of the 400-token default to say something the tier name
 * already said. Every ceiling check -- budgeter, Markdown fallback, contract validation -- now
 * reads the tier here, so the envelope and the enforcement cannot drift apart.
 */
export const MEMORY_CONTEXT_BUDGETS = Object.freeze({
// A 400-token budget reliably carries one evidence-bearing topic. Setting maxTopics to 3
// would report two budget drops on every normal recall and imply that the default tier
// delivers Top-3. Callers that need more topics must request expanded mode explicitly.
  default: Object.freeze({ maxTopics: 1, maxTokens: 400, excerptCharacters: 240, explanations: 2 }),
  expanded: Object.freeze({ maxTopics: 3, maxTokens: 1_200, excerptCharacters: 600, explanations: 4 }),
});

/**
 * Nominal source facts the envelope omits rather than restates. status already names the four
 * states, degraded is a function of it, and both trigger fields are null whenever nothing went
 * wrong -- which is every healthy recall. They are published only when they actually say
 * something, so a degraded source still explains itself in full.
 *
 * snapshot_id is deliberately NOT shortened here. It is the identity that observability events,
 * the recall ledger and the hook's session deduplication all key on, and those are paired against
 * full digests written elsewhere; a prefix would silently stop matching instead of failing.
 */
export function publishedMemorySource(source) {
  const published = { mode: source.mode, status: source.status, snapshot_id: source.snapshot_id };
  if (source.degraded) published.degraded = true;
  if (source.rebuild_trigger) published.rebuild_trigger = source.rebuild_trigger;
  if (source.fallback_reason) published.fallback_reason = source.fallback_reason;
  return published;
}
