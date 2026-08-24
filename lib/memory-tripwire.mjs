// The observation period, and what ends it.
//
// §8.4 uses the word "canary" and then says exactly what it does not mean by it: this is a
// deterministic tripwire, not a statistical test. There is no traffic to split on a single-user
// machine and no power to detect anything with, so the design is "a newly promoted memory is watched
// for a while, and any one degrade signal retracts it".
//
// The hard part is "for a while", and it was measured before it was chosen. On this repository the
// readable event history is one active day; across that day 24 delivery events covered 17 distinct
// memories, median one delivery per memory, maximum three. The explicit feedback streams are far
// thinner: eight retrieval verdicts in about a month, two weak attribution labels, zero outcome
// receipts. So a wall-clock window would have failed in the one way a guard must not fail -- a
// seven-day period on this machine contains, per memory, approximately no signal at all, and a
// tripwire that cannot fire is decoration with a maintenance cost. That is the `valid_for` mistake
// wearing a different hat.
//
// The period is therefore counted in exposures, with a settle time as a floor:
//
//     open  ==  deliveries_since_promotion < N   OR   elapsed < settle
//
// Both have to be satisfied for the window to close, so it can never be shorter than the settle time
// (a burst of three recalls in one minute must not close a window before a person could react), and
// it can never expire without the memory having actually been on screen N times (which is the part a
// clock cannot promise). A memory that is never recalled again stays under observation forever, and
// that is the safe direction: nothing is being injected, so nothing is at risk while it waits.
//
// One split matters and is easy to get backwards. The window gates the *rollback* -- the automatic
// retraction of a promotion. It does not gate the *quarantine*: §8.4 lists harmful feedback,
// rollback, evidence drift, staleness and risk overreach as things that trigger a local safety
// quarantine outright, with no mention of a period. So a signal arriving after the window closes
// still stops injection if the promotion armed it; it just no longer un-promotes anything on its
// own, because retracting a months-old promotion on one verdict is a review, not a reflex.

import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import {
  EVIDENCE_DRIFT_REASON,
  EVIDENCE_UNVERIFIABLE_REASON,
  TEST_EXECUTION_FAILED_REASON,
} from './memory-evidence-verifier.mjs';
import { loadMemoryTopics } from './memory-schema.mjs';
import { readMemoryTrustLock, resolveMemoryTrust } from './memory-trust-store.mjs';
import { readFeedbackInbox } from './memory-feedback.mjs';
import { readOutcomeReceipts } from './features/outcome.mjs';
import { readAttributionLabels } from './features/attribution.mjs';
import {
  PROMOTION_DEGRADE_SIGNALS,
  createPromotionRollback,
  planPromotionQuota,
} from './memory-promotion-receipt.mjs';
import {
  DEFAULT_QUARANTINE_FILE,
  loadQuarantine,
  recordQuarantine,
} from './memory-quarantine.mjs';

export const TRIPWIRE_RESULT_SCHEMA = 'ownmem-promotion-tripwire/v1';
export const TRIPWIRE_CHANGE_SCHEMA = 'ownmem-promotion-tripwire-change/v1';

/**
 * How many times a promoted memory has to be delivered before the observation period may close.
 *
 * Three, from the measurement above: the busiest memory on the busiest readable day was delivered
 * three times, so three exposures is roughly "one active day of being visible" for a well-matched
 * memory and several days for a typical one. It is deliberately a small number -- the window is a
 * floor on attention, not a sample size, and nothing here computes a rate from it.
 */
export const TRIPWIRE_DEFAULT_OBSERVATIONS = 3;

/**
 * The minimum wall-clock life of an observation period, in hours.
 *
 * Twenty-four, and its job is only to stop a burst from closing a window before anyone could react.
 * Every signal stream that exists here is filed by a person or an agent after seeing a result, and
 * on this machine those arrive within the same working session. A day covers that without being the
 * kind of long clock window the measurement rejected -- it is a floor under the exposure rule, never
 * a substitute for it.
 */
