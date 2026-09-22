import { createHash, randomBytes } from 'node:crypto';
import { MEMORY_QUERY_RESULT_SCHEMA, validateMemoryQueryResult } from './memory-contracts.mjs';
import { sha256 } from './memory-index-store.mjs';
import { estimateMemoryTokens } from './memory-token-budget.mjs';
import { normalizeMemoryText, tokenizeMemoryText } from './memory-tokenizer.mjs';
import { memoryTrustBlockingGate, memoryTrustIsNominal } from './memory-trust-policy.mjs';
import {
  MEMORY_CONTENT_TIER_THRESHOLD,
  MEMORY_CONTEXT_BUDGETS,
  MEMORY_EXACT_ANCHOR_CONTENT_STRENGTH,
  MEMORY_MAX_POINTERS,
  MEMORY_RECALL_RUNTIME_VERSION,
  publishedMemorySource,
} from './memory-runtime-contract.mjs';

export { MEMORY_CONTEXT_BUDGETS };

const MAX_CACHE_ENTRIES = 128;
const FIELD_ORDER = Object.freeze([
  'hooks', 'description', 'triggers', 'codeSymbol', 'codePath',
  'codeTest', 'authorityDocs', 'name', 'scopes',
]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createMemoryContextCache({ maxEntries = MAX_CACHE_ENTRIES } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10_000) {
    throw new Error('memory context cache maxEntries must be between 1 and 10000');
  }
  const entries = new Map();
  return {
    get(key) {
      const value = entries.get(key);
      if (!value) return null;
      entries.delete(key);
      entries.set(key, value);
      return structuredClone(value);
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, structuredClone(value));
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
    get size() {
      return entries.size;
    },
  };
}

function normalizeTier(value) {
  const tier = value || 'default';
  if (!Object.hasOwn(MEMORY_CONTEXT_BUDGETS, tier)) {
    throw new Error('memory context tier must be default or expanded');
  }
  return tier;
}

function normalizeExcludedIds(values) {
  if (values === undefined) return [];
  if (!Array.isArray(values) && !(values instanceof Set)) {
    throw new Error('memory context excludeMemoryIds must be an array or Set');
  }
  const normalized = [...new Set([...values].map((value) => String(value)))].sort(compareText);
  if (normalized.some((value) => !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value))) {
    throw new Error('memory context excludeMemoryIds contains an invalid memory ID');
  }
  return normalized;
}

function queryCacheKey(query, snapshotId) {
  const normalizedQuery = normalizeMemoryText(query).trim().replace(/\s+/g, ' ');
  return createHash('sha256')
    .update(`${normalizedQuery}\0${snapshotId}`)
    .digest('hex');
}

function resultCacheKey(cacheKey, tier, excludedIds, source, warnings) {
  const sourceVariant = source
    ? `${source.mode}\0${source.status}\0${source.rebuild_trigger || ''}`
    : 'snapshot\0ready\0';
  return `${cacheKey}\0${tier}\0${excludedIds.join('\0')}\0${sourceVariant}\0${warnings.join('\0')}`;
}

function truncateText(value, maximumCharacters) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maximumCharacters) return { text, truncated: false };
  if (maximumCharacters < 2) return { text: text.slice(0, maximumCharacters), truncated: true };
  return { text: `${text.slice(0, maximumCharacters - 1).trimEnd()}…`, truncated: true };
}

function matchingChunkScore(text, queryTokens, matchedTerms) {
  const normalized = normalizeMemoryText(text);
  let score = 0;
  let matched = 0;
  for (const term of matchedTerms) {
    if (!term || !normalized.includes(term)) continue;
    score += 4;
    matched += 1;
  }
  for (const token of queryTokens) {
    if (!token || !normalized.includes(token)) continue;
    score += 1;
    matched += 1;
  }
  return { score, matched };
}

