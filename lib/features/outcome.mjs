#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import { MemoryRecallLedger } from '../memory-recall-ledger.mjs';
import {
  DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  recordMemoryOutcome,
} from '../memory-observability.mjs';

/**
 * Stream 2 of three: the outcome receipt.
 *
 * Retrieval feedback answers "did recall return the right thing" and a full-text open proves only
 * that a body was read. Neither answers "was this memory actually applied, and did it help". This
 * file is the only surface that may answer that, and it is deliberately expensive to write: the
 * answer has to come from a user or from the host, it has to be anchored to the exact recall that
 * delivered the memory, and it has to carry a digest of the confirming statement.
 *
 * `self` is not an accepted confirmer. An agent's own read on a memory is a weak label and belongs
 * to `ownmem attribute`; letting it in here would make the one honest measure of actual application
 * self-graded, which is the failure this whole split exists to prevent.
 *
 * Privacy is a hard rule, not a default: no prompt, no confirming sentence, and no file body is
 * ever written. The confirmation is hashed the moment it arrives. An optional note is stored only
 * when the caller passes one explicitly -- nothing here reaches into the conversation to collect it.
 */

export const OUTCOME_RECEIPT_SCHEMA = 'ownmem-outcome-receipt/v1';
export const DEFAULT_OUTCOME_FILE = '.local-test/memory-outcome-receipts.jsonl';
export const OUTCOMES = ['applied', 'helpful_but_not_used', 'harmful'];
export const OUTCOME_CONFIRMERS = ['user', 'host'];
export const MAX_OUTCOME_NOTE_LENGTH = 200;

const TOPIC_NAME_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const SELF_CONFIRMER_REJECTION = 'confirmed_by must be user or host: an outcome receipt is the only evidence of actual application, so an agent grading its own recall does not qualify. Record that as a weak label with `ownmem attribute --label useful|misleading`.';

function takeValue(args, index, option) {
  const value = args[index + 1];
  if (value === undefined) throw new Error(`${option} requires a value`);
  return value;
}

export function parseOutcomeOptions(rawArgs = []) {
  const options = {
    root: process.env.OWNMEM_ROOT || process.cwd(),
    observabilityDirectory: DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
    receiptFile: null,
    memoryId: null,
    outcome: null,
    confirmedBy: null,
    confirmation: null,
    note: null,
    sessionId: null,
    json: false,
    observability: true,
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];
    if (argument === '--json') options.json = true;
    else if (argument === '--no-observability') options.observability = false;
    else if (argument.startsWith('--')) {
      const value = takeValue(rawArgs, index, argument);
      index += 1;
      if (argument === '--root') options.root = path.resolve(value);
      else if (argument === '--observability-dir') options.observabilityDirectory = value;
      else if (argument === '--receipt-file') options.receiptFile = value;
      else if (argument === '--memory') options.memoryId = value;
      else if (argument === '--outcome') options.outcome = value;
      else if (argument === '--confirmed-by') options.confirmedBy = value;
      else if (argument === '--confirmation') options.confirmation = value;
      else if (argument === '--note') options.note = value;
      else if (argument === '--session') options.sessionId = value;
      else throw new Error(`unknown option: ${argument}`);
    } else throw new Error(`unexpected argument: ${argument}`);
  }

  if (!options.memoryId) throw new Error('--memory <memory-name> is required');
  if (!TOPIC_NAME_PATTERN.test(options.memoryId)) {
    throw new Error(`--memory must be a memory name in lower_snake_case, got ${options.memoryId}`);
  }
  if (!OUTCOMES.includes(options.outcome)) {
    throw new Error(`--outcome must be one of ${OUTCOMES.join(', ')}`);
  }
  if (options.confirmedBy === 'self') throw new Error(SELF_CONFIRMER_REJECTION);
  if (!OUTCOME_CONFIRMERS.includes(options.confirmedBy)) {
    throw new Error(`--confirmed-by must be one of ${OUTCOME_CONFIRMERS.join(', ')}`);
  }
  if (typeof options.confirmation !== 'string' || !options.confirmation.trim()) {
    throw new Error('--confirmation <statement> is required: the receipt stores only its SHA-256, and without one nothing binds this outcome to something a person or the host actually said');
  }
  if (options.note !== null) {
    if (!options.note.trim()) throw new Error('--note must not be blank when supplied');
    if (options.note.length > MAX_OUTCOME_NOTE_LENGTH) {
      throw new Error(`--note must be at most ${MAX_OUTCOME_NOTE_LENGTH} characters, got ${options.note.length}`);
    }
  }
  return options;
}

