export function normalizeMemoryText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US');
}

const GRAPHEME_SEGMENTER = new Intl.Segmenter('und', { granularity: 'grapheme' });
// tokenize() only sends letter/mark/number runs here, so the expensive grapheme rules reduce to
// combining marks and decomposed Hangul Jamo. Emoji, regional indicators, ZWJ sequences, and
// controls cannot enter this path. Most repository text is therefore safely one code point per
// grapheme, while the fallback preserves exact UAX #29 behaviour for the exceptional runs.
const COMPLEX_WORD_GRAPHEMES = /[\p{M}\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff]/u;
const COMPACT_SCRIPTS = new Set(['Hans', 'Hant', 'Jpan', 'Thai', 'Laoo', 'Khmr', 'Mymr']);
const MORPHOLOGICAL_SCRIPTS = new Set([
  'Arab', 'Armn', 'Beng', 'Cyrl', 'Deva', 'Ethi', 'Geor', 'Grek', 'Gujr', 'Guru',
  'Hebr', 'Knda', 'Kore', 'Mlym', 'Sinh', 'Taml', 'Telu',
]);
const SCRIPT_CHECKS = Object.freeze([
  [/\p{Script=Thai}/u, 'Thai'], [/\p{Script=Lao}/u, 'Laoo'], [/\p{Script=Khmer}/u, 'Khmr'],
  [/\p{Script=Myanmar}/u, 'Mymr'], [/\p{Script=Hangul}/u, 'Kore'], [/\p{Script=Arabic}/u, 'Arab'],
  [/\p{Script=Hebrew}/u, 'Hebr'], [/\p{Script=Cyrillic}/u, 'Cyrl'], [/\p{Script=Greek}/u, 'Grek'],
  [/\p{Script=Devanagari}/u, 'Deva'], [/\p{Script=Bengali}/u, 'Beng'], [/\p{Script=Gurmukhi}/u, 'Guru'],
  [/\p{Script=Gujarati}/u, 'Gujr'], [/\p{Script=Tamil}/u, 'Taml'], [/\p{Script=Telugu}/u, 'Telu'],
  [/\p{Script=Kannada}/u, 'Knda'], [/\p{Script=Malayalam}/u, 'Mlym'], [/\p{Script=Sinhala}/u, 'Sinh'],
  [/\p{Script=Ethiopic}/u, 'Ethi'], [/\p{Script=Armenian}/u, 'Armn'], [/\p{Script=Georgian}/u, 'Geor'],
  [/\p{Script=Latin}/u, 'Latn'],
]);

// Exported so relevance code can ask the same question the tokenizer already answers instead of
// keeping a second list of scripts. A compact script writes without word boundaries, so a segment of
// it is a run of characters; every other script has them, so a segment of it is a word.
export function memoryScriptIsCompact(value) {
  return COMPACT_SCRIPTS.has(scriptOf(value));
}

// The forms a word is indexed under: as written, and search-folded when folding changes it. Anything
// comparing raw query text against indexed terms has to fold the same way or it will miss every
// script whose folding does real work -- Arabic and Hebrew vowel points, Turkish dotted I, Latin
// diacritics -- and report a language problem as a relevance one.
export function memoryWordSearchForms(value) {
  const script = scriptOf(value);
  const folded = scriptSearchFold(value, script);
  return folded && folded !== value ? [value, folded] : [value];
}

export const MEMORY_TOKENIZER_PROFILE = 'adaptive-script-v2';
export const MEMORY_TOKENIZER_PROFILES = Object.freeze({
  'unicode-word-no-fold-v1': Object.freeze({ foldMode: 'none', compactNgrams: false, adaptiveNgrams: false, adaptiveMinWidth: 3 }),
  'unicode-word-fold-v1': Object.freeze({ foldMode: 'multilingual', compactNgrams: false, adaptiveNgrams: false, adaptiveMinWidth: 3 }),
  'legacy-compact-v1': Object.freeze({ foldMode: 'latin', compactNgrams: true, adaptiveNgrams: false, adaptiveMinWidth: 3 }),
  'adaptive-no-fold-v2': Object.freeze({ foldMode: 'none', compactNgrams: true, adaptiveNgrams: true, adaptiveMinWidth: 3 }),
  'adaptive-script-v2': Object.freeze({ foldMode: 'multilingual', compactNgrams: true, adaptiveNgrams: true, adaptiveMinWidth: 3 }),
  'broad-bigram-v2': Object.freeze({ foldMode: 'multilingual', compactNgrams: true, adaptiveNgrams: true, adaptiveMinWidth: 2 }),
});