function readBestBodyChunk({ document, query, matchedTerms }) {
  if (document.chunks.length === 0) return { excerpt: null, warning: null };
  const source = Buffer.from(document.source_content, 'utf8');
  // source_content is the snapshot's own copy of the file, so this no longer detects on-disk drift.
  // It only catches a source whose bytes do not survive a UTF-8 round trip (invalid sequences the
  // compiler decoded lossily), which would make every byte offset below meaningless.
  if (sha256(source) !== document.source_sha256) {
    return { excerpt: null, warning: `Snapshot source failed validation for ${document.id}; body excerpt omitted` };
  }

  const queryTokens = [...new Set(tokenizeMemoryText(query))];
  const normalizedTerms = [...new Set(matchedTerms.map(normalizeMemoryText).filter(Boolean))];
  const candidates = [];
  for (const chunk of document.chunks) {
    if (chunk.end_byte <= chunk.start_byte || chunk.end_byte > source.byteLength) continue;
    const bytes = source.subarray(chunk.start_byte, chunk.end_byte);
    if (sha256(bytes) !== chunk.sha256) continue;
    const text = bytes.toString('utf8').trim();
    if (!text) continue;
    const relevance = matchingChunkScore(text, queryTokens, normalizedTerms);
    candidates.push({ text, ...relevance, startByte: chunk.start_byte });
  }
  if (candidates.length === 0) {
    return { excerpt: null, warning: `Snapshot chunks failed validation for ${document.id}; body excerpt omitted` };
  }
  candidates.sort((left, right) => (
    right.score - left.score
    || right.matched - left.matched
    || left.startByte - right.startByte
  ));
  return { excerpt: { field: 'body', text: candidates[0].text }, warning: null };
}

function structuredExcerpt(document, candidate) {
  const matched = new Set(candidate.matched_fields);
  const fields = [...FIELD_ORDER].sort((left, right) => (
    Number(matched.has(right)) - Number(matched.has(left))
    || FIELD_ORDER.indexOf(left) - FIELD_ORDER.indexOf(right)
  ));
  for (const field of fields) {
    const values = document.fields[field] || [];
    const text = values.map((value) => String(value).trim()).filter(Boolean).join(' | ');
    if (text) return { field, text };
  }
  return null;
}

function excerptForCandidate({ document, candidate, query }) {
  const body = readBestBodyChunk({ document, query, matchedTerms: candidate.matched_terms });
  if (body.excerpt && matchingChunkScore(
    body.excerpt.text,
    tokenizeMemoryText(query),
    candidate.matched_terms.map(normalizeMemoryText),
  ).matched > 0) {
    return body;
  }
  return { excerpt: structuredExcerpt(document, candidate) || body.excerpt, warning: body.warning };
}

/**
 * The trust block the envelope publishes. The ranker measures it against the context of this query;
 * the snapshot's compiled trust is only the fallback for callers that ranked without a trust
 * evaluator, because it cannot evaluate valid_for and therefore cannot answer applicability.
 */
function resultTrust(document, candidate) {
  const trust = candidate.trust || document.trust;
  return {
    lifecycle: trust.lifecycle,
    authority: trust.authority,
    action_risk: trust.action_risk,
    logical_type: trust.logical_type,
    integrity: trust.integrity,
  };
}

/**
 * Lanes with no rank say only that a lane did not match, which is every lane that is not listed.
 * Measured on the private corpus, the six-key object was 21.2 tokens per delivered result while
 * graph and embedding were null on 92 of 92 queries and fuzzy on 86 of 92. Publishing only the
 * lanes that ranked the topic carries the same information for a fraction of the budget, and it
 * also replaces `channels`, which was exactly the key set of the non-null lanes spelled twice.
 */
function matchedLanes(candidate) {
  return Object.fromEntries(
    Object.entries(candidate.lanes).filter(([, rank]) => rank !== null && rank !== undefined),
  );
}

/**
 * The four gate verdicts are not published on a delivered result, because a delivered result can
 * only ever say "passed" four times: memory-ranker.mjs delivers `relevant.filter(c =>
 * c.blockingGate === null)` and routes everything else into diagnostics.trust_blocked. Measured on
 * the private corpus that block cost 41.8 tokens per result to restate a structural invariant
 * 368 times out of 368.
 *
 * The assertion below is what turns that observation into an enforced invariant rather than a
 * lucky one: if a blocked candidate ever reaches the budgeter, it must fail loudly instead of
 * being delivered under a shape that can no longer disclose that it was blocked. The full
 * four-gate detail stays available in the ranker's diagnostics and in the trust.quarantined
 * observability event, so nothing is lost for anyone debugging why a topic was withheld.
 */
