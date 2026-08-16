import { normalizeMemoryText } from './memory-tokenizer.mjs';

const DECISION_PATTERN = /(?:为什么|为何|裁决|决定|决策|取舍|权威|依据|原因|\bwhy\b|\bdecision\b|\btrade[ -]?off\b|\brationale\b|\bchoose\b|\bchosen\b|\bshould\s+we\b)/iu;
const PATH_PATTERN = /(?:[a-z]:)?[\\/]?[\p{L}\p{N}_.-]+(?:[\\/][\p{L}\p{N}_.-]+)+|\b[\p{L}\p{N}_-]+\.(?:c|cc|cpp|go|h|html|java|js|json|jsx|kt|kts|md|mjs|mm|py|sh|sql|swift|ts|tsx|xml|ya?ml)\b/giu;
const ERROR_PATTERN = /\b(?:[A-Za-z][A-Za-z0-9]*(?:Error|Exception)|E\d{3,}|(?:ERR(?:OR)?|E)[_-][A-Z0-9_.-]{2,}|(?=[A-Z0-9_.-]*[_-])(?=[A-Z0-9_.-]*\d)[A-Z][A-Z0-9_.-]*|[1-9]\d{3,})\b/g;
const STRUCTURED_IDENTIFIER_PATTERN = /\b[A-Za-z][A-Za-z0-9]*(?:[._:-][A-Za-z0-9]+)+\b|\b[A-Za-z0-9]*[a-z][A-Z][A-Za-z0-9]*\b|\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/g;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function rawMatches(query, pattern) {
  return unique([...String(query || '').matchAll(pattern)].map((match) => match[0]));
}

function normalizedMatches(query, pattern) {
  return rawMatches(query, pattern).map(normalizeMemoryText);
}

export function extractMemoryPathAnchors(query) {
  return normalizedMatches(query, PATH_PATTERN).map((value) => value.replaceAll('\\', '/'));
}

export function extractMemoryErrorAnchors(query) {
  return normalizedMatches(query, ERROR_PATTERN);
}

export function extractMemoryIdentifierAnchors(query) {
  const paths = extractMemoryPathAnchors(query);
  const errors = new Set(extractMemoryErrorAnchors(query));
  return normalizedMatches(query, STRUCTURED_IDENTIFIER_PATTERN)
    .filter((value) => !errors.has(value) && !paths.some((pathValue) => pathValue.includes(value)));
}

function splitCamelCase(value) {
  return String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

export function memoryIdentifierFragments(value, { includePlain = false } = {}) {
  const raw = String(value || '');
  const structured = rawMatches(raw, STRUCTURED_IDENTIFIER_PATTERN);
  const paths = rawMatches(raw, PATH_PATTERN);
  const errors = rawMatches(raw, ERROR_PATTERN);
  const sources = [...structured, ...paths, ...errors];
  if (includePlain) sources.push(raw);

  const fragments = [];
  for (const source of sources) {
    const camelSplit = splitCamelCase(source);
    fragments.push(normalizeMemoryText(source));
    for (const part of camelSplit.split(/[^A-Za-z0-9]+/)) {
      const normalized = normalizeMemoryText(part);
      if (normalized.length >= 3) fragments.push(normalized);
    }
  }
  return unique(fragments).filter((fragment) => /^[a-z0-9]{3,64}$/.test(fragment));
}

function hasNaturalLanguage(query, recognizedAnchors) {
  let remainder = normalizeMemoryText(query);
  for (const anchor of recognizedAnchors.sort((left, right) => right.length - left.length)) {
    remainder = remainder.replaceAll(anchor, ' ');
  }
  if ([...remainder.matchAll(/\p{Script=Han}+/gu)].some((match) => [...match[0]].length >= 2)) return true;
  const words = remainder.match(/[A-Za-z]{2,}/g) || [];
  return words.length >= 2;
}

export function classifyMemoryQuery(query) {
  const raw = String(query || '').trim();
  if (!raw) throw new Error('memory query must not be empty');

  const paths = extractMemoryPathAnchors(raw);
  const errors = extractMemoryErrorAnchors(raw);
  const identifiers = extractMemoryIdentifierAnchors(raw);
  const primary = [];
  if (identifiers.length > 0) primary.push('identifier');
  if (paths.length > 0) primary.push('path');
  if (errors.length > 0) primary.push('error');
  if (hasNaturalLanguage(raw, [...paths, ...errors, ...identifiers])) primary.push('natural');
  if (DECISION_PATTERN.test(raw)) primary.push('decision');
  if (primary.length === 0) primary.push('natural');
  if (primary.length > 1) primary.push('mixed');
  return primary;
}
