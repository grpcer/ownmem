// Trigger backfill: the first change this system is allowed to make to memory without a person.
//
// A retrieval miss is the one failure the corpus records against itself -- a query was asked, the
// right memory existed, and it did not come back. The obvious repair is to add the phrasing that
// failed to that memory's triggers, and it is obvious enough that it was worth being careful about,
// because three separate things can make it wrong and only one of them is visible in the diff.
//
//   1. The trigger might not match. The exact lane matches a trigger as a bounded phrase, so a
//      compressed slug sits in the front matter looking correct and never fires. This is the
//      judgement `recordTriggerBackfill` already wrote down, and the answer here is the same one:
//      the proposal is refused unless the trigger is a verbatim substring of the query that failed.
//   2. The trigger might not be why it came back. If recall would return the topic anyway, adding a
//      trigger and then observing success credits the edit with a fix it did not perform. So the
//      replay below is differential: the same query is run against the corpus without the change
//      and with it, and the change is only credited when the first fails and the second passes.
//      Measured on this repository's one real miss, this is not hypothetical -- see the note on
//      lanes further down.
//   3. The edit might break something else. A trigger is a retrieval input, and retrieval is shared:
//      a phrase added to one topic competes with every other topic for the same queries. So the
//      evaluation corpus is replayed on both sides too, and any case that passed before and fails
//      after is a regression, whatever the miss did.
//
// `regression_gate_passed` is produced only when all three hold. It is the check the R0 row of the
// risk matrix needs to move from `shadow` to a materialized metadata edit, and until this file
// existed it had no producer at all.
//
// Nothing here bypasses the gates. A person or the unattended coordinator may decide to run the
// operation, and the write at the bottom happens only when policy, replay, regression, quota and a
// content-addressed reverse operation have each independently said yes.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readFeedbackInbox,
  readMissResolutionReceipts,
  readTriggerBackfillReceipts,
} from './memory-feedback.mjs';
import { loadMemoryTopics, parseMemoryContent } from './memory-schema.mjs';
import { loadMemoryRecallCases } from './memory-evaluation-cases.mjs';
import { MEMORY_PROCEDURE_SCHEMA } from './memory-procedure.mjs';
import { issueMemoryTrustReceipts } from './memory-trust-migration.mjs';
import { decideMemoryPromotion } from './memory-promotion-policy.mjs';
import {
  collectPromotionQuotaSwapCandidates,
  createPromotionReceipt,
  PROMOTION_METADATA_GROWTH_LIMIT_BYTES,
  planPromotionQuota,
  promotionQuotaBlocksAutomation,
  promotionRiskForChange,
} from './memory-promotion-receipt.mjs';

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

export const TRIGGER_BACKFILL_PROPOSAL_SCHEMA = 'ownmem-trigger-backfill-proposal/v1';
export const TRIGGER_BACKFILL_PLAN_SCHEMA = 'ownmem-trigger-backfill-plan/v1';
export const TRIGGER_BACKFILL_PROCEDURE_ID = 'trigger-backfill';

/**
 * The one shape of change this module makes, stated once.
 *
 * Held as a constant rather than written at each call site because it is what makes the risk come
 * out R0. A caller that assembled these two fields itself could assemble them differently, and the
 * first time it did, the grading would silently be about a different change than the one applied.
 */
export const TRIGGER_BACKFILL_CHANGE = Object.freeze({
  change_kind: 'retrieval_metadata',
  metadata_fields: Object.freeze(['triggers']),
});

/**
 * How the trigger is chosen from the query, named so a reader can check the rule rather than infer
 * it from an example.
 *
 * The whole query, with surrounding whitespace removed and nothing else touched. Two properties
 * follow and both are load-bearing: the result is a verbatim substring of what was asked, so the
 * exact-phrase lane can match it; and the same query always produces the same trigger, so a second
 * run of this command proposes the same edit rather than a slightly different one.
 *
 * A shorter substring would generalise better -- a phrase matches more queries than a sentence
 * does -- and that is exactly why this module does not pick one. Choosing which fragment carried
 * the intent is a judgement about meaning, and nothing here has read anything that would support
 * it. Guessing would produce a trigger that looks considered and was not.
 */
export const TRIGGER_SELECTION_RULE = 'verbatim-whole-query-trimmed';

/**
 * Directories the replay mirror must not share with the repository it mirrors.
 *
 * The mirror symlinks almost everything back to the real checkout so that code evidence, documents
 * and git all resolve exactly as they do in production -- a copied-out corpus fails every anchor it
 * has and gates every topic out of recall, which was measured before this was written. But recall
 * writes: it compiles snapshots into the index directory and the embedding lane keeps a cache. A
 * symlink there would make a replay mutate the real repository's index, so this whole subtree is
 * recreated empty and the inputs that are genuinely needed are copied in.
 */
export const MIRROR_ISOLATED_DIRECTORIES = Object.freeze(['.local-test']);
export const MIRROR_COPIED_INPUTS = Object.freeze(['.local-test/memory-embedding']);

const sha256 = value => createHash('sha256').update(value).digest('hex');
const sha256File = file => createHash('sha256').update(readFileSync(file)).digest('hex');

function trustMirrorTopic(mirror, memoryId) {
  const trustFile = path.join(mirror.root, mirror.memoryDir, 'trust.lock.json');
  if (!existsSync(trustFile)) return;
  issueMemoryTrustReceipts({
    root: mirror.root,
    memoryDir: mirror.memoryDir,
    memoryIds: [memoryId],
    write: true,
  });
}