function assertDeliverable(document, candidate) {
  const gate = memoryTrustBlockingGate(candidate.verdicts);
  if (gate !== null) {
    throw new Error(
      `memory context budgeter refuses to deliver ${document.id}: blocked by the ${gate} gate`,
    );
  }
}

function compactResult({ document, candidate, excerpt, config }) {
  assertDeliverable(document, candidate);
  const clippedExcerpt = excerpt ? truncateText(excerpt.text, config.excerptCharacters) : null;
  const matchedTerms = candidate.matched_terms.slice(0, config.tier === 'default' ? 6 : 12);
  const authorityDocs = document.relations.authority_docs.slice(0, 5);
  const explanation = candidate.explanation.slice(0, config.explanations)
    .map((line) => truncateText(line, 200).text);
  return {
    value: {
      rank: 0,
      memory_id: document.id,
      path: document.path,
      score: candidate.score,
      gate_score: candidate.gate_score,
      lanes: matchedLanes(candidate),
      trust: resultTrust(document, candidate),
      provenance: {
        receipt_id: document.provenance.receipt_id,
        evidence_root_sha256: document.provenance.evidence_root_sha256,
        source_commit: document.provenance.source_commit,
      },
      matched_fields: candidate.matched_fields,
      matched_terms: matchedTerms,
      excerpt: clippedExcerpt ? { field: excerpt.field, text: clippedExcerpt.text } : null,
      authority_docs: authorityDocs,
      explanation,
    },
    truncated: Boolean(clippedExcerpt?.truncated)
      || matchedTerms.length < candidate.matched_terms.length
      || explanation.length < candidate.explanation.length,
  };
}

/**
 * A pointer to one candidate: enough to decide whether to open it, and nothing that reads as an answer.
 *
 * The summary is the memory's own one-line description, not an excerpt selected against the query.
 * That distinction is the whole point of the tier -- an excerpt picked for the query is a claim
 * that this memory answers it, which is exactly what the runtime just said it could not vouch for.
 */
function pointerForCandidate({ document, candidate }) {
  const description = Array.isArray(document.fields?.description)
    ? document.fields.description.join(' ')
    : String(document.metadata?.description || '');
  const summary = truncateText(normalizeMemoryText(description) || document.id.replace(/_/g, ' '), 160).text;
  // Non-nominal trust travels with the pointer. A behavioral case pins this shape precisely so a
  // later compaction cannot drop the label to save tokens, and the same argument applies whether
  // the memory is quoted or merely named.
  const trust = memoryTrustIsNominal(candidate.trust) ? null : candidate.trust;
  return {
    memory_id: document.id,
    path: document.path,
    gate_score: candidate.gate_score,
    summary,
    ...(trust ? { trust } : {}),
  };
}

