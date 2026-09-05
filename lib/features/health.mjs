#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import { loadMemoryRecallCases } from '../memory-evaluation-cases.mjs';
import { readFeedbackInbox, readMissResolutionReceipts, summarizeFeedback } from '../memory-feedback.mjs';
import { loadMemoryTopics } from '../memory-schema.mjs';
import { resolveMemoryDir } from '../memory-paths.mjs';

// Public core packages omit host telemetry; instrumentation health is optional.
let readMemoryObservabilityEvents = null;
let collectInstrumentationHealth = null;
let formatInstrumentationHealth = null;
try {
  const observability = await import('../memory-observability.mjs');
  readMemoryObservabilityEvents = observability.readMemoryObservabilityEvents;
} catch {
  // Continue all other health checks when the local event reader is absent.
}
try {
  const instrumentation = await import('../memory-instrumentation-health.mjs');
  collectInstrumentationHealth = instrumentation.collectInstrumentationHealth;
  formatInstrumentationHealth = instrumentation.formatInstrumentationHealth;
} catch {
  // Without the instrumentation adapter the report omits that block.
}

const DEFAULT_ROOT = process.cwd();

function parseArgs(args) {
  const result = { root: DEFAULT_ROOT, memoryDir: null, casesFile: '', feedbackFile: '', usageFile: '', json: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--root') result.root = path.resolve(args[++index]);
    else if (argument === '--memory-dir') result.memoryDir = args[++index];
    else if (argument === '--cases-file') result.casesFile = args[++index];
    else if (argument === '--feedback-file') result.feedbackFile = args[++index];
    else if (argument === '--usage-file') result.usageFile = args[++index];
    else if (argument === '--json') result.json = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  result.memoryDir = resolveMemoryDir(result.root, result.memoryDir);
  result.feedbackFile = path.resolve(
    result.root,
    result.feedbackFile || '.local-test/memory-recall-feedback.jsonl',
  );
  result.usageFile = path.resolve(
    result.root,
    result.usageFile || '.local-test/memory-recall-usage.jsonl',
  );
  return result;
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

export function summarizeUsage(file) {
  const summary = { total: 0, abstained: 0, with_hits: 0, invalid: 0, abstain_rate: 0 };
  if (!existsSync(file)) return summary;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)) {
    try {
      const entry = JSON.parse(line);
      const valid = entry.schema === 'ownmem-recall-usage/v1'
        && typeof entry.recordedAt === 'string'
        && !Number.isNaN(Date.parse(entry.recordedAt))
        && /^[a-f0-9]{64}$/.test(entry.query_sha256)
        && typeof entry.abstained === 'boolean'
        && Array.isArray(entry.returned)
        && entry.returned.every((item) => (
          item && typeof item.name === 'string' && item.name.length > 0 && Number.isFinite(item.score)
        ))
        && entry.abstained === (entry.returned.length === 0)
        && !Object.hasOwn(entry, 'query');
      if (!valid) {
        summary.invalid += 1;
        continue;
      }
      summary.total += 1;
      if (entry.abstained) summary.abstained += 1;
      else summary.with_hits += 1;
    } catch {
      summary.invalid += 1;
    }
  }
  summary.abstain_rate = summary.total === 0 ? 0 : summary.abstained / summary.total;
  return summary;
}

