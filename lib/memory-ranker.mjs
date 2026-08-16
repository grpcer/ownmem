import {
  MEMORY_QUERY_CHANNELS,
  planMemoryQuery,
  planMultiMemoryQuery,
} from './memory-query-planner.mjs';
import { MEMORY_GENERIC_CONCEPTS, normalizeMemoryText, tokenizeMemoryText } from './memory-tokenizer.mjs';

const CHANNEL_ORDER = MEMORY_QUERY_CHANNELS;
const CHANNEL_POSITION = new Map(CHANNEL_ORDER.map((channel, index) => [channel, index]));
const QUERY_CLASSIFICATIONS = new Set(['identifier', 'path', 'error', 'natural', 'decision', 'mixed']);
const HIGH_SIGNAL_FIELDS = new Set([
  'name', 'hooks', 'description', 'triggers', 'codePath',
  'codeSymbol', 'codeTest', 'authorityDocs', 'scopes',
]);
const ANCHOR_FIELDS = new Set(['triggers', 'codePath', 'codeSymbol', 'codeTest']);
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareChannels(left, right) {
  return (CHANNEL_POSITION.get(left) ?? CHANNEL_ORDER.length)
    - (CHANNEL_POSITION.get(right) ?? CHANNEL_ORDER.length)
    || compareText(left, right);
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function sortedUnique(values, compare = compareText) {
  return [...new Set(values)].sort(compare);
}

function validatePlan(planner, planned) {
  if (!planned || planned.snapshot_id !== planner.snapshotId) {
    throw new Error('memory ranker requires a query plan from the same snapshot');
  }
  if (!Array.isArray(planned.classifications) || planned.classifications.length === 0) {
    throw new Error('memory ranker requires query classifications');
  }
  if (new Set(planned.classifications).size !== planned.classifications.length
      || planned.classifications.some((classification) => !QUERY_CLASSIFICATIONS.has(classification))) {
    throw new Error('memory ranker received invalid query classifications');
  }
  if (Object.keys(planned.channels || {}).join(',') !== CHANNEL_ORDER.join(',')) {
    throw new Error('memory ranker requires exactly six ordered candidate channels');
  }
  for (const channel of CHANNEL_ORDER) {
    const candidates = planned.channels[channel];
    if (!Array.isArray(candidates)) throw new Error(`memory ranker requires ${channel} candidates`);
    candidates.forEach((candidate, index) => {
      if (candidate.channel !== channel || candidate.rank !== index + 1) {
        throw new Error(`memory ranker requires contiguous ${channel} ranks`);
      }
      if (!planner.documents.has(candidate.document_id)) {
        throw new Error(`memory ranker candidate references unknown document ${candidate.document_id}`);
      }
    });
  }
}

function normalizeLimit(config, value) {
  const limit = value ?? config.default_limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > config.maximum_limit) {
    throw new Error(`memory ranker limit must be between 1 and ${config.maximum_limit}`);
  }
  return limit;
}

function aggregateCandidates(planner, planned) {
  const config = planner.ranking.rrf;
  const maximumRrf = Object.values(config.channel_weights)
    .reduce((sum, weight) => sum + weight / (config.k + 1), 0);
  if (maximumRrf <= 0) throw new Error('memory ranking RRF weights must include a positive channel');

  const fused = new Map();
  for (const channel of CHANNEL_ORDER) {
    const channelWeight = config.channel_weights[channel];
    for (const candidate of planned.channels[channel]) {
      let aggregate = fused.get(candidate.document_id);
      if (!aggregate) {
        aggregate = {
          documentId: candidate.document_id,
          document: planner.documents.get(candidate.document_id),
          rawRrf: 0,
          channelRanks: new Map(),
          fields: new Set(),
          terms: new Set(),
          evidence: new Map(),
          conflicts: new Map(),
          conflictPenalty: 0,
        };
        fused.set(candidate.document_id, aggregate);
      }
      aggregate.rawRrf += channelWeight / (config.k + candidate.rank);
      aggregate.channelRanks.set(channel, candidate.rank);
      for (const field of candidate.matched_fields) aggregate.fields.add(field);
      for (const term of candidate.matched_terms) aggregate.terms.add(term);
      for (const evidence of candidate.evidence) {
        aggregate.evidence.set(`${channel}\0${evidence.kind}\0${evidence.value}`, { channel, ...evidence });
      }
    }
  }

  return [...fused.values()].map((candidate) => ({
    ...candidate,
    rrfScore: candidate.rawRrf / maximumRrf,
  }));
}