function baseEnvelope({ planner, ranked, tier, traceId, source, warnings }) {
  const plannerWarnings = !source && planner.snapshotSelected === 'previous'
    ? ['Current snapshot was invalid; serving the previous validated snapshot']
    : [];
  const resolvedSource = source || {
    mode: 'snapshot',
    status: 'ready',
    snapshot_id: planner.snapshotId,
    snapshot_schema: planner.snapshotSchema,
    degraded: false,
    rebuild_trigger: null,
    fallback_reason: null,
  };
  if (resolvedSource.mode !== 'snapshot'
      || resolvedSource.snapshot_id !== planner.snapshotId
      || resolvedSource.snapshot_schema !== planner.snapshotSchema) {
    throw new Error('memory context source must reference the planner snapshot');
  }
  return {
    schema: MEMORY_QUERY_RESULT_SCHEMA,
    trace_id: traceId,
  // ranking_profile_hash was a 64-hex digest of the ranking manifest, 22.5 tokens per envelope --
  // 6.7% of the whole thing after the v4 slimming -- with a single reader, the private recall
  // benchmark, which sits on the same machine as the manifest and now derives it with
  // memoryRankingProfileHash. profile_id still names the profile for anyone reading an envelope;
  // the digest was only ever an identity check for a caller that has the manifest anyway.
    runtime: {
      version: MEMORY_RECALL_RUNTIME_VERSION,
      profile_id: planner.ranking.profile,
    },
    policy: 'untrusted-memory-v1',
  // cache_key_sha256 was a 64-hex digest of the normalized query and snapshot that nothing ever
  // read: the task cache keys on its own internal string, and no consumer in this repository
  // opened the published one. It cost about 20 tokens per envelope to say nothing to anybody.
    query: { classifications: [...ranked.classifications] },
    source: publishedMemorySource(resolvedSource),
    results: [],
    abstain: {
      abstained: ranked.abstain.abstained,
      reason: ranked.abstain.reason,
      gate: ranked.abstain.abstained ? (ranked.abstain.gate || 'relevance') : null,
      verdict_reason: ranked.abstain.abstained ? (ranked.abstain.verdict_reason ?? null) : null,
    },
  // max_topics, max_tokens and estimator are a pure function of tier (MEMORY_CONTEXT_BUDGETS),
  // so the envelope names the tier and lets every reader and every ceiling check derive them.
    budget: {
      tier,
      estimated_tokens: 0,
      truncated: false,
  // Count qualified topics excluded by the budget after session deduplication. A boolean
  // cannot distinguish excerpt shortening from delivering only one of three trusted topics.
      dropped_topics: 0,
    },
  // What the runtime did, kept apart from abstain, which answers only "was prose handed over".
  //
  // eligible closes a hole a reader could not see around: dropped_topics counts what the token
  // budget removed from the candidates that already fit the topic ceiling, so at the default tier
  // -- ceiling of one -- it reads 0 whether there was one qualified candidate or nine. The other
  // eight were never mentioned.
    delivery: {
      tier: 'abstain',
      content_threshold: MEMORY_CONTENT_TIER_THRESHOLD,
      eligible: 0,
    },
    pointers: [],
    warnings: [...new Set([...plannerWarnings, ...warnings])].slice(0, 5),
  };
}

function normalizeWarnings(values) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error('memory context warnings must be non-empty strings');
  }
  return [...new Set(values.map((value) => truncateText(value, 160).text))].slice(0, 5);
}

function estimateEnvelope(envelope) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const estimated = estimateMemoryTokens(envelope);
    if (estimated === envelope.budget.estimated_tokens) return estimated;
    envelope.budget.estimated_tokens = estimated;
  }
  throw new Error('memory context token estimate did not converge');
}

function fits(envelope) {
  return estimateEnvelope(envelope) <= MEMORY_CONTEXT_BUDGETS[envelope.budget.tier].maxTokens;
}