/**
 * Write one receipt. Refuses when the ledger cannot say which recall delivered the memory: an
 * unanchored receipt would have to invent a trace, and a trace that does not name the recall it is
 * about corrupts every funnel downstream more quietly than a missing row ever could.
 */
export function recordOutcomeReceipt({
  root,
  file,
  memoryId,
  outcome,
  confirmedBy,
  confirmation,
  note = null,
  sessionId = null,
  ledger,
  now = new Date(),
}) {
  if (confirmedBy !== 'user' && confirmedBy !== 'host') throw new Error(SELF_CONFIRMER_REJECTION);
  if (!OUTCOMES.includes(outcome)) throw new Error(`outcome must be one of ${OUTCOMES.join(', ')}`);
  if (typeof confirmation !== 'string' || !confirmation.trim()) {
    throw new Error('an outcome receipt requires the confirming statement so it can be hashed');
  }
  if (note !== null && String(note).length > MAX_OUTCOME_NOTE_LENGTH) {
    throw new Error(`note must be at most ${MAX_OUTCOME_NOTE_LENGTH} characters`);
  }
  const paired = ledger.pair({ sessionId, memoryId, now });
  if (!paired) {
    throw new Error(`no recall in the local ledger delivered ${memoryId} within the pairing window, so this outcome cannot be anchored to a trace. Run the recall again and record the receipt in the same session rather than attaching the outcome to a guessed trace.`);
  }
  const entry = {
    schema: OUTCOME_RECEIPT_SCHEMA,
    recorded_at: now.toISOString(),
    trace_id: paired.traceId,
    snapshot_id: paired.snapshotId,
    memory_id: memoryId,
    outcome,
    confirmed_by: confirmedBy,
    // The statement itself is never written anywhere. The digest is enough to prove two receipts
    // cite the same confirmation and to detect a receipt fabricated after the fact.
    confirmation_sha256: createHash('sha256').update(confirmation, 'utf8').digest('hex'),
    pairing: paired.match,
    note: note === null ? null : String(note),
  };
  const absoluteFile = path.resolve(file);
  mkdirSync(path.dirname(absoluteFile), { recursive: true });
  appendFileSync(absoluteFile, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { file: absoluteFile, entry, pairing: paired };
}

export function readOutcomeReceipts(file) {
  if (!existsSync(file)) return { file, entries: [], errors: [] };
  const entries = [];
  const errors = [];
  for (const [index, line] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      errors.push(`line ${index + 1}: invalid JSON: ${error.message}`);
      continue;
    }
    if (entry.schema !== OUTCOME_RECEIPT_SCHEMA) {
      errors.push(`line ${index + 1}: unsupported schema ${entry.schema || '(missing)'}; this file holds ${OUTCOME_RECEIPT_SCHEMA} rows only and never retrieval verdicts or self-attribution labels`);
      continue;
    }
    if (!OUTCOMES.includes(entry.outcome)) {
      errors.push(`line ${index + 1}: invalid outcome ${entry.outcome || '(missing)'}`);
      continue;
    }
    if (!OUTCOME_CONFIRMERS.includes(entry.confirmed_by)) {
      errors.push(`line ${index + 1}: ${SELF_CONFIRMER_REJECTION}`);
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(entry.confirmation_sha256 || '')) {
      errors.push(`line ${index + 1}: confirmation_sha256 must be a SHA-256 digest`);
      continue;
    }
    if (!entry.trace_id || !TOPIC_NAME_PATTERN.test(entry.memory_id || '')) {
      errors.push(`line ${index + 1}: an outcome receipt must name a memory and the trace that delivered it`);
      continue;
    }
    if (entry.note !== null && entry.note !== undefined && String(entry.note).length > MAX_OUTCOME_NOTE_LENGTH) {
      errors.push(`line ${index + 1}: note must be at most ${MAX_OUTCOME_NOTE_LENGTH} characters`);
      continue;
    }
    entries.push({ ...entry, line: index + 1 });
  }
  return { file, entries, errors };
}