function addConflict(candidate, conflict) {
  const key = `${conflict.kind}\0${conflict.with}\0${conflict.reference || ''}`;
  if (candidate.conflicts.has(key)) return;
  const previousPenalty = Math.max(0, ...[...candidate.conflicts.values()]
    .filter((item) => item.kind === conflict.kind)
    .map((item) => item.penalty));
  candidate.conflicts.set(key, conflict);
  candidate.conflictPenalty += Math.max(0, conflict.penalty - previousPenalty);
}

function intersect(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function markConflicts(candidates, config) {
  const byId = new Map(candidates.map((candidate) => [candidate.documentId, candidate]));
  for (const candidate of candidates) {
    for (const supersededId of candidate.document.relations.supersedes) {
      const superseded = byId.get(supersededId);
      if (!superseded) continue;
      addConflict(candidate, {
        kind: 'supersedes-candidate',
        with: supersededId,
        reference: supersededId,
        penalty: 0,
      });
      addConflict(superseded, {
        kind: 'superseded-by-candidate',
        with: candidate.documentId,
        reference: candidate.documentId,
        penalty: config.explicit_superseded_penalty,
      });
    }
  }

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex];
      const disagreements = sortedUnique([
        ...intersect(left.document.relations.authority_docs, right.document.relations.history_docs),
        ...intersect(right.document.relations.authority_docs, left.document.relations.history_docs),
      ]);
      for (const reference of disagreements) {
        addConflict(left, {
          kind: 'authority-role-disagreement',
          with: right.documentId,
          reference,
          penalty: config.authority_role_penalty,
        });
        addConflict(right, {
          kind: 'authority-role-disagreement',
          with: left.documentId,
          reference,
          penalty: config.authority_role_penalty,
        });
      }
    }
  }
}

function exactAnchorFeature(candidate, config, normalizedQuery) {
  let strength = 0;
  for (const evidence of candidate.evidence.values()) {
    if (evidence.channel !== 'exact') continue;
    let value = config[evidence.kind] || 0;
    if (evidence.kind === 'trigger' && normalizeMemoryText(evidence.value) !== normalizedQuery) value *= 0.25;
    strength = Math.max(strength, value);
  }
  return strength;
}

function approximateAnchorFeature(candidate) {
  let strength = 0;
  for (const evidence of candidate.evidence.values()) {
    if (evidence.channel !== 'fuzzy' || evidence.kind !== 'edit-distance') continue;
    const match = evidence.value.match(/^(.+)~(.+):(\d+)$/);
    if (!match) continue;
    const distance = Number.parseInt(match[3], 10);
    strength = Math.max(strength, 1 - distance / Math.max(match[1].length, match[2].length));
  }
  return strength;
}

function embeddingSimilarityFeature(candidate) {
  let strength = 0;
  for (const evidence of candidate.evidence.values()) {
    if (evidence.channel !== 'embedding' || evidence.kind !== 'embedding-score') continue;
    const score = Number(evidence.value);
    if (Number.isFinite(score)) strength = Math.max(strength, clampUnit(score));
  }
  return strength;
}

function fieldCoverageFeature(candidate) {
  const matched = [...candidate.fields].filter((field) => HIGH_SIGNAL_FIELDS.has(field));
  return Math.min(1, new Set(matched).size / 4);
}

function scopeOverlapFeature(document, queryTokens) {
  const scopeTokens = new Set(tokenizeMemoryText([
    ...document.metadata.scopes,
    ...document.metadata.applies_to,
  ].join(' ')));
  if (scopeTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of scopeTokens) if (queryTokens.has(token)) overlap += 1;
  return overlap / scopeTokens.size;
}

// term.idf is an index into the snapshot's idf_table, not the value. Returning it raw would silently
// score every term by its interning order.
//
// Exported so the decode can be asserted directly: a missed decode here changes scores without
// changing which documents match, so it survives every behavioural assertion in the suite.
export function inverseDocumentFrequency(planner, token) {
  const term = planner.terms.get(token);
  if (term) return planner.idfTable[term.idf];
  return Math.log(1 + ((planner.documents.size + 0.5) / 0.5));
}