function normalizeForComparison(value) {
  return String(value).normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

// --- proposal ----------------------------------------------------------------------------------

/**
 * The trigger this module proposes for one failing query.
 *
 * Refuses an empty query rather than proposing an empty trigger: a trigger that matches nothing is
 * not a smaller version of a working one, it is a line of front matter that costs quota and never
 * fires.
 */
export function selectBackfillTrigger(query) {
  const trigger = String(query ?? '').trim();
  if (!trigger) throw new Error('a retrieval miss with an empty query has no trigger to propose');
  return trigger;
}

/**
 * The gate that refuses a trigger somebody made up.
 *
 * Verbatim means verbatim: `query.includes(trigger)` on the raw strings, with no case folding and
 * no normalisation. Normalising first would accept a trigger that reads the same to a person and
 * does not match the same way, which is the entire failure this check exists to prevent -- the
 * front matter would look right and the query would still miss.
 *
 * The refusal names the compressed-slug case explicitly, because that is the shape a generator
 * reaches for on its own: slugs are what identifiers look like everywhere else in this repository.
 */
export function assertVerbatimTrigger(query, trigger) {
  const raw = String(query ?? '');
  const candidate = String(trigger ?? '');
  if (!candidate) throw new Error('a backfilled trigger must not be empty');
  if (candidate !== candidate.trim()) {
    throw new Error(`the proposed trigger "${candidate}" has surrounding whitespace; a trigger is matched as a bounded phrase and the padding would be part of it`);
  }
  if (!raw.includes(candidate)) {
    throw new Error(
      `the proposed trigger "${candidate}" is not a verbatim substring of the query that failed `
      + `("${raw}"). A trigger only matches as a verbatim phrase, so a compressed slug or a `
      + 'rephrasing sits in the front matter looking correct and never fires; write it the way the '
      + 'query was actually worded',
    );
  }
  return candidate;
}

/**
 * Where the triggers live in the file, in whichever of the two shapes this corpus actually uses.
 *
 * Both are present and neither is legacy: the block form is what one generation of topics was
 * written in and the flow form is what another was, so an editor that understood one of them would
 * refuse roughly half the corpus. Found the hard way -- the first run of this command over the live
 * queue hit a flow-form topic on the second row.
 */
function frontmatterTriggers(source) {
  const block = /\n {2}triggers: *\n((?: {4}- .*\n)*)/u.exec(source);
  if (block) {
    return {
      style: 'block',
      insertAt: block.index + block[0].length,
      insert: value => `    - ${value}\n`,
    };
  }
  const flow = /\n {2}triggers: *\[([^\]\n]*)\]/u.exec(source);
  if (flow) {
    const closing = flow.index + flow[0].length - 1;
    return {
      style: 'flow',
      insertAt: closing,
      insert: value => (flow[1].trim() ? `, ${value}` : value),
    };
  }
  return null;
}

/**
 * The candidate bytes, produced by editing the source text rather than by re-serialising the record.
 *
 * Re-serialising would rewrite the whole file through a YAML emitter and produce a diff full of
 * changes nobody asked for -- quoting, key order, blank lines -- inside a promotion whose entire
 * claim is that it touched one field. The quota is settled in bytes, so an incidental reformat is
 * not cosmetic here: it would be charged to this change and could push it over on its own.
 *
 * The quoting is decided by trying and checking rather than by a table of YAML's special
 * characters. A plain scalar is attempted first and the result is parsed back; the trigger is
 * accepted only if it survives the round trip as the exact string that went in, and nothing else in
 * the record moved. That is the same discipline the replay uses one layer up: the question "did this
 * edit do what it looks like it did" is answered by running it, not by reasoning about the rules.
 */
export function applyTriggerToTopicSource(source, trigger, { parse = parseMemoryContent } = {}) {
  if (/[\r\n]/u.test(trigger)) throw new Error('a trigger must be a single line');
  const existing = frontmatterTriggers(source);
  if (!existing) throw new Error('the topic has no triggers block to extend');

  const before = parse(source, { source: '<candidate>' });
  if (!before.record) {
    throw new Error(`the topic does not parse before the change, so no edit to it can be graded: ${before.issues.map(item => item.message).slice(0, 2).join('; ')}`);
  }
  const priorTriggers = before.record.metadata.triggers || [];
  const normalized = normalizeForComparison(trigger);
  if (priorTriggers.some(value => normalizeForComparison(value) === normalized)) {
    throw new Error(`the topic already carries the trigger "${trigger}"`);
  }

  const attempts = [trigger, JSON.stringify(trigger)];
  const rejected = [];
  for (const rendered of attempts) {
    const candidate = `${source.slice(0, existing.insertAt)}${existing.insert(rendered)}${source.slice(existing.insertAt)}`;
    const after = parse(candidate, { source: '<candidate>' });
    if (!after.record) {
      rejected.push(`${rendered === trigger ? 'plain' : 'quoted'}: does not parse`);
      continue;
    }
    const expected = [...priorTriggers, trigger];
    if (JSON.stringify(after.record.metadata.triggers) !== JSON.stringify(expected)) {
      rejected.push(`${rendered === trigger ? 'plain' : 'quoted'}: round-tripped as ${JSON.stringify(after.record.metadata.triggers.slice(priorTriggers.length))}`);
      continue;
    }
    const strip = record => JSON.stringify({ ...record, metadata: { ...record.metadata, triggers: null } });
    if (strip(after.record) !== strip(before.record)) {
      rejected.push(`${rendered === trigger ? 'plain' : 'quoted'}: changed something other than triggers`);
      continue;
    }
    return candidate;
  }
  throw new Error(`the trigger "${trigger}" cannot be written into this topic's ${existing.style} triggers list (${rejected.join('; ')})`);
}

