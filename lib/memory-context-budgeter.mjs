import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateMemoryQueryResult } from './memory-contracts.mjs';
import { sha256 } from './memory-index-store.mjs';
import { estimateMemoryTokens, MEMORY_TOKEN_ESTIMATOR } from './memory-token-budget.mjs';
import { normalizeMemoryText, tokenizeMemoryText } from './memory-tokenizer.mjs';

export const MEMORY_CONTEXT_BUDGETS = Object.freeze({
// A 400-token budget reliably carries one evidence-bearing topic. Setting maxTopics to 3
// would report two budget drops on every normal recall and imply that the default tier
// delivers Top-3. Callers that need more topics must request expanded mode explicitly.
  default: Object.freeze({ maxTopics: 1, maxTokens: 400, excerptCharacters: 240, explanations: 2 }),
  expanded: Object.freeze({ maxTopics: 3, maxTokens: 1_200, excerptCharacters: 600, explanations: 4 }),
});

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

function readBestBodyChunk({ root, document, query, matchedTerms }) {
  if (!root || document.chunks.length === 0) return { excerpt: null, warning: null };
  const sourcePath = path.resolve(root, document.path);
  const relative = path.relative(root, sourcePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { excerpt: null, warning: `Skipped unsafe source path for ${document.id}` };
  }

  let source;
  try {
    source = readFileSync(sourcePath);
  } catch {
    return { excerpt: null, warning: `Source unavailable for ${document.id}; body excerpt omitted` };
  }
  if (sha256(source) !== document.source_sha256) {
    return { excerpt: null, warning: `Source changed after snapshot for ${document.id}; body excerpt omitted` };
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

function excerptForCandidate({ root, document, candidate, query }) {
  const body = readBestBodyChunk({ root, document, query, matchedTerms: candidate.matched_terms });
  if (body.excerpt && matchingChunkScore(
    body.excerpt.text,
    tokenizeMemoryText(query),
    candidate.matched_terms.map(normalizeMemoryText),
  ).matched > 0) {
    return body;
  }
  return { excerpt: structuredExcerpt(document, candidate) || body.excerpt, warning: body.warning };
}

function compactResult({ document, candidate, excerpt, config }) {
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
      channels: candidate.channels,
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

function baseEnvelope({ planner, ranked, tier, cacheKey, traceId, source, warnings }) {
  const sourceWarning = planner.snapshotSelected === 'previous'
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
    schema: 'ownmem-query-result/v1',
    trace_id: traceId,
    query: { classifications: [...ranked.classifications], cache_key_sha256: cacheKey },
    source: structuredClone(resolvedSource),
    results: [],
    abstain: { abstained: ranked.abstain.abstained, reason: ranked.abstain.reason },
    budget: {
      tier,
      max_topics: MEMORY_CONTEXT_BUDGETS[tier].maxTopics,
      max_tokens: MEMORY_CONTEXT_BUDGETS[tier].maxTokens,
      estimated_tokens: 0,
      estimator: MEMORY_TOKEN_ESTIMATOR,
      truncated: false,
  // Count qualified topics excluded by the budget after session deduplication. A boolean
  // cannot distinguish excerpt shortening from delivering only one of three trusted topics.
      dropped_topics: 0,
    },
    warnings: [...new Set([...sourceWarning, ...warnings])].slice(0, 5),
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
  return estimateEnvelope(envelope) <= envelope.budget.max_tokens;
}

function compactUntilFit(envelope, result) {
  const variants = [
    () => { result.excerpt = result.excerpt ? { ...result.excerpt, text: truncateText(result.excerpt.text, 160).text } : null; },
    () => { result.matched_terms = result.matched_terms.slice(0, 3); },
    () => { result.authority_docs = result.authority_docs.slice(0, 2); },
    () => { result.explanation = [truncateText(result.explanation[0], 120).text]; },
    () => { result.excerpt = result.excerpt ? { ...result.excerpt, text: truncateText(result.excerpt.text, 80).text } : null; },
    () => { result.matched_terms = []; },
    () => { result.authority_docs = []; },
    () => { result.excerpt = null; },
  ];
  if (fits(envelope)) return true;
  for (const compact of variants) {
    compact();
    envelope.budget.truncated = true;
    if (fits(envelope)) return true;
  }
  return false;
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
  root = planner?.root,
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
    cacheKey,
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
  for (const candidate of eligible.slice(0, config.maxTopics)) {
    const document = planner.documents.get(candidate.document_id);
    if (!document) throw new Error(`ranked candidate references unknown document ${candidate.document_id}`);
    const selected = excerptForCandidate({ root: root ? path.resolve(root) : null, document, candidate, query });
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
    };
    if (!excludedEverything) {
      envelope.budget.truncated = true;
      envelope.budget.dropped_topics = Math.min(eligible.length, MEMORY_CONTEXT_BUDGETS[tier].maxTopics);
    }
  } else {
    envelope.abstain = { abstained: false, reason: null };
    envelope.budget.dropped_topics = Math.max(
      0,
      Math.min(eligible.length, MEMORY_CONTEXT_BUDGETS[tier].maxTopics) - envelope.results.length,
    );
    envelope.budget.truncated ||= envelope.results.length < eligible.length
      || excludedIds.some((id) => ranked.candidates.some((candidate) => candidate.document_id === id));
  }
  estimateEnvelope(envelope);
  validateMemoryQueryResult(envelope);
  if (cache) cache.set(internalCacheKey, envelope);
  return structuredClone(envelope);
}