export const TRIPWIRE_DEFAULT_SETTLE_HOURS = 24;

/** The local file the reviewable half of an automatic retraction is written to. */
export const DEFAULT_TRIPWIRE_CHANGE_DIRECTORY = '.local-test/memory-tripwire-changes';

/**
 * Which degrade signal has a producer here, and which does not.
 *
 * Published rather than implied, because an armed guard with no producer is a guard that silently
 * never fires -- the same failure as a metric with no collection surface. A caller can see the null
 * and know the difference between "watched and quiet" and "never watched".
 */
export const TRIPWIRE_SIGNAL_PRODUCERS = Object.freeze({
  'harmful-feedback': 'outcome-receipt',
  'wrong-feedback': 'retrieval-feedback',
  'evidence-drift': 'trust-resolution',
  'evidence-unverifiable': 'trust-resolution',
  'wall-clock-stale': 'trust-resolution',
  'gate-conflict': 'test-execution-ledger',
  'agent-abandoned': 'attribution-label',
  // No producer, and inventing one would mean guessing. The promotion receipt records the hosts and
  // scenarios a promotion was graded for, but nothing in the local event stream records which host a
  // delivery happened on -- `surface` distinguishes the CLI from the hook, not Claude from Codex.
  // A detector built on that would report scope violations it cannot observe.
  'risk-out-of-scope': null,
});

export function tripwireSignalsWithoutProducer() {
  return Object.entries(TRIPWIRE_SIGNAL_PRODUCERS)
    .filter(([, producer]) => producer === null)
    .map(([signal]) => signal);
}

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function isoOf(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : null;
}

// --- exposures -------------------------------------------------------------------------------

/**
 * Every time a memory was actually handed to a reader, deduplicated across the two events that
 * record it.
 *
 * `recall.delivered` and `recall.completed` both name the topics one recall returned, and which of
 * them a surface writes depends on the surface. Counting only one would undercount some hosts;
 * counting both naively would double every CLI recall. They share a trace id, so the pair is the
 * key and the exposure is counted once.
 */
