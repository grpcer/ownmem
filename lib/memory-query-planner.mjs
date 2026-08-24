import path from 'node:path';
import {
  MEMORY_ARTIFACT_SPECS,
  readPublishedMemorySnapshot,
} from './memory-index-store.mjs';
import {
  classifyMemoryQuery,
  extractMemoryErrorAnchors,
  extractMemoryIdentifierAnchors,
  extractMemoryPathAnchors,
  memoryIdentifierFragments,
} from './memory-query-classifier.mjs';
import {
  DEFAULT_MEMORY_TOKENIZER,
  normalizeMemoryText,
} from './memory-tokenizer.mjs';
import { validateMemoryEmbeddingCandidates } from './memory-embedding-adapter.mjs';

export const MEMORY_QUERY_PLANNER_LIMITS = Object.freeze({
  defaultCandidatesPerChannel: 50,
  maxCandidatesPerChannel: 100,
  maxQueryCharacters: 2_000,
  maxFuzzyFragments: 8,
  maxFuzzyFragmentCharacters: 64,
  maxFuzzyEditDistance: 2,
  maxNgramTermsPerFragment: 24,
  maxGraphSeeds: 8,
  minimumMultiQueries: 2,
  maximumMultiQueries: 3,
});

export const MEMORY_QUERY_CHANNELS = Object.freeze([
  'exact', 'bm25f', 'ngram', 'fuzzy', 'graph', 'embedding',
]);

const FIELD_ORDER = Object.freeze([
  'name', 'hooks', 'description', 'triggers', 'codePath',
  'codeSymbol', 'codeTest', 'authorityDocs', 'scopes', 'body',
]);
const FIELD_POSITION = new Map(FIELD_ORDER.map((field, index) => [field, index]));
const FUZZY_KINDS = new Set([
  'name', 'path', 'basename', 'symbol', 'symbol-suffix',
  'test', 'test-case', 'doc-id', 'error',
]);
const GRAPH_SEED_KINDS = new Set(FUZZY_KINDS);
const HIGH_SIGNAL_FIELD_COUNT = FIELD_ORDER.indexOf('scopes');
const GENERIC_IDENTIFIER_FRAGMENTS = new Set([
  'file', 'files', 'lib', 'script', 'scripts', 'source', 'spec', 'src', 'test', 'tests',
]);

const EXACT_KIND_SCORE = Object.freeze({
  name: 12,
  trigger: 7,
  path: 14,
  basename: 11,
  symbol: 15,
  'symbol-suffix': 12,
  test: 12,
  'test-case': 13,
  'doc-id': 10,
  error: 14,
});