function lexicalQueryContext(planner, query) {
  const tokens = new Set(tokenizeMemoryText(query));
  const terms = [];
  let queryWeight = 0;
  for (const token of tokens) {
    const idf = inverseDocumentFrequency(planner, token);
    queryWeight += idf;
    const fieldsByDocument = new Map();
    for (const [documentRef, postings] of planner.terms.get(token)?.postings || []) {
      fieldsByDocument.set(
        planner.documentIds[documentRef],
        postings.map(([fieldIndex]) => planner.postings.field_names[fieldIndex]),
      );
    }
    terms.push({ token, idf, fieldsByDocument });
  }
  return { tokens, terms, queryWeight };
}

function matchedConceptCount(query, matchedTerms) {
  const normalizedQuery = normalizeMemoryText(query);
  let concepts = 0;
  const asciiSegments = new Set(normalizedQuery.match(/[a-z0-9]+(?:[._:/\\-][a-z0-9]+)*/g) || []);
  for (const segment of asciiSegments) {
    if (MEMORY_GENERIC_CONCEPTS.has(segment)) continue;
    if (matchedTerms.some(({ term }) => /[a-z0-9]/.test(term)
      && (segment === term || segment.includes(term) || term.includes(segment)))) {
      concepts += 1;
    }
  }

  const unicodeSegments = new Set(normalizedQuery.match(/[\p{L}\p{M}\p{N}]+/gu) || []);
  for (const segment of unicodeSegments) {
    if (/^[a-z0-9]+$/.test(segment) || /^\p{Script=Han}+$/u.test(segment) || MEMORY_GENERIC_CONCEPTS.has(segment)) continue;
    if (matchedTerms.some(({ term }) => term === segment)) concepts += 1;
  }

  for (const runMatch of normalizedQuery.matchAll(/\p{Script=Han}+/gu)) {
    const run = runMatch[0];
    const intervals = [];
    const blocked = [];
    for (const generic of MEMORY_GENERIC_CONCEPTS) {
      if (!/^\p{Script=Han}+$/u.test(generic)) continue;
      let offset = run.indexOf(generic);
      while (offset !== -1) {
        blocked.push([offset, offset + generic.length]);
        offset = run.indexOf(generic, offset + 1);
      }
    }
    for (const { term } of matchedTerms) {
      if (!/^\p{Script=Han}+$/u.test(term)) continue;
      let offset = run.indexOf(term);
      while (offset !== -1) {
        const end = offset + term.length;
        if (!blocked.some(([start, blockedEnd]) => offset >= start && end <= blockedEnd)) {
          intervals.push([offset, end]);
        }
        offset = run.indexOf(term, offset + 1);
      }
    }
    intervals.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    let end = -1;
    for (const [start, nextEnd] of intervals) {
      if (start > end) concepts += 1;
      end = Math.max(end, nextEnd);
    }
  }
  return concepts;
}

function lexicalFeatures(candidate, query, queryContext) {
  let matchedWeight = 0;
  const matched = [];
  for (const { token, idf, fieldsByDocument } of queryContext.terms) {
    const fields = fieldsByDocument.get(candidate.documentId) || [];
    if (fields.length === 0) continue;
    matchedWeight += idf;
    matched.push({ term: token, fields });
  }
  const highSignal = matched.filter(({ fields }) => fields.some((field) => HIGH_SIGNAL_FIELDS.has(field)));
  const anchorTerms = matched.filter(({ fields }) => fields.some((field) => ANCHOR_FIELDS.has(field))).length;
  return {
    query_coverage: queryContext.queryWeight === 0 ? 0 : matchedWeight / queryContext.queryWeight,
    matched_terms: Math.min(1, matched.length / 5),
    high_signal_concepts: Math.min(1, matchedConceptCount(query, highSignal) / 2),
    high_signal_terms: Math.min(1, highSignal.length / 5),
    anchor_terms: Math.min(1, anchorTerms / 2),
  };
}

