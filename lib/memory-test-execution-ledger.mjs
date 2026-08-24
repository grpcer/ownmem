// Test execution ledger: the record of which cited tests were actually observed to run.
//
// Why this is a separate file instead of a field on the evidence item it describes:
// a trust receipt binds its evidence set by digest (`evidence_root_sha256`), so adding one field
// to an evidence entry would invalidate every receipt in the lock at once and force a full
// re-signature. The ledger is therefore a side artefact joined to evidence by a derived key, and
// signing a receipt neither reads nor writes it.
//
// What a record is allowed to claim. `test` evidence used to be verified exactly like a code
// anchor -- the file exists and the symbol appears in it -- which proves that a test was written,
// never that it ran. This ledger only ever holds outcomes parsed out of a real runner's output, so
// the absence of a record means `never-run` and nothing else. A file existing is never promoted to
// a pass.
//
// Grading, aligned with the evidence severities in memory-evidence-verifier.mjs:
//   never-run  informational. Not having run a test is not evidence that the memory is wrong, and
//              most of this corpus predates any execution ingest. It never downgrades anything.
//   failed     advisory. A red test may be an unrelated regression in the same suite, so it caps
//              what the memory may authorize without removing it from recall.
//   stale      advisory. The tested file changed after the run, so the recorded outcome describes
//              a file that no longer exists in that form. Freshness is checked before the outcome
//              precisely because a changed file makes both `passed` and `failed` unprovable.
// None of the three blocks.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { schemaPath } from './schema-paths.mjs';
import { fingerprintCodeAnchor } from './memory-code-fingerprint.mjs';

export const MEMORY_TEST_RUNS_SCHEMA = 'ownmem.test-runs/v1';
export const DEFAULT_MEMORY_TEST_RUNS_FILE = 'test-runs.lock.json';

export const TEST_EXECUTION_NEVER_RUN = 'never-run';
export const TEST_EXECUTION_PASSED = 'passed';
export const TEST_EXECUTION_FAILED = 'failed';
export const TEST_EXECUTION_STALE = 'stale';

/**
 * Every runner whose tests this corpus cites. Runners with no ingested run stay in the roster with
 * `status: not-connected`: dropping them would make an unconnected toolchain read as "not
 * applicable here", which is the one reading that would be a lie.
 */
export const KNOWN_TEST_RUNNERS = ['go-test', 'gradle-junit', 'node-self-test', 'vitest', 'xctest'];

const testRunsSchema = JSON.parse(readFileSync(schemaPath('trust', 'test-runs.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
const validateSchema = ajv.compile(testRunsSchema);
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort(compareText).map(key => [key, stableValue(value[key])]));
}

function stableJson(value, space = 0) {
  return `${JSON.stringify(stableValue(value), null, space)}\n`;
}

function validationMessage(errors) {
  return (errors || []).slice(0, 8).map(error => {
    if (error.keyword === 'additionalProperties') return `${error.instancePath || '/'} unknown field ${error.params.additionalProperty}`;
    return `${error.instancePath || '/'} ${error.message}`;
  }).join('; ');
}

export function validateTestExecutionLedger(ledger) {
  if (!validateSchema(ledger)) throw new Error(`memory test run ledger is invalid: ${validationMessage(validateSchema.errors)}`);
  const runIds = new Set(ledger.runs.map(run => run.run_id));
  for (const [key, result] of Object.entries(ledger.results)) {
    if (!runIds.has(result.run_id)) throw new Error(`memory test run ledger result has no run: ${key}`);
    if (testExecutionResultKey(result) !== key) throw new Error(`memory test run ledger key does not match its result: ${key}`);
  }
  return ledger;
}

export function createTestExecutionLedger({ now = new Date(), adapters = {} } = {}) {
  return validateTestExecutionLedger({
    schema: MEMORY_TEST_RUNS_SCHEMA,
    updated_at: now.toISOString(),
    runners: rebuildRunnerRoster([], adapters),
    runs: [],
    results: {},
  });
}

export function memoryTestRunsFile({ root, memoryDir = '.ownmem', fileName = DEFAULT_MEMORY_TEST_RUNS_FILE } = {}) {
  return path.resolve(root, memoryDir, fileName);
}

// Reading is memoized on (path, mtime, size): the audit resolves trust once per topic, and parsing
// plus schema-validating the same ledger hundreds of times in one process is pure overhead. Any
// write changes mtime or size, so a stale entry cannot survive an ingest in the same process.
const ledgerCache = new Map();

export function readTestExecutionLedger({
  root,
  memoryDir = '.ownmem',
  fileName = DEFAULT_MEMORY_TEST_RUNS_FILE,
  required = false,
} = {}) {
  const file = memoryTestRunsFile({ root, memoryDir, fileName });
  if (!existsSync(file)) {
    if (required) throw new Error(`memory test run ledger is missing: ${path.relative(root, file)}`);
    return { file, ledger: null };
  }
  const stat = statSync(file);
  const cacheKey = `${stat.mtimeMs}\0${stat.size}`;
  const cached = ledgerCache.get(file);
  if (cached && cached.key === cacheKey) return { file, ledger: cached.ledger };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`memory test run ledger is unreadable: ${error.message}`);
  }
  const ledger = validateTestExecutionLedger(parsed);
  ledgerCache.set(file, { key: cacheKey, ledger });
  return { file, ledger };
}