export function memoryDeliveries(events) {
  const seen = new Set();
  const deliveries = [];
  for (const event of events || []) {
    let topics = null;
    if (event.event === 'recall.delivered') topics = event.payload?.topics;
    else if (event.event === 'recall.completed') topics = event.payload?.returned_topics;
    if (!Array.isArray(topics) || topics.length === 0) continue;
    for (const memoryId of topics) {
      const key = `${event.trace_id}\0${memoryId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deliveries.push({ memory_id: memoryId, recorded_at: event.recorded_at, trace_id: event.trace_id });
    }
  }
  return deliveries.sort((left, right) => compareText(left.recorded_at, right.recorded_at));
}

function deliveriesFor(deliveries, memoryId) {
  return deliveries.filter(delivery => delivery.memory_id === memoryId).map(delivery => isoOf(delivery.recorded_at)).filter(value => value !== null);
}

// --- observation windows ---------------------------------------------------------------------

/**
 * One observation period per promotion chain.
 *
 * The chain's last `promote` receipt opens it, and a `rollback` after that closes it -- a promotion
 * that has already been retracted has nothing left to watch for.
 */
export function promotionObservationWindows({
  ledger,
  deliveries = [],
  now = new Date(),
  observationsRequired = TRIPWIRE_DEFAULT_OBSERVATIONS,
  settleHours = TRIPWIRE_DEFAULT_SETTLE_HOURS,
} = {}) {
  const windows = [];
  for (const [promotionId, receipts] of Object.entries(ledger?.promotions || {})) {
    let promoted = null;
    let rolledBackAt = null;
    for (const receipt of receipts) {
      if (receipt.operation === 'promote') {
        promoted = receipt;
        rolledBackAt = null;
      } else if (receipt.operation === 'rollback' && promoted) {
        rolledBackAt = receipt.issued_at;
      }
    }
    if (!promoted) continue;
    const openedAt = isoOf(promoted.issued_at);
    if (openedAt === null) continue;
    const exposures = deliveriesFor(deliveries, promoted.candidate.memory_id);
    const window = {
      promotion_id: promotionId,
      memory_id: promoted.candidate.memory_id,
      receipt_id: promoted.receipt_id,
      opened_at: promoted.issued_at,
      observations_required: observationsRequired,
      settle_hours: settleHours,
      // Counted from the promotion forward. Deliveries before it were of a different version.
      observations: exposures.filter(time => time >= openedAt).length,
      settles_at: new Date(openedAt + settleHours * 3_600_000).toISOString(),
      rolled_back_at: rolledBackAt,
      guards: promoted.guards,
      target_lifecycle: promoted.change.target_lifecycle,
    };
    window.open = observationWindowOpenAt(window, exposures, now);
    window.closed_reason = window.open
      ? null
      : rolledBackAt ? 'rolled-back' : 'observed';
    windows.push(window);
  }
  return windows.sort((left, right) => compareText(left.promotion_id, right.promotion_id));
}

/**
 * Whether a window was still open at a given instant.
 *
 * Both conditions have to be satisfied for it to be closed, which is what makes it impossible for
 * the period to be vacuous in either direction: a quiet machine cannot let the clock run it out
 * unobserved, and a busy minute cannot exhaust it before anyone has looked.
 */
export function observationWindowOpenAt(window, exposures, at) {
  const atMs = at instanceof Date ? at.getTime() : isoOf(at);
  const openedAt = isoOf(window.opened_at);
  if (atMs === null || openedAt === null) return false;
  const rolledBack = isoOf(window.rolled_back_at);
  if (rolledBack !== null && atMs >= rolledBack) return false;
  const observed = exposures.filter(time => time >= openedAt && time <= atMs).length;
  const elapsed = atMs - openedAt;
  return observed < window.observations_required || elapsed < window.settle_hours * 3_600_000;
}

// --- degrade signals -------------------------------------------------------------------------

function signal({ name, memoryId, recordedAt, source, detail }) {
  return {
    signal: name,
    memory_id: memoryId,
    recorded_at: recordedAt,
    source,
    // A short machine token, never the observed content: feedback queries, confirmation statements
    // and command output stay out of this file exactly as they stay out of the ledgers they come
    // from. `detail` is a reason name or an anchor locator, nothing else.
    detail: detail === null || detail === undefined ? null : String(detail).slice(0, 120),
  };
}

/**
 * Degrade signals that come from the three feedback streams.
 *
 * Each is read through its own reader, so the streams stay separated here exactly as they are on
 * disk: a retrieval verdict, an outcome receipt and a weak turn-end label are three different
 * claims, and this function turns each into its own signal rather than pooling them into a count.
 */
export function collectLedgerTripwireSignals({
  feedbackFile = null,
  outcomeFile = null,
  attributionFile = null,
} = {}) {
  const signals = [];
  const errors = [];
  if (feedbackFile && existsSync(feedbackFile)) {
    const inbox = readFeedbackInbox(feedbackFile);
    errors.push(...inbox.errors.map(message => `retrieval feedback: ${message}`));
    for (const entry of inbox.entries) {
      if (entry.verdict !== 'wrong') continue;
      // `wrong` says "these were not it", so the memories it indicts are the ones that came back.
      // `expected` names what should have come back instead and is never a degrade signal about
      // itself -- reading it as one would penalise the memory the reporter was asking for.
      for (const memoryId of entry.returned || []) {
        signals.push(signal({
          name: 'wrong-feedback',
          memoryId,
          recordedAt: entry.recordedAt || entry.recorded_at,
          source: `retrieval-feedback#L${entry.line ?? '?'}`,
          detail: 'wrong',
        }));
      }
    }
  }
  if (outcomeFile && existsSync(outcomeFile)) {
    const inbox = readOutcomeReceipts(outcomeFile);
    errors.push(...inbox.errors.map(message => `outcome receipts: ${message}`));
    for (const entry of inbox.entries) {
      if (entry.outcome !== 'harmful') continue;
      signals.push(signal({
        name: 'harmful-feedback',
        memoryId: entry.memory_id,
        recordedAt: entry.recorded_at,
        source: `outcome-receipt#L${entry.line ?? '?'}`,
        detail: entry.confirmed_by,
      }));
    }
  }
  if (attributionFile && existsSync(attributionFile)) {
    const inbox = readAttributionLabels(attributionFile);
    errors.push(...inbox.errors.map(message => `attribution labels: ${message}`));
    for (const entry of inbox.entries) {
      if (entry.label !== 'misleading') continue;
      signals.push(signal({
        name: 'agent-abandoned',
        memoryId: entry.memory_id,
        recordedAt: entry.recorded_at,
        source: `attribution-label#L${entry.line ?? '?'}`,
        detail: 'misleading',
      }));
    }
  }
  return { signals: signals.filter(item => item.memory_id && item.recorded_at), errors };
}

