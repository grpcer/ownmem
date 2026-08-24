#!/usr/bin/env node

// The observation period and the safety switch, on the command line.
//
// Three things live here and they are deliberately one command, because they are one story: what is
// currently being watched, what stopped being injected and why, and how to put a promotion back the
// way it was. Splitting them would mean a reader who saw a quarantine row had to know a second
// command existed to find out what fired it.
//
// The verbs divide along exactly one line -- whether they can change a file the repository tracks:
//
//   status / list          read only, always
//   apply                  appends to the local quarantine ledger and writes a review proposal
//   quarantine / release   appends to the local quarantine ledger
//   rollback               prints the proposal; `--apply` restores the file, and only then
//
// Everything above `rollback --apply` stays inside the ignored local directory. `rollback --apply`
// is the one place bytes under version control move, it happens only when a person types it, and it
// still does not stage or commit anything: the working tree is left for review.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import {
  DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  readMemoryObservabilityEvents,
} from '../memory-observability.mjs';
import {
  DEFAULT_PROMOTION_LEDGER_FILE,
  PROMOTION_DEGRADE_SIGNALS,
  readPromotionLedger,
} from '../memory-promotion-receipt.mjs';
import {
  restoreContentFromPlan,
  rollbackPromotion,
} from '../memory-promotion-rollback.mjs';
import {
  DEFAULT_QUARANTINE_FILE,
  QUARANTINE_RELEASERS,
  quarantineFilePath,
  quarantineState,
  readQuarantineLedger,
  recordQuarantine,
  releaseQuarantine,
} from '../memory-quarantine.mjs';
import {
  DEFAULT_TRIPWIRE_CHANGE_DIRECTORY,
  TRIPWIRE_DEFAULT_OBSERVATIONS,
  TRIPWIRE_DEFAULT_SETTLE_HOURS,
  TRIPWIRE_SIGNAL_PRODUCERS,
  applyPromotionTripwire,
  collectLedgerTripwireSignals,
  collectTrustTripwireSignals,
  evaluatePromotionTripwire,
  memoryDeliveries,
  promotionObservationWindows,
} from '../memory-tripwire.mjs';

const USAGE = `Usage: ownmem tripwire <status|apply|list|quarantine|release|rollback> [options]

  status                    What is under observation and which degrade signals landed. Writes nothing
  apply                     Act on the signals: stop injecting, and write the retraction for review
  list                      The local quarantine ledger as it currently stands
  quarantine <memory>       Stop injecting one memory now (--signal is required)
  release <memory>          Lift a quarantine (--released-by user|host; the system cannot do this)
  rollback <promotion-id>   Undo one promotion. Prints the plan; --apply restores the file

Options:
  --root <path>             Repository root (default: cwd)
  --memory-dir <path>       Memory directory (default: .claude/memory)
  --json                    Emit JSON instead of text
  --apply                   Carry out the action instead of previewing it
  --signal <name>           ${PROMOTION_DEGRADE_SIGNALS.join(', ')}
  --released-by <who>       ${QUARANTINE_RELEASERS.join(' or ')}
  --reason <text>           Short readable note, at most 200 characters
  --observations <n>        Deliveries before an observation period may close (default: ${TRIPWIRE_DEFAULT_OBSERVATIONS})
  --settle-hours <h>        Minimum life of an observation period (default: ${TRIPWIRE_DEFAULT_SETTLE_HOURS})
  --quarantine-file <path>  Local quarantine ledger (default: ${DEFAULT_QUARANTINE_FILE})
  --ledger-file <name>      Promotion ledger inside the memory directory (default: ${DEFAULT_PROMOTION_LEDGER_FILE})
  --observability-dir <d>   Local event directory (default: ${DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY})
  --feedback-file <path>    Retrieval feedback ledger
  --outcome-file <path>     Outcome receipt ledger
  --attribution-file <path> Weak turn-end label ledger`;

const COMMANDS = ['status', 'apply', 'list', 'quarantine', 'release', 'rollback'];

function takeValue(args, index, option) {
  const value = args[index + 1];
  if (!value) throw new Error(`${option} requires a value`);
  return value;
}

