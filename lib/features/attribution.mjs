#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import { MemoryRecallLedger } from '../memory-recall-ledger.mjs';
import {
  DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  recordMemoryAttribution,
} from '../memory-observability.mjs';

/**
 * Stream 3 of three: the weak, turn-scoped self-attribution label.
 *
 * Explicit retrieval feedback arrives at roughly two rows a month in this repository, so any gate
 * whose denominator is explicit feedback starves. This stream exists to produce a signal at the
 * rate work actually happens -- and it pays for that volume with a permanent limitation.
 *
 * The label is self-reported and self-selected. It is recorded only when a memory clearly helped or
 * clearly misled; a turn where memory was injected and nothing stood out produces no row at all.
 * That makes the unlabelled turns *unknown*, not neutral, and it means no rate may ever be computed
 * from this file: not a usefulness rate, not an error rate, not a numerator or denominator of any
 * gate. Counts, alongside the number of deliveries they correspond to, are the whole of what it can
 * honestly say.
 *
 * The scope is the turn, not the session. The host fires its stop hook after every assistant turn,
 * and by the time a session actually ends the model can no longer respond -- so "at the end of the
 * session, ask the agent what helped" is not a position that exists here. Turn scope is also the
 * better measurement: the memory was injected during this turn, so the judgment is made while the
 * evidence is still fresh, and one session can produce several labels instead of one.
 *
 * `basis` is a constant. It is written by this file and validated on read so that no later change
 * can quietly re-label these rows as explicit feedback and fold them into a real denominator.
 */

export const ATTRIBUTION_SCHEMA = 'ownmem-attribution/v1';
export const DEFAULT_ATTRIBUTION_FILE = '.local-test/memory-attribution.jsonl';
export const ATTRIBUTION_LABELS = ['useful', 'misleading'];
export const ATTRIBUTION_BASIS = 'self-attribution';
export const ATTRIBUTION_SCOPE = 'turn';

const TOPIC_NAME_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

function takeValue(args, index, option) {
  const value = args[index + 1];
  if (value === undefined) throw new Error(`${option} requires a value`);
  return value;
}

export function parseAttributionOptions(rawArgs = []) {
  const options = {
    root: process.env.OWNMEM_ROOT || process.cwd(),
    observabilityDirectory: DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
    labelFile: null,
    memoryId: null,
    label: null,
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
      else if (argument === '--label-file') options.labelFile = value;
      else if (argument === '--memory') options.memoryId = value;
      else if (argument === '--label') options.label = value;
      else if (argument === '--session') options.sessionId = value;
      else if (argument === '--basis') {
        throw new Error(`basis is fixed at ${ATTRIBUTION_BASIS} and cannot be supplied: this stream is an agent grading itself, and a settable basis is exactly how it would end up counted as explicit feedback`);
      } else throw new Error(`unknown option: ${argument}`);
    } else throw new Error(`unexpected argument: ${argument}`);
  }
  if (!options.memoryId) throw new Error('--memory <memory-name> is required');
  if (!TOPIC_NAME_PATTERN.test(options.memoryId)) {
    throw new Error(`--memory must be a memory name in lower_snake_case, got ${options.memoryId}`);
  }
  if (!ATTRIBUTION_LABELS.includes(options.label)) {
    throw new Error(`--label must be one of ${ATTRIBUTION_LABELS.join(', ')}: record a label only when a memory clearly helped or clearly misled, and record nothing when the turn was neutral`);
  }
  return options;
}

/**
 * Write one label, anchored to the recall that delivered the memory. Refuses when the ledger cannot
 * pair it: a weak signal is still a signal about a specific delivery, and inventing a trace would
 * attach this turn's judgment to a recall that never happened.
 */
