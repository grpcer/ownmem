import { existsSync, readFileSync } from 'node:fs';

// This file reads stream 1 of three: the retrieval verdict, "did recall return the right thing".
// The outcome receipt (what happened after a memory was used) and the weak self-attribution label
// live in their own files with their own schemas, and nothing here may be derived from them or
// stand in for them -- mixing the three is exactly how one denominator starts impersonating another.
//
// The writer (lib/features/recall.mjs) lives in the compiler layer and cannot import from this one,
// so the verdict contract is stated independently on each side; the self-tests keep them aligned.
const VERDICTS = new Set(['correct', 'correct_abstain', 'wrong', 'retrieval_miss', 'coverage_gap', 'stale', 'conflict']);
// `retrieval_miss` claims the right memory is active but fell outside top-k, so it has to name which
// one. `coverage_gap` claims the corpus holds no right memory at all, so naming one contradicts the
// verdict. The rest may name a memory and stay valid without one. The old name for the first one was
// `miss`, which sat next to `coverage_gap` meaning "also did not get it" and needed a paragraph of
// prose every time it appeared; the name now carries the distinction instead of the comment.
//
// `correct_abstain` is the second way recall can be right, and it had no way to be recorded at all.
// Abstaining is a behaviour with its own correctness: when the corpus holds nothing for a query, the
// right answer is to return nothing, and that is the single hardest thing for a ranker to do -- the
// held-out partition added 2026-08-25 abstains on 14.3% of the queries where it should. Until now
// `correct` refused any row with an empty result set, so every such success had to be filed as
// `wrong` or `coverage_gap`. That is not a labelling quibble: it put recall's correct behaviour into
// the failure column and inflated the observed error rate on this repository's own ledger.
//
// It is NOT a synonym for `coverage_gap`, and both can be true of the same query. `coverage_gap`
// judges the CORPUS -- a memory ought to exist here and does not, so someone should write one.
// `correct_abstain` judges RECALL -- given a corpus with no right answer, it correctly returned
// none. A query about an unrelated product is `correct_abstain` and no gap at all; a real question
// this repository has never written down is both.
const EXPECTED_REQUIRED = new Set(['retrieval_miss']);
const EXPECTED_FORBIDDEN = new Set(['coverage_gap', 'correct_abstain']);
// Claiming recall was right to return nothing is only coherent when it in fact returned nothing.
const RETURNED_MUST_BE_EMPTY = new Set(['correct_abstain']);
// The two verdicts that say recall did its job. Exported because three call sites independently
// filtered on `verdict !== 'correct'` to mean "still needs a human", and a second correct verdict
// would silently have been counted as outstanding work in all three.
export const FEEDBACK_CORRECT_VERDICTS = new Set(['correct', 'correct_abstain']);
const SUPPORTED_SCHEMAS = ['ownmem-recall-feedback/v3'];
// A clean break: an unrecognized schema id is rejected, never migrated and never dual-parsed. A bare
// rejection leaves the reader with nothing to do, so it carries the remedy. These queues live under
// .local-test/, which is discardable local telemetry.
const DISCARD_LOCAL_TELEMETRY = 'OwnMem reads only ownmem-recall-feedback/v3, in which the verdict `miss` is now `retrieval_miss`; rewrite or delete this .local-test/ file, then record fresh rows with `npx ownmem recall --feedback retrieval_miss --expected <memory-name> -- \'<query>\'`';

export function readFeedbackInbox(file, activeNames = new Set()) {
  if (!existsSync(file)) {
    return { file, entries: [], errors: [], duplicates: 0 };
  }

  const entries = [];
  const errors = [];
  const seen = new Set();
  let duplicates = 0;
  for (const [index, line] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      errors.push(`line ${index + 1}: invalid JSON: ${error.message}`);
      continue;
    }
    if (!SUPPORTED_SCHEMAS.includes(entry.schema)) {
      errors.push(`line ${index + 1}: unsupported schema ${entry.schema || '(missing)'}; ${DISCARD_LOCAL_TELEMETRY}`);
      continue;
    }
    if (!VERDICTS.has(entry.verdict)) {
      errors.push(`line ${index + 1}: invalid verdict ${entry.verdict || '(missing)'}`);
      continue;
    }
    if (typeof entry.query !== 'string' || !entry.query.trim()) {
      errors.push(`line ${index + 1}: query must be a non-empty string`);
      continue;
    }
    if (!Array.isArray(entry.returned) || entry.returned.some((name) => typeof name !== 'string')) {
      errors.push(`line ${index + 1}: returned must be an array of memory names`);
      continue;
    }
    if (RETURNED_MUST_BE_EMPTY.has(entry.verdict) && entry.returned.length > 0) {
      errors.push(`line ${index + 1}: ${entry.verdict} says recall was right to return nothing, but it returned ${entry.returned.join(', ')}`);
      continue;
    }
    if (EXPECTED_REQUIRED.has(entry.verdict) && (typeof entry.expected !== 'string' || !entry.expected)) {
      errors.push(`line ${index + 1}: ${entry.verdict} requires expected`);
      continue;
    }
    if (EXPECTED_FORBIDDEN.has(entry.verdict) && entry.expected) {
      errors.push(`line ${index + 1}: ${entry.verdict} means no correct memory exists, so it must not carry expected`);
      continue;
    }
    if (entry.expected !== undefined && entry.expected !== null
        && (typeof entry.expected !== 'string' || !entry.expected)) {
      errors.push(`line ${index + 1}: expected must be a memory name or null`);
      continue;
    }
    if (entry.expected && activeNames.size > 0 && !activeNames.has(entry.expected)) {
      errors.push(`line ${index + 1}: expected memory is no longer active: ${entry.expected}`);
      continue;
    }
    const key = `${entry.query}\u0000${entry.verdict}\u0000${entry.expected || ''}`;
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
    entries.push({ ...entry, line: index + 1 });
  }
  return { file, entries, errors, duplicates };
}

