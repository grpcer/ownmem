import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatMemoryIssue,
  loadMemoryTopics,
  parsedRecallFields,
} from './memory-schema.mjs';
import {
  compileMemoryFields,
  loadMemoryHooks,
  MEMORY_FIELD_CONFIG,
} from './memory-field-compiler.mjs';
import {
  DEFAULT_MEMORY_TOKENIZER,
  MEMORY_GENERIC_CONCEPTS,
  tokenizeMemoryText,
} from './memory-tokenizer.mjs';
import {
  compileMemoryTrust,
  memoryGitState,
  memoryTrustRankingAuthority,
  readMemoryTrustLock,
} from './memory-trust-store.mjs';

const DEFAULT_LIMIT = 5;
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIELD_CONFIG = MEMORY_FIELD_CONFIG;
const HIGH_SIGNAL_FIELDS = new Set([
  'name',
  'hooks',
  'description',
  'triggers',
  'codePath',
  'codeSymbol',
  'codeTest',
  'authorityDocs',
]);
const ANCHOR_FIELDS = new Set(['triggers', 'codePath', 'codeSymbol', 'codeTest']);
export function tokenize(value) {
  return tokenizeMemoryText(value);
}

/**
 * skipInvalidTopics intentionally creates an asymmetric safety boundary.
 * Compilation stays strict: one invalid frontmatter record blocks publication because an
 * immutable snapshot must never silently omit topics. The Markdown reader is the final fallback
 * after current and previous snapshots. It skips individual invalid topics, reports their names
 * through skippedTopics, and fails only when no valid content remains. This contains local damage
 * without hiding a partially published long-lived index.
 */
export function loadMemoryIndex({
  root = DEFAULT_ROOT,
  memoryDir = '.claude/memory',
  skipInvalidTopics = false,
  tokenizer = DEFAULT_MEMORY_TOKENIZER,
} = {}) {
  const absoluteMemoryDir = path.resolve(root, memoryDir);
  if (!existsSync(absoluteMemoryDir)) throw new Error(`memory directory does not exist: ${absoluteMemoryDir}`);
  const hooksByMemory = loadMemoryHooks(absoluteMemoryDir);
  const allTopics = loadMemoryTopics({ root, memoryDir });
  const invalidTopics = allTopics.filter(topic => !topic.record || topic.issues.some(item => item.level === 'error'));
  const errors = invalidTopics.flatMap(topic => topic.issues.filter(item => item.level === 'error'));
  if (errors.length > 0 && !skipInvalidTopics) {
    const details = errors.slice(0, 5).map(formatMemoryIssue).join('\n  ');
    throw new Error(`memory schema is invalid:\n  ${details}`);
  }
  const invalid = new Set(invalidTopics);
  const topics = invalid.size === 0 ? allTopics : allTopics.filter(topic => !invalid.has(topic));
  if (topics.length === 0 && invalid.size > 0) {
    const details = errors.slice(0, 5).map(formatMemoryIssue).join('\n  ');
    throw new Error(`every memory topic failed to parse (${invalid.size} files):\n  ${details}`);
  }
  const skippedTopics = invalidTopics.map(topic => topic.fileName).sort((left, right) => left.localeCompare(right, 'en'));
  const trustLock = readMemoryTrustLock({ root, memoryDir, required: false }).lock || { receipts: {} };
  const gitState = memoryGitState(root, memoryDir);
  const documents = topics
    .sort((left, right) => left.fileName.localeCompare(right.fileName, 'en'))
    .map((topic) => {
      const { content, body, record } = topic;
      const parsed = parsedRecallFields(record);
      const hooks = hooksByMemory.get(record.name) || [];
      const relativePath = path.posix.join(memoryDir.split(path.sep).join('/'), topic.fileName);
      const sourceSha256 = createHash('sha256').update(content).digest('hex');
      const trust = compileMemoryTrust({
        root,
        memoryDir,
        record,
        sourceSha256,
        trustLock,
        gitState,
      });
      return {
        id: record.name,
        name: record.name,
        file: topic.fileName,
        relativePath,
        content,
        source_sha256: sourceSha256,
        body,
        parsed,
        metadata: {
          authority: memoryTrustRankingAuthority(trust),
          declared_authority: record.metadata.authority,
          last_verified: record.metadata.last_verified,
          scopes: record.metadata.scopes,
        },
        relations: {
          authority_docs: record.metadata.authority_docs,
          supersedes: record.metadata.supersedes,
          code_evidence: record.metadata.code_evidence,
        },
        trust,
        hooks,
        ...compileMemoryFields({ name: record.name, parsed, hooks, body, sourcePath: relativePath }, { tokenizer }),
      };
    });
  const documentFrequency = new Map();
  for (const document of documents) {
    const seen = new Set();
    for (const frequencies of Object.values(document.fieldFrequencies)) {
      for (const token of frequencies.keys()) seen.add(token);
    }
    for (const token of seen) documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
  }
  const averageFieldLengths = {};
  for (const field of Object.keys(FIELD_CONFIG)) {
    averageFieldLengths[field] = documents.length === 0
      ? 0
      : documents.reduce((sum, document) => sum + document.fieldLengths[field], 0) / documents.length;
  }
  return { root, memoryDir, documents, documentFrequency, averageFieldLengths, skippedTopics, tokenizer };
}