export const MEMORY_GENERIC_CONCEPTS = new Set([
  'android', 'api', 'app', 'client', 'code', 'ios', 'memory', 'observability', 'recall', 'runtime', 'server', 'system', 'web',
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with',
  'al', 'con', 'de', 'del', 'el', 'en', 'la', 'las', 'los', 'para', 'por', 'un', 'una', 'y',
  'au', 'aux', 'avec', 'ce', 'des', 'du', 'et', 'le', 'les', 'une',
  'am', 'auf', 'bei', 'das', 'dem', 'den', 'der', 'die', 'ein', 'eine', 'für', 'im', 'mit', 'und', 'von', 'zu',
  'com', 'da', 'do', 'dos', 'e', 'em', 'o', 'os', 'um', 'uma',
  'dan', 'di', 'ke', 'dari', 'dengan', 'untuk', 'yang', 've', 'bir', 'bu', 'için', 'ile',
  'na', 'ya', 'kwa', 'katika', 'kutoka', 'ni', 'w', 'z', 'do', 'dla', 'jest',
  'và', 'của', 'trong', 'với', 'một', 'các', 'в', 'во', 'на', 'с', 'со', 'к', 'из', 'и', 'или', 'это', 'до', 'для', 'це', 'за', 'е', 'u', 'sa', 'je',
  'και', 'σε', 'του', 'της', 'με', 'για', 'είναι',
  'في', 'من', 'إلى', 'على', 'عن', 'مع', 'هذا', 'هذه', 'و', 'در', 'از', 'به', 'برای', 'با', 'این',
  'اور', 'میں', 'سے', 'کو', 'کے', 'کی', 'کا', 'یہ', 'של', 'על', 'עם', 'את', 'זה',
  'का', 'की', 'के', 'को', 'से', 'में', 'और', 'एक', 'यह', 'आणि', 'मध्ये', 'वर', 'पासून', 'ला', 'ची', 'चा', 'हे',
  'এবং', 'এর', 'মধ্যে', 'থেকে', 'জন্য', 'এই', 'ਅਤੇ', 'ਵਿੱਚ', 'ਤੋਂ', 'ਨੂੰ', 'ਦਾ', 'ਦੀ', 'ਇਹ',
  'અને', 'માં', 'થી', 'માટે', 'નું', 'ની', 'આ', 'மற்றும்', 'இல்', 'இருந்து', 'க்கு', 'இது',
  'మరియు', 'లో', 'నుండి', 'కోసం', 'ఇది', 'ಮತ್ತು', 'ನಲ್ಲಿ', 'ಇಂದ', 'ಗೆ', 'ಇದು',
  'ഒപ്പം', 'നിന്ന്', 'വേണ്ടി', 'ഇത്', 'සහ', 'තුළ', 'සිට', 'සඳහා', 'මෙය',
  'ແລະ', 'ໃນ', 'ຈາກ', 'ສໍາລັບ', 'ນີ້', 'និង', 'ក្នុង', 'ពី', 'សម្រាប់', 'នេះ',
  'နှင့်', 'တွင်', 'မှ', 'အတွက်', 'ဤ', 'እና', 'ውስጥ', 'ከ', 'ለ', 'ይህ',
  'և', 'մեջ', 'համար', 'սա', 'და', 'ეს',
  '一直', '代码', '使用', '修改', '功能', '如何', '对话', '怎么', '按钮', '支持', '数据', '新增', '消息', '添加', '用户', '问题', '项目', '页面',
]);

const LATIN_SEARCH_FOLD = new Map([
  ['ı', 'i'], ['ł', 'l'], ['đ', 'd'], ['ð', 'd'], ['þ', 'th'], ['ø', 'o'],
  ['æ', 'ae'], ['œ', 'oe'], ['ß', 'ss'],
]);

function latinFold(value) {
  if (!/^\p{Script=Latin}[\p{Script=Latin}\p{M}\p{N}]*$/u.test(value)) return '';
  return [...value.normalize('NFKD').replace(/\p{M}+/gu, '')]
    .map(character => LATIN_SEARCH_FOLD.get(character) || character)
    .join('');
}

function scriptOf(value) {
  if (/\p{Script=Han}/u.test(value)) return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value) ? 'Jpan' : 'Hans';
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)) return 'Jpan';
  for (const [pattern, code] of SCRIPT_CHECKS) if (pattern.test(value)) return code;
  return 'Zyyy';
}