function evidenceFeature(document, config) {
  let strength = 0;
  if (document.provenance.l2_hooks.length > 0) strength += config.l2_hook;
  if (document.relations.authority_docs.length > 0) strength += config.authority_doc;
  if (document.relations.code_evidence.length > 0) strength += config.code_path;
  if (document.relations.code_evidence.some((entry) => entry.symbols.length > 0)) strength += config.code_symbol;
  if (document.relations.code_evidence.some((entry) => entry.tests.length > 0)) strength += config.code_test;
  return clampUnit(strength);
}

function freshnessFeature(document, freshestOrdinal, halfLifeDays) {
  const ordinal = Date.parse(`${document.metadata.last_verified}T00:00:00.000Z`) / 86_400_000;
  const age = Math.max(0, freshestOrdinal - ordinal);
  return 0.5 ** (age / halfLifeDays);
}

function graphQualityFeature(candidate, config) {
  let strength = 0;
  for (const evidence of candidate.evidence.values()) {
    if (evidence.channel === 'graph') strength = Math.max(strength, config[evidence.kind] || 0);
  }
  return strength;
}

function channelDiversityFeature(candidate, channelWeights) {
  return Math.min(1, [...candidate.channelRanks.keys()].filter((channel) => (
    channel !== 'graph' && channelWeights[channel] > 0
  )).length / 4);
}

function calculateFeatures(candidate, query, queryContext, freshestOrdinal, config, channelWeights) {
  const lexical = lexicalFeatures(candidate, query, queryContext);
  return {
    exact_anchor: exactAnchorFeature(candidate, config.exact_kind_strength, normalizeMemoryText(query)),
    approximate_anchor: approximateAnchorFeature(candidate),
    embedding_similarity: embeddingSimilarityFeature(candidate),
    ...lexical,
    field_coverage: fieldCoverageFeature(candidate),
    scope_overlap: scopeOverlapFeature(candidate.document, queryContext.tokens),
    authority: config.authority_strength[candidate.document.metadata.authority],
    evidence: evidenceFeature(candidate.document, config.evidence_strength),
    freshness: freshnessFeature(candidate.document, freshestOrdinal, config.freshness_half_life_days),
    graph_quality: graphQualityFeature(candidate, config.graph_kind_strength),
    channel_diversity: channelDiversityFeature(candidate, channelWeights),
  };
}

function weightedFeatureBranch(features, weights) {
  const entries = Object.entries(weights);
  const denominator = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (denominator <= 0) throw new Error('memory ranking confidence weights must include a positive value');
  return clampUnit(entries.reduce((sum, [feature, weight]) => sum + features[feature] * weight, 0) / denominator);
}

function confidenceScore(features, weights, classifications, candidate, threshold) {
  const branches = [
    features.exact_anchor,
    weightedFeatureBranch(features, weights.concept),
    weightedFeatureBranch(features, weights.density),
  ];
  if (!classifications.includes('natural')) {
    branches.push(weightedFeatureBranch(features, weights.approximate));
  }
  const embeddingWeight = Object.values(weights.embedding).reduce((sum, weight) => sum + weight, 0);
  const hasDeterministicEvidence = [...candidate.channelRanks.keys()]
    .some((channel) => channel !== 'embedding');
  const deterministicConfidence = Math.max(...branches);
  if (features.embedding_similarity > 0
      && embeddingWeight > 0
      && hasDeterministicEvidence
      && deterministicConfidence >= threshold) {
    branches.push(weightedFeatureBranch(features, weights.embedding));
  }
  return Math.max(...branches);
}

function weightedScore(candidate, features, config) {
  const featureWeight = Object.values(config.weights).reduce((sum, weight) => sum + weight, 0);
  const denominator = config.rrf_weight + featureWeight;
  if (denominator <= 0) throw new Error('memory ranking feature weights must include a positive value');
  const featureScore = Object.entries(features)
    .reduce((sum, [feature, value]) => sum + value * config.weights[feature], 0);
  const beforePenalty = (candidate.rrfScore * config.rrf_weight + featureScore) / denominator;
  return clampUnit(beforePenalty * (1 - Math.min(0.9, candidate.conflictPenalty)));
}

function strongestFeatures(features, weights) {
  return Object.entries(features)
    .filter(([, value]) => value > 0)
    .sort((left, right) => (
      right[1] * weights[right[0]] - left[1] * weights[left[0]]
      || compareText(left[0], right[0])
    ))
    .slice(0, 3)
    .map(([name, value]) => `${name}=${rounded(value).toFixed(3)}`);
}