export function recordAttributionLabel({
  file,
  memoryId,
  label,
  sessionId = null,
  ledger,
  now = new Date(),
}) {
  if (!ATTRIBUTION_LABELS.includes(label)) {
    throw new Error(`label must be one of ${ATTRIBUTION_LABELS.join(', ')}`);
  }
  const paired = ledger.pair({ sessionId, memoryId, now });
  if (!paired) {
    throw new Error(`no recall in the local ledger delivered ${memoryId} within the pairing window, so this label cannot be anchored to a trace. A turn-end label belongs to the turn whose recall it judges; do not attach it to a guessed trace.`);
  }
  const entry = {
    schema: ATTRIBUTION_SCHEMA,
    recorded_at: now.toISOString(),
    trace_id: paired.traceId,
    snapshot_id: paired.snapshotId,
    memory_id: memoryId,
    label,
    basis: ATTRIBUTION_BASIS,
    scope: ATTRIBUTION_SCOPE,
    pairing: paired.match,
  };
  const absoluteFile = path.resolve(file);
  mkdirSync(path.dirname(absoluteFile), { recursive: true });
  appendFileSync(absoluteFile, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { file: absoluteFile, entry, pairing: paired };
}

export function readAttributionLabels(file) {
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
    if (entry.schema !== ATTRIBUTION_SCHEMA) {
      errors.push(`line ${index + 1}: unsupported schema ${entry.schema || '(missing)'}; this file holds ${ATTRIBUTION_SCHEMA} rows only and never retrieval verdicts or outcome receipts`);
      continue;
    }
    if (!ATTRIBUTION_LABELS.includes(entry.label)) {
      errors.push(`line ${index + 1}: invalid label ${entry.label || '(missing)'}`);
      continue;
    }
    if (entry.basis !== ATTRIBUTION_BASIS) {
      errors.push(`line ${index + 1}: basis must be ${ATTRIBUTION_BASIS}; a row claiming any other basis is trying to pass a self-graded label off as explicit feedback`);
      continue;
    }
    if (entry.scope !== ATTRIBUTION_SCOPE) {
      errors.push(`line ${index + 1}: scope must be ${ATTRIBUTION_SCOPE}`);
      continue;
    }
    if (!entry.trace_id || !TOPIC_NAME_PATTERN.test(entry.memory_id || '')) {
      errors.push(`line ${index + 1}: a label must name a memory and the trace that delivered it`);
      continue;
    }
    entries.push({ ...entry, line: index + 1 });
  }
  return { file, entries, errors };
}

/**
 * Counts and nothing else, with the limitation carried in the data rather than left to whoever
 * renders it. `rate_measurable` is a constant false: the sample selects itself, so any percentage
 * built on it would describe the labelling habit, not the memory.
 */
export function summarizeAttributionLabels(inbox) {
  const labels = Object.fromEntries(ATTRIBUTION_LABELS.map(label => [label, 0]));
  for (const entry of inbox.entries) labels[entry.label] += 1;
  return {
    total: inbox.entries.length,
    labels,
    invalid: inbox.errors.length,
    basis: ATTRIBUTION_BASIS,
    scope: ATTRIBUTION_SCOPE,
    rate_measurable: false,
    rate_unmeasurable_reason: 'Self-reported and self-selected: only clearly useful or clearly misleading turns are labelled, so an unlabelled delivery is unknown rather than neutral and no denominator exists.',
  };
}

function usage() {
  return `Usage: ownmem attribute --memory NAME --label useful|misleading

Records a weak, turn-scoped label at the end of a turn in which memory was injected. Record one
only when a memory clearly helped or clearly misled you; record nothing when the turn was neutral.

Because the sample selects itself, these labels are never a rate and never enter a gate. They feed
the review queue and nothing else.

Options:
  --memory NAME          the memory the label is about
  --label LABEL          useful or misleading
  --session ID           host session id, for the strongest pairing to the delivering recall
  --label-file PATH      default ${DEFAULT_ATTRIBUTION_FILE}
  --observability-dir D  local run-event directory (default ${DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY})
  --no-observability     write the label but skip the local run event
  --json                 emit the recorded label

Example:
  ownmem attribute --memory feedback_no_stash --label useful`;
}

export function runCli(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const options = parseAttributionOptions(args);
  const ledger = new MemoryRecallLedger({
    root: options.root,
    directory: options.observabilityDirectory,
  });
  const recorded = recordAttributionLabel({
    file: options.labelFile
      ? path.resolve(options.root, options.labelFile)
      : path.join(options.root, DEFAULT_ATTRIBUTION_FILE),
    memoryId: options.memoryId,
    label: options.label,
    sessionId: options.sessionId,
    ledger,
  });
  const warnings = [];
  if (options.observability) {
    const { write } = recordMemoryAttribution({
      root: options.root,
      directory: options.observabilityDirectory,
      traceId: recorded.entry.trace_id,
      snapshotId: recorded.entry.snapshot_id,
      memoryId: recorded.entry.memory_id,
      label: recorded.entry.label,
      pairing: recorded.entry.pairing,
    });
    if (!write.written) warnings.push(write.error);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(recorded.entry, null, 2)}\n`);
  } else {
    process.stdout.write(`Weak ${ATTRIBUTION_SCOPE}-scoped label recorded: ${recorded.entry.memory_id} -> ${recorded.entry.label} (${recorded.entry.pairing} pairing to trace ${recorded.entry.trace_id}).\n`);
    process.stdout.write(`Written to ${path.relative(options.root, recorded.file)}. Self-attributed, so it is a count, never a rate.\n`);
  }
  if (warnings.length > 0) {
    process.stderr.write(`ownmem-attribute: local observability skipped: ${[...new Set(warnings)].join('; ')}\n`);
  }
  return 0;
}

if (isMemoryCliEntry(import.meta.url)) {
  Promise.resolve().then(() => runCli()).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`ownmem-attribute: ${error.message}\n`);
    process.exitCode = 1;
  });
}