/**
 * A stable accumulation key for one miss.
 *
 * Derived from the target and the query rather than from a clock or a counter, so re-running the
 * command settles the quota against the same promotion instead of opening a fresh one. That is the
 * property the ledger's cumulative accounting depends on: a promotion that got a new id on every
 * attempt could grow the corpus one innocent-looking step at a time.
 */
export function triggerBackfillPromotionId(feedback) {
  return `trigger-backfill-${sha256(`${feedback.expected}\n${feedback.query}`).slice(0, 24)}`;
}

function topicRelativePath(memoryDir, memoryId) {
  return path.posix.join(memoryDir.split(path.sep).join('/'), `${memoryId}.md`);
}

/**
 * One proposal: what would change, by how much, and on whose evidence.
 *
 * `next_content` is held in memory and nothing writes it. Every downstream question -- what the
 * quota costs, whether the replay proves anything, whether the evaluation corpus regressed -- is
 * answered against these bytes before any of them reach the corpus.
 */
export function proposeTriggerBackfill({ root, memoryDir = '.ownmem', feedback, topic }) {
  if (!root) throw new Error('proposeTriggerBackfill requires a repository root');
  if (feedback?.verdict !== 'retrieval_miss') {
    throw new Error(`trigger backfill only acts on retrieval_miss feedback, got ${JSON.stringify(feedback?.verdict)}`);
  }
  if (!feedback.expected) {
    throw new Error('this retrieval_miss names no expected memory, so there is nothing to backfill into; that is a coverage_gap, not a miss');
  }
  if (!topic?.record) throw new Error(`expected memory is not active: ${feedback.expected}`);

  const trigger = assertVerbatimTrigger(feedback.query, selectBackfillTrigger(feedback.query));
  const relative = topicRelativePath(memoryDir, feedback.expected);
  const absolute = path.resolve(root, relative);
  const currentContent = readFileSync(absolute, 'utf8');
  const nextContent = applyTriggerToTopicSource(currentContent, trigger);

  return {
    schema: TRIGGER_BACKFILL_PROPOSAL_SCHEMA,
    promotion_id: triggerBackfillPromotionId(feedback),
    memory_id: feedback.expected,
    feedback_line: feedback.line,
    feedback_recorded_at: feedback.recordedAt,
    query: feedback.query,
    trigger,
    selection_rule: TRIGGER_SELECTION_RULE,
    path: relative,
    current_content: currentContent,
    next_content: nextContent,
    current_sha256: sha256(Buffer.from(currentContent, 'utf8')),
    next_sha256: sha256(Buffer.from(nextContent, 'utf8')),
    // Reported for a reader; the number the quota is settled on is measured again from these bytes
    // by planPromotionQuota, which reads the file itself rather than trusting this field.
    bytes_added: Buffer.byteLength(nextContent, 'utf8') - Buffer.byteLength(currentContent, 'utf8'),
    quota_entry: { memory_id: feedback.expected, effect: 'edit', next_content: nextContent },
  };
}

// --- the queue ---------------------------------------------------------------------------------

export const DEFAULT_FEEDBACK_FILE = '.local-test/memory-recall-feedback.jsonl';
export const DEFAULT_BACKFILL_RECEIPT_FILE = '.local-test/memory-trigger-backfill-receipts.jsonl';
export const DEFAULT_RESOLUTION_RECEIPT_FILE = '.local-test/memory-miss-resolution-receipts.jsonl';

/**
 * The misses that still want a trigger.
 *
 * Three exclusions, and each is a different way a miss stops being work. A miss that already has a
 * backfill receipt was handled. A miss that has a resolution receipt healed on its own, which
 * happens when an index or channel change fixes a whole class at once. A miss naming a topic this
 * corpus does not have cannot be acted on -- normally the inbox reader has already rejected that
 * row, but it only checks names when it has a corpus to check against, so an empty one reaches here.
 *
 * A miss with no expected topic is deliberately *not* a case here: the inbox reader requires
 * `expected` on a `retrieval_miss` and puts rows without one in its error list, so a branch for it
 * would be a branch nothing can reach. Those rows come back in `inbox_errors` instead, which is why
 * that list is returned rather than dropped -- a queue that reports "nothing to do" over a file with
 * rows in it has to be able to say which rows and why.
 */
export function pendingTriggerBackfills({
  root,
  memoryDir = '.ownmem',
  feedbackFile = DEFAULT_FEEDBACK_FILE,
  receiptFile = DEFAULT_BACKFILL_RECEIPT_FILE,
  resolutionFile = DEFAULT_RESOLUTION_RECEIPT_FILE,
} = {}) {
  if (!root) throw new Error('pendingTriggerBackfills requires a repository root');
  const topics = loadMemoryTopics({ root, memoryDir });
  const activeNames = new Set(topics.filter(topic => topic.record).map(topic => topic.record.name));
  const inbox = readFeedbackInbox(path.resolve(root, feedbackFile), activeNames);
  const backfilled = new Set(readTriggerBackfillReceipts(path.resolve(root, receiptFile))
    .entries.map(entry => entry.feedback_line));
  const resolved = new Set(readMissResolutionReceipts(path.resolve(root, resolutionFile))
    .entries.map(entry => entry.feedback_line));

  const pending = [];
  const excluded = [];
  for (const feedback of inbox.entries) {
    if (feedback.verdict !== 'retrieval_miss') continue;
    if (backfilled.has(feedback.line)) {
      excluded.push({ line: feedback.line, reason: 'already-backfilled' });
      continue;
    }
    if (resolved.has(feedback.line)) {
      excluded.push({ line: feedback.line, reason: 'healed-without-a-trigger' });
      continue;
    }
    const topic = topics.find(item => item.record?.name === feedback.expected);
    if (!topic) {
      excluded.push({ line: feedback.line, reason: `expected-memory-not-active:${feedback.expected}` });
      continue;
    }
    pending.push({ feedback, topic });
  }
  return { pending, excluded, inbox_errors: inbox.errors || [] };
}

