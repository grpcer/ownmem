import {
  MEMORY_QUERY_CHANNELS,
  planMemoryQuery,
  planMultiMemoryQuery,
} from './memory-query-planner.mjs';
import {
  MEMORY_GENERIC_CONCEPTS,
  memoryScriptIsCompact,
  memoryWordSearchForms,
  normalizeMemoryText,
  tokenizeMemoryText,
} from './memory-tokenizer.mjs';
import {
  memoryBlockedVerdictReason,
  memoryTrustBlockingGate,
  memoryTrustVerdicts,
  memoryQueryRefusalReason,
} from './memory-trust-policy.mjs';
import { memoryTrustIntegrity } from './memory-trust-store.mjs';

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
  return { tokens, terms, queryWeight, coverage: queryCoverageContext(query) };
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

// How much of the query did this candidate account for?
//
// Every other lexical feature asks the opposite question -- how much of the document the query hit
// -- and each of them saturates: high_signal_concepts caps at two matched concepts, matched_terms
// at five matched tokens. Under the CJK tokenizer, which emits every 2- and 3-gram, a candidate
// sharing two incidental bigrams with the query already saturates high_signal_concepts, and that
// branch alone carries 0.55 of a 0.65 threshold. Nothing in the score notices that most of the
// query went unexplained, which is exactly what an in-domain no-answer false positive looks like:
// measured 2026-08-27, a nine-word Chinese query about overhauling open-source documentation and
// its local preview images matched a site-SEO memory on four incidental fragments -- "open",
// "local", and two bigrams straddling the boundary between them -- and cleared the gate at 0.751,
// while every term carrying the actual request (overhaul, preview, images, documentation) matched
// nothing at all.
//
// Denominator is significant characters: letters, marks and digits, minus any span a generic
// concept covers. Deliberately the crudest of the three formulations tried. Weighting by IDF
// dropped two more colloquial golden cases than plain characters (a rare filler word scores high
// IDF and gets punished for it), and restricting the denominator to characters the corpus vocabulary
// could match makes one query's verdict depend on how the corpus grew, which is a maintenance debt
// in a tool other people run on their own corpora.
// Does this term account for this word? Substring either way, which is what makes an inflected or
// compounded form count as explained, but only when the shorter side is a real stem rather than a
// fragment: at least three characters and at least half the longer side. Without the length floor
// the fuzzy lane's short partial matches explain everything and the feature stops discriminating --
// measured 2026-08-27, admitting them unguarded took answer-ablation from 53.3% down to 43.5% and
// let noise candidates back above correct ones.
function explainsWord(form, term) {
  if (form === term) return true;
  const [longer, shorter] = form.length >= term.length ? [form, term] : [term, form];
  return shorter.length >= 3 && shorter.length * 2 >= longer.length && longer.includes(shorter);
}

function queryCoverageContext(query) {
  const normalized = normalizeMemoryText(query);
  const segments = [];
  let total = 0;
  for (const match of normalized.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
    const segment = match[0];
    if (memoryScriptIsCompact(segment)) {
      const significant = new Uint8Array(segment.length).fill(1);
      for (const generic of MEMORY_GENERIC_CONCEPTS) {
        if (!memoryScriptIsCompact(generic)) continue;
        let offset = segment.indexOf(generic);
        while (offset !== -1) {
          significant.fill(0, offset, offset + generic.length);
          offset = segment.indexOf(generic, offset + 1);
        }
      }
      const count = significant.reduce((sum, value) => sum + value, 0);
      total += count;
      segments.push({ kind: 'compact', value: segment, significant });
      continue;
    }
    const forms = memoryWordSearchForms(segment);
    if (forms.some((form) => MEMORY_GENERIC_CONCEPTS.has(form))) continue;
    total += 1;
    segments.push({ kind: 'word', forms });
  }
  return { segments, total };
}