function explanations(candidate, threshold, config) {
  const channelRanks = [...candidate.channelRanks.entries()]
    .sort(([left], [right]) => compareChannels(left, right))
    .map(([channel, rank]) => `${channel}#${rank}`)
    .join(', ');
  const values = [
    `RRF ${channelRanks}; normalized=${rounded(candidate.rrfScore).toFixed(3)}`,
    `Features ${strongestFeatures(candidate.features, config.weights).join(', ')}`,
    `Score ${rounded(candidate.score).toFixed(3)}; confidence=${rounded(candidate.confidence).toFixed(3)}; threshold=${threshold.toFixed(3)}`,
  ];
  const penalized = [...candidate.conflicts.values()].filter((conflict) => conflict.penalty > 0);
  if (penalized.length > 0) {
    values.push(`Conflict ${penalized.map((conflict) => `${conflict.kind}:${conflict.with}`).join(', ')}`);
  } else {
    values.push(`Evidence authority=${candidate.document.metadata.authority}; verified=${candidate.document.metadata.last_verified}`);
  }
  return values;
}

function candidateFingerprint(document) {
  return new Set(tokenizeMemoryText([
    ...document.fields.hooks,
    ...document.fields.description,
    ...document.fields.triggers,
    ...document.fields.authorityDocs,
    ...document.fields.scopes,
  ].join(' ')));
}

