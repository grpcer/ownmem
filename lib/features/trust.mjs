#!/usr/bin/env node

import path from 'node:path';
import { bootstrapMemoryTrust, issueMemoryTrustReceipts } from '../memory-trust-migration.mjs';
import { collectMemoryTrustAudit, formatMemoryTrustAudit } from '../memory-trust-audit.mjs';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';

const COMMANDS = new Set(['check', 'bootstrap', 'issue']);

function parseArgs(args, defaults = {}) {
  // A bare invocation, or one that starts with a flag, means `check`. Host entry points append
  // their own flags (a catalog path, for instance), so args[0] is not reliably the subcommand.
  const positional = !args[0] || args[0].startsWith('-');
  const options = {
    command: positional ? 'check' : args[0],
    root: process.cwd(),
    memoryDir: '.ownmem',
    catalogPath: null,
    json: false,
    strict: false,
    all: false,
    dryRun: false,
    refreshEvidence: false,
    memoryIds: [],
    ...defaults,
  };
  if (!COMMANDS.has(options.command)) throw new Error(`trust command must be one of ${[...COMMANDS].join(', ')}`);
  for (let index = positional ? 0 : 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--root' || argument === '--memory-dir' || argument === '--catalog-path') {
      const value = args[++index];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === '--root') options.root = path.resolve(value);
      else if (argument === '--memory-dir') options.memoryDir = value;
      else options.catalogPath = value;
    } else if (argument === '--json') options.json = true;
    else if (argument === '--strict-working-tree') options.strict = true;
    else if (argument === '--all') options.all = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--refresh-evidence') options.refreshEvidence = true;
    else if (argument.startsWith('--')) throw new Error(`unknown trust option: ${argument}`);
    else options.memoryIds.push(argument);
  }
  // Accepting the flag on `check` would suggest the audit can refresh anything, which is the one
  // thing this flag must never mean.
  if (options.refreshEvidence && options.command !== 'issue') {
    throw new Error('--refresh-evidence only applies to trust issue');
  }
  return options;
}

function formatIssueResult(result) {
  const verb = result.dry_run ? 'would sign' : 'signed';
  const lines = result.issued.flatMap(item => {
    const line = `${verb}: ${item.mode.padEnd(6)} ${item.memory_id} (${item.previous_lifecycle ?? 'new'} -> ${item.lifecycle}, authority=${item.authority}, evidence=${item.evidence_items}, reason=${item.reason})`;
    // A refresh signs an unchanged body, so the drift it was signed for is the only thing that
    // explains the new receipt. Printing it is what makes the re-signature a reviewable decision.
    return item.evidence_drift.length > 0
      ? [line, ...item.evidence_drift.map(reason => `    drift: ${reason}`)]
      : [line];
  });
  for (const memoryId of result.up_to_date) lines.push(`up-to-date: ${memoryId}`);
  for (const item of result.skipped) lines.push(`skipped: ${item.memory_id} (${item.reason})`);
  lines.push(`Memory trust issue${result.dry_run ? ' (dry run)' : ''}: ${result.issued.length} receipt(s) ${verb}, ${result.up_to_date.length} up-to-date, ${result.skipped.length} skipped.`);
  if (result.file) lines.push(`Wrote ${result.file}`);
  return `${lines.join('\n')}\n`;
}

export function runTrustCli(args = process.argv.slice(2), defaults = {}) {
  const options = parseArgs(args, defaults);
  if (options.command === 'bootstrap') {
    const result = bootstrapMemoryTrust({ root: options.root, memoryDir: options.memoryDir, catalogPath: options.catalogPath, write: true });
    process.stdout.write(options.json
      ? `${JSON.stringify({ schema: 'ownmem-trust-bootstrap/v1', ...result.summary, file: result.file }, null, 2)}\n`
      : `Memory trust baseline: ${result.summary.receipts} receipt(s), ${result.summary.active} active, ${result.summary.advisory} advisory.\n`);
    return 0;
  }
  if (options.command === 'issue') {
    const result = issueMemoryTrustReceipts({
      root: options.root,
      memoryDir: options.memoryDir,
      catalogPath: options.catalogPath,
      memoryIds: options.memoryIds,
      all: options.all,
      refreshEvidence: options.refreshEvidence,
      write: !options.dryRun,
    });
    // The full successor lock is an implementation detail of the writer, not CLI output.
    const { lock: _lock, ...reported } = result;
    process.stdout.write(options.json ? `${JSON.stringify(reported, null, 2)}\n` : formatIssueResult(result));
    return 0;
  }
  const report = collectMemoryTrustAudit({
    root: options.root,
    memoryDir: options.memoryDir,
    catalogPath: options.catalogPath,
    strictWorkingTree: options.strict,
    issueCommand: options.issueCommand,
  });
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatMemoryTrustAudit(report));
  return report.issues.some(item => item.level === 'error') ? 1 : 0;
}

// Both of this module's callers are wrappers that supply repository defaults, so running the module
// file directly used to load it, export everything, and exit 0 having done nothing at all. That is
// worse than a crash: the operator reads a clean exit as a successful ingest and moves on. Measured
// 2026-08-25 -- two `node lib/features/test-runs.mjs ingest ...` invocations reported success while
// the ledger stayed stale. Sixteen of the eighteen feature modules already guard this; these two
// were simply missed.
if (isMemoryCliEntry(import.meta.url)) {
  process.stderr.write(
    'This module needs the repository defaults its wrapper supplies. Run '
    + '`ownmem trust` instead.\n',
  );
  process.exitCode = 1;
}