function inverseDocumentFrequency(index, token) {
  const frequency = index.documentFrequency.get(token) || 0;
  return Math.log(1 + ((index.documents.length - frequency + 0.5) / (frequency + 0.5)));
}

function looksLikeIdentifier(query) {
  return !/\s/.test(query) && /[._:/\\-]|[a-z][A-Z]|\d/.test(query);
}

function exactFieldMatches(index, document, query) {
  const normalizedQuery = index.tokenizer.normalize(query);
  const matches = new Set();
  for (const [field, values] of Object.entries(document.normalizedFieldValues)) {
    if (values.some(value => value.includes(normalizedQuery))) matches.add(field);
  }
  const normalizedBasename = value => path.posix.basename(value.replaceAll('\\', '/'));
  if (document.normalizedFieldValues.codePath.some(value => normalizedBasename(value) === normalizedQuery)) matches.add('codePath');
  if (document.normalizedFieldValues.codeSymbol.some(value => value === normalizedQuery || value.endsWith(`.${normalizedQuery}`))) matches.add('codeSymbol');
  if (document.normalizedFieldValues.codeTest.some(value => normalizedBasename(value.split('#')[0]) === normalizedQuery || value.endsWith(`#${normalizedQuery}`))) matches.add('codeTest');
  return matches;
}

function matchedTermsByField(document, queryTokens) {
  return queryTokens.map(term => ({
    term,
    fields: Object.entries(document.fieldTokens).filter(([, tokens]) => tokens.has(term)).map(([field]) => field),
  })).filter(match => match.fields.length > 0);
}

