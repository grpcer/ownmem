// Runtime safety quarantine: a local switch that stops one memory being injected, and nothing else.
//
// §8.4 of the plan asks for two layers when a promoted memory turns out to be wrong, and the reason
// there are two rather than one is a property that disappears the moment they are collapsed:
//
//   * The runtime layer is immediate and local. Stop injecting now, leave a row saying why.
//   * The persistent layer -- demoting the memory, retracting the promotion -- is a change somebody
//     reviews. A system that edits shared Git history to undo its own mistakes turns that history
//     into something no later reader can use as evidence, because every version of it is a version
//     the system might have rewritten.
//
// So this module writes exactly one thing: an append-only JSON Lines ledger under the ignored local
// directory. It never opens a memory file, never touches trust.lock.json, and never shells out. The
// self-test asserts that by comparing the bytes of the memory directory across a quarantine, because
// a comment saying "this does not write to Git" is worth nothing the first time somebody adds "and
// also mark the frontmatter".
//
// Two asymmetries are deliberate:
//
//   1. The system may quarantine itself and may not release itself. `release` requires a `user` or
//      `host` confirmer for the same reason an outcome receipt does: quarantining is a safety
//      reflex and costs a recall, releasing is a judgement that the thing is safe again.
//   2. A ledger this file cannot read yields an empty quarantine set rather than an error, for the
//      recall path only. Failing closed here would let a corrupt local telemetry file take recall
//      down, which the plan rules out explicitly; the tripwire command reads the same file through
//      readQuarantineLedger and refuses loudly instead.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PROMOTION_DEGRADE_SIGNALS } from './memory-promotion-receipt.mjs';

export const QUARANTINE_LEDGER_SCHEMA = 'ownmem-runtime-quarantine/v1';
export const DEFAULT_QUARANTINE_FILE = '.local-test/memory-quarantine.jsonl';

/** What a row can say. Closed, because a third verb would need a third answer in every reader. */
export const QUARANTINE_ACTIONS = Object.freeze(['quarantine', 'release']);

/** Who may lift a quarantine. `self` is absent on purpose; see the asymmetry note above. */
export const QUARANTINE_RELEASERS = Object.freeze(['user', 'host']);

/**
 * The reason a quarantined memory carries through the trust resolver.
 *
 * One string, exported, because the runtime publishes it as a verdict reason and the self-test has
 * to be able to look for the same token the production path emits rather than a copy of it.
 */
export const RUNTIME_QUARANTINE_REASON = 'runtime-quarantine';

const TOPIC_NAME = /^[a-z0-9]+(?:_[a-z0-9]+)*$/u;
const MAX_REASON_LENGTH = 200;

export function quarantineFilePath({ root, file = DEFAULT_QUARANTINE_FILE } = {}) {
  return path.isAbsolute(file) ? file : path.resolve(root, file);
}