function scriptSearchFold(value, script) {
  if (script === 'Latn') return latinFold(value);
  if (script === 'Grek') return value.replaceAll('ς', 'σ');
  if (script === 'Arab') {
    return value.replace(/[\p{M}\u0640]/gu, '')
      .replace(/[أإآٱ]/gu, 'ا')
      .replace(/[ىي]/gu, 'ي')
      .replace(/ک/gu, 'ك');
  }
  if (script === 'Hebr') return value.replace(/\p{M}/gu, '').replace(/[ךםןףץ]/gu, character => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[character]);
  return value;
}

function wordForms(value, config) {
  const script = scriptOf(value);
  const forms = [value];
  if (config.foldMode !== 'none') {
    const folded = config.foldMode === 'latin' && script !== 'Latn' ? value : scriptSearchFold(value, script);
    if (folded && folded !== value) forms.push(folded);
  }
  return [...new Set(forms)];
}

function graphemeNgrams(value, widths) {
  const graphemes = COMPLEX_WORD_GRAPHEMES.test(value)
    ? [...GRAPHEME_SEGMENTER.segment(value)].map(item => item.segment)
    : [...value];
  const output = [];
  for (const width of widths) {
    if (graphemes.length < width) continue;
    for (let index = 0; index <= graphemes.length - width; index += 1) {
      let ngram = graphemes[index];
      for (let offset = 1; offset < width; offset += 1) ngram += graphemes[index + offset];
      output.push(ngram);
    }
  }
  return output;
}

function profileConfig(profile) {
  const config = MEMORY_TOKENIZER_PROFILES[profile];
  if (!config) throw new Error(`unknown memory tokenizer profile: ${profile}`);
  return config;
}

export function createMemoryTokenizer(profile = MEMORY_TOKENIZER_PROFILE) {
  const config = profileConfig(profile);

  function tokenize(value) {
    const camelSplit = String(value || '').normalize('NFKC').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    const normalized = normalizeMemoryText(camelSplit).replace(/\p{Cf}+/gu, '');
    const tokens = [];

    for (const match of normalized.matchAll(/(?<![\p{L}\p{M}\p{N}])[a-z0-9]+(?:[._:/\\-][a-z0-9]+)*(?![\p{L}\p{M}\p{N}])/gu)) {
      const whole = match[0];
      tokens.push(whole);
      const pathSegments = whole.split(/[/\\]+/).filter(Boolean);
      for (const segment of pathSegments) {
        if (segment !== whole) tokens.push(segment);
        for (const part of segment.split(/[._:-]+/)) {
          if (part && part !== segment && part !== whole) tokens.push(part);
        }
      }
    }

    for (const match of normalized.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
      const whole = match[0];
      if (/^[a-z0-9]+$/.test(whole)) continue;
      const script = scriptOf(whole);
      const forms = wordForms(whole, config);
      if (!COMPACT_SCRIPTS.has(script)) tokens.push(...forms);
      if (config.compactNgrams && COMPACT_SCRIPTS.has(script)) {
        for (const form of forms) tokens.push(...graphemeNgrams(form, [2, 3]));
      } else if (config.adaptiveNgrams && MORPHOLOGICAL_SCRIPTS.has(script)) {
        for (const form of forms) tokens.push(...graphemeNgrams(form, config.adaptiveMinWidth === 2 ? [2, 3] : [3]));
      }
    }

    return tokens.filter(token => [...token].length > 1);
  }

  function frequency(value) {
    const frequencies = new Map();
    for (const token of tokenize(value)) frequencies.set(token, (frequencies.get(token) || 0) + 1);
    return frequencies;
  }

  return Object.freeze({
    profile,
    normalize: normalizeMemoryText,
    tokenize,
    frequency,
    set: value => new Set(tokenize(value)),
    wordForms: value => wordForms(normalizeMemoryText(value).replace(/\p{Cf}+/gu, ''), config),
  });
}

export const DEFAULT_MEMORY_TOKENIZER = createMemoryTokenizer();

export function tokenizeMemoryText(value) {
  return DEFAULT_MEMORY_TOKENIZER.tokenize(value);
}

export function memoryTokenFrequency(value) {
  return DEFAULT_MEMORY_TOKENIZER.frequency(value);
}

export function memoryTokenSet(value) {
  return DEFAULT_MEMORY_TOKENIZER.set(value);
}