function matchedConceptCount(index, query, matchedTerms) {
  const normalizedQuery = index.tokenizer.normalize(query);
  let concepts = 0;
  const asciiSegments = new Set(normalizedQuery.match(/[a-z0-9]+(?:[._:/\\-][a-z0-9]+)*/g) || []);
  for (const segment of asciiSegments) {
    if (MEMORY_GENERIC_CONCEPTS.has(segment)) continue;
    if (matchedTerms.some(({ term }) => /[a-z0-9]/.test(term) && (segment === term || segment.includes(term) || term.includes(segment)))) concepts += 1;
  }
  const unicodeSegments = new Set(normalizedQuery.match(/[\p{L}\p{M}\p{N}]+/gu) || []);
  for (const segment of unicodeSegments) {
    if (/^[a-z0-9]+$/.test(segment) || /^\p{Script=Han}+$/u.test(segment) || MEMORY_GENERIC_CONCEPTS.has(segment)) continue;
    const forms = index.tokenizer.wordForms(segment);
    if (matchedTerms.some(({ term }) => forms.includes(term))) concepts += 1;
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
        if (!blocked.some(([start, blockedEnd]) => offset >= start && end <= blockedEnd)) intervals.push([offset, end]);
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

function bm25fTermFrequency(index, document, token) {
  let combined = 0;
  for (const [field, config] of Object.entries(FIELD_CONFIG)) {
    const frequency = document.fieldFrequencies[field].get(token) || 0;
    if (frequency === 0) continue;
    const averageLength = index.averageFieldLengths[field] || 1;
    const lengthRatio = document.fieldLengths[field] / averageLength;
    const normalization = 1 - config.lengthNormalization + config.lengthNormalization * lengthRatio;
    combined += config.weight * frequency / Math.max(normalization, 0.1);
  }
  return combined;
}

function excerptCandidates(document) {
  const candidates = [];
  for (const field of ['codeSymbol', 'codePath', 'triggers', 'description', 'hooks']) {
    for (const value of document.fieldValues[field]) candidates.push({ field, text: value });
  }
  for (const paragraph of document.body.split(/\n\s*\n|\n(?=[#>*-])/)) {
    const text = paragraph.replace(/^\s*[#>*-]+\s*/gm, ' ').replace(/\s+/g, ' ').trim();
    if (text) candidates.push({ field: 'body', text });
  }
  return candidates;
}

function bestExcerpt(index, document, queryTokens) {
  let best = null;
  for (const candidate of excerptCandidates(document)) {
    const tokens = index.tokenizer.set(candidate.text);
    const config = FIELD_CONFIG[candidate.field] || FIELD_CONFIG.body;
    const score = queryTokens.reduce((sum, token) => sum + (tokens.has(token) ? inverseDocumentFrequency(index, token) : 0), 0) * config.weight;
    if (!best || score > best.score) best = { ...candidate, score };
  }
  if (!best || best.score === 0) return null;
  return { field: best.field, text: best.text.length > 220 ? `${best.text.slice(0, 217)}...` : best.text };
}

function scoreDocument(index, document, query, queryTokens) {
  const k1 = 1.2;
  let score = 0;
  let matchedWeight = 0;
  let queryWeight = 0;
  const matchedTerms = matchedTermsByField(document, queryTokens);
  const matchedLookup = new Map(matchedTerms.map(match => [match.term, match.fields]));
  for (const token of queryTokens) {
    const idf = inverseDocumentFrequency(index, token);
    const frequency = bm25fTermFrequency(index, document, token);
    queryWeight += idf;
    if (frequency === 0) continue;
    matchedWeight += idf;
    score += idf * ((frequency * (k1 + 1)) / (frequency + k1));
  }
  const exactFields = exactFieldMatches(index, document, query);
  for (const field of exactFields) score += FIELD_CONFIG[field].exactBoost;
  const coverage = queryWeight === 0 ? 0 : matchedWeight / queryWeight;
  const highSignalMatches = matchedTerms.filter(match => match.fields.some(field => HIGH_SIGNAL_FIELDS.has(field)));
  const conceptCount = matchedConceptCount(index, query, highSignalMatches);
  score += conceptCount * 4;
  const anchorTerms = matchedTerms.filter(match => match.fields.some(field => ANCHOR_FIELDS.has(field))).length;
  const exactAnchor = [...exactFields].some(field => ANCHOR_FIELDS.has(field));
  const exactHighSignal = [...exactFields].some(field => HIGH_SIGNAL_FIELDS.has(field));
  const exactBody = exactFields.has('body');
  const identifier = looksLikeIdentifier(query);
  const accepted = exactAnchor
    || exactHighSignal
    || (exactBody && (identifier || coverage >= 0.45))
    || (identifier && anchorTerms >= 1 && coverage >= 0.34 && score >= 7)
    || (conceptCount >= 2 && score >= 12)
    || (matchedTerms.length >= 5 && coverage >= 0.24 && score >= 20);
  return {
    score,
    coverage,
    matchedCount: matchedTerms.length,
    highSignalMatchedCount: highSignalMatches.length,
    matchedConceptCount: conceptCount,
    anchorMatchedCount: anchorTerms,
    exactFields: [...exactFields],
    exactAnchor,
    exactHighSignal,
    exactBody,
    accepted,
    fields: [...new Set(matchedTerms.flatMap(match => match.fields))],
    matchedTerms: [...matchedLookup].map(([term, fields]) => ({ term, fields })),
  };
}

export function rankMemory(index, query) {
  const queryTokens = [...new Set(index.tokenizer.tokenize(query))];
  if (queryTokens.length === 0) return [];
  return index.documents
    .map(document => ({ document, ...scoreDocument(index, document, query, queryTokens) }))
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score || left.document.name.localeCompare(right.document.name, 'en'));
}

export function searchMemory(index, query, { limit = DEFAULT_LIMIT } = {}) {
  const queryTokens = [...new Set(index.tokenizer.tokenize(query))];
  const accepted = rankMemory(index, query).filter(result => result.accepted);
  const topScore = accepted[0]?.score || 0;
  return accepted.filter(result => result.score >= topScore * 0.55).slice(0, limit)
    .map(result => ({ ...result, excerpt: bestExcerpt(index, result.document, queryTokens) }));
}