export function parseTripwireOptions(rawArgs = []) {
  const options = {
    command: 'status',
    help: false,
    root: process.cwd(),
    memoryDir: '.claude/memory',
    json: false,
    apply: false,
    target: null,
    signal: null,
    releasedBy: null,
    reason: '',
    observations: TRIPWIRE_DEFAULT_OBSERVATIONS,
    settleHours: TRIPWIRE_DEFAULT_SETTLE_HOURS,
    quarantineFile: null,
    ledgerFile: DEFAULT_PROMOTION_LEDGER_FILE,
    observabilityDirectory: DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
    changeDirectory: DEFAULT_TRIPWIRE_CHANGE_DIRECTORY,
    feedbackFile: null,
    outcomeFile: null,
    attributionFile: null,
  };
  const positional = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--apply') options.apply = true;
    else if (argument.startsWith('--')) {
      const value = takeValue(rawArgs, index, argument);
      index += 1;
      if (argument === '--root') options.root = path.resolve(value);
      else if (argument === '--memory-dir') options.memoryDir = value;
      else if (argument === '--signal') options.signal = value;
      else if (argument === '--released-by') options.releasedBy = value;
      else if (argument === '--reason') options.reason = value;
      else if (argument === '--observations') options.observations = Number.parseInt(value, 10);
      else if (argument === '--settle-hours') options.settleHours = Number.parseFloat(value);
      else if (argument === '--quarantine-file') options.quarantineFile = value;
      else if (argument === '--ledger-file') options.ledgerFile = value;
      else if (argument === '--observability-dir') options.observabilityDirectory = value;
      else if (argument === '--change-dir') options.changeDirectory = value;
      else if (argument === '--feedback-file') options.feedbackFile = value;
      else if (argument === '--outcome-file') options.outcomeFile = value;
      else if (argument === '--attribution-file') options.attributionFile = value;
      else throw new Error(`unknown tripwire option: ${argument}`);
    } else positional.push(argument);
  }
  if (positional.length > 0) {
    if (!COMMANDS.includes(positional[0])) throw new Error(`unknown tripwire command: ${positional[0]}`);
    options.command = positional[0];
    options.target = positional[1] || null;
  }
  if (!Number.isInteger(options.observations) || options.observations < 1) {
    throw new Error('--observations must be a positive integer');
  }
  if (!Number.isFinite(options.settleHours) || options.settleHours < 0) {
    throw new Error('--settle-hours must be a non-negative number');
  }
  if (options.quarantineFile === null) options.quarantineFile = DEFAULT_QUARANTINE_FILE;
  const local = name => path.join(options.root, '.local-test', name);
  if (options.feedbackFile === null) options.feedbackFile = local('memory-recall-feedback.jsonl');
  if (options.outcomeFile === null) options.outcomeFile = local('memory-outcome-receipts.jsonl');
  if (options.attributionFile === null) options.attributionFile = local('memory-attribution.jsonl');
  return options;
}

function loadEvents(options) {
  try {
    return readMemoryObservabilityEvents({ root: options.root, directory: options.observabilityDirectory }).events;
  } catch {
    // No event directory yet, or it is unreadable. An observation period with no exposures stays
    // open, which is the conservative answer, so this degrades rather than refusing to run.
    return [];
  }
}

/**
 * Everything `status` and `apply` share.
 *
 * The two must not compute different things -- a preview that is a different calculation from the
 * act it previews is not a preview -- so there is one function and `apply` is a flag on the end of
 * it.
 */
export function observeTripwire(options, { now = new Date() } = {}) {
  const { ledger } = readPromotionLedger({
    root: options.root,
    memoryDir: options.memoryDir,
    fileName: options.ledgerFile,
  });
  const deliveries = memoryDeliveries(loadEvents(options));
  const windows = promotionObservationWindows({
    ledger,
    deliveries,
    now,
    observationsRequired: options.observations,
    settleHours: options.settleHours,
  });
  const ledgerSignals = collectLedgerTripwireSignals({
    feedbackFile: options.feedbackFile,
    outcomeFile: options.outcomeFile,
    attributionFile: options.attributionFile,
  });
  const trustSignals = collectTrustTripwireSignals({
    root: options.root,
    memoryDir: options.memoryDir,
    memoryIds: windows.map(window => window.memory_id),
    now,
  });
  const evaluation = evaluatePromotionTripwire({
    windows,
    signals: [...ledgerSignals.signals, ...trustSignals.signals],
    deliveries,
    now,
  });
  return { ledger, evaluation, errors: [...ledgerSignals.errors, ...trustSignals.errors] };
}