// Ordered cheapest-loss first. Where the trust block sits depends on what it says, because that is
// what decides whether it is worth its ~20 tokens at all.
//
// Nominal trust (active, passed, never downgraded) describes every healthy memory in the corpus, so
// it tells the reader nothing they would not have assumed. It is dropped early, right after the
// provenance digests -- the most tokens for the least value to a reader -- and ahead of shortening
// the quote any further.
//
// Non-nominal trust is never dropped. It is the only signal that this memory is advisory, that its
// evidence drifted, or that its lifecycle moved off active, and on a real corpus a 400-token
// envelope landed at 396 tokens one query and 397 the next: keeping it in the ladder made "is this
// advice verified?" a coin flip from one query to the next, on the surface agents read most.
// If an envelope cannot fit while saying that, the result is dropped whole rather than delivered
// looking fully verified.
//
// How much room the ladder actually has, re-measured on the private corpus (113 queries, 92 of them
// delivered at the default tier) after v4 stopped publishing the four passed verdicts, the null
// lanes, channels, the unread cache-key digest, the constant snapshot schema and the three budget
// numbers the tier already decides. Those removals took about 124 tokens per envelope off the fixed
// metadata; everything except the quote now costs 309 tokens on average, leaving roughly 91 of the
// 400 for the quote instead of the ~36 the old shape left. The ladder spends the difference on
// evidence: the same corpus went from 39 of 92 envelopes delivering no quote at all to 0 of 92, the
// average surviving quote grew from 56.7 to 141 characters, and the trust block now usually
// survives too. The 160/80/48 rungs are the common landing zone now, not a last resort.
//
// compactFallbackEnvelope in memory-runtime.mjs degrades in the same order.
function compactUntilFit(envelope, result) {
  const dropNominalTrust = memoryTrustIsNominal(result.trust)
    ? [() => { delete result.trust; }]
    : [];
  const variants = [
    // First rung since 2026-09-19. provenance is three hex digests -- a receipt id, an evidence root
    // and a commit -- and it is the one block in the envelope that no reader can act on: an agent
    // cannot verify a digest, and the auditor who can has the receipt store on the same machine. It
    // was costing roughly 60 tokens of a 400-token budget behind three rungs that each give up
    // something a reader does use, so the quote was being shortened to keep digests nobody reads.
    () => { delete result.provenance; },
    () => { result.excerpt = result.excerpt ? { ...result.excerpt, text: truncateText(result.excerpt.text, 160).text } : null; },
    () => { result.matched_terms = result.matched_terms.slice(0, 3); },
    () => { result.authority_docs = result.authority_docs.slice(0, 2); },
    ...dropNominalTrust,
    () => { result.explanation = [truncateText(result.explanation[0], 120).text]; },
    () => { result.excerpt = result.excerpt ? { ...result.excerpt, text: truncateText(result.excerpt.text, 80).text } : null; },
    () => { result.matched_terms = []; },
    () => { result.authority_docs = []; },
    // matched_fields names which fields matched, which by this point restates the lane names and an
    // already emptied matched_terms. Trimming it is the cheapest remaining loss and it is what
    // pays for a non-nominal trust block on an envelope that also has to carry a warning.
    () => { result.matched_fields = result.matched_fields.slice(0, 3); },
    () => { result.excerpt = result.excerpt ? { ...result.excerpt, text: truncateText(result.excerpt.text, 48).text } : null; },
    () => { result.excerpt = null; },
    () => { result.matched_fields = result.matched_fields.slice(0, 1); },
    // lanes now lists only the lanes that actually ranked this topic, in fixed channel order
    // (exact first), so keeping the first entry keeps the strongest lane rather than an arbitrary
    // one. The lanes that are already absent were the ones that did not match.
    () => { result.lanes = Object.fromEntries(Object.entries(result.lanes).slice(0, 1)); },
    () => { envelope.warnings = envelope.warnings.slice(0, 1); },
    // The surviving warning keeps its subject and loses its tail. What degraded is also stated
    // structurally in source and in budget.truncated, so the sentence only has to stay recognisable.
    () => { envelope.warnings = envelope.warnings.map((warning) => truncateText(warning, 72).text); },
    // Below this the only remaining move is to deliver no result at all, so the ranking rationale is
    // cut to its leading lane. A reader who can still see the memory, its path and its standing has
    // what they came for; why it ranked first is the least of it -- and specifically it is worth
    // less than logical_type, which is what turns "not fully verified" into an action the reader
    // can take. Measured on this corpus, an exact-match explanation is ~58 characters and the type
    // costs ~28, so cutting the rationale first is what keeps the advice specific in the common case.
    () => { result.explanation = [truncateText(result.explanation[0], 24).text]; },
    // Last rung. Without logical_type the reader still learns that this memory is not fully verified
    // -- the four enums that say so are the reason the block is undroppable -- and only loses which
    // of the two follow-ups applies, so the advice degrades to a generic sentence, never a wrong one.
    () => { if (result.trust) delete result.trust.logical_type; },
  ];
  if (fits(envelope)) return true;
  for (const compact of variants) {
    compact();
    envelope.budget.truncated = true;
    if (fits(envelope)) return true;
  }
  return false;
}