/**
 * Degrade signals that come from re-verifying the memory itself.
 *
 * This is the use-time revalidation the trust resolver already performs, asked as a question about
 * a named set of memories instead of about a query. Nothing is re-implemented: the reasons it
 * returns are mapped onto the guard vocabulary and the original reason travels along as `detail`,
 * so a reader is never left with a category where the resolver gave a specific answer.
 *
 * `content-drift` maps to `evidence-unverifiable` because that is what it is at this layer: the
 * receipt's hash no longer matches the body, so nothing the receipt vouches for can be verified
 * against the memory as it now stands. The exact reason is on the signal, so the two remain
 * distinguishable to anyone reading the row.
 */
export function collectTrustTripwireSignals({
  root,
  memoryDir = '.ownmem',
  memoryIds = [],
  now = new Date(),
  observedAt = null,
} = {}) {
  const wanted = new Set(memoryIds);
  if (wanted.size === 0) return { signals: [], errors: [] };
  const errors = [];
  const signals = [];
  let topics = [];
  let lock = null;
  try {
    topics = loadMemoryTopics({ root, memoryDir }).filter(topic => wanted.has(topic.record.name));
    lock = readMemoryTrustLock({ root, memoryDir, required: false }).lock;
  } catch (error) {
    return { signals: [], errors: [`trust resolution: ${error.message}`] };
  }
  const stamp = observedAt || now.toISOString();
  for (const topic of topics) {
    const document = {
      id: topic.record.name,
      source_sha256: createHash('sha256').update(topic.content, 'utf8').digest('hex'),
      source_content: topic.content,
      metadata: { last_verified: topic.record.metadata.last_verified },
    };
    let trust;
    try {
      trust = resolveMemoryTrust({
        root,
        memoryDir,
        document,
        trustLock: lock,
        now,
        // Same reasoning as the trust audit: applicability needs a query context, and this is not a
        // query. Evaluating it here against blank values would report every platform-scoped receipt
        // as out of scope on every machine.
        evaluateApplicability: false,
      });
    } catch (error) {
      errors.push(`trust resolution for ${topic.record.name}: ${error.message}`);
      continue;
    }
    const emit = (name, detail) => signals.push(signal({
      name,
      memoryId: topic.record.name,
      recordedAt: stamp,
      source: 'trust-resolution',
      detail,
    }));
    if (trust.reasons.includes(EVIDENCE_UNVERIFIABLE_REASON)) emit('evidence-unverifiable', EVIDENCE_UNVERIFIABLE_REASON);
    if (trust.reasons.includes('content-drift')) emit('evidence-unverifiable', 'content-drift');
    if (trust.reasons.includes('wall-clock-stale')) emit('wall-clock-stale', 'wall-clock-stale');
    if ((trust.advisory_reasons || []).includes(EVIDENCE_DRIFT_REASON)) emit('evidence-drift', EVIDENCE_DRIFT_REASON);
    // The one gate conflict with a per-memory binding. A memory names a test in its evidence, the
    // execution ledger says that test's last observed run was red, and those two statements
    // contradict each other about the same file. The repository's other gate signal -- a failed
    // `gate.completed` event -- is deliberately not wired: it carries no memory id, and Phase 4
    // measured every recovery it produced as having an empty `recalled_topics`, so binding it to a
    // memory would be a guess presented as a conflict.
    if ((trust.advisory_reasons || []).includes(TEST_EXECUTION_FAILED_REASON)) emit('gate-conflict', TEST_EXECUTION_FAILED_REASON);
  }
  return { signals, errors };
}

