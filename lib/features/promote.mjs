#!/usr/bin/env node

// The R0 promotion producer and its explicit diagnostic command.
//
// The CLI remains a dry preview unless a person passes `--apply`. Unattended evolution calls the
// same exported producer with application enabled inside its lock, audit and compensation
// transaction; it does not reach around the replay, policy, quota or content-hash gates here.

import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import {
  appendPromotionReceipt,
  promotionReceiptsFor,
  readPromotionLedger,
} from '../memory-promotion-receipt.mjs';
import { createMemoryRecallRuntime, queryMemoryRuntime } from '../memory-runtime.mjs';
import {
  DEFAULT_BACKFILL_RECEIPT_FILE,
  applyTriggerBackfill,
  createTriggerBackfillMirror,
  createTriggerBackfillReceipt,
  evaluateTriggerBackfillGate,
  pendingTriggerBackfills,
  planTriggerBackfillPromotion,
  proposeTriggerBackfill,
  revertTriggerBackfill,
} from '../memory-trigger-backfill.mjs';
import { rollbackPromotion } from '../memory-promotion-rollback.mjs';

function restoreLocalFile(file, existed, content) {
  if (!existed) {
    rmSync(file, { force: true });
    return;
  }
  const temporary = `${file}.ownmem-recover-${process.pid}-${Date.now()}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function recordAppliedBackfill(root, result, now) {
  const file = path.resolve(root, DEFAULT_BACKFILL_RECEIPT_FILE);
  const receipt = {
    schema: 'ownmem-trigger-backfill-receipt/v1',
    recorded_at: now.toISOString(),
    feedback_line: result.proposal.feedback_line,
    feedback_recorded_at: result.proposal.feedback_recorded_at,
    target: result.proposal.memory_id,
    trigger: result.proposal.trigger,
    query_sha256: createHash('sha256').update(result.proposal.query, 'utf8').digest('hex'),
  };
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8', mode: 0o600 });
  return receipt;
}

const USAGE = `Usage: ownmem promote <triggers> [options]

  triggers                  Grade every recorded retrieval miss that wants a trigger, and apply the
                            ones the policy, the replay, the regression gate and the quota all admit

Options:
  --root <path>             Repository root (default: cwd)
  --memory-dir <path>       Memory directory (default: .claude/memory)
  --apply                   Actually write the approved changes. Without it nothing is written
  --cases-file <path>       Evaluation corpus for the regression gate (default: the repository's)
  --limit <n>               Results a replay asks for (default: 3)
  --json                    Emit JSON instead of text`;

function takeValue(args, index, option) {
  const value = args[index + 1];
  if (value === undefined) throw new Error(`${option} requires a value`);
  return value;
}

export function parsePromoteOptions(rawArgs = []) {
  const options = {
    command: null,
    root: process.env.OWNMEM_ROOT || process.cwd(),
    memoryDir: '.claude/memory',
    apply: false,
    casesFile: null,
    limit: 3,
    json: false,
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];
    if (argument === '--json') options.json = true;
    else if (argument === '--apply') options.apply = true;
    else if (argument.startsWith('--')) {
      const value = takeValue(rawArgs, index, argument);
      index += 1;
      if (argument === '--root') options.root = path.resolve(value);
      else if (argument === '--memory-dir') options.memoryDir = value;
      else if (argument === '--cases-file') options.casesFile = value;
      else if (argument === '--limit') {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--limit requires a positive integer');
        options.limit = parsed;
      } else throw new Error(`unknown promote option: ${argument}`);
    } else if (!options.command) options.command = argument;
    else throw new Error(`unexpected argument: ${argument}`);
  }
  if (!options.command) throw new Error(`promote requires a subcommand.\n\n${USAGE}`);
  if (options.command !== 'triggers') throw new Error(`unknown promote subcommand: ${options.command}`);
  return options;
}

const createRuntime = ({ root, memoryDir }) => createMemoryRecallRuntime({ root, memoryDir }, { observer: null });
const query = (runtime, text) => queryMemoryRuntime(runtime, text, { limit: 3, tier: 'default' })
  .envelope.results.map(item => item.memory_id);

/**
 * Grade one pending miss.
 *
 * Every expensive step happens inside one mirror, which is created here and destroyed here whatever
 * the outcome. The mirror is per candidate rather than shared, because the regression sweep and the
 * replay both write the topic file, and one mutated tree carried across candidates is precisely the
 * kind of shared state whose failures only show up once there is more than one of them.
 */
function gradeOne({ options, feedback, topic, ledger, now }) {
  let proposal = proposeTriggerBackfill({
    root: options.root,
    memoryDir: options.memoryDir,
    feedback,
    topic,
  });
  const basePromotionId = proposal.promotion_id;
  let retry = 0;
  while (promotionReceiptsFor(ledger, proposal.promotion_id).length > 0) {
    const chain = promotionReceiptsFor(ledger, proposal.promotion_id);
    if (chain.at(-1).operation !== 'rollback') {
      throw new Error(`promotion ${proposal.promotion_id} is already active but its local backfill receipt is missing`);
    }
    retry += 1;
    proposal = { ...proposal, promotion_id: `${basePromotionId}-retry-${retry}` };
  }
  const mirror = createTriggerBackfillMirror({ root: options.root, memoryDir: options.memoryDir });
  let gate;
  try {
    gate = evaluateTriggerBackfillGate({
      mirror,
      proposal,
      casesFile: options.casesFile,
      createRuntime,
      query,
      limit: options.limit,
      now,
    });
  } finally {
    mirror.cleanup();
  }
  const plan = planTriggerBackfillPromotion({
    root: options.root,
    memoryDir: options.memoryDir,
    proposal,
    gate,
    priorReceipts: promotionReceiptsFor(ledger, proposal.promotion_id),
    now,
  });
  const receipt = createTriggerBackfillReceipt({ root: options.root, proposal, plan, gate, now });
  return { proposal, gate, plan, receipt };
}

function describe(result, applied) {
  const { proposal, gate, plan } = result;
  const lines = [
    `${proposal.memory_id}  <- feedback line ${proposal.feedback_line}  (+${proposal.bytes_added} bytes)`,
    `    trigger: ${proposal.trigger}`,
    `    rule: ${proposal.selection_rule}; the trigger is a verbatim substring of the query that failed`,
    `    risk: ${plan.risk.risk} -- ${plan.risk.reason}`,
    `    replay: ${gate.replay.proved ? 'proved' : 'refused'} -- ${gate.replay.reason}`,
    `    regression: ${gate.regression.status === 'not-run' ? 'not run' : gate.regression.passed ? 'clean' : 'regressed'} -- ${gate.regression.reason}`,
    `    regression_gate_passed: ${gate.regression_gate_passed}`,
    `    automation: ${plan.decision ? plan.decision.automation : 'n/a'}`,
    `    quota: ${plan.quota ? plan.quota.verdict : 'n/a'}`,
  ];
  for (const reason of (plan.quota?.reasons || [])) lines.push(`      ${reason}`);
  for (const proposalOut of (plan.quota?.proposals || [])) {
    lines.push(`      swap out ${proposalOut.memory_id} frees ${proposalOut.frees_bytes} bytes `
      + `(${proposalOut.authority}, ${proposalOut.references} inbound link(s)) -- ${proposalOut.recommendation}; requires review`);
  }
  lines.push(applied
    ? '    applied.'
    : plan.applies
      ? '    approved; not written because --apply was not given.'
      : `    refused: ${plan.blockers.join(', ')}`);
  return lines.join('\n');
}

/**
 * Grade and optionally materialize every pending trigger backfill.
 *
 * This is the production API used by both the CLI and unattended evolution. The caller chooses
 * whether approved R0 changes are applied; the risk matrix, differential replay, regression gate,
 * quota and content hash checks remain inside the operation and cannot be bypassed by that choice.
 */
export function promoteTriggerBackfills(options, { now = new Date() } = {}) {
  const queue = pendingTriggerBackfills({ root: options.root, memoryDir: options.memoryDir });

  // The honest empty case, and it is a real state rather than a formality: all four of R0's fuel
  // sources were measured empty on this repository the day this was written. Nothing is created,
  // nothing is appended, and no ledger file is brought into existence to hold zero rows.
  if (queue.pending.length === 0) {
    return {
      schema: 'ownmem-promote-triggers/v1',
      pending: 0,
      excluded: queue.excluded,
      inbox_errors: queue.inbox_errors,
      results: [],
      applied: 0,
      wrote: false,
      ledger_file: null,
    };
  }

  const { ledger, file: ledgerFile } = readPromotionLedger({ root: options.root, memoryDir: options.memoryDir });
  let current = ledger;
  const results = [];
  let applied = 0;

  for (const { feedback, topic } of queue.pending) {
    const result = gradeOne({ options, feedback, topic, ledger: current, now });
    let wasApplied = false;
    if (options.apply && result.plan.applies) {
      const localReceiptFile = path.resolve(options.root, DEFAULT_BACKFILL_RECEIPT_FILE);
      const localReceiptExisted = existsSync(localReceiptFile);
      const localReceiptBefore = localReceiptExisted ? readFileSync(localReceiptFile, 'utf8') : null;
      let topicWritten = false;
      let ledgerAppended = false;
      try {
        applyTriggerBackfill({
          root: options.root,
          memoryDir: options.memoryDir,
          proposal: result.proposal,
          plan: result.plan,
        });
        topicWritten = true;
        current = appendPromotionReceipt({
          root: options.root,
          memoryDir: options.memoryDir,
          ledger: current,
          receipt: result.receipt,
          now,
        }).ledger;
        ledgerAppended = true;
        recordAppliedBackfill(options.root, result, now);
      } catch (error) {
        const recoveryErrors = [];
        try {
          restoreLocalFile(localReceiptFile, localReceiptExisted, localReceiptBefore);
        } catch (recoveryError) {
          recoveryErrors.push(`local receipt recovery failed: ${recoveryError.message}`);
        }
        try {
          if (ledgerAppended) {
            rollbackPromotion({
              root: options.root,
              memoryDir: options.memoryDir,
              promotionId: result.proposal.promotion_id,
              signal: 'gate-conflict',
              reason: `promotion transaction failed: ${error.message}`,
              verifier: { kind: 'machine', id: 'ownmem-promotion-transaction' },
              requireAutomatic: true,
              quarantine: false,
              apply: true,
              now,
            });
          } else if (topicWritten) {
            revertTriggerBackfill({
              root: options.root,
              memoryDir: options.memoryDir,
              proposal: result.proposal,
            });
          }
        } catch (recoveryError) {
          recoveryErrors.push(`topic recovery failed: ${recoveryError.message}`);
        }
        throw new Error(`${error.message}${recoveryErrors.length > 0 ? `; ${recoveryErrors.join('; ')}` : ''}`);
      }
      wasApplied = true;
      applied += 1;
    }
    // The receipt is appended only alongside the change it describes. A ledger that recorded every
    // refusal would grow without bound from a queue nobody drained, and a refusal is already fully
    // reported here; what the ledger is for is the cumulative quota accounting, which only has
    // something to accumulate once bytes actually landed.
    results.push({ ...result, applied: wasApplied });
  }

  return {
    schema: 'ownmem-promote-triggers/v1',
    pending: queue.pending.length,
    excluded: queue.excluded,
    inbox_errors: queue.inbox_errors,
    applied,
    wrote: applied > 0,
    ledger_file: applied > 0 ? path.relative(options.root, ledgerFile) : null,
    results,
    reported_results: results.map(result => ({
        memory_id: result.proposal.memory_id,
        feedback_line: result.proposal.feedback_line,
        trigger: result.proposal.trigger,
        selection_rule: result.proposal.selection_rule,
        bytes_added: result.proposal.bytes_added,
        risk: result.plan.risk.risk,
        replay: {
          proved: result.gate.replay.proved,
          before: result.gate.replay.before?.topics ?? null,
          after: result.gate.replay.after?.topics ?? null,
          reason: result.gate.replay.reason,
        },
        regression: result.gate.regression,
        regression_gate_passed: result.gate.regression_gate_passed,
        automation: result.plan.decision?.automation ?? null,
        blockers: result.plan.blockers,
        verdict: result.plan.quota?.verdict ?? null,
        quota: result.plan.quota,
        applied: result.applied,
        receipt_id: result.receipt.receipt_id,
      })),
  };
}

export function runCli(rawArgs = process.argv.slice(2), { now = new Date() } = {}) {
  const options = parsePromoteOptions(rawArgs);
  const result = promoteTriggerBackfills(options, { now });

  if (options.json) {
    const { results: _internalResults, reported_results: reportedResults, ...reported } = result;
    process.stdout.write(`${JSON.stringify({ ...reported, results: reportedResults }, null, 2)}\n`);
    return 0;
  }

  if (result.pending === 0) {
    process.stdout.write(`No retrieval miss is waiting for a trigger.${result.excluded.length > 0
      ? ` ${result.excluded.length} recorded miss(es) were excluded: ${result.excluded.map(item => `line ${item.line} (${item.reason})`).join(', ')}.`
      : ''}\n`);
    // Rows the inbox reader rejected outright never become queue entries, so without this they would
    // vanish between a file that has rows in it and a command that says there is nothing to do.
    for (const message of result.inbox_errors) process.stdout.write(`  unreadable: ${message}\n`);
    return 0;
  }

  for (const message of result.inbox_errors) process.stdout.write(`unreadable: ${message}\n`);
  for (const item of result.results) process.stdout.write(`${describe(item, item.applied)}\n`);
  process.stdout.write(`${result.pending} pending miss(es); ${result.applied} applied`
    + `${options.apply ? '' : ' (dry run: pass --apply to write)'}.\n`);
  return 0;
}

if (isMemoryCliEntry(import.meta.url)) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