/**
 * Counts only, and never a rate. Until receipts accumulate, the denominator for "how often does a
 * recalled memory actually get applied" does not exist, and a percentage computed from a handful of
 * receipts would read like a measurement of the corpus rather than of the receipts.
 */
export function summarizeOutcomeReceipts(inbox) {
  const outcomes = Object.fromEntries(OUTCOMES.map(outcome => [outcome, 0]));
  const confirmers = Object.fromEntries(OUTCOME_CONFIRMERS.map(confirmer => [confirmer, 0]));
  for (const entry of inbox.entries) {
    outcomes[entry.outcome] += 1;
    confirmers[entry.confirmed_by] += 1;
  }
  return {
    total: inbox.entries.length,
    outcomes,
    confirmed_by: confirmers,
    invalid: inbox.errors.length,
  };
}

function usage() {
  return `Usage: ownmem outcome --memory NAME --outcome OUTCOME --confirmed-by user|host --confirmation TEXT

Records what happened after a memory was used. This is the only stream allowed to speak about
actual application; a retrieval verdict (\`ownmem recall --feedback\`) and a full-text open say
nothing about it.

Options:
  --memory NAME          the memory the outcome is about
  --outcome OUTCOME      applied, helpful_but_not_used or harmful
  --confirmed-by WHO     user or host. \`self\` is refused: use \`ownmem attribute\` for that
  --confirmation TEXT    the confirming statement. Only its SHA-256 is stored, never the text
  --note TEXT            optional, at most ${MAX_OUTCOME_NOTE_LENGTH} characters, supplied explicitly
  --session ID           host session id, for the strongest pairing to the delivering recall
  --receipt-file PATH    default ${DEFAULT_OUTCOME_FILE}
  --observability-dir D  local run-event directory (default ${DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY})
  --no-observability     write the receipt but skip the local run event
  --json                 emit the recorded receipt

Example:
  ownmem outcome --memory feedback_no_stash --outcome applied --confirmed-by user \\
    --confirmation 'yes, that fixed it'`;
}

export function runCli(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const options = parseOutcomeOptions(args);
  const ledger = new MemoryRecallLedger({
    root: options.root,
    directory: options.observabilityDirectory,
  });
  const recorded = recordOutcomeReceipt({
    root: options.root,
    file: options.receiptFile
      ? path.resolve(options.root, options.receiptFile)
      : path.join(options.root, DEFAULT_OUTCOME_FILE),
    memoryId: options.memoryId,
    outcome: options.outcome,
    confirmedBy: options.confirmedBy,
    confirmation: options.confirmation,
    note: options.note,
    sessionId: options.sessionId,
    ledger,
  });
  const warnings = [];
  if (options.observability) {
    const { write } = recordMemoryOutcome({
      root: options.root,
      directory: options.observabilityDirectory,
      traceId: recorded.entry.trace_id,
      snapshotId: recorded.entry.snapshot_id,
      memoryId: recorded.entry.memory_id,
      outcome: recorded.entry.outcome,
      confirmedBy: recorded.entry.confirmed_by,
      confirmationSha256: recorded.entry.confirmation_sha256,
      pairing: recorded.entry.pairing,
      notePresent: recorded.entry.note !== null,
    });
    if (!write.written) warnings.push(write.error);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(recorded.entry, null, 2)}\n`);
  } else {
    process.stdout.write(`Outcome receipt recorded: ${recorded.entry.memory_id} -> ${recorded.entry.outcome} (confirmed by ${recorded.entry.confirmed_by}, ${recorded.entry.pairing} pairing to trace ${recorded.entry.trace_id}).\n`);
    process.stdout.write(`Written to ${path.relative(options.root, recorded.file)}.\n`);
  }
  if (warnings.length > 0) {
    process.stderr.write(`ownmem-outcome: local observability skipped: ${[...new Set(warnings)].join('; ')}\n`);
  }
  return 0;
}

if (isMemoryCliEntry(import.meta.url)) {
  Promise.resolve().then(() => runCli()).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`ownmem-outcome: ${error.message}\n`);
    process.exitCode = 1;
  });
}
