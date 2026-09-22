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
//
// dismissedLines is the same exit for the one verdict no machine can close. `coverage_gap` says "the
// answer is written down nowhere", and it carries no `expected`, on purpose -- there is no target to
// replay against, so nothing here can prove it fixed. What settles it is somebody ruling on where the
// gap belongs, and by the five-step test in MEMORY.md most of them belong somewhere that is not the
// memory library (a work package, a document, a regression test, a gate). Only `coverage_gap` leaves
// the count this way: a dismissed `retrieval_miss` stays counted by design, because the retrieval
// failure itself is still real and only its trigger lane was closed.
export function summarizeFeedback(inbox, { resolvedLines = new Set(), dismissedLines = new Set() } = {}) {
  const settled = (entry) => resolvedLines.has(entry.line)
    || (entry.verdict === 'coverage_gap' && dismissedLines.has(entry.line));
  const verdicts = Object.fromEntries([...VERDICTS].map((verdict) => [verdict, 0]));
  for (const entry of inbox.entries) verdicts[entry.verdict] += 1;
  // `wrong` names the direction, not just the existence, of a retrieval failure. A non-empty
  // result is a precision failure (the system spoke and was wrong); an empty result is a recall or
  // corpus failure (the system stayed silent when the reporter expected help). Combining the two is
  // what made six first-day 0.5.0 receipts look like six false-positive deliveries even though two
  // were abstentions. File-backed inboxes expose `returned`; report events reconstruct the same
  // count from the paired recall trace and pass it as `returned_count`. Legacy unpaired rows stay
  // unknown rather than being guessed into either bucket.
  const wrongResultShape = { returned: 0, abstained: 0, unknown: 0 };
  for (const entry of inbox.entries.filter((item) => item.verdict === 'wrong')) {
    const returnedCount = Array.isArray(entry.returned)
      ? entry.returned.length
      : Number.isInteger(entry.returned_count) && entry.returned_count >= 0
        ? entry.returned_count
        : null;
    if (returnedCount === null) wrongResultShape.unknown += 1;
    else if (returnedCount === 0) wrongResultShape.abstained += 1;
    else wrongResultShape.returned += 1;
  }
  return {
    total: inbox.entries.length,
    verdicts,
    wrong_result_shape: wrongResultShape,
    resolved: inbox.entries.filter((entry) => resolvedLines.has(entry.line)).length,
    actionable: inbox.entries
      .filter((entry) => !FEEDBACK_CORRECT_VERDICTS.has(entry.verdict) && !settled(entry)).length,
    dismissed: inbox.entries.filter((entry) => entry.verdict === 'coverage_gap' && dismissedLines.has(entry.line)).length,
    invalid: inbox.errors.length,
    duplicates: inbox.duplicates,
  };
}

/**
 * Whether recall is still answering a query with prose.
 *
 * The one judgement `wrong` receipts are settled by, extracted so the two readers cannot drift.
 * `wrong` means "these should not have come back, and I cannot name what should have": there is no
 * target to replay against, so the only observable ending is the system no longer quoting. A pointer
 * is explicitly not an answer -- it is a place to look -- so it does not count as still quoting.
 */
export function memoryRecallStillQuotes(envelope) {
  return Array.isArray(envelope?.results) && envelope.results.length > 0;
}

/**
 * The known false-delivery residual: of everything a human ever reported as a wrong delivery, how
 * much of it does the current engine still answer with prose.
 *
 * This is the one adoption-adjacent number in this system with a real collection surface on both
 * sides of the fraction. The denominator is every distinct query somebody bothered to file a `wrong`
 * receipt for; the numerator is how many of them still come back quoted, replayed against whatever
 * index is on disk now. Both halves are recorded facts, and nobody has to do anything new for the
 * next reading to exist.
 *
 * It replaced actual-application rate as the north star on 2026-09-19, and the reason is not that
 * application matters less. It is that its numerator cannot be collected: 547 real user turns across
 * 75 local transcripts were read one by one, and the number that read as "that memory was right" is
 * zero. What the user evaluates is the deliverable, not the memory -- she does not know, and has no
 * reason to know, which memory was injected. Lowering the confirmation bar does not help something
 * nobody has the information to say. `recall.consumed` is not a substitute: a confirmed full-text
 * open proves a body was read, never that the answer used it.
 *
 * Read-only by contract. Settling a receipt writes a resolution receipt and is the reviewer's job
 * (memory-feedback-review); a reporting path that wrote them would close its own complaints and the
 * next reading would flatter itself.
 *
 * `replay` is injected rather than imported so this file stays a parser: the callers that only count
 * verdicts must not pull in a retrieval runtime, and the one caller that wants the residual pays for
 * it explicitly. A replay returning null means the query could not be re-run at all, which is
 * counted apart from a query that ran and stayed quiet -- one is a hole in the measurement, the
 * other is the measurement.
 */
export function summarizeKnownFalseDelivery({ inbox, replay = null } = {}) {
  const queries = [...new Set((inbox?.entries || [])
    .filter((entry) => entry.verdict === 'wrong')
    .map((entry) => entry.query))];
  const base = {
    stream: 'known_false_delivery_residual',
    verdict: 'wrong',
    distinct_queries: queries.length,
    still_quoted: 0,
    no_longer_quoted: 0,
    unreplayable: 0,
    residual_rate: null,
    status: 'not_measured',
    unmeasured_reason: null,
  };
  if (typeof replay !== 'function') {
    return { ...base, unmeasured_reason: 'this caller did not supply a replay, so no query was re-run' };
  }
  if (queries.length === 0) {
    return { ...base, unmeasured_reason: 'no `wrong` receipt has been recorded yet, so there is no residual to measure' };
  }
  for (const query of queries) {
    const envelope = replay(query);
    if (!envelope) base.unreplayable += 1;
    else if (memoryRecallStillQuotes(envelope)) base.still_quoted += 1;
    else base.no_longer_quoted += 1;
  }
  const replayed = base.still_quoted + base.no_longer_quoted;
  if (replayed === 0) {
    return { ...base, unmeasured_reason: `all ${queries.length} recorded query(ies) failed to replay` };
  }
  return {
    ...base,
    status: 'measured',
    residual_rate: Number((base.still_quoted / replayed).toFixed(4)),
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