// --- evaluation ------------------------------------------------------------------------------

function armedAction(guards, name) {
  const quarantine = (guards?.quarantine_on || []).includes(name);
  const rollback = (guards?.rollback_on || []).includes(name);
  return { quarantine: quarantine || rollback, rollback };
}

/**
 * Match signals against open windows and say what each one earns.
 *
 * Nothing is written here. The result is a value a caller can print, diff or apply, and keeping the
 * decision separate from the act is what makes the dry run of the command the same computation as
 * the real one rather than an approximation of it.
 */
export function evaluatePromotionTripwire({
  windows = [],
  signals = [],
  deliveries = [],
  now = new Date(),
} = {}) {
  const hits = [];
  for (const window of windows) {
    const exposures = deliveriesFor(deliveries, window.memory_id);
    const openedAt = isoOf(window.opened_at);
    for (const item of signals) {
      if (item.memory_id !== window.memory_id) continue;
      const at = isoOf(item.recorded_at);
      // A signal recorded before the promotion is about the memory the promotion replaced.
      if (at === null || openedAt === null || at < openedAt) continue;
      if (!PROMOTION_DEGRADE_SIGNALS.includes(item.signal)) continue;
      const inWindow = observationWindowOpenAt(window, exposures, new Date(at));
      const armed = armedAction(window.guards, item.signal);
      const action = armed.rollback && inWindow ? 'rollback' : armed.quarantine ? 'quarantine' : 'none';
      hits.push({
        promotion_id: window.promotion_id,
        memory_id: window.memory_id,
        receipt_id: window.receipt_id,
        signal: item.signal,
        recorded_at: item.recorded_at,
        source: item.source,
        detail: item.detail,
        in_window: inWindow,
        armed_quarantine: armed.quarantine,
        armed_rollback: armed.rollback,
        action,
        // Why an armed rollback did not fire. Stated rather than left to be inferred from two
        // booleans, because "the guard is armed and nothing happened" is the sentence a reader of
        // this output most needs explained.
        withheld_reason: armed.rollback && !inWindow
          ? 'outside-observation-window'
          : !armed.quarantine ? 'signal-not-armed-by-this-promotion' : null,
      });
    }
  }
  hits.sort((left, right) => compareText(left.recorded_at, right.recorded_at)
    || compareText(left.promotion_id, right.promotion_id)
    || compareText(left.signal, right.signal));
  return {
    schema: TRIPWIRE_RESULT_SCHEMA,
    observed_at: now.toISOString(),
    windows,
    // Counted separately from `windows.length` so "nothing is under observation" and "everything
    // under observation is quiet" are never printed as the same sentence.
    open_windows: windows.filter(window => window.open).length,
    hits,
    quarantines: hits.filter(hit => hit.action === 'quarantine' || hit.action === 'rollback').length,
    rollbacks: hits.filter(hit => hit.action === 'rollback').length,
    signals_without_producer: tripwireSignalsWithoutProducer(),
  };
}

// --- application -----------------------------------------------------------------------------

function changeFile(root, directory, promotionId) {
  return path.resolve(root, directory, `${promotionId}.json`);
}