export function writeTestExecutionLedger({ root, memoryDir = '.ownmem', ledger, fileName = DEFAULT_MEMORY_TEST_RUNS_FILE } = {}) {
  validateTestExecutionLedger(ledger);
  const file = memoryTestRunsFile({ root, memoryDir, fileName });
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, stableJson(ledger, 2), 'utf8');
  renameSync(temporary, file);
  ledgerCache.delete(file);
  return file;
}

/**
 * The join key between a run outcome and a piece of test evidence. Two memories citing the same
 * test resolve to the same key, and one batch writes many keys at once, so the ledger is keyed by
 * test rather than by memory or by run.
 */
export function testExecutionResultKey({ path: filePath, symbol = null }) {
  return symbol ? `${filePath}#${symbol}` : filePath;
}

/**
 * Rolls named results up to one whole-file record per file, which is the granularity most memories
 * cite ("this behaviour is covered by that test file"). Only files that produced at least one
 * named outcome get a roll-up, and a file where everything was skipped gets none: an aggregate is
 * a claim about tests that ran.
 */
export function deriveTestFileAggregates(records) {
  const byPath = new Map();
  for (const record of records) {
    if (!record.symbol) continue;
    const group = byPath.get(record.path) || { observed: 0, failed: 0, duration: 0 };
    group.observed += 1;
    if (record.result === 'failed') group.failed += 1;
    group.duration += record.duration_ms || 0;
    byPath.set(record.path, group);
  }
  const explicit = new Set(records.filter(record => !record.symbol).map(record => record.path));
  const aggregates = [];
  for (const [filePath, group] of byPath) {
    if (explicit.has(filePath)) continue;
    aggregates.push({
      test_id: filePath,
      path: filePath,
      symbol: null,
      result: group.failed > 0 ? 'failed' : 'passed',
      duration_ms: group.duration,
      aggregate: true,
      observed_tests: group.observed,
      skipped_tests: 0,
    });
  }
  return aggregates.sort((left, right) => compareText(left.path, right.path));
}

function runIdentity(run) {
  return createHash('sha256').update(stableJson({
    runner: run.runner,
    command: run.command,
    cwd: run.cwd ?? null,
    started_at: run.started_at,
    git_commit: run.git_commit ?? null,
  })).digest('hex').slice(0, 16);
}

function anchorFingerprint(root, filePath, symbol) {
  const withSymbol = symbol ? fingerprintCodeAnchor(root, { path: filePath, symbol }) : null;
  if (withSymbol && withSymbol.status === 'ok') return { fingerprint: withSymbol.fingerprint, fingerprint_symbol: symbol };
  // A symbol the slicer cannot find degrades to the whole file rather than to nothing: a coarse
  // freshness signal still answers "did this file change after the run", which is the question.
  const coarse = fingerprintCodeAnchor(root, { path: filePath, symbol: null });
  if (coarse.status !== 'ok') return null;
  return { fingerprint: coarse.fingerprint, fingerprint_symbol: null };
}

/**
 * Folds one observed batch into the ledger. Records are outcomes parsed from that batch's own
 * output; this function never runs anything and never invents a result for a test the batch did
 * not report.
 */
