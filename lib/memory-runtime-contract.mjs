import { createHash } from 'node:crypto';

export const MEMORY_RECALL_RUNTIME_VERSION = '0.11.0';

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
 * Lowest gate score at which a memory is handed over as prose rather than as a pointer.
 *
 * Measured on the tuning partition of the 2026-09-19 corpus (quality cases, n=52), by asking each
 * query a second time with its own answer excluded and watching what the runtime did with the
 * remainder:
 *
 *   threshold   still delivered with the answer gone   correct answers still delivered
 *   0.80        13                                     43
 *   0.85         2                                     40
 *   0.90         1                                     30
 *   0.92         0                                     22
 *
 * 0.85 is where the curve turns. It removes 25 of the 27 confident deliveries that had no answer
 * to give -- 51.9% down to 3.8% -- and costs twelve correct answers, which are not lost but handed
 * over as pointers instead. Pushing on to 0.92 buys the last two at the price of eighteen more.
 *
 * The number is a floor on being wrong, not a target for being right: raising it belongs with
 * evidence from the same leave-one-out measurement, never with a wish for a tidier metric.
 */
export const MEMORY_CONTENT_TIER_THRESHOLD = 0.85;

/**
 * Strength an exact-lane anchor must reach before it may hand over prose on its own.
 *
 * A symbol, path or error code query is often a single token, so its gate score is computed over a
 * vocabulary of one and lands well below what a sentence scores -- measured on the 2026-09-19
 * corpus, the identifier group's top gate score has a median of 0.840 while every one of its
 * answers was correct. Judging those by the same 0.85 line sent eight of fifteen exact symbol
 * lookups to the pointer tier, which is the one case where a reader is entitled to a direct answer.
 *
 * The same bypass already exists one gate earlier, in coverageFloorAllowsCandidate, for the same
 * reason. Both halves of the condition are measured, not assumed: on the leave-one-out run the only
 * candidate this bypass wrongly promotes is a `natural` query whose anchor strength is 0.18, while
 * all eight it rescues are `identifier` queries at 0.72. Requiring a non-natural classification and
 * a substantial anchor keeps the nine apart, and leaves the confident tier at 2 of 52 rather than 3.
 */
export const MEMORY_EXACT_ANCHOR_CONTENT_STRENGTH = 0.5;

/**
 * How the runtime answered, as one word.
 *
 * `content` hands over prose. `pointers` says the question was understood well enough to name
 * where to look but not well enough to quote, which is the case a two-state protocol had to round
 * to one of its ends -- and it rounded to prose, because a ranker always has a best candidate.
 * `abstain` is nothing at all.
 */
export const MEMORY_DELIVERY_TIERS = Object.freeze(['content', 'pointers', 'abstain']);

/** At most this many pointers, whichever tier delivered them. */
export const MEMORY_MAX_POINTERS = 3;

/**
 * Every memory the envelope actually handed the caller, quotes first, then pointers.
 *
 * Lives in this leaf module because "what came back" is read in at least six places -- the recall
 * CLI, the receipt ledgers, the observability writer, the private benchmark, the offline replay and
 * the public benchmark -- and before the tiers landed every one of them spelled it
 * `envelope.results`. That spelling silently became wrong for a whole tier at once: each site kept
 * working, and each one under-reported. Naming it here is what makes the next surface inherit the
 * right answer instead of the old assumption.
 *
 * Callers that mean specifically "what was quoted" keep reading `envelope.results` directly; that
 * is a different question and is exactly what the confidence metrics ask.
 */
export function memoryEnvelopeHandedOver(envelope) {
  return [...(envelope?.results || []), ...(envelope?.pointers || [])];
}

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