/**
 * Carry out what the evaluation decided, in the two layers §8.4 keeps apart.
 *
 * The runtime layer -- appending a quarantine row -- is done here when `apply` is set. The
 * persistent layer is written out as a proposal and never applied: the file it produces is marked
 * `requires_review` and `auto_apply: false`, and nothing in this module can put it into effect.
 *
 * `apply: false` performs the same computation and writes nothing at all, which is what makes the
 * preview trustworthy.
 */
export function applyPromotionTripwire({
  root,
  memoryDir = '.ownmem',
  quarantineFile = DEFAULT_QUARANTINE_FILE,
  changeDirectory = DEFAULT_TRIPWIRE_CHANGE_DIRECTORY,
  ledger,
  evaluation,
  verifier = { kind: 'machine', id: 'ownmem-tripwire' },
  apply = false,
  now = new Date(),
} = {}) {
  const already = loadQuarantine({ root, file: quarantineFile }).ids;
  const quarantined = [];
  const rollbacks = [];
  const skipped = [];
  const rollbackProposed = new Set();
  const receiptsById = new Map();
  for (const receipts of Object.values(ledger?.promotions || {})) {
    for (const receipt of receipts) receiptsById.set(receipt.receipt_id, receipt);
  }
  for (const hit of evaluation.hits) {
    if (hit.action === 'none') continue;
    const wasAlreadyQuarantined = already.has(hit.memory_id);
    if (wasAlreadyQuarantined) {
      skipped.push({ ...hit, skipped: 'already-quarantined' });
    } else {
      quarantined.push(hit);
      if (apply) {
        recordQuarantine({
          root,
          file: quarantineFile,
          memoryId: hit.memory_id,
          signal: hit.signal,
          promotionId: hit.promotion_id,
          receiptId: hit.receipt_id,
          source: hit.source,
          reason: `tripwire ${hit.action} on ${hit.signal}`,
          now,
        });
        already.add(hit.memory_id);
      }
    }
    if (hit.action !== 'rollback') continue;
    if (rollbackProposed.has(hit.promotion_id)) {
      skipped.push({ ...hit, skipped: 'rollback-already-proposed' });
      continue;
    }
    rollbackProposed.add(hit.promotion_id);
    const promoted = receiptsById.get(hit.receipt_id);
    if (!promoted) {
      skipped.push({ ...hit, skipped: 'promotion-receipt-not-in-ledger' });
      continue;
    }
    let undone;
    try {
      undone = createPromotionRollback({
        receipt: promoted,
        issued_at: now.toISOString(),
        verifier,
        // Entries are empty on purpose: a restore recovers bytes the repository already had from
        // the commit the promotion recorded, and this module never holds those bytes, so measuring
        // them here would mean guessing a size. The quota is settled again by whoever applies the
        // reviewable change, against real content.
        quota: planPromotionQuota({ root, memoryDir, promotion_id: hit.promotion_id }),
        reason: `observation-period tripwire: ${hit.signal}`,
      });
    } catch (error) {
      skipped.push({ ...hit, skipped: `rollback-refused: ${error.message}` });
      continue;
    }
    const change = {
      schema: TRIPWIRE_CHANGE_SCHEMA,
      proposed_at: now.toISOString(),
      promotion_id: hit.promotion_id,
      memory_id: hit.memory_id,
      signal: hit.signal,
      requires_review: true,
      auto_apply: false,
      rollback_receipt: undone.receipt,
      runtime: undone.runtime,
      operations: undone.change.operations,
    };
    rollbacks.push(change);
    if (apply) {
      const file = changeFile(root, changeDirectory, hit.promotion_id);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(change, null, 2)}\n`, 'utf8');
    }
  }
  return {
    applied: Boolean(apply),
    quarantined,
    rollbacks,
    skipped,
    // The persistent half never lands from here. Stated in the result so a caller printing it says
    // so out loud rather than leaving the reader to assume the rollback took effect.
    persistent_changes_applied: false,
  };
}