function requireReadableQuarantine(options) {
  const file = quarantineFilePath({ root: options.root, file: options.quarantineFile });
  const ledger = readQuarantineLedger(file);
  if (ledger.errors.length > 0) {
    // Loud here and quiet in recall, on purpose. Recall must keep answering with a broken local
    // file; the command that manages that file must not pretend it read it, because a silently
    // rebuilt quarantine ledger is one that loses the rows saying what is currently unsafe.
    throw new Error(`quarantine ledger is unreadable: ${ledger.errors.slice(0, 3).join('; ')}`);
  }
  return ledger;
}

function printStatus(result, options) {
  const { evaluation } = result;
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...evaluation, errors: result.errors }, null, 2)}\n`);
    return 0;
  }
  // The honest zero. A repository with no promotions has nothing under observation, and saying so
  // in those words is different from printing a table with no rows, which reads as "all clear".
  if (evaluation.windows.length === 0) {
    process.stdout.write('0 entries in the observation period: no promotion has been recorded in this repository yet.\n');
  } else {
    process.stdout.write(`${evaluation.open_windows} of ${evaluation.windows.length} observation period(s) open.\n`);
    for (const window of evaluation.windows) {
      process.stdout.write(`  ${window.memory_id}  promotion=${window.promotion_id}  ${window.open ? 'open' : `closed (${window.closed_reason})`}`
        + `  exposures=${window.observations}/${window.observations_required}  settles=${window.settles_at}\n`);
    }
  }
  if (evaluation.hits.length === 0) process.stdout.write('No degrade signal landed on a promoted memory.\n');
  for (const hit of evaluation.hits) {
    process.stdout.write(`  ${hit.action.padEnd(10)} ${hit.memory_id}  ${hit.signal}  ${hit.recorded_at}`
      + `  ${hit.in_window ? 'in-window' : 'out-of-window'}${hit.withheld_reason ? `  withheld=${hit.withheld_reason}` : ''}\n`);
  }
  const unproduced = evaluation.signals_without_producer;
  if (unproduced.length > 0) {
    process.stdout.write(`Armed but unobservable here: ${unproduced.join(', ')} (no producer, so it can never fire).\n`);
  }
  for (const error of result.errors) process.stdout.write(`  warning: ${error}\n`);
  return 0;
}

function statusCommand(options, now) {
  return printStatus(observeTripwire(options, { now }), options);
}

function applyCommand(options, now) {
  requireReadableQuarantine(options);
  const result = observeTripwire(options, { now });
  const applied = applyPromotionTripwire({
    root: options.root,
    memoryDir: options.memoryDir,
    quarantineFile: options.quarantineFile,
    changeDirectory: options.changeDirectory,
    ledger: result.ledger,
    evaluation: result.evaluation,
    apply: options.apply,
    now,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...applied, evaluation: result.evaluation, errors: result.errors }, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`${options.apply ? 'Applied' : 'Preview (nothing written; pass --apply)'}: `
    + `${applied.quarantined.length} quarantine(s), ${applied.rollbacks.length} retraction(s) proposed.\n`);
  for (const hit of applied.quarantined) {
    process.stdout.write(`  ${hit.action.padEnd(10)} ${hit.memory_id}  ${hit.signal}  ${hit.source}\n`);
  }
  for (const change of applied.rollbacks) {
    process.stdout.write(`  review     ${change.memory_id}  rollback receipt ${change.rollback_receipt.receipt_id.slice(0, 12)}`
      + `  -> ${path.join(options.changeDirectory, `${change.promotion_id}.json`)}\n`);
  }
  for (const skip of applied.skipped) process.stdout.write(`  skipped    ${skip.memory_id}  ${skip.skipped}\n`);
  if (applied.rollbacks.length > 0) {
    process.stdout.write('The retraction itself is a change for review; nothing under version control was modified.\n');
  }
  return 0;
}

function listCommand(options) {
  const ledger = requireReadableQuarantine(options);
  const state = [...quarantineState(ledger.entries).values()];
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ schema: 'ownmem-runtime-quarantine-state/v1', file: ledger.file, entries: state }, null, 2)}\n`);
    return 0;
  }
  const held = state.filter(entry => entry.action === 'quarantine');
  process.stdout.write(`${held.length} memory(ies) quarantined on this machine.\n`);
  for (const entry of held) {
    process.stdout.write(`  ${entry.memory_id}  ${entry.signal}  ${entry.recorded_at}  ${entry.reason || ''}\n`);
  }
  return 0;
}