function assertMember(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label} must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`);
  }
}

/**
 * Read the ledger and say what is wrong with it rather than repairing it.
 *
 * Per-line, so one corrupt row does not discard the rows around it -- this file is appended to by a
 * process that may be killed mid-write, and losing every earlier quarantine because the last line is
 * half-written is the failure this shape exists to avoid.
 */
export function readQuarantineLedger(file) {
  if (!existsSync(file)) return { file, entries: [], errors: [] };
  const entries = [];
  const errors = [];
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return { file, entries: [], errors: [`quarantine ledger is unreadable: ${error.message}`] };
  }
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      errors.push(`line ${index + 1}: invalid JSON: ${error.message}`);
      continue;
    }
    if (entry.schema !== QUARANTINE_LEDGER_SCHEMA) {
      errors.push(`line ${index + 1}: unsupported schema ${entry.schema || '(missing)'}; this file holds ${QUARANTINE_LEDGER_SCHEMA} rows only`);
      continue;
    }
    if (!QUARANTINE_ACTIONS.includes(entry.action)) {
      errors.push(`line ${index + 1}: action must be one of ${QUARANTINE_ACTIONS.join(', ')}`);
      continue;
    }
    if (!TOPIC_NAME.test(entry.memory_id || '')) {
      errors.push(`line ${index + 1}: a quarantine row must name a memory`);
      continue;
    }
    if (!Number.isFinite(Date.parse(entry.recorded_at || ''))) {
      errors.push(`line ${index + 1}: recorded_at must be an ISO timestamp`);
      continue;
    }
    if (entry.action === 'release' && !QUARANTINE_RELEASERS.includes(entry.released_by)) {
      errors.push(`line ${index + 1}: a release must be confirmed by ${QUARANTINE_RELEASERS.join(' or ')}; the system does not lift its own quarantine`);
      continue;
    }
    entries.push({ ...entry, line: index + 1 });
  }
  return { file, entries, errors };
}

/**
 * The current state per memory: the last row wins.
 *
 * Append-only with last-write-wins rather than mutation, so the history of a memory that was
 * quarantined, released and quarantined again is all still there to read.
 */
export function quarantineState(entries) {
  const state = new Map();
  for (const entry of entries) state.set(entry.memory_id, entry);
  return state;
}

export function quarantinedMemoryIds(entries) {
  const ids = new Set();
  for (const [memoryId, entry] of quarantineState(entries)) {
    if (entry.action === 'quarantine') ids.add(memoryId);
  }
  return ids;
}

/**
 * What the recall path calls. Never throws, never repairs, and reports what it could not read so
 * that a degraded quarantine is visible in the envelope instead of being silently absent.
 */
export function loadQuarantine({ root, file = DEFAULT_QUARANTINE_FILE } = {}) {
  const absolute = quarantineFilePath({ root, file });
  try {
    const ledger = readQuarantineLedger(absolute);
    return {
      file: absolute,
      ids: quarantinedMemoryIds(ledger.entries),
      entries: ledger.entries,
      errors: ledger.errors,
    };
  } catch (error) {
    // Defensive: readQuarantineLedger is written not to throw, and if a future edit makes it throw
    // the consequence must still be "recall answers" rather than "recall stops".
    return { file: absolute, ids: new Set(), entries: [], errors: [String(error?.message || error)] };
  }
}

function appendRow(absolute, row) {
  mkdirSync(path.dirname(absolute), { recursive: true });
  appendFileSync(absolute, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 });
  return row;
}

/**
 * Stop injecting one memory, now, on this machine.
 *
 * `signal` is the tripwire vocabulary rather than free text, so a row can be counted and so nobody
 * can record a reason the guard lists could never have armed. `reason` is the one readable field and
 * it is bounded; it never reaches any digest and never leaves this file.
 */
export function recordQuarantine({
  root,
  file = DEFAULT_QUARANTINE_FILE,
  memoryId,
  signal,
  promotionId = null,
  receiptId = null,
  source = null,
  reason = '',
  now = new Date(),
} = {}) {
  if (!TOPIC_NAME.test(memoryId || '')) throw new Error(`quarantine requires a memory name, got ${JSON.stringify(memoryId)}`);
  assertMember(signal, [...PROMOTION_DEGRADE_SIGNALS], 'quarantine signal');
  if (String(reason || '').length > MAX_REASON_LENGTH) {
    throw new Error(`quarantine reason must be at most ${MAX_REASON_LENGTH} characters`);
  }
  const absolute = quarantineFilePath({ root, file });
  return {
    file: absolute,
    entry: appendRow(absolute, {
      schema: QUARANTINE_LEDGER_SCHEMA,
      recorded_at: now.toISOString(),
      action: 'quarantine',
      memory_id: memoryId,
      signal,
      promotion_id: promotionId,
      receipt_id: receiptId,
      // Where the signal was observed: a ledger name and a line, never the observed content.
      source: source === null ? null : String(source).slice(0, 200),
      reason: String(reason || '').slice(0, MAX_REASON_LENGTH),
    }),
  };
}

/**
 * Lift a quarantine.
 *
 * Deliberately not automatic, and deliberately not something a rollback does on its way past: a
 * rollback restores content, which is not the same claim as "the thing that fired the tripwire has
 * been understood". Leaving the memory quarantined after a rollback costs one explicit command and
 * is the direction that fails safe.
 */
export function releaseQuarantine({
  root,
  file = DEFAULT_QUARANTINE_FILE,
  memoryId,
  releasedBy,
  reason = '',
  now = new Date(),
} = {}) {
  if (!TOPIC_NAME.test(memoryId || '')) throw new Error(`release requires a memory name, got ${JSON.stringify(memoryId)}`);
  assertMember(releasedBy, [...QUARANTINE_RELEASERS], 'quarantine releaser');
  if (String(reason || '').length > MAX_REASON_LENGTH) {
    throw new Error(`release reason must be at most ${MAX_REASON_LENGTH} characters`);
  }
  const absolute = quarantineFilePath({ root, file });
  return {
    file: absolute,
    entry: appendRow(absolute, {
      schema: QUARANTINE_LEDGER_SCHEMA,
      recorded_at: now.toISOString(),
      action: 'release',
      memory_id: memoryId,
      released_by: releasedBy,
      reason: String(reason || '').slice(0, MAX_REASON_LENGTH),
    }),
  };
}