/**
 * Whether the top candidate explains enough of the query to be quoted rather than pointed at.
 *
 * The second half of the content-tier decision, and the one that asks about the query instead of
 * about the candidate. `gate_score` answers "how confident is the ranker in this memory", which is
 * not the same question: measured 2026-09-19 over the 336 content-tier deliveries this corpus and
 * the real feedback ledger produce (293 right, 43 wrong), `gate_score` separates them with AUC
 * 0.812 overall but only **0.667** once the 223 smoke cases are removed -- and the smoke cases are
 * questions written out of a memory's own summary, so their coverage is full by construction and
 * they flatter every metric. On those same hard cases `query_span_coverage` reaches **0.886** and
 * the IDF-weighted `query_coverage` 0.803. Coverage is the signal; the 0.85 threshold was leaning
 * on the weaker one alone.
 *
 * Two metrics, because a single one is wrong for half the traffic, and both directions were
 * measured rather than reasoned about:
 *
 * - **natural** queries use `query_span_coverage`, the share of the query's characters the candidate
 *   accounts for. Sweeping it: every step up to 0.45 turned away false deliveries with zero
 *   collateral on the curated quality cases; 0.45 -> 0.50 turned away nothing and cost 3 real
 *   `correct` receipts; 0.50 -> 0.55 flipped outright (3 caught, 4 quality cases plus 6 receipts
 *   lost). The IDF-weighted variant is the intuitive choice here and lost the head-to-head: at an
 *   equal collateral budget it caught 17 of 43 against span's 26.
 * - **identifier / path / error** queries use `query_coverage`, because a one-token symbol query has
 *   a span coverage of exactly 0 or 1 with nothing in between (the same fact that forces the
 *   exact-anchor bypass one gate earlier). Span alone demoted `SyncReconnectNudgePolicy` and
 *   `NoteRecallEngine.findRelatedNotes` -- span 0.00, `query_coverage` 1.00. On non-natural queries
 *   that distribution is unusually clean: 39 of the 43 correct ones sit exactly at 1.00 and the
 *   wrong ones at 0.11 / 0.24 / 0.68.
 *
 * The floor is `planner.ranking.coverage_floor`, the value the ranker's own relevance gate already
 * uses, deliberately not a new constant. It was quantified in 2026-08 for a different gate and the
 * 20 residual false deliveries only confirmed it, which is the strongest available argument that
 * 0.45 is not fitted to them. The ranker's intent was always "a natural-language query must be
 * explained to 45%"; three bypasses (exact anchor, non-natural classification, any non-compact term
 * of 4+ characters) meant a long development-period query mentioning `loop` or `agent` never met it.
 * This gate restores the intent at the point where it is cheap to be wrong: the relevance gates are
 * untouched, so a candidate that fails here still arrives as a pointer instead of disappearing.
 *
 * Under `--multi` both features arrive from `maximumFeatures`, the best value across the phrasings,
 * and that is the behaviour this gate wants: the agent supplied several wordings of one question, so
 * a candidate that explains any one of them explains the question. Taking a minimum would let a
 * deliberately broad third phrasing veto a precise first one.
 *
 * Whole-corpus effect (2026-09-19): distinct `wrong` receipts still answered with prose 21/106 ->
 * 8/106, ablation smoke false quotes 23 -> 10, curated quality cases quoted correctly 38 -> 38
 * (none lost), gate-score overlap 0.1213 -> 0.0867, Recall@1 unchanged on every partition because
 * nothing about ranking moved.
 */
function candidateExplainsQuery(candidate, natural, coverageFloor) {
  // Zero means unarmed, the same convention as coverageFloorAllowsCandidate in the ranker.
  if (!coverageFloor) return true;
  const features = candidate.features;
  if (!features) return false;
  return natural
    ? (features.query_span_coverage ?? 0) >= coverageFloor
    : (features.query_coverage ?? 0) >= coverageFloor;
}