export function ingestTestRun({
  root,
  ledger,
  run,
  records,
  adapters = {},
  // Which reported outcomes are worth keeping. One batch of seven Go packages reports about 1,500
  // tests; storing all of them produced a 1.1 MB file that churns on every run, for a corpus that
  // cites 79 anchors. The caller narrows it to what memory actually points at, and a test that
  // becomes cited later reads `never-run` until the next batch -- which is true, not a gap.
  accept = () => true,
  now = new Date(),
} = {}) {
  if (!KNOWN_TEST_RUNNERS.includes(run.runner)) {
    throw new Error(`unknown test runner: ${run.runner} (known: ${KNOWN_TEST_RUNNERS.join(', ')})`);
  }
  const base = ledger || createTestExecutionLedger({ now });
  const runId = runIdentity(run);
  const results = { ...base.results };
  const stored = [];
  const unresolved = [];
  let uncited = 0;
  for (const record of [...records, ...deriveTestFileAggregates(records)]) {
    if (!accept(record)) {
      uncited += 1;
      continue;
    }
    const anchor = anchorFingerprint(root, record.path, record.symbol);
    if (!anchor) {
      unresolved.push(record.test_id);
      continue;
    }
    const entry = {
      run_id: runId,
      runner: run.runner,
      test_id: record.test_id,
      path: record.path,
      symbol: record.symbol ?? null,
      fingerprint: anchor.fingerprint,
      fingerprint_symbol: anchor.fingerprint_symbol,
      result: record.result,
      duration_ms: record.duration_ms ?? null,
      aggregate: Boolean(record.aggregate),
      observed_tests: record.observed_tests ?? 1,
      skipped_tests: record.skipped_tests ?? 0,
    };
    results[testExecutionResultKey(entry)] = entry;
    stored.push(entry);
  }
  const runEntry = {
    run_id: runId,
    runner: run.runner,
    runner_version: run.runner_version ?? null,
    command: run.command,
    cwd: run.cwd ?? null,
    exit_code: run.exit_code,
    started_at: run.started_at,
    duration_ms: run.duration_ms,
    git_commit: run.git_commit ?? null,
    recorded_results: stored.length,
    skipped_tests: run.skipped_tests ?? 0,
    ingested_at: now.toISOString(),
  };
  // Latest outcome per key wins, so older runs lose their last reference over time. Dropping the
  // runs nothing points at any more is what keeps this file from growing without bound. The one
  // exception is each runner's most recent run: a batch that reported nothing memory cites is
  // still the evidence that this runner is connected, and it is exactly one entry per runner.
  const referenced = new Set(Object.values(results).map(entry => entry.run_id));
  const candidates = [...base.runs.filter(item => item.run_id !== runId), runEntry]
    .sort((left, right) => compareText(left.started_at, right.started_at) || compareText(left.run_id, right.run_id));
  const latestPerRunner = new Map(candidates.map(item => [item.runner, item.run_id]));
  const runs = candidates.filter(item => referenced.has(item.run_id) || latestPerRunner.get(item.runner) === item.run_id);
  const next = validateTestExecutionLedger({
    schema: MEMORY_TEST_RUNS_SCHEMA,
    updated_at: now.toISOString(),
    runners: rebuildRunnerRoster(runs, adapters),
    runs,
    results,
  });
  return { ledger: next, run: runEntry, stored, unresolved, uncited };
}

/**
 * The roster is derived, never asserted: a runner is `ingested` exactly when a run for it survives
 * in this ledger. `adapters` reports whether an output parser exists at all, so "we can read this
 * runner but have not run it" stays distinguishable from "we cannot read this runner yet".
 */
export function rebuildRunnerRoster(runs, adapters = {}) {
  const roster = {};
  for (const name of [...new Set([...KNOWN_TEST_RUNNERS, ...runs.map(run => run.runner)])].sort(compareText)) {
    const own = runs.filter(run => run.runner === name);
    roster[name] = {
      status: own.length > 0 ? 'ingested' : 'not-connected',
      adapter: adapters[name] ? 'available' : 'unavailable',
      runs: own.length,
      last_run_at: own.length > 0 ? own[own.length - 1].started_at : null,
    };
  }
  return roster;
}

/**
 * Finds the outcome that actually describes this evidence item.
 *
 * A named test never falls back to its file's roll-up. The roll-up says "every named test observed
 * in that file passed", which does not entail that this particular one was among them -- it may
 * have been skipped, renamed, or added after the run. Reading the aggregate as proof for the named
 * case is exactly the "the file is there, so it must have run" inference this module exists to
 * prevent.
 */
export function findTestExecutionRecord(ledger, evidence) {
  if (!ledger || !evidence || evidence.kind !== 'test') return null;
  if (evidence.path) {
    const key = testExecutionResultKey({ path: evidence.path, symbol: evidence.symbol || null });
    const direct = ledger.results[key];
    if (direct) return direct;
  }
  // Last resort: the runner's own identifier for the unit. It covers evidence whose declared path
  // no longer matches where the runner reported the test from.
  return Object.values(ledger.results).find(entry => entry.test_id === evidence.locator) || null;
}