// --- the replay mirror -------------------------------------------------------------------------

function mirrorLevel(realDirectory, mirrorDirectory, skip) {
  mkdirSync(mirrorDirectory, { recursive: true });
  for (const entry of readdirSync(realDirectory)) {
    if (entry === skip) continue;
    symlinkSync(path.join(realDirectory, entry), path.join(mirrorDirectory, entry));
  }
}

/**
 * A throwaway repository whose memory directory can be edited freely.
 *
 * Every path outside the memory directory is a symlink back to the real checkout, and that is not a
 * shortcut. A memory corpus copied away from its repository fails every anchor it declares -- the
 * code evidence points at source files, the documents resolve through the catalogue -- and the
 * trust layer then gates the topics out of recall entirely. Measured before this was written: a
 * standalone copy of this corpus returned nothing at all for a query that returns three results in
 * place. A replay against that corpus would be a replay of a different system.
 *
 * The isolated subtree is the exception, for the opposite reason: those directories are written to
 * during recall, and a replay that mutates the real index is not a read-only experiment.
 */
export function createTriggerBackfillMirror({ root, memoryDir = '.ownmem', directory = null } = {}) {
  if (!root) throw new Error('createTriggerBackfillMirror requires a repository root');
  const absoluteRoot = path.resolve(root);
  const mirrorRoot = directory
    ? path.resolve(directory)
    : mkdtempSync(path.join(tmpdir(), 'ownmem-trigger-backfill-'));
  const segments = memoryDir.split(/[\\/]/u).filter(Boolean);
  if (segments.length === 0) throw new Error('a memory directory is required to mirror');

  const isolated = new Set(MIRROR_ISOLATED_DIRECTORIES.map(entry => entry.split('/')[0]));
  // The top level skips both the first segment of the memory directory and every isolated subtree;
  // deeper levels only ever have the memory directory to skip.
  mkdirSync(mirrorRoot, { recursive: true });
  for (const entry of readdirSync(absoluteRoot)) {
    if (entry === segments[0] || isolated.has(entry)) continue;
    symlinkSync(path.join(absoluteRoot, entry), path.join(mirrorRoot, entry));
  }
  for (let depth = 1; depth < segments.length; depth += 1) {
    const relative = segments.slice(0, depth).join('/');
    mirrorLevel(path.join(absoluteRoot, relative), path.join(mirrorRoot, relative), segments[depth]);
  }
  cpSync(path.join(absoluteRoot, ...segments), path.join(mirrorRoot, ...segments), { recursive: true });
  for (const relative of MIRROR_ISOLATED_DIRECTORIES) mkdirSync(path.join(mirrorRoot, relative), { recursive: true });
  for (const relative of MIRROR_COPIED_INPUTS) {
    const source = path.join(absoluteRoot, relative);
    if (existsSync(source)) cpSync(source, path.join(mirrorRoot, relative), { recursive: true });
  }

  return {
    root: mirrorRoot,
    memoryDir,
    topicFile: memoryId => path.join(mirrorRoot, ...segments, `${memoryId}.md`),
    write(memoryId, content) {
      writeFileSync(path.join(mirrorRoot, ...segments, `${memoryId}.md`), content, 'utf8');
    },
    cleanup() {
      rmSync(mirrorRoot, { recursive: true, force: true });
    },
  };
}

/**
 * One recall through the production entry point.
 *
 * Spawned rather than called in process, and the reason is the same one `recordTriggerBackfill`
 * gives for spawning: the question is what the user's recall does, and the user's recall is this
 * command line with whatever channels this repository has configured. Reaching past it into the
 * runtime would answer a question about a subsystem instead.
 */