function jaccard(left, right) {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function mmrSelect(candidates, config, limit) {
  const selected = [];
  const suppressed = [];
  let remaining = candidates.map((candidate) => ({
    ...candidate,
    fingerprint: candidateFingerprint(candidate.document),
  }));

  while (remaining.length > 0 && selected.length < limit) {
    const eligible = [];
    for (const candidate of remaining) {
      let mostSimilar = null;
      for (const existing of selected) {
        const similarity = jaccard(candidate.fingerprint, existing.fingerprint);
        if (!mostSimilar || similarity > mostSimilar.similarity
            || (similarity === mostSimilar.similarity && compareText(existing.documentId, mostSimilar.documentId) < 0)) {
          mostSimilar = { documentId: existing.documentId, similarity };
        }
      }
      if (mostSimilar && mostSimilar.similarity >= config.similarity_threshold) {
        suppressed.push({
          document_id: candidate.documentId,
          similar_to: mostSimilar.documentId,
          similarity: rounded(mostSimilar.similarity),
        });
        continue;
      }
      const similarity = mostSimilar?.similarity || 0;
      eligible.push({
        ...candidate,
        mmrScore: config.lambda * candidate.score - (1 - config.lambda) * similarity,
      });
    }
    if (eligible.length === 0) break;
    eligible.sort((left, right) => (
      right.mmrScore - left.mmrScore
      || right.score - left.score
      || right.rrfScore - left.rrfScore
      || compareText(left.documentId, right.documentId)
    ));
    const winner = eligible[0];
    selected.push(winner);
    const suppressedIds = new Set(suppressed.map((item) => item.document_id));
    remaining = remaining.filter((candidate) => (
      candidate.documentId !== winner.documentId && !suppressedIds.has(candidate.documentId)
    ));
  }
  suppressed.sort((left, right) => compareText(left.document_id, right.document_id));
  return { selected, suppressed };
}

function thresholdFor(classifications, thresholds) {
  return Math.max(...classifications.map((classification) => thresholds[classification]));
}

function publicCandidate(candidate, rank, threshold, featureConfig) {
  return {
    rank,
    document_id: candidate.documentId,
    score: rounded(candidate.score),
    confidence: rounded(candidate.confidence),
    rrf_score: rounded(candidate.rrfScore),
    mmr_score: rounded(candidate.mmrScore),
    channels: [...candidate.channelRanks.keys()].sort(compareChannels),
    matched_fields: sortedUnique([...candidate.fields]),
    matched_terms: sortedUnique([...candidate.terms]),
    evidence: [...candidate.evidence.values()].sort((left, right) => (
      compareChannels(left.channel, right.channel)
      || compareText(left.kind, right.kind)
      || compareText(left.value, right.value)
    )),
    features: Object.fromEntries(Object.entries(candidate.features).map(([name, value]) => [name, rounded(value)])),
    conflicts: [...candidate.conflicts.values()].sort((left, right) => (
      compareText(left.kind, right.kind)
      || compareText(left.with, right.with)
      || compareText(left.reference || '', right.reference || '')
    )).map((conflict) => ({ ...conflict, penalty: rounded(conflict.penalty) })),
    explanation: explanations(candidate, threshold, featureConfig),
  };
}

function maximumFeatures(featureSets) {
  return Object.fromEntries(Object.keys(featureSets[0]).map((feature) => [
    feature,
    Math.max(...featureSets.map((features) => features[feature])),
  ]));
}

export function rankPlannedMemoryQuery(planner, query, planned, { limit, featureQueries } = {}) {
  if (!planner?.snapshotId || planner.ranking?.profile !== 'deterministic-ranker-v1') {
    throw new Error('memory ranker requires a validated deterministic ranking profile');
  }
  const raw = String(query || '').trim();
  if (!raw) throw new Error('memory query must not be empty');
  validatePlan(planner, planned);
  const resultLimit = normalizeLimit(planner.ranking.mmr, limit);
  const threshold = thresholdFor(planned.classifications, planner.ranking.thresholds);
  const fused = aggregateCandidates(planner, planned);
  markConflicts(fused, planner.ranking.conflicts);

  const freshestOrdinal = fused.length === 0 ? 0 : Math.max(...fused.map((candidate) => (
    Date.parse(`${candidate.document.metadata.last_verified}T00:00:00.000Z`) / 86_400_000
  )));
  const queries = featureQueries === undefined ? [raw] : featureQueries.map((value) => String(value || '').trim());
  if (queries.length === 0 || queries.some((value) => !value)) throw new Error('memory ranker feature queries must not be empty');
  const queryContexts = queries.map((value) => lexicalQueryContext(planner, value));
  for (const candidate of fused) {
    candidate.features = maximumFeatures(queries.map((featureQuery, index) => calculateFeatures(
      candidate, featureQuery, queryContexts[index], freshestOrdinal, planner.ranking.features,
      planner.ranking.rrf.channel_weights,
    )));
    candidate.score = weightedScore(candidate, candidate.features, planner.ranking.features);
    candidate.confidence = confidenceScore(
      candidate.features,
      planner.ranking.features.confidence_weights,
      planned.classifications,
      candidate,
      threshold,
    )
      * (1 - Math.min(0.9, candidate.conflictPenalty));
  }
  fused.sort((left, right) => (
    right.score - left.score
    || right.rrfScore - left.rrfScore
    || compareText(left.documentId, right.documentId)
  ));

  const trusted = fused.filter((candidate) => candidate.confidence >= threshold);
  const topConfidence = fused.length === 0 ? null : Math.max(...fused.map((candidate) => candidate.confidence));
  const selection = mmrSelect(trusted, planner.ranking.mmr, resultLimit);
  const candidates = selection.selected.map((candidate, index) => (
    publicCandidate(candidate, index + 1, threshold, planner.ranking.features)
  ));
  return {
    snapshot_id: planner.snapshotId,
    profile: planner.ranking.profile,
    classifications: [...planned.classifications],
    abstain: {
      abstained: candidates.length === 0,
      reason: candidates.length > 0 ? null : fused.length === 0 ? 'no-trusted-candidate' : 'below-threshold',
      threshold: rounded(threshold),
      top_score: fused.length > 0 ? rounded(fused[0].score) : null,
      top_confidence: topConfidence === null ? null : rounded(topConfidence),
    },
    candidates,
    diagnostics: {
      fused_candidates: fused.length,
      trusted_candidates: trusted.length,
      mmr_suppressed: selection.suppressed,
    },
  };
}

export function rankMemoryQuery(planner, query, { candidateLimit, limit } = {}) {
  const planned = planMemoryQuery(planner, query, { limit: candidateLimit });
  return rankPlannedMemoryQuery(planner, query, planned, { limit });
}

export function rankMultiMemoryQuery(planner, queries, { candidateLimit, limit, embeddingResponses } = {}) {
  const planned = planMultiMemoryQuery(planner, queries, { limit: candidateLimit, embeddingResponses });
  return rankPlannedMemoryQuery(planner, queries[0], planned, { limit, featureQueries: queries });
}