// resolvedLines carries misses that a later recall improvement already fixed. They stay in the inbox as
// history but must leave the actionable count, or the queue can never reach zero and every consumer
// keeps reporting work that no longer exists.
export function summarizeFeedback(inbox, { resolvedLines = new Set() } = {}) {
  const verdicts = Object.fromEntries([...VERDICTS].map((verdict) => [verdict, 0]));
  for (const entry of inbox.entries) verdicts[entry.verdict] += 1;
  return {
    total: inbox.entries.length,
    verdicts,
    resolved: inbox.entries.filter((entry) => resolvedLines.has(entry.line)).length,
    actionable: inbox.entries
      .filter((entry) => !FEEDBACK_CORRECT_VERDICTS.has(entry.verdict) && !resolvedLines.has(entry.line)).length,
    invalid: inbox.errors.length,
    duplicates: inbox.duplicates,
  };
}

export function readTriggerBackfillReceipts(file) {
  if (!existsSync(file)) return { file, entries: [], errors: [] };
  const entries = [];
  const errors = [];
  const seen = new Set();
  for (const [index, line] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      errors.push(`line ${index + 1}: invalid JSON: ${error.message}`);
      continue;
    }
    if (entry.schema !== 'ownmem-trigger-backfill-receipt/v1') {
      errors.push(`line ${index + 1}: unsupported schema ${entry.schema || '(missing)'}; ${DISCARD_LOCAL_TELEMETRY}`);
      continue;
    }
    const fields = Object.keys(entry).sort().join(',');
    if (fields !== 'feedback_line,feedback_recorded_at,query_sha256,recorded_at,schema,target,trigger') {
      errors.push(`line ${index + 1}: receipt contains missing or unknown fields`);
      continue;
    }
    if (!Number.isInteger(entry.feedback_line) || entry.feedback_line < 1) {
      errors.push(`line ${index + 1}: feedback_line must be a positive integer`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(entry.recorded_at || '')
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(entry.feedback_recorded_at || '')
        || typeof entry.target !== 'string' || !entry.target
        || typeof entry.trigger !== 'string' || !entry.trigger
        || !/^[a-f0-9]{64}$/.test(entry.query_sha256 || '')) {
      errors.push(`line ${index + 1}: target, trigger, and query_sha256 are required`);
      continue;
    }
    if (seen.has(entry.feedback_line)) {
      errors.push(`line ${index + 1}: duplicate receipt for feedback line ${entry.feedback_line}`);
      continue;
    }
    seen.add(entry.feedback_line);
    entries.push({ ...entry, line: index + 1 });
  }
  return { file, entries, errors };
}

/**
 * Misses a person has ruled out of the trigger lane.
 *
 * A dismissal is not a resolution and the two ledgers are kept apart on purpose. A resolution says
 * recall now returns the topic unaided, which is a claim about behaviour and is verified by replay
 * before it is written. A dismissal says only that a person looked and decided no trigger edit can
 * close this miss -- the miss is still a miss, and the recall failure it records stays true. Folding
 * them into one file would let "we gave up on this route" read later as "this was fixed", which is
 * the one reading the queue must never support.
 *
 * The row leaves the backfill queue so the unattended runner stops re-grading a proposal a person
 * has already refused, and nothing else about it changes.
 */
export function readMissDismissalReceipts(file) {
  if (!existsSync(file)) return { entries: [], errors: [] };
  const entries = [];
  const errors = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.schema !== 'ownmem-miss-dismissal-receipt/v1') throw new Error('unexpected schema');
      if (typeof parsed.reason !== 'string' || parsed.reason.trim() === '') {
        throw new Error('a dismissal without a reason is not a decision anyone can review');
      }
      entries.push({ ...parsed, line: index + 1 });
    } catch (error) {
      errors.push(`dismissal receipt line ${index + 1}: ${error.message}`);
    }
  }
  return { entries, errors };
}

export function readMissResolutionReceipts(file) {
  if (!existsSync(file)) return { entries: [], errors: [] };
  const entries = [];
  const errors = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.schema !== 'ownmem-miss-resolution-receipt/v1') throw new Error('unexpected schema');
      entries.push({ ...parsed, line: index + 1 });
    } catch (error) {
      errors.push(`resolution receipt line ${index + 1}: ${error.message}`);
    }
  }
  return { entries, errors };
}
