#!/usr/bin/env node

import { isMemoryCliEntry } from './lib/memory-cli-entry.mjs';
import {
  createMemoryTokenizer,
  DEFAULT_MEMORY_TOKENIZER,
  MEMORY_TOKENIZER_PROFILE,
} from './lib/memory-tokenizer.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sharesToken(tokenizer, left, right, expected) {
  const leftTokens = tokenizer.set(left);
  const rightTokens = tokenizer.set(right);
  assert(leftTokens.has(expected), `${JSON.stringify(left)} must emit ${expected}`);
  assert(rightTokens.has(expected), `${JSON.stringify(right)} must emit ${expected}`);
}

export function runMultilingualTokenizerSelfTest() {
  const tokenizer = createMemoryTokenizer('adaptive-script-v2');
  assert(DEFAULT_MEMORY_TOKENIZER.profile === MEMORY_TOKENIZER_PROFILE, 'default tokenizer profile must be explicit');
  sharesToken(tokenizer, 'ＡＰＩ timeout', 'api timeout', 'api');
  sharesToken(tokenizer, 'café', 'cafe\u0301', 'cafe');
  sharesToken(tokenizer, 'İSTEMCİ', 'ıstemci', 'istemci');
  sharesToken(tokenizer, 'السَّلَام', 'السلام', 'السلام');
  sharesToken(tokenizer, 'ΟΣ', 'ος', 'οσ');
  sharesToken(tokenizer, 'מלך', 'מלכ', 'מלכ');
  sharesToken(tokenizer, 'key\u200Bchain migration', 'keychain migration', 'keychain');
  assert([...tokenizer.set('ข้อความเสีย')].some(token => tokenizer.set('ข้อความเสียค้างคิว').has(token)), 'Thai compact text must share grapheme n-grams');
  assert([...tokenizer.set('нормализация')].some(token => tokenizer.set('нормализации').has(token)), 'Cyrillic inflections must share adaptive n-grams');

  const legacy = createMemoryTokenizer('legacy-compact-v1');
  assert(!legacy.set('السَّلَام').has('السلام'), 'legacy profile must remain a meaningful no-script-fold ablation');
  const wordOnly = createMemoryTokenizer('unicode-word-fold-v1');
  assert(!wordOnly.set('нормализация').has('нор'), 'word-only profile must remain a meaningful no-n-gram ablation');
  const broad = createMemoryTokenizer('broad-bigram-v2');
  assert(broad.set('нормализация').size > tokenizer.set('нормализация').size, 'broad-bigram profile must have higher expansion complexity');

  const sample = 'İSTEMCİ السَّلَام нормализация ข้อความเสีย';
  const first = tokenizer.tokenize(sample);
  for (let iteration = 0; iteration < 20; iteration += 1) {
    assert(JSON.stringify(tokenizer.tokenize(sample)) === JSON.stringify(first), 'tokenizer output must be deterministic');
  }
  return { assertions: 12, profile: tokenizer.profile };
}

if (isMemoryCliEntry(import.meta.url)) {
  const result = runMultilingualTokenizerSelfTest();
  process.stdout.write(`memory multilingual tokenizer self-test: ${result.assertions}/${result.assertions} passed (${result.profile})\n`);
}