export function replayRecall({ root, memoryDir, query, limit = 3, recallScript = null }) {
  const script = recallScript || path.join(MODULE_DIRECTORY, 'features', 'recall.mjs');
  const result = spawnSync(process.execPath, [
    script,
    '--root', root,
    '--memory-dir', memoryDir,
    '--limit', String(limit),
    '--json',
    '--no-observability',
    query,
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    return { ok: false, topics: null, reason: `recall exited ${result.status}: ${(result.stderr || '').trim().slice(0, 300)}` };
  }
  try {
    const envelope = JSON.parse(result.stdout);
    return { ok: true, topics: (envelope.results || []).map(item => item.memory_id), reason: null };
  } catch (error) {
    return { ok: false, topics: null, reason: `recall produced unreadable output: ${error.message}` };
  }
}

/**
 * Whether the trigger is what makes the topic come back.
 *
 * Differential, and this is the part that is easy to leave out. Asking only "does the topic come
 * back now" answers yes in two different worlds: the one where the trigger fixed the miss, and the
 * one where the miss was never about triggers and recall returns the topic regardless. The second
 * world is not hypothetical here -- on this repository the recorded miss is caused by a ranking
 * lane, and with that lane out of the picture the topic is already the top result with its existing
 * triggers untouched. A single-sided check would have credited the edit and recorded a receipt for
 * a repair that did not happen.
 *
 * So both sides are run, and the change is credited only when the corpus without it fails and the
 * corpus with it passes.
 */
export function replayTriggerBackfill({ mirror, proposal, limit = 3, recall = replayRecall }) {
  const context = { root: mirror.root, memoryDir: mirror.memoryDir, limit };

  mirror.write(proposal.memory_id, proposal.current_content);
  trustMirrorTopic(mirror, proposal.memory_id);
  const before = recall({ ...context, query: proposal.query });
  if (!before.ok) {
    return { proved: false, before, after: null, reason: `the baseline replay could not run: ${before.reason}` };
  }
  if (before.topics.includes(proposal.memory_id)) {
    return {
      proved: false,
      before,
      after: null,
      reason: `recall already returns ${proposal.memory_id} for this query without the trigger, so the trigger would be credited with a fix it did not make; record a miss resolution instead of a backfill`,
    };
  }

  mirror.write(proposal.memory_id, proposal.next_content);
  trustMirrorTopic(mirror, proposal.memory_id);
  const after = recall({ ...context, query: proposal.query });
  // Restored so that anything running after this reads the corpus as it is, not as the experiment
  // left it. The mirror is discarded either way; leaving a mutated tree behind for a later step to
  // trip over is the kind of shared state that only fails once something else is added.
  mirror.write(proposal.memory_id, proposal.current_content);
  trustMirrorTopic(mirror, proposal.memory_id);
  if (!after.ok) {
    return { proved: false, before, after, reason: `the candidate replay could not run: ${after.reason}` };
  }
  if (!after.topics.includes(proposal.memory_id)) {
    return {
      proved: false,
      before,
      after,
      reason:
        `the trigger is present and recall still does not return ${proposal.memory_id} `
        + `(returned ${after.topics.join(', ') || 'nothing'}). A trigger only matches as a verbatim `
        + 'phrase, so it has to be written the way the query is actually worded rather than as a '
        + 'compressed slug -- and when it already is, the miss has a cause a trigger cannot reach '
        + 'and belongs to a person',
    };
  }
  return {
    proved: true,
    before,
    after,
    reason: `recall did not return ${proposal.memory_id} for this query and does with the trigger added`,
  };
}

// --- the regression gate -----------------------------------------------------------------------

/**
 * Whether the corpus still answers everything it used to.
 *
 * Run in process against the deterministic ranker rather than through the command line, and the two
 * departures from the replay above are deliberate rather than convenient.
 *
 * In process, because this is a hundred-odd queries on each side and the answer does not depend on
 * process boundaries. Deterministic, because this is a *difference* between two runs: an optional
 * ranking lane that reaches the network on every query, and degrades to a different answer when it
 * times out, would put its own noise into that difference and there would be no way to tell which
 * changes came from the edit. The replay next door asks a question about the user's configured
 * recall and is spawned through it; this one asks whether one edit broke anything and has to hold
 * the rest of the world still to answer.
 *
 * Golden and negative cases are graded by the benchmark's own definitions -- a golden case is
 * correct when one of its expected names is delivered, a negative case is correct when nothing is.
 * Only cases that were correct before are counted: a case already failing is a fact about the
 * corpus, not something this change broke, and folding it in would block every promotion until an
 * unrelated backlog was empty.
 */
export function runRecallRegressionGate({
  mirror,
  proposal,
  casesFile = null,
  createRuntime,
  query,
}) {
  const loaded = loadMemoryRecallCases({ root: mirror.root, memoryDir: mirror.memoryDir, casesFile });
  if (loaded.status !== 'loaded') {
    return {
      passed: false,
      status: loaded.status,
      reason: `the evaluation corpus could not be read (${loaded.status}): ${loaded.reason}`,
      cases: 0,
      compared: 0,
      regressions: [],
      cases_sha256: null,
    };
  }
  const cases = [
    ...loaded.cases.golden.map(item => ({ ...item, kind: 'golden' })),
    ...loaded.cases.negative.map(item => ({ ...item, kind: 'negative' })),
  ];

  const observe = content => {
    mirror.write(proposal.memory_id, content);
    trustMirrorTopic(mirror, proposal.memory_id);
    const runtime = createRuntime({ root: mirror.root, memoryDir: mirror.memoryDir });
    const outcomes = new Map();
    for (const testCase of cases) {
      const delivered = query(runtime, testCase.query);
      const expected = Array.isArray(testCase.expected)
        ? testCase.expected
        : testCase.expected ? [testCase.expected] : [];
      outcomes.set(testCase.id || testCase.query, testCase.kind === 'negative'
        ? delivered.length === 0
        : delivered.some(name => expected.includes(name)));
    }
    return outcomes;
  };

  const before = observe(proposal.current_content);
  const after = observe(proposal.next_content);
  mirror.write(proposal.memory_id, proposal.current_content);

  const regressions = [];
  let compared = 0;
  for (const [id, wasCorrect] of before) {
    if (!wasCorrect) continue;
    compared += 1;
    if (after.get(id) !== true) regressions.push(id);
  }
  return {
    passed: regressions.length === 0,
    status: 'loaded',
    reason: regressions.length === 0
      ? `all ${compared} evaluation case(s) that passed before the change still pass after it`
      : `${regressions.length} evaluation case(s) that passed before the change fail after it: ${regressions.slice(0, 8).join(', ')}`,
    cases: cases.length,
    compared,
    regressions,
    cases_sha256: loaded.sha256,
  };
}

/**
 * The two runs behind `regression_gate_passed`, and the check itself.
 *
 * Both, or neither. A replay that proves the miss is fixed says nothing about the rest of the
 * corpus, and a clean regression sweep says nothing about whether the change accomplished anything;
 * granting automation on either alone would be granting it on half an answer.
 */
export function evaluateTriggerBackfillGate({ mirror, proposal, casesFile = null, createRuntime, query, recall = replayRecall, limit = 3, now = new Date() }) {
  const replay = replayTriggerBackfill({ mirror, proposal, limit, recall });
  const regression = replay.proved
    ? runRecallRegressionGate({ mirror, proposal, casesFile, createRuntime, query })
    // Not run when the replay already refused. The regression sweep is the expensive half and it
    // grades a change that is not going to be applied; running it anyway would only produce a
    // second verdict about a promotion that already has one.
    : { passed: false, status: 'not-run', reason: 'the replay did not prove the change, so the corpus was never swept', cases: 0, compared: 0, regressions: [], cases_sha256: null };

  const passed = replay.proved && regression.passed;
  const observedAt = now.toISOString();
  return {
    regression_gate_passed: passed,
    replay,
    regression,
    reasons: [replay.reason, regression.reason].filter(Boolean),
    // The receipt refuses to carry regression_gate_passed without a matching passing test result,
    // so the two runs are reported in the vocabulary that check is validated against.
    verification: [
      {
        kind: 'test',
        locator: `trigger-backfill-replay:${proposal.promotion_id}`,
        outcome: replay.proved ? 'passed' : 'failed',
        observed_at: observedAt,
      },
      {
        kind: 'test',
        locator: `trigger-backfill-regression:${proposal.promotion_id}`,
        outcome: regression.passed ? 'passed' : 'failed',
        observed_at: observedAt,
      },
    ],
  };
}

// --- the procedure -----------------------------------------------------------------------------

/**
 * This task, written down as a playbook a person can follow.
 *
 * A procedure and the pipeline below are two different objects and it is worth being explicit about
 * why both exist, because the procedure declares `auto_execute: false` while the pipeline is the
 * first thing here allowed to act without a person.
 *
 * The procedure is a document. It states the preconditions, the steps, the postconditions and the
 * rollback for backfilling a trigger by hand, and `auto_execute: false` is a statement about the
 * document: nothing in this system reads a procedure file and carries out its steps. There is no
 * interpreter. The pipeline does not read it, does not consult it, and would behave identically if
 * the file were deleted -- which the self-test asserts rather than promises.
 *
 * The pipeline is a program that performs one specific change. Its authority to act comes from the
 * promotion policy grading that change R0 and from the gates above returning true, not from this
 * document. So the two never disagree: one is the written form of the task, the other is a
 * particular implementation of it that happens to have earned an exemption from being run by hand.
 *
 * Where it would be wrong is if the procedure were ever treated as the authorisation -- if applying
 * it came to mean "the procedure said so". That is what `auto_execute: false` forecloses in the
 * schema rather than in a comment.
 */
export function triggerBackfillProcedure({ fixture, failureFixtures, rollbackSha256 }) {
  return {
    schema: MEMORY_PROCEDURE_SCHEMA,
    procedure_id: TRIGGER_BACKFILL_PROCEDURE_ID,
    version: 1,
    title: 'Backfill a natural-language trigger from a recorded retrieval miss',
    risk: 'R0',
    execution: { mode: 'advisory-playbook', auto_execute: false },
    // Not `any`: a scope of everything declares nothing, and this playbook is about one repository's
    // recall feedback ledger, not about repositories in general.
    scope: { applies_to: ['ownmem', 'recall-feedback'], platforms: ['any'] },
    preconditions: [
      {
        id: 'unresolved-miss',
        label: 'The feedback ledger holds a retrieval_miss that names the topic it expected',
        kind: 'command_output_contains',
        command: ['node', 'scripts/memory-feedback-review.mjs', '--json'],
        needle: '"verdict":"retrieval_miss"',
      },
      {
        id: 'backfill-not-recorded',
        label: 'That row has no trigger backfill receipt yet',
        kind: 'command_output_contains',
        command: ['node', 'scripts/memory-feedback-review.mjs', '--json'],
        needle: '"trigger_backfills_recorded":0',
      },
      {
        id: 'quota-headroom',
        label: 'The zero-net-growth quota still admits the bytes this adds',
        kind: 'command_output_contains',
        command: ['node', 'scripts/bin/ownmem.mjs', 'promote', 'triggers', '--json'],
        needle: '"verdict":"no_growth"',
      },
    ],
    allowed_tools: ['read', 'write', 'shell'],
    steps: [
      { index: 1, tool: 'shell', intent: 'Read the pending misses and the topics they expected', command: ['node', 'scripts/bin/ownmem.mjs', 'promote', 'triggers', '--json'] },
      { index: 2, tool: 'read', intent: 'Read the expected topic and note the bytes it currently hashes to', command: null },
      { index: 3, tool: 'write', intent: 'Add the missed phrasing to that topic verbatim, as one more trigger', command: null },
      { index: 4, tool: 'shell', intent: 'Replay the missed query through the real recall entry point and confirm the topic comes back', command: ['bash', 'scripts/memory-recall.sh', '--'] },
      { index: 5, tool: 'shell', intent: 'Record the backfill receipt against that feedback row', command: ['node', 'scripts/memory-feedback-review.mjs', '--record-trigger-backfill'] },
    ],
    postconditions: [
      {
        id: 'topic-returns',
        label: 'Replaying the missed query returns the expected topic',
        kind: 'command_output_contains',
        command: ['node', 'scripts/memory-feedback-review.mjs', '--json'],
        needle: '"trigger_backfills_required"',
      },
      {
        id: 'receipt-recorded',
        label: 'The feedback row now carries a backfill receipt',
        kind: 'command_output_contains',
        command: ['node', 'scripts/memory-feedback-review.mjs', '--json'],
        needle: '"recorded":true',
      },
    ],
    idempotency: {
      kind: 'guarded',
      guard: 'backfill-not-recorded',
      note: 'A second run is refused by the recorded receipt rather than adding the same trigger twice.',
    },
    rollback: {
      strategy: 'steps',
      steps: [{ index: 1, tool: 'write', intent: 'Remove the trigger line that was added', command: null }],
      verification: [
        {
          id: 'topic-restored',
          label: 'The topic hashes back to the bytes recorded before the trigger was added',
          kind: 'file_sha256',
          path: fixture.topicPath,
          sha256: rollbackSha256,
        },
      ],
      reason: 'The change is one line of front matter and the pre-change hash is taken before it is written.',
    },
    budget: { timeout_seconds: 300, max_steps: 8, max_files_touched: 2 },
    allowed_environments: ['local', 'sandbox'],
    forbidden_environments: ['production', 'release', 'staging', 'ci'],
    replay: {
      fixture: { path: fixture.path, sha256: fixture.sha256 },
      // Two real refusals rather than two imagined ones. Both are shapes this repository's own
      // feedback ledger and quota produced, which is the difference between a failure sample and a
      // guess about how something might go wrong.
      failure_samples: [
        {
          id: 'miss-without-expected',
          label: 'A feedback row that names no expected topic, so there is nothing to backfill into',
          fixture: { path: failureFixtures.withoutExpected.path, sha256: failureFixtures.withoutExpected.sha256 },
          expected_outcome: 'refused',
        },
        {
          id: 'quota-exhausted',
          label: 'The zero-net-growth quota has no room for the bytes the trigger line adds',
          fixture: { path: failureFixtures.quotaExhausted.path, sha256: failureFixtures.quotaExhausted.sha256 },
          expected_outcome: 'refused',
        },
      ],
    },
    receipt: null,
    supersedes: [],
  };
}

// --- the pipeline ------------------------------------------------------------------------------

function gitCommit(root) {
  const result = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * Prove that the bytes being promoted can be recovered from the current Git commit.
 *
 * Automatic rollback must not depend on a receipt carrying a second copy of the memory, and it
 * must not silently discard somebody's uncommitted edit. Therefore the exact pre-promotion bytes
 * must already exist at HEAD. A dirty topic remains eligible for preview but cannot auto-apply.
 */
export function triggerBackfillReversePlan(proposal) {
  const before = Buffer.from(proposal.current_content, 'utf8');
  const after = Buffer.from(proposal.next_content, 'utf8');
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  if (prefix + suffix !== before.length || after.length <= before.length) {
    throw new Error('trigger backfill must be a pure byte insertion before it can declare an automatic rollback');
  }
  const inserted = after.subarray(prefix, after.length - suffix);
  return {
    operation: 'reverse-byte-insert',
    memory_id: proposal.memory_id,
    path: proposal.path,
    content_sha256: proposal.current_sha256,
    lifecycle: 'shadow',
    bytes: before.length,
    source_commit: null,
    byte_offset: prefix,
    inserted_bytes: inserted.length,
    inserted_sha256: sha256(inserted),
  };
}

function atomicTopicWrite(file, content) {
  const temporary = `${file}.ownmem-trigger-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * Grade one backfill end to end and decide nothing else.
 *
 * The order is the order the answers stop mattering in. Risk is asked first and is a property of
 * the change alone, so a change that is not R0 is refused before anything expensive runs -- and it
 * is asked rather than assumed, because the whole point of a matrix is that the caller does not get
 * to decide its own blast radius. The gates run next and produce the one evidence check R0 needs.
 * The quota is settled last, over the whole promotion, and it can refuse a change every other gate
 * approved. R0 metadata may spend only its bounded allowance inside the existing hard cap.
 */
export function planTriggerBackfillPromotion({
  root,
  memoryDir = '.ownmem',
  proposal,
  gate,
  priorReceipts = [],
  swapCandidates = null,
  trustAudit = null,
  // The grader, not a grade. A caller may substitute the function -- which is how the refusal below
  // is exercised at all, since the real matrix has no input that reaches it today -- but it cannot
  // hand over a risk level: the change being graded is this module's own constant, so nobody gets to
  // describe their change as something smaller than it is.
  gradeRisk = promotionRiskForChange,
  now = new Date(),
}) {
  const risk = gradeRisk({
    change_kind: TRIGGER_BACKFILL_CHANGE.change_kind,
    metadata_fields: [...TRIGGER_BACKFILL_CHANGE.metadata_fields],
  });
  if (risk.risk !== 'R0') {
    // Not reachable while the matrix grades a triggers-only edit R0, and kept because that grading
    // belongs to another module. If it ever moves, this refuses rather than promoting a change under
    // a risk level whose rules it never checked.
    return {
      schema: TRIGGER_BACKFILL_PLAN_SCHEMA,
      applicable: false,
      risk,
      decision: null,
      quota: null,
      blockers: [`risk-not-r0:${risk.risk}`],
      applies: false,
      reasons: [`this change graded ${risk.risk}, and trigger backfill is only the automatic path for R0: ${risk.reason}`],
      now: now.toISOString(),
    };
  }

  const decision = decideMemoryPromotion({
    risk: risk.risk,
    current_lifecycle: 'shadow',
    target_lifecycle: 'advisory',
    evidence: { regression_gate_passed: gate.regression_gate_passed },
  });

  const candidates = swapCandidates
    || collectPromotionQuotaSwapCandidates({ root, memoryDir, trustAudit });
  const quota = planPromotionQuota({
    root,
    memoryDir,
    promotion_id: proposal.promotion_id,
    entries: [proposal.quota_entry],
    prior_receipts: priorReceipts,
    swap_candidates: candidates,
    automatic_metadata_growth_bytes: PROMOTION_METADATA_GROWTH_LIMIT_BYTES,
  });

  const blockers = [];
  if (decision.automation !== 'auto') blockers.push(...decision.blocked_by);
  if (promotionQuotaBlocksAutomation(quota)) blockers.push(`quota-${quota.verdict.replace(/_/gu, '-')}`);

  return {
    schema: TRIGGER_BACKFILL_PLAN_SCHEMA,
    applicable: true,
    risk,
    decision,
    quota,
    blockers,
    applies: blockers.length === 0,
    reasons: [
      risk.reason,
      ...decision.reasons,
      ...quota.reasons,
      ...gate.reasons,
    ],
    now: now.toISOString(),
  };
}

/**
 * The receipt for one backfill, built whether or not it is applied.
 *
 * A refusal is as much a promotion event as an approval, and a system that only records what it did
 * cannot answer "why did nothing happen" a month later. The decision, the quota plan and both gate
 * runs are carried in full, so the receipt explains itself without this module being present.
 */
export function createTriggerBackfillReceipt({ root, proposal, plan, gate, now = new Date() }) {
  const feedbackFile = DEFAULT_FEEDBACK_FILE;
  const anchors = [
    {
      kind: 'feedback',
      locator: `${feedbackFile}#L${proposal.feedback_line}`,
      path: feedbackFile,
      sha256: sha256(proposal.query),
      fingerprint: null,
      symbol: null,
    },
    {
      kind: 'topic',
      locator: proposal.path,
      path: proposal.path,
      sha256: proposal.current_sha256,
      fingerprint: null,
      symbol: null,
    },
  ];
  const sourceCommit = gitCommit(root);
  return createPromotionReceipt({
    promotion_id: proposal.promotion_id,
    operation: 'promote',
    issued_at: now.toISOString(),
    memory_id: proposal.memory_id,
    content_sha256: proposal.next_sha256,
    summary: `Backfilled the verbatim phrasing of a recorded retrieval miss as a trigger on ${proposal.memory_id}.`,
    decision: plan.decision,
    change: {
      kind: TRIGGER_BACKFILL_CHANGE.change_kind,
      current_lifecycle: 'shadow',
      target_lifecycle: 'advisory',
      metadata_fields: [...TRIGGER_BACKFILL_CHANGE.metadata_fields],
    },
    anchors,
    evidence_checks: { regression_gate_passed: gate.regression_gate_passed },
    verification: gate.verification,
    verifier: { kind: 'machine', id: 'ownmem-trigger-backfill/1' },
    source_commit: sourceCommit,
    target_commit: null,
    scope: { hosts: [], scenarios: ['recall'] },
    guards: {
      quarantine_on: ['wrong-feedback', 'harmful-feedback'],
      rollback_on: ['harmful-feedback'],
      on_rollback: ['stop-injection', 'record-event'],
    },
    quota: plan.quota,
    rollback: {
      previous_content_sha256: proposal.current_sha256,
      previous_lifecycle: 'shadow',
      restore: triggerBackfillReversePlan(proposal),
    },
  });
}