export function collectMemoryHealth(options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const memoryDir = resolveMemoryDir(root, options.memoryDir);
  const absoluteMemoryDir = path.resolve(root, memoryDir);
  const topics = loadMemoryTopics({ root, memoryDir });
  const validTopics = topics.filter((topic) => topic.record);
  const activeNames = new Set(validTopics.map((topic) => topic.record.name));
  // No cases file is a question nobody asked, not a corpus that scored zero. The loader keeps the
  // three outcomes apart and never throws, so a checkout without a fixture still gets a full report.
  const loaded = loadMemoryRecallCases({ root, memoryDir, casesFile: options.casesFile });
  const corpus = loaded.cases;
  const evaluationError = loaded.reason;
  const expectedTopics = new Set((corpus?.golden || []).flatMap((testCase) => (
    Array.isArray(testCase.expected) ? testCase.expected : [testCase.expected]
  )));

  const byType = {};
  const byScope = {};
  const evaluatedByScope = {};
  let bytes = 0;
  let topicsWithCodeEvidence = 0;
  let codeEvidenceEntries = 0;
  let symbolAnchors = 0;
  let coarseAnchors = 0;
  let testReferences = 0;
  for (const topic of validTopics) {
    const metadata = topic.record.metadata;
    bytes += Buffer.byteLength(topic.content);
    increment(byType, metadata.type);
    for (const scope of metadata.scopes) increment(byScope, scope);
    if (metadata.code_evidence.length > 0) topicsWithCodeEvidence += 1;
    for (const evidence of metadata.code_evidence) {
      codeEvidenceEntries += 1;
      if (evidence.symbols.length > 0) symbolAnchors += evidence.symbols.length;
      else coarseAnchors += 1;
      testReferences += evidence.tests.length;
    }
    if (expectedTopics.has(topic.record.name)) {
      for (const scope of metadata.scopes) increment(evaluatedByScope, scope);
    }
  }

  const l2 = {};
  for (const entry of readdirSync(absoluteMemoryDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^MEMORY-.*\.md$/.test(entry.name)) continue;
    const text = readFileSync(path.join(absoluteMemoryDir, entry.name), 'utf8');
    l2[entry.name] = text.split(/\r?\n/).filter((line) => line.startsWith('- [')).length;
  }

  // Stream 1 of three only: the retrieval verdicts and their review queue. The outcome receipt and
  // the weak self-attribution label are separate files with separate denominators and are reported
  // by `ownmem report`, which is window-scoped; folding them in here would put three different
  // questions behind one `feedback` key. The verdict buckets come from summarizeFeedback rather
  // than a list spelled out here, so a verdict renamed in that module is renamed here too.
  const feedbackFile = options.feedbackFile || path.join(root, '.local-test/memory-recall-feedback.jsonl');
  const usageFile = options.usageFile || path.join(root, '.local-test/memory-recall-usage.jsonl');
  const feedback = readFeedbackInbox(feedbackFile, activeNames);
  // Same source of truth as memory-feedback-review: a miss that recall already fixed is not open work.
  const resolutionFile = options.resolutionFile
    || path.join(root, '.local-test/memory-miss-resolution-receipts.jsonl');
  const resolvedLines = new Set(readMissResolutionReceipts(resolutionFile).entries.map((entry) => entry.feedback_line));
  const largestTopics = validTopics
    .map((topic) => ({ name: topic.record.name, bytes: Buffer.byteLength(topic.content) }))
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 10);

  return {
    schema: 'ownmem.health/v1',
    generated_at: new Date().toISOString(),
    corpus: {
      active_topics: topics.length,
      valid_topics: validTopics.length,
      active_bytes: bytes,
      schema_errors: topics.flatMap((topic) => topic.issues).filter((item) => item.level === 'error').length,
      schema_warnings: topics.flatMap((topic) => topic.issues).filter((item) => item.level === 'warning').length,
      by_type: byType,
      by_scope: byScope,
      l2_hooks: l2,
      largest_topics: largestTopics,
    },
    evidence: {
      topics_with_code_evidence: topicsWithCodeEvidence,
      code_evidence_entries: codeEvidenceEntries,
      symbol_anchors: symbolAnchors,
      coarse_anchors: coarseAnchors,
      test_references: testReferences,
    },
    evaluation: {
      available: Boolean(corpus),
      status: loaded.status,
      source: corpus ? loaded.file : null,
      searched: loaded.searched,
      cases_sha256: loaded.sha256,
      error: evaluationError,
      golden_cases: corpus?.golden.length ?? null,
      negative_cases: corpus?.negative.length ?? null,
      unique_expected_topics: corpus ? expectedTopics.size : null,
      topic_coverage: corpus && validTopics.length > 0 ? expectedTopics.size / validTopics.length : null,
      evaluated_by_scope: evaluatedByScope,
      unevaluated_topics: corpus ? Math.max(0, validTopics.length - expectedTopics.size) : null,
    },
    feedback: {
      file_exists: existsSync(feedbackFile),
      ...summarizeFeedback(feedback, { resolvedLines }),
    },
    usage: {
      file_exists: existsSync(usageFile),
      ...summarizeUsage(usageFile),
    },
    // Report constant placeholders and never-observed producers; use null when the surface is absent.
    instrumentation: instrumentationHealth(root, options),
  };
}

function instrumentationHealth(root, options) {
  if (!readMemoryObservabilityEvents || !collectInstrumentationHealth) return null;
  try {
    const { events } = readMemoryObservabilityEvents({
      root,
      ...(options.observabilityDirectory ? { directory: options.observabilityDirectory } : {}),
    });
    return collectInstrumentationHealth(events, {
      ...(options.minimumSamples ? { minimumSamples: options.minimumSamples } : {}),
    });
  } catch {
    return null;
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const report = await collectMemoryHealth(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `Memory health: ${report.corpus.valid_topics}/${report.corpus.active_topics} schema-valid, `
    + `${report.corpus.active_bytes}B, ${report.evaluation.available
      ? `${report.evaluation.unique_expected_topics}/${report.corpus.active_topics} topics evaluated (${report.evaluation.topic_coverage === null ? 'n/a' : `${(report.evaluation.topic_coverage * 100).toFixed(1)}%`})`
      : `evaluation unavailable (${report.evaluation.error})`}\n`,
  );
  // The usage log is opt-in (`recall --usage-file`); an install that never wrote one has no usage
  // sample, and printing `0 query(s), 0.0% abstained` there reports a measurement nobody took.
  process.stdout.write(report.usage.file_exists
    ? `Usage: ${report.usage.total} query(s), ${(report.usage.abstain_rate * 100).toFixed(1)}% abstained, `
      + `${report.usage.invalid} invalid\n`
    : 'Usage: unavailable (no usage log; recall writes one only when given --usage-file)\n');
  process.stdout.write(
    `Evidence: ${report.evidence.topics_with_code_evidence} topics, ${report.evidence.symbol_anchors} symbol anchor(s), `
    + `${report.evidence.coarse_anchors} coarse anchor(s), ${report.evidence.test_references} test reference(s)\n`,
  );
  process.stdout.write(
    `Feedback: ${report.feedback.total} entries, ${report.feedback.actionable} actionable, `
    + `${report.feedback.invalid} invalid\n`,
  );
  process.stdout.write(`Largest topics: ${report.corpus.largest_topics.slice(0, 5).map((item) => `${item.name}=${item.bytes}B`).join(', ')}\n`);
  if (report.instrumentation && formatInstrumentationHealth) {
    process.stdout.write(`${formatInstrumentationHealth(report.instrumentation)}\n`);
  }
}

if (isMemoryCliEntry(import.meta.url)) {
  run().catch((error) => {
    process.stderr.write(`memory-health: ${error.message}\n`);
    process.exitCode = 1;
  });
}
