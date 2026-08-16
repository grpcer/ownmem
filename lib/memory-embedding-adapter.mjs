import { normalizeMemoryText } from './memory-tokenizer.mjs';

export const MEMORY_EMBEDDING_QUERY_SCHEMA = 'ownmem-embedding-query/v1';
export const MEMORY_EMBEDDING_CANDIDATES_SCHEMA = 'ownmem-embedding-candidates/v1';

export function createMemoryEmbeddingQuery(query, { limit = 50 } = {}) {
  const normalized = normalizeMemoryText(query).trim().replace(/\s+/g, ' ');
  if (!normalized) throw new Error('memory embedding query must not be empty');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('memory embedding query limit must be between 1 and 100');
  }
  return { schema: MEMORY_EMBEDDING_QUERY_SCHEMA, query: normalized, limit };
}

export function validateMemoryEmbeddingCandidates(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'candidates,schema') {
    throw new Error('memory embedding response must contain exactly schema and candidates');
  }
  if (value.schema !== MEMORY_EMBEDDING_CANDIDATES_SCHEMA || !Array.isArray(value.candidates)) {
    throw new Error(`memory embedding response must use ${MEMORY_EMBEDDING_CANDIDATES_SCHEMA}`);
  }
  if (value.candidates.length > 100) throw new Error('memory embedding response exceeds 100 candidates');
  const seen = new Set();
  let previousScore = Infinity;
  for (const candidate of value.candidates) {
    if (!candidate || Object.keys(candidate).sort().join(',') !== 'document_id,score') {
      throw new Error('memory embedding candidate must contain exactly document_id and score');
    }
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(candidate.document_id)) {
      throw new Error(`invalid memory embedding document_id ${candidate.document_id}`);
    }
    if (seen.has(candidate.document_id)) throw new Error(`duplicate memory embedding candidate ${candidate.document_id}`);
    if (!Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 1) {
      throw new Error('memory embedding candidate score must be between 0 and 1');
    }
    if (candidate.score > previousScore) throw new Error('memory embedding candidates must be sorted by descending score');
    seen.add(candidate.document_id);
    previousScore = candidate.score;
  }
  return value;
}

export function validateMemoryEmbeddingAdapter(adapter) {
  if (!adapter || typeof adapter.retrieve !== 'function') {
    throw new Error('memory embedding adapter must provide retrieve(request)');
  }
  return adapter;
}

export async function retrieveMemoryEmbeddingCandidates(adapter, query, options = {}) {
  validateMemoryEmbeddingAdapter(adapter);
  const request = createMemoryEmbeddingQuery(query, options);
  return validateMemoryEmbeddingCandidates(await adapter.retrieve(request));
}