export function resolveTestExecution(root, evidence, ledger) {
  const absent = {
    status: TEST_EXECUTION_NEVER_RUN,
    runner: null,
    run_id: null,
    recorded_result: null,
    key: null,
    fingerprint_fresh: null,
  };
  const record = findTestExecutionRecord(ledger, evidence);
  if (!record) return absent;
  const anchor = fingerprintCodeAnchor(root, { path: record.path, symbol: record.fingerprint_symbol });
  const fresh = anchor.status === 'ok' && anchor.fingerprint === record.fingerprint;
  return {
    // Freshness is decided before the outcome on purpose: once the tested file has moved on, the
    // recorded pass and the recorded failure are equally unprovable, so both become `stale`.
    status: !fresh ? TEST_EXECUTION_STALE : record.result === 'failed' ? TEST_EXECUTION_FAILED : TEST_EXECUTION_PASSED,
    runner: record.runner,
    run_id: record.run_id,
    recorded_result: record.result,
    key: testExecutionResultKey(record),
    fingerprint_fresh: fresh,
  };
}

/**
 * Coverage over a set of already-verified evidence checks. `topics_with_receipt` is the honest
 * denominator answer to "how many memories that cite a test have any proof it ran"; callers must
 * render it as counts and must not turn a zero into a percentage.
 */
export function summarizeTestExecution(perTopicChecks, ledger) {
  const summary = {
    topics_with_tests: 0,
    topics_with_receipt: 0,
    anchors: 0,
    anchors_with_receipt: 0,
    passed: 0,
    failed: 0,
    stale: 0,
    never_run: 0,
    ledger_present: Boolean(ledger),
    runs: ledger?.runs.length ?? 0,
    runners_ingested: [],
    runners_not_connected: [],
  };
  for (const checks of perTopicChecks) {
    const tests = checks.filter(check => check.kind === 'test');
    if (tests.length === 0) continue;
    summary.topics_with_tests += 1;
    let receipted = false;
    for (const check of tests) {
      summary.anchors += 1;
      const status = check.execution?.status || TEST_EXECUTION_NEVER_RUN;
      if (status === TEST_EXECUTION_NEVER_RUN) summary.never_run += 1;
      else {
        receipted = true;
        summary.anchors_with_receipt += 1;
        if (status === TEST_EXECUTION_PASSED) summary.passed += 1;
        else if (status === TEST_EXECUTION_FAILED) summary.failed += 1;
        else summary.stale += 1;
      }
    }
    if (receipted) summary.topics_with_receipt += 1;
  }
  // With no ledger at all the roster still has to be named. Reporting an empty "not connected"
  // list would read as "every runner is fine", which is the opposite of what an absent ledger means.
  const roster = ledger?.runners || Object.fromEntries(KNOWN_TEST_RUNNERS.map(name => [name, { status: 'not-connected' }]));
  for (const [name, runner] of Object.entries(roster)) {
    (runner.status === 'ingested' ? summary.runners_ingested : summary.runners_not_connected).push(name);
  }
  summary.runners_ingested.sort(compareText);
  summary.runners_not_connected.sort(compareText);
  return summary;
}

/**
 * One human line. With no receipts at all it says so in words: rendering "0%" would read as a
 * measured coverage rate for a measurement that was never taken.
 */
export function formatTestExecutionSummary(summary) {
  const runners = [
    summary.runners_ingested.length > 0 ? `ingested: ${summary.runners_ingested.join(', ')}` : 'ingested: none',
    summary.runners_not_connected.length > 0 ? `not connected: ${summary.runners_not_connected.join(', ')}` : null,
  ].filter(Boolean).join('; ');
  if (summary.topics_with_tests === 0) return `Memory test execution: no memory cites a test; runners ${runners}.`;
  if (summary.anchors_with_receipt === 0) {
    return `Memory test execution: ${summary.topics_with_tests} topic(s) cite ${summary.anchors} test anchor(s); execution receipts unavailable (no test run ingested); runners ${runners}.`;
  }
  return `Memory test execution: receipts cover ${summary.topics_with_receipt}/${summary.topics_with_tests} topic(s) and ${summary.anchors_with_receipt}/${summary.anchors} anchor(s) `
    + `[passed=${summary.passed} failed=${summary.failed} stale=${summary.stale} never-run=${summary.never_run}]; runners ${runners}.`;
}