/**
 * Write the trigger into the corpus.
 *
 * Guarded rather than trusted: the plan is re-read here rather than taken as a promise from the
 * caller, so a caller that skipped a gate and called this anyway is refused. The write itself is
 * checked against the bytes the gates were run on, because the corpus is shared -- another session
 * editing the same topic between the replay and the write would otherwise have its edit silently
 * overwritten by content measured before it existed.
 */
export function applyTriggerBackfill({ root, memoryDir = '.ownmem', proposal, plan }) {
  if (!plan?.applies) {
    throw new Error(`this backfill was not approved for automatic application: ${(plan?.blockers || ['no plan']).join(', ')}`);
  }
  const file = path.resolve(root, topicRelativePath(memoryDir, proposal.memory_id));
  const onDisk = readFileSync(file, 'utf8');
  if (sha256(Buffer.from(onDisk, 'utf8')) !== proposal.current_sha256) {
    throw new Error(`${proposal.memory_id} changed on disk after this backfill was graded; nothing was written`);
  }
  atomicTopicWrite(file, proposal.next_content);
  return { file, bytes: Buffer.byteLength(proposal.next_content, 'utf8'), sha256: sha256File(file) };
}

/** Undo an unreceipted write only while the file still equals the exact graded candidate. */
export function revertTriggerBackfill({ root, memoryDir = '.ownmem', proposal }) {
  const file = path.resolve(root, topicRelativePath(memoryDir, proposal.memory_id));
  const onDisk = readFileSync(file, 'utf8');
  if (sha256(Buffer.from(onDisk, 'utf8')) !== proposal.next_sha256) {
    throw new Error(`${proposal.memory_id} no longer matches the graded candidate; transaction recovery refused`);
  }
  atomicTopicWrite(file, proposal.current_content);
  return { file, bytes: Buffer.byteLength(proposal.current_content, 'utf8'), sha256: sha256File(file) };
}