function queryCoverageFeature(coverage, matchedTerms, candidateTerms) {
  // Both the exact postings hits and everything the other lanes matched. Counting only exact hits
  // makes this feature harsher on morphologically rich languages for a reason that has nothing to
  // do with relevance: German "Übergangsfenster" and the indexed "Übergangsfensters" are not the
  // same posting, so the candidate arrives through the n-gram and fuzzy lanes and its real
  // explanatory power is invisible to a count of exact matches. Measured 2026-08-27 on the
  // 40-language public fixture, exact-only counting cost the German and Polish cases outright.
  const exactTerms = matchedTerms.map(({ term }) => term).filter(Boolean);
  // Which evidence counts depends on how the script is indexed, because the two are indexed
  // differently on purpose. A compact script is tokenized into every 2- and 3-gram, so its variant
  // forms are already exact postings and the exact hits are the complete picture -- widening them
  // there only lets the fuzzy lane's partial matches explain everything (measured: answer-ablation
  // 58.7% -> 43.5%). A word-indexed script gets one posting per word, so an inflected or compounded
  // query word is a different posting from the indexed one, its candidate arrives through the
  // n-gram and fuzzy lanes, and counting exact hits alone reports morphology as irrelevance -- that
  // is German and Polish failing outright on the 40-language fixture while Chinese was unaffected.
  const laneTerms = [...new Set([...exactTerms, ...(candidateTerms || [])])].filter(Boolean);
  let hit = 0;
  for (const segment of coverage.segments) {
    if (segment.kind === 'compact') {
      const covered = new Uint8Array(segment.value.length);
      for (const term of exactTerms) {
        let offset = segment.value.indexOf(term);
        while (offset !== -1) {
          covered.fill(1, offset, offset + term.length);
          offset = segment.value.indexOf(term, offset + 1);
        }
      }
      for (let index = 0; index < segment.value.length; index += 1) {
        if (!segment.significant[index]) continue;
        if (covered[index]) hit += 1;
      }
      continue;
    }
    // A script with word boundaries is counted by the word, and a stem match explains the whole of
    // it. Counting characters here punishes morphology rather than irrelevance: an inflected or
    // agglutinated form shares its stem with the indexed token and differs in the ending, so a
    // correct match scores as partial coverage purely for being in Finnish rather than English.
    // Measured 2026-08-27 on the 40-language public fixture, character counting everywhere took
    // Recall@1 from 100% to 93.0% and unseated the default tokenizer profile -- a retrieval quality
    // rule must not read differently depending on the language the question arrives in.
    if (laneTerms.some((term) => segment.forms.some((form) => explainsWord(form, term)))) hit += 1;
  }
  return coverage.total === 0 ? 0 : hit / coverage.total;
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
    query_span_coverage: queryCoverageFeature(queryContext.coverage, matched, candidate.terms),
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

// Decay is measured against the clock the caller supplies, never against the rest of the corpus. A
// baseline taken from the newest topic in the snapshot would make a corpus in which everything is
// old look uniformly fresh, and the feature would stop discriminating without changing shape.
//
// Exported so the curve can be asserted directly: the feature carries a weight of 0.01, so a broken
// decay moves scores far too little to disturb any behavioural assertion in the suite.
export function freshnessFeature(document, nowOrdinal, halfLifeDays) {
  const ordinal = Date.parse(`${document.metadata.last_verified}T00:00:00.000Z`) / 86_400_000;
  const age = Math.max(0, nowOrdinal - ordinal);
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

function calculateFeatures(candidate, query, queryContext, nowOrdinal, config, channelWeights) {
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
    freshness: freshnessFeature(candidate.document, nowOrdinal, config.freshness_half_life_days),
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
    `Score ${rounded(candidate.score).toFixed(3)}; gate_score=${rounded(candidate.gateScore).toFixed(3)}; threshold=${threshold.toFixed(3)}`,
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

/**
 * The trust a consumer may publish for this candidate, measured against the context of the query
 * that just ran. The snapshot's compiled trust is only the query-independent half of the same
 * computation: it cannot evaluate valid_for, so shipping it would answer an applicability question
 * the compiler never asked. Callers that rank without a trust evaluator keep the compiled value.
 */
function measuredTrust(candidate) {
  const compiled = candidate.document.trust;
  const resolved = candidate.trust;
  if (!resolved) {
    return {
      lifecycle: compiled.lifecycle,
      authority: compiled.authority,
      action_risk: compiled.action_risk,
      // Carried so a delivery surface can tell a memory backed by code from one backed by something
      // the user said. Without it, the only honest advice for a non-nominal memory is a generic one.
      logical_type: compiled.logical_type,
      integrity: compiled.integrity,
    };
  }
  return {
    lifecycle: resolved.receipt?.lifecycle || compiled.lifecycle,
    authority: resolved.authority || compiled.authority,
    action_risk: resolved.receipt?.action_risk || compiled.action_risk,
    logical_type: resolved.receipt?.logical_type || compiled.logical_type,
    integrity: memoryTrustIntegrity(resolved),
  };
}

function publicCandidate(candidate, rank, threshold, featureConfig) {
  return {
    rank,
    document_id: candidate.documentId,
    score: rounded(candidate.score),
    gate_score: rounded(candidate.gateScore),
    rrf_score: rounded(candidate.rrfScore),
    mmr_score: rounded(candidate.mmrScore),
    channels: [...candidate.channelRanks.keys()].sort(compareChannels),
    lanes: Object.fromEntries(CHANNEL_ORDER.map((channel) => [channel, candidate.channelRanks.get(channel) || null])),
    verdicts: candidate.verdicts,
    trust: measuredTrust(candidate),
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

export function rankPlannedMemoryQuery(planner, query, planned, { limit, featureQueries, trustEvaluator = null, now = new Date() } = {}) {
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

  const nowOrdinal = now.getTime() / 86_400_000;
  const queries = featureQueries === undefined ? [raw] : featureQueries.map((value) => String(value || '').trim());
  if (queries.length === 0 || queries.some((value) => !value)) throw new Error('memory ranker feature queries must not be empty');
  const queryContexts = queries.map((value) => lexicalQueryContext(planner, value));
  for (const candidate of fused) {
    candidate.features = maximumFeatures(queries.map((featureQuery, index) => calculateFeatures(
      candidate, featureQuery, queryContexts[index], nowOrdinal, planner.ranking.features,
      planner.ranking.rrf.channel_weights,
    )));
    candidate.score = weightedScore(candidate, candidate.features, planner.ranking.features);
    candidate.gateScore = confidenceScore(
      candidate.features,
      planner.ranking.features.confidence_weights,
      planned.classifications,
      candidate,
      threshold,
    )
      * (1 - Math.min(0.9, candidate.conflictPenalty));
    const trust = trustEvaluator ? trustEvaluator(candidate.document) : null;
    candidate.trust = trust;
    candidate.verdicts = memoryTrustVerdicts({
      document: candidate.document,
      queries,
      conflicts: [...candidate.conflicts.values()],
      maxStalenessDays: planner.ranking.trust.max_staleness_days,
      now,
      trust,
    });
    candidate.blockingGate = memoryTrustBlockingGate(candidate.verdicts);
  }
  fused.sort((left, right) => (
    right.score - left.score
    || right.rrfScore - left.rrfScore
    || compareText(left.documentId, right.documentId)
  ));

  // Two gates in conjunction, because there are two ways a query can have no answer here and one
  // test does not catch both. The score threshold catches a query whose vocabulary the corpus does
  // not have. The coverage floor catches a query whose vocabulary it does have, where the specific
  // answer simply does not exist -- the case the curated negatives never contained and the one
  // production actually produces.
  //
  // The exact_anchor bypass is required, not a softener: an identifier, path or symbol query is
  // often a single token, so character coverage there is 1 or 0 with nothing in between, and the
  // exact lane is what should decide it. Measured 2026-08-27, the bypass is what keeps two golden
  // anchor cases from being dropped by a rule that was never about them.
  const coverageFloor = planner.ranking.coverage_floor;
  const scored = fused.filter((candidate) => candidate.gateScore >= threshold);
  const relevant = scored.filter((candidate) => (
    candidate.features.exact_anchor > 0 || candidate.features.query_span_coverage >= coverageFloor
  ));
  const trusted = relevant.filter((candidate) => candidate.blockingGate === null);
  const trustBlocked = relevant.filter((candidate) => candidate.blockingGate !== null);
  const topGateScore = fused.length === 0 ? null : Math.max(...fused.map((candidate) => candidate.gateScore));
  const selection = mmrSelect(trusted, planner.ranking.mmr, resultLimit);
  const candidates = selection.selected.map((candidate, index) => (
    publicCandidate(candidate, index + 1, threshold, planner.ranking.features)
  ));
  const blockingGates = relevant.map((candidate) => candidate.blockingGate).filter(Boolean);
  // Only a whole-exchange refusal wins over the candidate verdicts: it is the reason no candidate
  // was ever allowed to be considered, and on those queries the relevance lane is often empty,
  // leaving no candidate verdict to read the cause off. A per-candidate tier must not be published
  // here, or an empty relevance lane gets reported as a refusal nothing made.
  const queryRefusalReason = memoryQueryRefusalReason(queries);
  const blockedGate = queryRefusalReason
    ? 'risk'
    : ['risk', 'validity', 'applicability'].find((gate) => blockingGates.includes(gate)) || null;
  const blockedVerdictReason = queryRefusalReason
    || memoryBlockedVerdictReason(blockedGate, relevant.map((candidate) => candidate.verdicts));
  return {
    snapshot_id: planner.snapshotId,
    profile: planner.ranking.profile,
    classifications: [...planned.classifications],
    abstain: {
      abstained: candidates.length === 0,
      reason: candidates.length > 0
        ? null
        : blockedGate ? `blocked-${blockedGate}`
          : fused.length === 0 ? 'no-trusted-candidate'
            // Distinguished so the next reader knows which gate spoke. "Scored well enough but did
            // not explain the question" and "nothing scored" call for different fixes: the first
            // usually means the memory that would answer this has not been written, the second that
            // the one that would has no anchor the query can reach.
            : scored.length > 0 && relevant.length === 0 ? 'below-coverage'
              : 'below-threshold',
      gate: candidates.length > 0 ? null : blockedGate || 'relevance',
      verdict_reason: candidates.length > 0 ? null : blockedVerdictReason,
      threshold: rounded(threshold),
      top_score: fused.length > 0 ? rounded(fused[0].score) : null,
      top_gate_score: topGateScore === null ? null : rounded(topGateScore),
      // Published because `below-coverage` is otherwise an unactionable verdict: the reader needs
      // to know whether the best candidate explained a third of the question or almost all of it
      // before deciding whether the memory needs a better anchor or does not exist yet.
      // Reported over the candidates that cleared the score threshold, not over everything fused:
      // the question this answers is "what did the coverage floor turn away", and a high number
      // from a candidate that never got past the first gate answers a different question.
      top_coverage: scored.length === 0
        ? null
        : rounded(Math.max(...scored.map((candidate) => candidate.features.query_span_coverage))),
    },
    candidates,
    diagnostics: {
      fused_candidates: fused.length,
      trusted_candidates: trusted.length,
      trust_blocked: trustBlocked.map((candidate) => ({
        document_id: candidate.documentId,
        gate: candidate.blockingGate,
        verdicts: candidate.verdicts,
        conflicts: [...candidate.conflicts.values()],
      })),
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