function quarantineCommand(options, now) {
  if (!options.target) throw new Error('quarantine requires a memory name');
  if (!options.signal) throw new Error(`quarantine requires --signal (${PROMOTION_DEGRADE_SIGNALS.join(', ')})`);
  requireReadableQuarantine(options);
  const written = recordQuarantine({
    root: options.root,
    file: options.quarantineFile,
    memoryId: options.target,
    signal: options.signal,
    source: 'manual',
    reason: options.reason,
    now,
  });
  process.stdout.write(options.json
    ? `${JSON.stringify(written.entry, null, 2)}\n`
    : `Quarantined ${options.target} on ${options.signal}. Recall will stop returning it on this machine.\n`);
  return 0;
}

function releaseCommand(options, now) {
  if (!options.target) throw new Error('release requires a memory name');
  if (!options.releasedBy) {
    throw new Error(`release requires --released-by ${QUARANTINE_RELEASERS.join('|')}; the system does not lift its own quarantine`);
  }
  requireReadableQuarantine(options);
  const written = releaseQuarantine({
    root: options.root,
    file: options.quarantineFile,
    memoryId: options.target,
    releasedBy: options.releasedBy,
    reason: options.reason,
    now,
  });
  process.stdout.write(options.json
    ? `${JSON.stringify(written.entry, null, 2)}\n`
    : `Released ${options.target}, confirmed by ${options.releasedBy}.\n`);
  return 0;
}

/**
 * Recover the bytes a restore plan names, and refuse anything that does not hash to what the plan
 * says it should.
 *
 * The content comes out of the commit the promotion recorded, never out of a receipt: a receipt
 * carries a hash so that it can check the bytes, and a receipt that carried the bytes themselves
 * would be a second copy of the corpus that could disagree with the first.
 */
function rollbackCommand(options, now) {
  if (!options.target) throw new Error('rollback requires a promotion id');
  const summary = rollbackPromotion({
    root: options.root,
    memoryDir: options.memoryDir,
    promotionId: options.target,
    ledgerFile: options.ledgerFile,
    quarantineFile: options.quarantineFile,
    signal: options.signal || 'wrong-feedback',
    reason: options.reason || 'rollback requested',
    verifier: { kind: 'machine', id: 'ownmem-tripwire-rollback' },
    apply: options.apply,
    now,
  });
  const receipt = summary.receipt;
  const restore = summary.operations[0];
  if (!options.apply) {
    const file = path.resolve(options.root, options.changeDirectory, `${options.target}.json`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ ...summary, requires_review: true, auto_apply: false }, null, 2)}\n`, 'utf8');
    summary.proposal = path.relative(options.root, file);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return { code: 0, receipt, summary };
  }
  process.stdout.write(summary.applied
    ? `Rolled back ${summary.memory_id}: ${receipt.change.current_lifecycle} -> ${receipt.change.target_lifecycle}`
      + `${restore.lifecycle === receipt.change.target_lifecycle ? '' : ` (declared ${restore.lifecycle}; the lifecycle graph has no edge back to it)`}.\n`
      + `Receipt ${summary.rollback_receipt_id.slice(0, 12)} undoes ${summary.previous_receipt_id.slice(0, 12)}. `
      + 'The file is restored in the working tree and nothing was staged or committed.\n'
    : `Would roll back ${summary.memory_id}: ${receipt.change.current_lifecycle} -> ${receipt.change.target_lifecycle}. `
      + `Plan written to ${summary.proposal}; pass --apply to restore the file.\n`);
  return { code: 0, receipt, summary };
}

/**
 * The rollback receipt is appended by the caller rather than here, because appending it is a claim
 * that the rollback happened -- and on a preview it did not. Exposed so the self-test and any host
 * driving this programmatically use the same chain rule the ledger validates.
 */
export function runCli(rawArgs = process.argv.slice(2), { now = new Date() } = {}) {
  const options = parseTripwireOptions(rawArgs);
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (options.command === 'status') return statusCommand(options, now);
  if (options.command === 'apply') return applyCommand(options, now);
  if (options.command === 'list') return listCommand(options);
  if (options.command === 'quarantine') return quarantineCommand(options, now);
  if (options.command === 'release') return releaseCommand(options, now);
  const result = rollbackCommand(options, now);
  return result.code;
}

export { USAGE as TRIPWIRE_USAGE, TRIPWIRE_SIGNAL_PRODUCERS, restoreContentFromPlan, rollbackCommand };

if (isMemoryCliEntry(import.meta.url)) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(`ownmem tripwire: ${error.message}\n`);
    process.exitCode = 1;
  }
}