const GRAPH_KIND_SCORE = Object.freeze({
  'wiki-link': 1,
  supersedes: 0.95,
  'authority-doc': 0.85,
  'history-doc': 0.75,
  'code-evidence': 0.8,
  'code-test': 0.8,
  'l2-hook': 0.55,
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareFields(left, right) {
  return (FIELD_POSITION.get(left) ?? FIELD_ORDER.length) - (FIELD_POSITION.get(right) ?? FIELD_ORDER.length)
    || compareText(left, right);
}

function fieldForExactKind(kind) {
  if (kind === 'name') return 'name';
  if (kind === 'trigger') return 'triggers';
  if (kind === 'error') return 'error';
  if (kind === 'path' || kind === 'basename') return 'codePath';
  if (kind === 'symbol' || kind === 'symbol-suffix') return 'codeSymbol';
  if (kind === 'test' || kind === 'test-case') return 'codeTest';
  if (kind === 'doc-id') return 'authorityDocs';
  return kind;
}

function addCandidate(candidates, documentId, { score, fields = [], terms = [], evidence = [] }) {
  let candidate = candidates.get(documentId);
  if (!candidate) {
    candidate = { documentId, score: 0, fields: new Set(), terms: new Set(), evidence: new Map() };
    candidates.set(documentId, candidate);
  }
  candidate.score += score;
  for (const field of fields) candidate.fields.add(field);
  for (const term of terms) candidate.terms.add(term);
  for (const item of evidence) candidate.evidence.set(`${item.kind}\0${item.value}`, item);
}

function finalizeCandidates(channel, candidates, limit) {
  return [...candidates.values()]
    .sort((left, right) => right.score - left.score || compareText(left.documentId, right.documentId))
    .slice(0, limit)
    .map((candidate, index) => ({
      channel,
      rank: index + 1,
      document_id: candidate.documentId,
      score: Number(candidate.score.toFixed(6)),
      matched_fields: [...candidate.fields].sort(compareFields),
      matched_terms: [...candidate.terms].sort(compareText),
      evidence: [...candidate.evidence.values()].sort((left, right) => (
        compareText(left.kind, right.kind) || compareText(left.value, right.value)
      )),
    }));
}

function normalizeEmbeddingCandidates(planner, response, limit) {
  if (response === undefined || response === null) return [];
  validateMemoryEmbeddingCandidates(response);
  const seen = new Set();
  let previousScore = Infinity;
  return response.candidates.slice(0, limit).map((candidate, index) => {
    if (!candidate || Object.keys(candidate).sort().join(',') !== 'document_id,score') {
      throw new Error('memory embedding candidate must contain exactly document_id and score');
    }
    if (!planner.documents.has(candidate.document_id)) {
      throw new Error(`memory embedding candidate references unknown document ${candidate.document_id}`);
    }
    if (seen.has(candidate.document_id)) throw new Error(`duplicate memory embedding candidate ${candidate.document_id}`);
    if (!Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 1) {
      throw new Error('memory embedding candidate score must be between 0 and 1');
    }
    if (candidate.score > previousScore) throw new Error('memory embedding candidates must be sorted by descending score');
    seen.add(candidate.document_id);
    previousScore = candidate.score;
    return {
      channel: 'embedding',
      rank: index + 1,
      document_id: candidate.document_id,
      score: Number(candidate.score.toFixed(6)),
      matched_fields: ['embedding'],
      matched_terms: [],
      evidence: [{ kind: 'embedding-score', value: candidate.score.toFixed(6) }],
    };
  });
}

function fuseQueryVariants(channel, candidateLists, k, limit) {
  const fused = new Map();
  for (const candidates of candidateLists) {
    for (const candidate of candidates) {
      let aggregate = fused.get(candidate.document_id);
      if (!aggregate) {
        aggregate = {
          documentId: candidate.document_id,
          score: 0,
          fields: new Set(),
          terms: new Set(),
          evidence: new Map(),
        };
        fused.set(candidate.document_id, aggregate);
      }
      aggregate.score += 1 / (k + candidate.rank);
      for (const field of candidate.matched_fields) aggregate.fields.add(field);
      for (const term of candidate.matched_terms) aggregate.terms.add(term);
      for (const item of candidate.evidence) aggregate.evidence.set(`${item.kind}\0${item.value}`, item);
    }
  }
  return finalizeCandidates(channel, fused, limit);
}

function normalizeMultiQueries(queries) {
  if (!Array.isArray(queries)) throw new Error('memory multi-query requires an array');
  const values = queries.map((query) => String(query || '').trim());
  if (values.length < MEMORY_QUERY_PLANNER_LIMITS.minimumMultiQueries
      || values.length > MEMORY_QUERY_PLANNER_LIMITS.maximumMultiQueries) {
    throw new Error(`memory multi-query requires ${MEMORY_QUERY_PLANNER_LIMITS.minimumMultiQueries}-${MEMORY_QUERY_PLANNER_LIMITS.maximumMultiQueries} phrasings`);
  }
  if (values.some((query) => !query)) throw new Error('memory multi-query phrasing must not be empty');
  const normalized = values.map((query) => normalizeMemoryText(query).trim().replace(/\s+/g, ' '));
  if (new Set(normalized).size !== normalized.length) throw new Error('memory multi-query phrasings must be distinct');
  return values;
}

function normalizeCandidateLimit(value) {
  const limit = value ?? MEMORY_QUERY_PLANNER_LIMITS.defaultCandidatesPerChannel;
  if (!Number.isInteger(limit) || limit < 1 || limit > MEMORY_QUERY_PLANNER_LIMITS.maxCandidatesPerChannel) {
    throw new Error(`memory candidate limit must be between 1 and ${MEMORY_QUERY_PLANNER_LIMITS.maxCandidatesPerChannel}`);
  }
  return limit;
}

function characterTrigrams(value) {
  const normalized = normalizeMemoryText(value).replace(/[^a-z0-9]/g, '');
  if (normalized.length < 3) return new Set();
  const grams = new Set();
  for (let index = 0; index <= normalized.length - 3; index += 1) grams.add(normalized.slice(index, index + 3));
  return grams;
}

function hasHighSignalPosting(term) {
  return term.postings.some(([, postings]) => postings.some(([fieldIndex]) => fieldIndex < HIGH_SIGNAL_FIELD_COUNT));
}

function buildNgramTermMap(terms) {
  const byGram = new Map();
  for (const term of terms) {
    if (!/^[a-z0-9]{4,64}$/.test(term.term) || !hasHighSignalPosting(term)) continue;
    for (const gram of characterTrigrams(term.term)) {
      const values = byGram.get(gram) || new Set();
      values.add(term.term);
      byGram.set(gram, values);
    }
  }
  return byGram;
}

function buildFuzzyEntries(entries) {
  const byLength = new Map();
  const seen = new Set();
  for (const entry of entries) {
    if (!FUZZY_KINDS.has(entry.kind)) continue;
    for (const fragment of memoryIdentifierFragments(entry.value, { includePlain: true })) {
      const key = `${entry.kind}\0${entry.normalized}\0${fragment}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const bucket = byLength.get(fragment.length) || [];
      bucket.push({ ...entry, fragment });
      byLength.set(fragment.length, bucket);
    }
  }
  for (const bucket of byLength.values()) {
    bucket.sort((left, right) => compareText(`${left.fragment}\0${left.kind}\0${left.normalized}`, `${right.fragment}\0${right.kind}\0${right.normalized}`));
  }
  return byLength;
}

function buildEdgesByNode(edges) {
  const byNode = new Map();
  for (const edge of edges) {
    for (const node of [edge.from, edge.to]) {
      const values = byNode.get(node) || [];
      values.push(edge);
      byNode.set(node, values);
    }
  }
  return byNode;
}

export function createMemoryQueryPlanner(snapshot, { root = null, tokenizer = DEFAULT_MEMORY_TOKENIZER } = {}) {
  if (!snapshot?.manifest?.snapshot?.id || !snapshot?.artifacts) {
    throw new Error('memory query planner requires a validated snapshot');
  }
  for (const [kind, spec] of Object.entries(MEMORY_ARTIFACT_SPECS)) {
    if (snapshot.artifacts[kind]?.schema !== spec.schema) {
      throw new Error(`memory query planner requires validated ${kind} artifact ${spec.schema}`);
    }
  }
  const documents = new Map(snapshot.artifacts.documents.documents.map((document) => [document.id, document]));
  const terms = new Map(snapshot.artifacts.postings.terms.map((term) => [term.term, term]));
  const exactByNormalized = new Map();
  for (const entry of snapshot.artifacts.exact_map.entries) {
    const values = exactByNormalized.get(entry.normalized) || [];
    values.push(entry);
    exactByNormalized.set(entry.normalized, values);
  }
  return {
    root: root ? path.resolve(root) : null,
    tokenizer,
    snapshotId: snapshot.manifest.snapshot.id,
    snapshotSchema: snapshot.manifest.schema,
    snapshotDirectory: snapshot.directory,
    snapshotSelected: snapshot.selected || 'current',
    documents,
    postings: snapshot.artifacts.postings,
    // Decoding happens per matched term rather than at load: a query touches tens of terms, while
    // the file holds 128,344. Rebuilding every posting on read costs 28 ms and would eat most of
    // what the interned encoding saves.
    documentIds: snapshot.artifacts.postings.document_ids,
    idfTable: snapshot.artifacts.postings.idf_table,
    ranking: snapshot.artifacts.ranking,
    terms,
    exactEntries: snapshot.artifacts.exact_map.entries,
    exactByNormalized,
    fuzzyEntriesByLength: buildFuzzyEntries(snapshot.artifacts.exact_map.entries),
    ngramTermsByGram: buildNgramTermMap(snapshot.artifacts.postings.terms),
    edgesByNode: buildEdgesByNode(snapshot.artifacts.graph.edges),
  };
}

export function loadMemoryQueryPlanner({
  root,
  indexDirectory = '.local-test/memory-index',
  allowPrevious = true,
} = {}) {
  if (!root) throw new Error('loadMemoryQueryPlanner requires a repository root');
  const snapshot = readPublishedMemorySnapshot({
    indexRoot: path.resolve(root, indexDirectory),
    allowPrevious,
  });
  return createMemoryQueryPlanner(snapshot, { root });
}

function exactQueryAnchors(query) {
  const normalized = normalizeMemoryText(query).trim();
  const paths = extractMemoryPathAnchors(query);
  const anchors = new Set([
    normalized,
    ...paths,
    ...paths.map((value) => path.posix.basename(value)),
    ...extractMemoryIdentifierAnchors(query),
    ...extractMemoryErrorAnchors(query),
  ]);
  return { normalized, paths, anchors };
}

function containsDelimited(haystack, needle) {
  let offset = haystack.indexOf(needle);
  while (offset !== -1) {
    const before = offset === 0 ? '' : haystack[offset - 1];
    const afterOffset = offset + needle.length;
    const after = afterOffset >= haystack.length ? '' : haystack[afterOffset];
    if ((!before || !/[a-z0-9]/.test(before)) && (!after || !/[a-z0-9]/.test(after))) return true;
    offset = haystack.indexOf(needle, offset + 1);
  }
  return false;
}

function exactEntriesForQuery(planner, query, allowTriggerSubstring) {
  const { normalized, paths, anchors } = exactQueryAnchors(query);
  const matched = new Map();
  const add = (entry) => matched.set(`${entry.kind}\0${entry.normalized}`, entry);
  for (const anchor of anchors) for (const entry of planner.exactByNormalized.get(anchor) || []) add(entry);

  for (const entry of planner.exactEntries) {
    if (entry.kind === 'path') {
      const indexed = entry.normalized.replaceAll('\\', '/');
      if (paths.some((queryPath) => indexed.endsWith(`/${queryPath}`) || queryPath.endsWith(`/${indexed}`))) add(entry);
    }
    if (allowTriggerSubstring && entry.kind === 'trigger') {
      const isHan = /^\p{Script=Han}+$/u.test(entry.normalized);
      const longEnough = isHan ? [...entry.normalized].length >= 2 : entry.normalized.length >= 4;
      if (longEnough && containsDelimited(normalized, entry.normalized)) add(entry);
    }
  }
  return [...matched.values()];
}

function exactCandidates(planner, query, classifications, limit) {
  const candidates = new Map();
  const allowTriggerSubstring = classifications.some((classification) => (
    ['natural', 'decision', 'error'].includes(classification)
  ));
  for (const entry of exactEntriesForQuery(planner, query, allowTriggerSubstring)) {
    for (const documentId of entry.documents) addCandidate(candidates, documentId, {
      score: EXACT_KIND_SCORE[entry.kind],
      fields: [fieldForExactKind(entry.kind)],
      terms: [entry.normalized],
      evidence: [{ kind: entry.kind, value: entry.value }],
    });
  }
  return finalizeCandidates('exact', candidates, limit);
}

function fieldPostingScore(planner, document, fieldIndex, frequency) {
  const field = planner.postings.field_names[fieldIndex];
  const config = planner.ranking.field_weights[field];
  const averageLength = planner.postings.average_field_lengths[field] || 1;
  const lengthRatio = document.field_lengths[field] / averageLength;
  const normalization = 1 - config.length_normalization + config.length_normalization * lengthRatio;
  return { field, weightedFrequency: config.weight * frequency / Math.max(normalization, 0.1) };
}

function bm25fCandidates(planner, queryTokens, limit) {
  const candidates = new Map();
  const k1 = planner.ranking.bm25.k1;
  for (const token of queryTokens) {
    const term = planner.terms.get(token);
    if (!term) continue;
    const termIdf = planner.idfTable[term.idf];
    for (const [documentRef, postings] of term.postings) {
      const documentId = planner.documentIds[documentRef];
      const document = planner.documents.get(documentId);
      let frequency = 0;
      const fields = [];
      for (const [fieldIndex, count] of postings) {
        const posting = fieldPostingScore(planner, document, fieldIndex, count);
        frequency += posting.weightedFrequency;
        fields.push(posting.field);
      }
      const score = termIdf * ((frequency * (k1 + 1)) / (frequency + k1));
      addCandidate(candidates, documentId, {
        score,
        fields,
        terms: [token],
        evidence: [{ kind: 'term', value: token }],
      });
    }
  }
  return finalizeCandidates('bm25f', candidates, limit);
}

function maximumPostingWeight(planner, postings) {
  return Math.max(...postings.map(([fieldIndex]) => {
    const field = planner.postings.field_names[fieldIndex];
    return planner.ranking.field_weights[field].weight;
  }));
}

function addNgramTerm(planner, candidates, queryTerm, indexedTerm, similarity) {
  const term = planner.terms.get(indexedTerm);
  if (!term) return;
  const termIdf = planner.idfTable[term.idf];
  for (const [documentRef, postings] of term.postings) {
    const documentId = planner.documentIds[documentRef];
    const fields = postings.map(([fieldIndex]) => planner.postings.field_names[fieldIndex]);
    addCandidate(candidates, documentId, {
      score: similarity * termIdf * maximumPostingWeight(planner, postings),
      fields,
      terms: [queryTerm, indexedTerm],
      evidence: [{ kind: 'ngram', value: `${queryTerm}~${indexedTerm}` }],
    });
  }
}

function asciiQueryFragments(planner, query) {
  const tokens = planner.tokenizer.tokenize(query).filter((token) => /^[a-z0-9]{4,64}$/.test(token));
  return [...new Set([...tokens, ...memoryIdentifierFragments(query)])]
    .filter((fragment) => !GENERIC_IDENTIFIER_FRAGMENTS.has(fragment));
}

function ngramCandidates(planner, query, queryTokens, limit) {
  const candidates = new Map();
  for (const token of queryTokens.filter((value) => /^\p{Script=Han}{2,3}$/u.test(value))) {
    addNgramTerm(planner, candidates, token, token, 1);
  }

  for (const queryTerm of asciiQueryFragments(planner, query)) {
    const queryGrams = characterTrigrams(queryTerm);
    if (queryGrams.size === 0) continue;
    const overlaps = new Map();
    for (const gram of queryGrams) {
      for (const indexedTerm of planner.ngramTermsByGram.get(gram) || []) {
        overlaps.set(indexedTerm, (overlaps.get(indexedTerm) || 0) + 1);
      }
    }
    const matches = [...overlaps.entries()].map(([indexedTerm, overlap]) => {
      const indexedGrams = characterTrigrams(indexedTerm);
      const similarity = (2 * overlap) / (queryGrams.size + indexedGrams.size);
      // Only used to break ties between equally similar terms, but it still has to be the value
      // rather than the table index -- index order is interning order, not magnitude order.
      const indexed = planner.terms.get(indexedTerm);
      return { indexedTerm, overlap, similarity, idf: indexed ? planner.idfTable[indexed.idf] : 0 };
    }).filter((match) => match.overlap >= Math.min(2, queryGrams.size) && match.similarity >= 0.45)
      .sort((left, right) => right.similarity - left.similarity || right.idf - left.idf || compareText(left.indexedTerm, right.indexedTerm))
      .slice(0, MEMORY_QUERY_PLANNER_LIMITS.maxNgramTermsPerFragment);
    for (const match of matches) addNgramTerm(planner, candidates, queryTerm, match.indexedTerm, match.similarity);
  }
  return finalizeCandidates('ngram', candidates, limit);
}

function boundedEditDistance(left, right, maximum) {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(previous[rightIndex] + 1, current[rightIndex - 1] + 1, substitution);
      rowMinimum = Math.min(rowMinimum, current[rightIndex]);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previous = current;
  }
  return previous[right.length];
}

function fuzzyCandidates(planner, query, classifications, limit) {
  if (!classifications.some((classification) => ['identifier', 'path', 'error'].includes(classification))) return [];
  const candidates = new Map();
  const fragments = memoryIdentifierFragments(query)
    .filter((fragment) => (
      fragment.length <= MEMORY_QUERY_PLANNER_LIMITS.maxFuzzyFragmentCharacters
      && !GENERIC_IDENTIFIER_FRAGMENTS.has(fragment)
    ))
    .slice(0, MEMORY_QUERY_PLANNER_LIMITS.maxFuzzyFragments);
  for (const fragment of fragments) {
    const maximum = Math.min(fragment.length >= 9 ? 2 : 1, MEMORY_QUERY_PLANNER_LIMITS.maxFuzzyEditDistance);
    for (let length = fragment.length - maximum; length <= fragment.length + maximum; length += 1) {
      for (const entry of planner.fuzzyEntriesByLength.get(length) || []) {
        const distance = boundedEditDistance(fragment, entry.fragment, maximum);
        if (distance === 0 || distance > maximum) continue;
        const similarity = 1 - distance / Math.max(fragment.length, entry.fragment.length);
        for (const documentId of entry.documents) addCandidate(candidates, documentId, {
          score: similarity * (EXACT_KIND_SCORE[entry.kind] || 1),
          fields: [fieldForExactKind(entry.kind)],
          terms: [fragment, entry.fragment],
          evidence: [{ kind: 'edit-distance', value: `${fragment}~${entry.fragment}:${distance}` }],
        });
      }
    }
  }
  return finalizeCandidates('fuzzy', candidates, limit);
}

function otherNode(edge, node) {
  return edge.from === node ? edge.to : edge.from;
}

function graphRelations(planner, seedDocumentId) {
  const seedNode = `topic:${seedDocumentId}`;
  const relations = new Map();
  const add = (relation) => relations.set(`${relation.target}\0${relation.kind}\0${relation.via}`, relation);
  for (const edge of planner.edgesByNode.get(seedNode) || []) {
    const neighbor = otherNode(edge, seedNode);
    if (neighbor.startsWith('topic:')) {
      add({ target: neighbor.slice(6), kind: edge.kind, via: neighbor });
      continue;
    }
    for (const sharedEdge of planner.edgesByNode.get(neighbor) || []) {
      const targetNode = otherNode(sharedEdge, neighbor);
      if (targetNode.startsWith('topic:') && targetNode !== seedNode) {
        add({ target: targetNode.slice(6), kind: sharedEdge.kind, via: neighbor });
      }
    }
  }
  return [...relations.values()];
}

function graphCandidates(planner, exact, limit) {
  const eligibleSeeds = exact.filter((candidate) => candidate.evidence.some((item) => GRAPH_SEED_KINDS.has(item.kind)))
    .slice(0, MEMORY_QUERY_PLANNER_LIMITS.maxGraphSeeds);
  if (eligibleSeeds.length === 0) return [];
  const seedIds = new Set(eligibleSeeds.map((candidate) => candidate.document_id));
  const candidates = new Map();
  for (const seed of eligibleSeeds) {
    for (const relation of graphRelations(planner, seed.document_id)) {
      if (seedIds.has(relation.target) || !planner.documents.has(relation.target)) continue;
      addCandidate(candidates, relation.target, {
        score: (GRAPH_KIND_SCORE[relation.kind] || 0.5) / seed.rank,
        fields: [`graph:${relation.kind}`],
        terms: [seed.document_id],
        evidence: [{ kind: relation.kind, value: `${seed.document_id}->${relation.target} via ${relation.via}` }],
      });
    }
  }
  return finalizeCandidates('graph', candidates, limit);
}

export function planMemoryQuery(planner, query, { limit, embeddingResponse } = {}) {
  if (!planner?.snapshotId) throw new Error('planMemoryQuery requires a memory query planner');
  const raw = String(query || '').trim();
  if (!raw) throw new Error('memory query must not be empty');
  if ([...raw].length > MEMORY_QUERY_PLANNER_LIMITS.maxQueryCharacters) {
    throw new Error(`memory query exceeds ${MEMORY_QUERY_PLANNER_LIMITS.maxQueryCharacters} characters`);
  }
  const candidateLimit = normalizeCandidateLimit(limit);
  const classifications = classifyMemoryQuery(raw);
  const queryTokens = [...new Set(planner.tokenizer.tokenize(raw))];
  const exact = exactCandidates(planner, raw, classifications, candidateLimit);
  // A path-only PreToolUse query is exact machine-produced evidence, not natural language.
  // Full BM25F, n-gram, and fuzzy expansion would slow every edit and combine path fragments into
  // unrelated matches. Exact path/basename suffixes cover code evidence; mixed queries retain all lanes.
  const strictPath = classifications.length === 1 && classifications[0] === 'path';
  const bm25f = strictPath ? [] : bm25fCandidates(planner, queryTokens, candidateLimit);
  const ngram = strictPath ? [] : ngramCandidates(planner, raw, queryTokens, candidateLimit);
  const fuzzy = strictPath ? [] : fuzzyCandidates(planner, raw, classifications, candidateLimit);
  const graph = graphCandidates(planner, exact, candidateLimit);
  const embedding = normalizeEmbeddingCandidates(planner, embeddingResponse, candidateLimit);
  return {
    snapshot_id: planner.snapshotId,
    classifications,
    channels: { exact, bm25f, ngram, fuzzy, graph, embedding },
  };
}

export function planMultiMemoryQuery(planner, queries, { limit, embeddingResponses } = {}) {
  if (!planner?.snapshotId) throw new Error('planMultiMemoryQuery requires a memory query planner');
  const values = normalizeMultiQueries(queries);
  if (embeddingResponses !== undefined
      && (!Array.isArray(embeddingResponses) || embeddingResponses.length !== values.length)) {
    throw new Error('memory multi-query embeddingResponses must align with every phrasing');
  }
  const candidateLimit = normalizeCandidateLimit(limit);
  const plans = values.map((query, index) => planMemoryQuery(planner, query, {
    limit: candidateLimit,
    embeddingResponse: embeddingResponses?.[index],
  }));
  const classifications = [];
  for (const plan of plans) {
    for (const classification of plan.classifications) {
      if (!classifications.includes(classification)) classifications.push(classification);
    }
  }
  const channels = Object.fromEntries(MEMORY_QUERY_CHANNELS.map((channel) => [
    channel,
    fuseQueryVariants(
      channel,
      plans.map((plan) => plan.channels[channel]),
      planner.ranking.rrf.k,
      candidateLimit,
    ),
  ]));
  return { snapshot_id: planner.snapshotId, classifications, channels };
}
