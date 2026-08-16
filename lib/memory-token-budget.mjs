export const MEMORY_TOKEN_ESTIMATOR = 'cjk1-ascii4-v1';

export function estimateMemoryTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || [];
  const nonCjk = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, '');
  return cjk.length + Math.ceil(Buffer.byteLength(nonCjk, 'utf8') / 4);
}
