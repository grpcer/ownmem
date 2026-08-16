#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { isMemoryCliEntry } from './lib/memory-cli-entry.mjs';
import { loadMemoryIndex, searchMemory } from './lib/memory-markdown-index.mjs';
import {
  createMemoryTokenizer,
  MEMORY_TOKENIZER_PROFILE,
} from './lib/memory-tokenizer.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CORPUS = path.join(SCRIPT_DIR, 'memory-public-benchmark-corpus.json');
const DEFAULT_SUPPLEMENT = path.join(SCRIPT_DIR, 'memory-public-benchmark-supplement.json');
const SCHEMA = 'ownmem-public-benchmark/v2';
const REQUIRED_UI_LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'id', 'ja', 'ko', 'pt-BR', 'ru', 'th', 'tr', 'vi', 'zh-Hans', 'zh-Hant'];
const SCRIPT_BY_LANGUAGE = Object.freeze({
  am: 'Ethi', ar: 'Arab', bg: 'Cyrl', bn: 'Beng', de: 'Latn', el: 'Grek', en: 'Latn', es: 'Latn', fa: 'Arab', fr: 'Latn',
  gu: 'Gujr', he: 'Hebr', hi: 'Deva', hy: 'Armn', id: 'Latn', ja: 'Jpan', ka: 'Geor', km: 'Khmr', kn: 'Knda', ko: 'Kore',
  lo: 'Laoo', ml: 'Mlym', mr: 'Deva', my: 'Mymr', pa: 'Guru', pl: 'Latn', 'pt-BR': 'Latn', ru: 'Cyrl', 'sr-Cyrl': 'Cyrl',
  si: 'Sinh', sw: 'Latn', ta: 'Taml', te: 'Telu', th: 'Thai', tr: 'Latn', uk: 'Cyrl', ur: 'Arab', vi: 'Latn',
  'zh-Hans': 'Hans', 'zh-Hant': 'Hant',
});
const ALGORITHM_PROFILES = Object.freeze([
  'unicode-word-no-fold-v1',
  'unicode-word-fold-v1',
  'legacy-compact-v1',
  'adaptive-no-fold-v2',
  'adaptive-script-v2',
  'broad-bigram-v2',
]);
const NORMALIZATION_CHALLENGES = Object.freeze([
  { group: 'normalization', partition: 'challenge', locale: 'en', query: 'ｄｅｃｏｒｒｅｌａｔｅｄ jitter spreads reconnect load', expected: 'decorrelated_retry_jitter' },
  { group: 'normalization', partition: 'challenge', locale: 'vi', query: 'xung đột phiên bản thay vì ghi đè', expected: 'optimistic_version_conflict' },
  { group: 'normalization', partition: 'challenge', locale: 'tr', query: 'İSTEMCİ KİMLİĞİNİ SABİT KURALLA NORMALLEŞTİRİN', expected: 'turkish_dotted_i_casefold' },
  { group: 'normalization', partition: 'challenge', locale: 'ar', query: 'اِنْحِرَافُ السَّاعَةِ يُفْسِدُ تَوْقِيعَ الطَّلَبِ', expected: 'signed_request_clock_skew' },
  { group: 'normalization', partition: 'challenge', locale: 'fa', query: 'فایل\u200cموقت را با تغییر نام اتمی جایگزین کنید', expected: 'fa_atomic_file_replace' },
  { group: 'normalization', partition: 'challenge', locale: 'he', query: 'שַׁרְשֶׁרֶת TLS חֲסֵרָה תְּעוּדַת בֵּינַיִם', expected: 'he_tls_missing_intermediate' },
  { group: 'normalization', partition: 'challenge', locale: 'el', query: 'ΠΡΟΓΡΑΜΜΑΤΙΣΜΟΣ ΜΕ UTC ΚΑΙ ΜΟΝΑΔΙΚΟ ΚΛΕΙΔΙ', expected: 'el_dst_duplicate_schedule' },
  { group: 'normalization', partition: 'challenge', locale: 'ru', query: 'нормализации Unicode имён файловой системы', expected: 'unicode_filename_normalization' },
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(args) {
  const options = {
    corpus: DEFAULT_CORPUS,
    supplement: DEFAULT_SUPPLEMENT,
    iterations: 5,
    embeddingAdapter: null,
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--corpus') options.corpus = path.resolve(args[++index]);
    else if (argument === '--supplement') options.supplement = path.resolve(args[++index]);
    else if (argument === '--iterations') options.iterations = Number.parseInt(args[++index], 10);
    else if (argument === '--embedding-adapter') options.embeddingAdapter = path.resolve(args[++index]);
    else if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  if (!Number.isInteger(options.iterations) || options.iterations < 1 || options.iterations > 100) throw new Error('--iterations must be an integer from 1 to 100');
  return options;
}

function usage() {
  return `Usage: node scripts/memory-public-benchmark.mjs [options]

Run a locked multilingual/script retrieval bake-off. The embedding lane is absent unless an explicit zero-call adapter is supplied.

Options:
  --corpus FILE              Base public corpus fixture
  --supplement FILE          Additional language/script fixture
  --iterations N             Timed repetitions per query (default 5)
  --embedding-adapter FILE   Optional local adapter exporting metadata and search()
  --json                     Print the closed JSON result`;
}

function rounded(value) {
  return Number(value.toFixed(4));
}

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return rounded(sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]);
}

function writeTopic(directory, topic) {
  const frontmatter = [
    '---',
    `name: ${topic.id}`,
    `description: ${JSON.stringify(topic.description)}`,
    'metadata:',
    '  node_type: memory',
    '  type: lesson',
    '  status: active',
    '  scopes: [benchmark]',
    '  applies_to: [all]',
    `  triggers: ${JSON.stringify(topic.triggers)}`,
    '  last_verified: 2026-08-01',
    '  expires_at: null',
    '  authority: observed',
    '  authority_docs: []',
    '  history_docs: []',
    '  supersedes: []',
    '  code_evidence: []',
    '  evidence: [synthetic-public-benchmark]',
    '---',
    '',
    `# ${topic.id}`,
    '',
    topic.body,
    '',
  ].join('\n');
  writeFileSync(path.join(directory, `${topic.id}.md`), frontmatter, 'utf8');
}

function materializeCorpus(corpus, topicOrder = corpus.topics) {
  const root = mkdtempSync(path.join(tmpdir(), 'ownmem-memory-public-benchmark-'));
  const memory = path.join(root, '.ownmem');
  mkdirSync(memory, { recursive: true });
  writeFileSync(path.join(memory, 'MEMORY.md'), '# OwnMem\n\n- [Benchmark](MEMORY-benchmark.md)\n', 'utf8');
  writeFileSync(path.join(memory, 'MEMORY-benchmark.md'), `# Benchmark\n\n${topicOrder.map(topic => `- [${topic.id}](${topic.id}.md) - ${topic.description}`).join('\n')}\n`, 'utf8');
  topicOrder.forEach(topic => writeTopic(memory, topic));
  return root;
}

function annotatePart(part, source, { allowExternalTopics = false } = {}) {
  const languageByTopic = new Map();
  for (const item of part.queries) {
    const existing = languageByTopic.get(item.expected);
    assert(!existing || existing === item.locale, `${source}: topic ${item.expected} is shared by multiple languages`);
    languageByTopic.set(item.expected, item.locale);
  }
  const topics = part.topics.map(topic => {
    const language = topic.language || languageByTopic.get(topic.id);
    const script = topic.script || SCRIPT_BY_LANGUAGE[language];
    return { ...topic, language, script, source };
  });
  const topicMap = new Map(topics.map(topic => [topic.id, topic]));
  const annotateQuery = (item, negative = false) => {
    const language = item.locale;
    const script = SCRIPT_BY_LANGUAGE[language];
    return {
      ...item,
      language,
      script,
      partition: negative ? 'challenge' : item.partition || (item.group === 'remedy' ? 'challenge' : 'selection'),
      source,
    };
  };
  if (!allowExternalTopics) {
    for (const item of part.queries) assert(topicMap.has(item.expected), `${source}: query references unknown topic ${item.expected}`);
  }
  return {
    topics,
    queries: part.queries.map(item => annotateQuery(item)),
    negativeQueries: part.negative_queries.map(item => annotateQuery(item, true)),
  };
}

function loadCorpus(corpusFile, supplementFile) {
  const corpusText = readFileSync(corpusFile, 'utf8');
  const supplementText = readFileSync(supplementFile, 'utf8');
  const base = JSON.parse(corpusText);
  const supplement = JSON.parse(supplementText);
  assert(base.schema === 'ownmem-public-benchmark-corpus/v1', `unsupported base corpus schema: ${base.schema}`);
  assert(supplement.schema === 'ownmem-public-benchmark-supplement/v1', `unsupported supplement schema: ${supplement.schema}`);
  assert(base.license === 'CC0-1.0' && supplement.license === 'CC0-1.0', 'public corpora must remain CC0-1.0');
  const basePart = annotatePart(base, path.basename(corpusFile));
  const supplementPart = annotatePart(supplement, path.basename(supplementFile));
  const challengePart = annotatePart(
    { topics: [], queries: NORMALIZATION_CHALLENGES, negative_queries: [] },
    'normalization-challenges',
    { allowExternalTopics: true },
  );
  const corpus = {
    license: 'CC0-1.0',
    topics: [...basePart.topics, ...supplementPart.topics],
    queries: [...basePart.queries, ...supplementPart.queries, ...challengePart.queries],
    negative_queries: [...basePart.negativeQueries, ...supplementPart.negativeQueries],
    sourceFiles: [
      { name: path.basename(corpusFile), sha256: createHash('sha256').update(corpusText).digest('hex') },
      { name: path.basename(supplementFile), sha256: createHash('sha256').update(supplementText).digest('hex') },
    ],
  };
  corpus.sha256 = createHash('sha256').update(`${corpusText}\u0000${supplementText}\u0000${JSON.stringify(NORMALIZATION_CHALLENGES)}`).digest('hex');
  return corpus;
}

function validateCorpus(corpus) {
  assert(corpus.topics.length >= 40, 'public corpus requires at least forty topics');
  const topicIds = new Set(corpus.topics.map(topic => topic.id));
  assert(topicIds.size === corpus.topics.length, 'topic IDs must be unique');
  assert(new Set(corpus.queries.map(item => item.query)).size === corpus.queries.length, 'positive queries must be unique');
  assert(new Set(corpus.negative_queries.map(item => item.query)).size === corpus.negative_queries.length, 'negative queries must be unique');
  corpus.queries.forEach(item => assert(topicIds.has(item.expected), `query references unknown topic ${item.expected}`));
  const languages = [...new Set(corpus.topics.map(topic => topic.language))].sort();
  const scripts = [...new Set(corpus.topics.map(topic => topic.script))].sort();
  assert(languages.length >= 40, 'public corpus requires at least forty language tags');
  assert(scripts.length >= 20, 'public corpus requires at least twenty scripts');
  assert(Object.keys(SCRIPT_BY_LANGUAGE).length === languages.length && languages.every(language => SCRIPT_BY_LANGUAGE[language]), 'language/script coverage map must be closed');
  assert(REQUIRED_UI_LOCALES.every(locale => languages.includes(locale)), 'retrieval coverage must include every release UI locale');
  for (const language of languages) {
    const topicScripts = new Set(corpus.topics.filter(topic => topic.language === language).map(topic => topic.script));
    assert(topicScripts.size === 1 && topicScripts.has(SCRIPT_BY_LANGUAGE[language]), `${language} topic script is inconsistent`);
    assert(corpus.queries.filter(item => item.language === language).length >= 3, `${language} requires at least three positive queries`);
    assert(corpus.negative_queries.filter(item => item.language === language).length >= 1, `${language} requires an abstention query`);
    assert(corpus.queries.some(item => item.language === language && item.partition === 'selection'), `${language} requires selection evidence`);
    assert(corpus.queries.some(item => item.language === language && item.partition === 'challenge'), `${language} requires challenge evidence`);
  }
  assert(corpus.queries.every(item => item.script === SCRIPT_BY_LANGUAGE[item.language]), 'positive query scripts must match the language map');
  assert(corpus.negative_queries.every(item => item.script === SCRIPT_BY_LANGUAGE[item.language]), 'negative query scripts must match the language map');
}

function accuracy(cases, rankings) {
  let top1 = 0;
  let top5 = 0;
  let reciprocalRank = 0;
  const misses = [];
  const wrongTop1 = [];
  cases.forEach((item, index) => {
    const ranking = rankings[index];
    const rank = ranking.indexOf(item.expected) + 1;
    if (rank === 1) top1 += 1;
    if (rank > 0 && rank <= 5) top5 += 1;
    if (rank > 0) reciprocalRank += 1 / rank;
    if (rank === 0) misses.push({ language: item.language, query: item.query, expected: item.expected });
    if (rank !== 1) wrongTop1.push({ language: item.language, query: item.query, expected: item.expected, actual: ranking[0] || null, rank: rank || null });
  });
  return {
    cases: cases.length,
    recall_at_1: cases.length === 0 ? null : rounded(top1 / cases.length),
    recall_at_5: cases.length === 0 ? null : rounded(top5 / cases.length),
    mrr: cases.length === 0 ? null : rounded(reciprocalRank / cases.length),
    misses,
    wrong_top_1: wrongTop1,
  };
}

function negativeAccuracy(cases, rankings) {
  const abstained = rankings.filter(items => items.length === 0).length;
  return {
    cases: cases.length,
    abstained,
    rate: cases.length === 0 ? null : rounded(abstained / cases.length),
    false_positives: cases.flatMap((item, index) => rankings[index].length > 0
      ? [{ language: item.language, query: item.query, actual: rankings[index][0] }]
      : []),
  };
}

function groupedMetrics(keys, corpus, rankings, negativeRankings, latencyGroups, keyName) {
  const output = {};
  for (const key of keys) {
    const positiveIndexes = corpus.queries.map((item, index) => item[keyName] === key ? index : -1).filter(index => index >= 0);
    const negativeIndexes = corpus.negative_queries.map((item, index) => item[keyName] === key ? index : -1).filter(index => index >= 0);
    const positives = positiveIndexes.map(index => corpus.queries[index]);
    const negatives = negativeIndexes.map(index => corpus.negative_queries[index]);
    output[key] = {
      ...accuracy(positives, positiveIndexes.map(index => rankings[index])),
      negative_abstention: negativeAccuracy(negatives, negativeIndexes.map(index => negativeRankings[index])),
      latency_ms: {
        samples: latencyGroups.get(key)?.length || 0,
        p50: percentile(latencyGroups.get(key) || [], 0.5),
        p95: percentile(latencyGroups.get(key) || [], 0.95),
      },
    };
  }
  return output;
}

function rankingDigest(rankings, negativeRankings) {
  return createHash('sha256').update(JSON.stringify({ rankings, negativeRankings })).digest('hex');
}

async function measureEngine({ name, search, corpus, iterations, dependencies, provenance, tokenizer = null }) {
  const rssBefore = process.memoryUsage().rss;
  const rankings = [];
  const negativeRankings = [];
  for (const item of corpus.queries) rankings.push(await search(item.query, 5));
  for (const item of corpus.negative_queries) negativeRankings.push(await search(item.query, 5));
  const expectedDigest = rankingDigest(rankings, negativeRankings);
  let deterministic = true;
  const latencies = [];
  const languageLatencies = new Map(Object.keys(SCRIPT_BY_LANGUAGE).map(language => [language, []]));
  const scriptLatencies = new Map([...new Set(Object.values(SCRIPT_BY_LANGUAGE))].map(script => [script, []]));
  const partitionLatencies = new Map(['selection', 'challenge'].map(partition => [partition, []]));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const repeatedRankings = [];
    const repeatedNegativeRankings = [];
    for (const item of corpus.queries) {
      const started = performance.now();
      const result = await search(item.query, 5);
      const elapsed = performance.now() - started;
      repeatedRankings.push(result);
      latencies.push(elapsed);
      languageLatencies.get(item.language).push(elapsed);
      scriptLatencies.get(item.script).push(elapsed);
      partitionLatencies.get(item.partition).push(elapsed);
    }
    for (const item of corpus.negative_queries) {
      const started = performance.now();
      const result = await search(item.query, 5);
      const elapsed = performance.now() - started;
      repeatedNegativeRankings.push(result);
      latencies.push(elapsed);
      languageLatencies.get(item.language).push(elapsed);
      scriptLatencies.get(item.script).push(elapsed);
      partitionLatencies.get('challenge').push(elapsed);
    }
    if (rankingDigest(repeatedRankings, repeatedNegativeRankings) !== expectedDigest) deterministic = false;
  }
  const languages = Object.keys(SCRIPT_BY_LANGUAGE).sort();
  const scripts = [...new Set(Object.values(SCRIPT_BY_LANGUAGE))].sort();
  return {
    status: 'ran',
    name,
    provenance,
    profile: tokenizer?.profile || null,
    accuracy: accuracy(corpus.queries, rankings),
    negative_abstention: negativeAccuracy(corpus.negative_queries, negativeRankings),
    by_language: groupedMetrics(languages, corpus, rankings, negativeRankings, languageLatencies, 'language'),
    by_script: groupedMetrics(scripts, corpus, rankings, negativeRankings, scriptLatencies, 'script'),
    by_partition: groupedMetrics(['selection', 'challenge'], corpus, rankings, negativeRankings, partitionLatencies, 'partition'),
    determinism: { repeated: deterministic, digest: expectedDigest },
    latency_ms: { samples: latencies.length, p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    resources: {
      rss_delta_bytes: Math.max(0, process.memoryUsage().rss - rssBefore),
      dependency_count: dependencies,
      average_query_tokens: tokenizer
        ? rounded(corpus.queries.reduce((sum, item) => sum + tokenizer.tokenize(item.query).length, 0) / corpus.queries.length)
        : null,
    },
    _rankings: rankings,
    _negativeRankings: negativeRankings,
  };
}

function publicEngine(engine) {
  const { _rankings, _negativeRankings, ...value } = engine;
  return value;
}

function worst(values) {
  return Math.min(...values.filter(value => value !== null));
}

function selectionVector(engine) {
  return {
    worst_language_recall_at_1: worst(Object.values(engine.by_language).map(item => item.recall_at_1)),
    worst_language_negative_abstain_rate: worst(Object.values(engine.by_language).map(item => item.negative_abstention.rate)),
    worst_script_mrr: worst(Object.values(engine.by_script).map(item => item.mrr)),
    recall_at_1: engine.accuracy.recall_at_1,
    recall_at_5: engine.accuracy.recall_at_5,
    mrr: engine.accuracy.mrr,
    negative_abstain_rate: engine.negative_abstention.rate,
    deterministic: engine.determinism.repeated ? 1 : 0,
    p95_ms: engine.latency_ms.p95,
    average_query_tokens: engine.resources.average_query_tokens,
  };
}

function compareCandidates(left, right) {
  const leftVector = selectionVector(left);
  const rightVector = selectionVector(right);
  for (const key of [
    'worst_language_recall_at_1',
    'worst_language_negative_abstain_rate',
    'worst_script_mrr',
    'recall_at_1',
    'recall_at_5',
    'mrr',
    'negative_abstain_rate',
    'deterministic',
  ]) {
    if (leftVector[key] !== rightVector[key]) return rightVector[key] - leftVector[key];
  }
  if (leftVector.p95_ms !== rightVector.p95_ms) return leftVector.p95_ms - rightVector.p95_ms;
  if (leftVector.average_query_tokens !== rightVector.average_query_tokens) return leftVector.average_query_tokens - rightVector.average_query_tokens;
  return left.name.localeCompare(right.name, 'en');
}

function qualityGate(engine) {
  const languageGate = Object.values(engine.by_language).every(item => item.recall_at_1 === 1
    && item.recall_at_5 === 1
    && item.mrr === 1
    && item.negative_abstention.rate === 1);
  const scriptGate = Object.values(engine.by_script).every(item => item.recall_at_1 === 1
    && item.recall_at_5 === 1
    && item.mrr === 1
    && item.negative_abstention.rate === 1);
  const partitionGate = Object.values(engine.by_partition).every(item => item.recall_at_1 === 1
    && item.recall_at_5 === 1
    && item.mrr === 1);
  return engine.accuracy.recall_at_1 === 1
    && engine.accuracy.recall_at_5 === 1
    && engine.accuracy.mrr === 1
    && engine.negative_abstention.rate === 1
    && engine.determinism.repeated
    && languageGate
    && scriptGate
    && partitionGate;
}

// The latency lock exists to catch algorithmic regressions, not to certify runner hardware: an
// absolute 5 ms budget calibrated on the maintainer's workstation is unreachable on shared 2-core
// CI runners even though every quality and determinism lock passes there. A fixed pure-CPU
// workload (Unicode-heavy string processing, the engine's dominant cost) is timed on the current
// machine and the budget scales by how much slower it is than the reference workstation. A real
// complexity blowup exceeds any hardware factor; a slow runner does not.
const PERFORMANCE_BUDGET_BASE_MS = 5;
const REFERENCE_CALIBRATION_MS = 38; // median of the workload on the M5 Pro the 5 ms budget was calibrated on
// Per-language/per-script groups hold few queries, so their P95 is close to a maximum and one
// scheduler preemption on a busy runner lands directly on the statistic. Groups get double the
// global budget; the global P95 over the full sample stays at the strict budget.
const GROUP_BUDGET_ALLOWANCE = 2;

function calibrationRun() {
  const started = performance.now();
  let accumulator = 0;
  let text = 'calibration-预热负载-キャリブレーション-보정-معايرة-0';
  for (let index = 0; index < 12_000; index += 1) {
    text = `${text.slice(-96)}-${index.toString(36)}`;
    const tokens = text.normalize('NFKC').toLocaleLowerCase('und').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    for (const token of tokens) {
      for (const point of token) accumulator = (accumulator * 31 + point.codePointAt(0)) >>> 0;
    }
  }
  assert(accumulator >= 0, 'calibration workload must complete');
  return performance.now() - started;
}

function calibrateMachineSpeed() {
  calibrationRun(); // untimed warmup so JIT compilation does not inflate the machine factor
  const runs = [];
  for (let run = 0; run < 5; run += 1) runs.push(calibrationRun());
  runs.sort((left, right) => left - right);
  const sampleMs = runs[Math.floor(runs.length / 2)];
  const factor = Math.max(1, sampleMs / REFERENCE_CALIBRATION_MS);
  return {
    sample_ms: rounded(sampleMs),
    reference_ms: REFERENCE_CALIBRATION_MS,
    factor: rounded(factor),
    global_budget_ms: rounded(PERFORMANCE_BUDGET_BASE_MS * factor),
    group_budget_ms: rounded(PERFORMANCE_BUDGET_BASE_MS * factor * GROUP_BUDGET_ALLOWANCE),
  };
}

function performanceGate(engine, calibration) {
  return engine.latency_ms.p95 !== null
    && engine.latency_ms.p95 <= calibration.global_budget_ms
    && Object.values(engine.by_language).every(item => item.latency_ms.p95 !== null && item.latency_ms.p95 <= calibration.group_budget_ms)
    && Object.values(engine.by_script).every(item => item.latency_ms.p95 !== null && item.latency_ms.p95 <= calibration.group_budget_ms);
}

async function loadEmbeddingAdapter(file) {
  if (!file) return null;
  const adapter = await import(pathToFileURL(file).href);
  assert(adapter.metadata && typeof adapter.metadata.name === 'string', 'embedding adapter must export metadata.name');
  assert(adapter.metadata.model_calls === 0 && adapter.metadata.network_calls === 0, 'benchmark adapters must declare zero model and network calls');
  assert(Number.isInteger(adapter.metadata.dependency_count) && adapter.metadata.dependency_count >= 0, 'embedding adapter metadata.dependency_count must be a non-negative integer');
  assert(typeof adapter.search === 'function', 'embedding adapter must export search({ documents, query, limit })');
  return adapter;
}

async function verifyOrderInvariance(corpus, profile, expectedDigest) {
  const root = materializeCorpus(corpus, [...corpus.topics].reverse());
  try {
    const tokenizer = createMemoryTokenizer(profile);
    const index = loadMemoryIndex({ root, memoryDir: '.ownmem', tokenizer });
    const rankings = corpus.queries.map(item => searchMemory(index, item.query, { limit: 5 }).map(result => result.document.name));
    const negativeRankings = corpus.negative_queries.map(item => searchMemory(index, item.query, { limit: 5 }).map(result => result.document.name));
    return { reversed_topic_order: rankingDigest(rankings, negativeRankings) === expectedDigest };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export async function runPublicBenchmark({
  corpusFile = DEFAULT_CORPUS,
  supplementFile = DEFAULT_SUPPLEMENT,
  iterations = 5,
  embeddingAdapter = null,
} = {}) {
  const corpus = loadCorpus(corpusFile, supplementFile);
  validateCorpus(corpus);
  const root = materializeCorpus(corpus);
  try {
    const candidates = [];
    let defaultIndex = null;
    for (const profile of ALGORITHM_PROFILES) {
      const tokenizer = createMemoryTokenizer(profile);
      const index = loadMemoryIndex({ root, memoryDir: '.ownmem', tokenizer });
      if (profile === MEMORY_TOKENIZER_PROFILE) defaultIndex = index;
      candidates.push(await measureEngine({
        name: `bm25f-${profile}`,
        corpus,
        iterations,
        dependencies: 2,
        provenance: 'repository code under test',
        tokenizer,
        search: async (query, limit) => searchMemory(index, query, { limit }).map(result => result.document.name),
      }));
    }
    assert(defaultIndex, `default tokenizer profile ${MEMORY_TOKENIZER_PROFILE} is not in the candidate set`);
    const rankedCandidates = [...candidates].sort(compareCandidates);
    const winner = rankedCandidates[0];
    winner.determinism = {
      ...winner.determinism,
      ...(await verifyOrderInvariance(corpus, winner.profile, winner.determinism.digest)),
    };

    const documents = defaultIndex.documents.map(document => ({ id: document.name, text: document.content }));
    const grep = await measureEngine({
      name: 'grep-fixed-string',
      corpus,
      iterations,
      dependencies: 0,
      provenance: 'in-process equivalent of case-insensitive grep -F',
      search: async (query, limit) => {
        const needle = query.normalize('NFKC').toLocaleLowerCase('und');
        return documents.filter(document => document.text.normalize('NFKC').toLocaleLowerCase('und').includes(needle)).slice(0, limit).map(document => document.id);
      },
    });
    const adapter = await loadEmbeddingAdapter(embeddingAdapter);
    const embedding = adapter
      ? await measureEngine({
        name: adapter.metadata.name,
        corpus,
        iterations,
        dependencies: adapter.metadata.dependency_count,
        provenance: `user-supplied adapter ${path.basename(embeddingAdapter)}`,
        search: async (query, limit) => {
          const result = await adapter.search({ documents, query, limit });
          assert(Array.isArray(result) && result.every(value => typeof value === 'string'), 'embedding adapter search() must return document ID strings');
          return result.slice(0, limit);
        },
      })
      : { status: 'not_configured', reason: 'No zero-call embedding adapter was supplied; no embedding number is fabricated.' };

    const selectedIsDefault = winner.profile === MEMORY_TOKENIZER_PROFILE;
    const performanceEnforced = iterations >= 20;
    const calibration = performanceEnforced ? calibrateMachineSpeed() : null;
    const qualityPassed = qualityGate(winner);
    const performancePassed = performanceEnforced ? performanceGate(winner, calibration) : null;
    const passed = qualityPassed
      && selectedIsDefault
      && winner.determinism.reversed_topic_order
      && (!performanceEnforced || performancePassed);
    const candidateReport = Object.fromEntries(candidates.map(candidate => [candidate.profile, {
      vector: selectionVector(candidate),
      quality_gate_passed: qualityGate(candidate),
      performance_gate_passed: performanceEnforced ? performanceGate(candidate, calibration) : null,
      engine: publicEngine(candidate),
    }]));
    return {
      schema: SCHEMA,
      corpus: {
        sha256: corpus.sha256,
        sources: corpus.sourceFiles,
        license: corpus.license,
        topics: corpus.topics.length,
        queries: corpus.queries.length,
        negative_queries: corpus.negative_queries.length,
        languages: Object.keys(SCRIPT_BY_LANGUAGE).sort(),
        scripts: [...new Set(Object.values(SCRIPT_BY_LANGUAGE))].sort(),
        ui_locales: REQUIRED_UI_LOCALES,
        groups: Object.fromEntries([...new Set(corpus.queries.map(item => item.group))].sort().map(group => [group, corpus.queries.filter(item => item.group === group).length])),
        partitions: Object.fromEntries(['selection', 'challenge'].map(partition => [partition, corpus.queries.filter(item => item.partition === partition).length])),
      },
      controls: {
        iterations,
        model_calls: 0,
        network_calls: 0,
        same_corpus: true,
        same_queries: true,
        same_top_k: 5,
        corpus_order_perturbation: 'reversed topic manifest',
      },
      selection: {
        rule: 'lexicographic-v1: worst-language R@1 > worst-language abstain > worst-script MRR > global R@1/R@5/MRR/abstain > determinism > P95 > token expansion',
        candidates: rankedCandidates.map(candidate => candidate.profile),
        winner: winner.profile,
        expected_default: MEMORY_TOKENIZER_PROFILE,
        selected_is_default: selectedIsDefault,
        vectors: Object.fromEntries(rankedCandidates.map(candidate => [candidate.profile, selectionVector(candidate)])),
      },
      gates: {
        recall_at_1_min: 1,
        recall_at_5_min: 1,
        mrr_min: 1,
        negative_abstain_rate_min: 1,
        p95_budget_base_ms: PERFORMANCE_BUDGET_BASE_MS,
        per_language_p95_ms_max: calibration ? calibration.group_budget_ms : null,
        per_script_p95_ms_max: calibration ? calibration.group_budget_ms : null,
        global_p95_ms_max: calibration ? calibration.global_budget_ms : null,
        calibration,
        deterministic_required: true,
        minimum_languages: 40,
        minimum_scripts: 20,
        performance_minimum_iterations: 20,
        performance_enforced: performanceEnforced,
        quality_passed: qualityPassed,
        performance_passed: performancePassed,
        release_passed: performanceEnforced ? passed : null,
        passed,
      },
      algorithms: candidateReport,
      engines: {
        core: publicEngine(winner),
        grep: publicEngine(grep),
        embedding: embedding.status === 'ran' ? publicEngine(embedding) : embedding,
      },
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function formatPublicBenchmark(result) {
  const line = engine => engine.status === 'ran'
    ? `${engine.name}: R@1 ${(engine.accuracy.recall_at_1 * 100).toFixed(1)}%, R@5 ${(engine.accuracy.recall_at_5 * 100).toFixed(1)}%, MRR ${engine.accuracy.mrr.toFixed(4)}, abstain ${(engine.negative_abstention.rate * 100).toFixed(1)}%, P95 ${engine.latency_ms.p95.toFixed(4)}ms, deps ${engine.resources.dependency_count}`
    : 'embedding: not configured (no result fabricated)';
  return [
    `Public memory benchmark: ${result.corpus.topics} topics / ${result.corpus.queries} positive + ${result.corpus.negative_queries} negative / ${result.corpus.languages.length} languages / ${result.corpus.scripts.length} scripts`,
    `Algorithm winner: ${result.selection.winner} (${result.selection.candidates.length} candidates, default=${result.selection.expected_default})`,
    line(result.engines.core),
    line(result.engines.grep),
    line(result.engines.embedding),
    `Determinism: repeated=${result.engines.core.determinism.repeated}, reversed_topic_order=${result.engines.core.determinism.reversed_topic_order}`,
    `Quality gate: ${result.gates.quality_passed ? 'passed' : 'failed'}`,
    result.gates.performance_enforced
      ? `Performance gate: ${result.gates.performance_passed ? 'passed' : 'failed'} (machine factor ${result.gates.calibration.factor.toFixed(2)}, global budget ${result.gates.calibration.global_budget_ms.toFixed(2)}ms, group budget ${result.gates.calibration.group_budget_ms.toFixed(2)}ms)`
      : `Performance gate: not measured (requires >=${result.gates.performance_minimum_iterations} iterations)`,
    `Release gate: ${result.gates.release_passed === null ? 'not measured' : result.gates.release_passed ? 'passed' : 'failed'}`,
    `Controls: model_calls=${result.controls.model_calls}, network_calls=${result.controls.network_calls}, corpus=${result.corpus.sha256}`,
  ].join('\n') + '\n';
}

export async function runCli(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const result = await runPublicBenchmark({
    corpusFile: options.corpus,
    supplementFile: options.supplement,
    iterations: options.iterations,
    embeddingAdapter: options.embeddingAdapter,
  });
  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatPublicBenchmark(result));
  return result.gates.passed ? 0 : 1;
}

if (isMemoryCliEntry(import.meta.url)) {
  runCli().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`memory-public-benchmark: ${error.message}\n`);
    process.exitCode = 1;
  });
}