function validateInputs(planner, ranked, query) {
  if (!planner?.snapshotId || !planner?.snapshotSchema || !(planner.documents instanceof Map)) {
    throw new Error('memory context budgeter requires a validated query planner');
  }
  if (!ranked || ranked.snapshot_id !== planner.snapshotId || !Array.isArray(ranked.candidates)) {
    throw new Error('memory context budgeter requires ranked candidates from the same snapshot');
  }
  if (!String(query || '').trim()) throw new Error('memory query must not be empty');
}

export function budgetMemoryContext(planner, query, ranked, {
  tier: rawTier = 'default',
  cache = null,
  excludeMemoryIds,
  source = null,
  warnings: rawWarnings,
} = {}) {
  validateInputs(planner, ranked, query);
  const tier = normalizeTier(rawTier);
  const excludedIds = normalizeExcludedIds(excludeMemoryIds);
  const warnings = normalizeWarnings(rawWarnings);
  const excluded = new Set(excludedIds);
  const cacheKey = queryCacheKey(query, planner.snapshotId);
  const internalCacheKey = resultCacheKey(cacheKey, tier, excludedIds, source, warnings);
  if (cache) {
    if (typeof cache.get !== 'function' || typeof cache.set !== 'function') {
      throw new Error('memory context cache must provide get and set');
    }
    const hit = cache.get(internalCacheKey);
    if (hit) return hit;
  }

  const envelope = baseEnvelope({
    planner,
    ranked,
    tier,
    traceId: randomBytes(16).toString('hex'),
    source,
    warnings,
  });
  if (ranked.abstain.abstained) {
    estimateEnvelope(envelope);
    validateMemoryQueryResult(envelope);
    if (cache) cache.set(internalCacheKey, envelope);
    return structuredClone(envelope);
  }

  const config = { ...MEMORY_CONTEXT_BUDGETS[tier], tier };
  const eligible = ranked.candidates.filter((candidate) => !excluded.has(candidate.document_id));
  envelope.delivery.eligible = eligible.length;

  // The tier decision, made once, on the top candidate.
  //
  // Below the threshold the runtime still knows which memories are in the neighbourhood -- they
  // cleared every gate -- it just cannot vouch that any of them answers the question. Handing those
  // over as pointers is the honest middle the protocol did not have: with only "quote" and
  // "nothing" available, a ranker that always has a best candidate rounds to quoting, which is how
  // 27 of 52 queries whose answer had been removed still came back with confident prose.
  const topCandidate = eligible.length > 0 ? eligible[0] : null;
  const natural = ranked.classifications.includes('natural');
  const contentTier = topCandidate !== null
    && candidateExplainsQuery(topCandidate, natural, planner.ranking.coverage_floor)
    && (
      topCandidate.gate_score >= MEMORY_CONTENT_TIER_THRESHOLD
      // An exact anchor answers the confidence question directly, and for a one-token query it is the
      // only thing that can: see MEMORY_EXACT_ANCHOR_CONTENT_STRENGTH.
      || (!natural
        && (topCandidate.features?.exact_anchor ?? 0) >= MEMORY_EXACT_ANCHOR_CONTENT_STRENGTH)
    );
  if (eligible.length > 0 && !contentTier) {
    // The verdict is written before anything is measured. `fits` weighs the whole envelope, and the
    // envelope includes this string: checking the budget while `reason` was still null and then
    // filling in `below-content-threshold` added tokens after the last check and pushed a 399-token
    // envelope over its own ceiling. Anything that changes size must be in place before measuring.
    envelope.delivery.tier = 'pointers';
    envelope.abstain = {
      abstained: true, reason: 'below-content-threshold', gate: 'relevance', verdict_reason: null,
    };
    for (const candidate of eligible.slice(0, MEMORY_MAX_POINTERS)) {
      const document = planner.documents.get(candidate.document_id);
      if (!document) throw new Error(`ranked candidate references unknown document ${candidate.document_id}`);
      envelope.pointers.push(pointerForCandidate({ document, candidate }));
      if (!fits(envelope)) {
        envelope.pointers.pop();
        envelope.budget.truncated = true;
        break;
      }
    }
    // A tier that promises to name somewhere to look and cannot afford to name one has not done
    // that, so it abstains instead -- and says the budget was the reason, which is the truth.
    if (envelope.pointers.length === 0) {
      envelope.delivery.tier = 'abstain';
      envelope.abstain = { abstained: true, reason: 'budget-empty', gate: 'budget', verdict_reason: null };
      envelope.budget.truncated = true;
    }
    estimateEnvelope(envelope);
    validateMemoryQueryResult(envelope);
    if (cache) cache.set(internalCacheKey, envelope);
    return structuredClone(envelope);
  }

  for (const candidate of eligible.slice(0, config.maxTopics)) {
    const document = planner.documents.get(candidate.document_id);
    if (!document) throw new Error(`ranked candidate references unknown document ${candidate.document_id}`);
    const selected = excerptForCandidate({ document, candidate, query });
    const warning = selected.warning ? truncateText(selected.warning, 160).text : null;
    if (warning && !envelope.warnings.includes(warning) && envelope.warnings.length < 5) {
      envelope.warnings.push(warning);
    }
    const compacted = compactResult({ document, candidate, excerpt: selected.excerpt, config });
    compacted.value.rank = envelope.results.length + 1;
    envelope.results.push(compacted.value);
    envelope.budget.truncated ||= compacted.truncated;
    if (!compactUntilFit(envelope, compacted.value)) {
      envelope.results.pop();
      envelope.budget.truncated = true;
      break;
    }
  }

  if (envelope.results.length === 0) {
    // When session deduplication excludes every candidate, the budget was never the limit.
    // Keep that outcome separate from budget exhaustion and do not mark it as truncated.
    const excludedEverything = eligible.length === 0 && ranked.candidates.length > 0;
    envelope.abstain = {
      abstained: true,
      reason: excludedEverything ? 'all-candidates-excluded' : 'budget-empty',
      gate: excludedEverything ? 'applicability' : 'budget',
      // Neither outcome came from a trust verdict: the candidates passed every gate and were then
      // dropped by session deduplication or by the token budget.
      verdict_reason: null,
    };
    if (!excludedEverything) {
      envelope.budget.truncated = true;
      envelope.budget.dropped_topics = Math.min(eligible.length, MEMORY_CONTEXT_BUDGETS[tier].maxTopics);
    }
  } else {
    envelope.abstain = { abstained: false, reason: null, gate: null, verdict_reason: null };
    envelope.delivery.tier = 'content';
    envelope.budget.dropped_topics = Math.max(
      0,
      Math.min(eligible.length, MEMORY_CONTEXT_BUDGETS[tier].maxTopics) - envelope.results.length,
    );
    envelope.budget.truncated ||= envelope.results.length < eligible.length
      || excludedIds.some((id) => ranked.candidates.some((candidate) => candidate.document_id === id));

    // Qualified candidates the topic ceiling left out, named rather than dropped in silence. At the
    // default tier the ceiling is one, so this is where the second and third qualified memory go --
    // previously they were simply absent, and dropped_topics stayed 0 because it only counts what
    // the token budget removed from candidates that already fit the ceiling.
    //
    // Unlike the pointers tier, these are an extra: the envelope already carries a quote that
    // cleared the threshold, so if the budget is tight they all come off before anything else.
    const delivered = new Set(envelope.results.map((result) => result.memory_id));
    for (const candidate of eligible.slice(0, config.maxTopics + MEMORY_MAX_POINTERS)) {
      if (envelope.pointers.length >= MEMORY_MAX_POINTERS) break;
      const document = planner.documents.get(candidate.document_id);
      if (!document || delivered.has(document.id)) continue;
      envelope.pointers.push(pointerForCandidate({ document, candidate }));
      if (!fits(envelope)) {
        envelope.pointers.pop();
        envelope.budget.truncated = true;
        break;
      }
    }
  }
  estimateEnvelope(envelope);
  validateMemoryQueryResult(envelope);
  if (cache) cache.set(internalCacheKey, envelope);
  return structuredClone(envelope);
}
