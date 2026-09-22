#!/usr/bin/env node

import path from 'node:path';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import { resolveMemoryDir } from '../memory-paths.mjs';
import { DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY } from '../memory-observability.mjs';
import { MEMORY_TELEMETRY_FIRST_DAY, runMemoryArchive } from '../memory-archive.mjs';

const DEFAULT_ROOT = process.cwd();
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(args) {
  const options = {
    root: DEFAULT_ROOT,
    memoryDir: null,
    directory: DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
    day: null,
    backfill: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--root') options.root = path.resolve(args[++index]);
    else if (argument === '--memory-dir') options.memoryDir = args[++index];
    else if (argument === '--observability-dir') options.directory = args[++index];
    else if (argument === '--day') options.day = args[++index];
    else if (argument === '--backfill') options.backfill = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  if (options.day !== null && !DAY_PATTERN.test(options.day)) {
    throw new Error(`--day must be a UTC date such as 2026-09-08, got ${options.day}`);
  }
  if (options.day !== null && options.backfill) {
    throw new Error('--day names one day and --backfill sweeps every day; pass one or the other');
  }
  options.memoryDir = resolveMemoryDir(options.root, options.memoryDir);
  return options;
}

function usage() {
  return `Usage: npx ownmem archive [options]

Reduce a day of local telemetry to a counted package under <memory-dir>/telemetry/<installation>/,
which is committed to Git. Local event files expire after thirty days and never leave the machine
that wrote them, so this is the only durable, portable record of how memory behaved that day.

Packages carry counts only: never query text, a query digest, a trace id, a path, a machine or
account name, or a timestamp finer than the day. Writing is refused outright if any of those would
appear. The same day archived twice produces the same bytes, and a day with nothing new is not
rewritten at all.

With no options it sweeps every day from ${MEMORY_TELEMETRY_FIRST_DAY} whose events are still on
disk, up to and excluding today -- today is still being written and would churn on every session.

Options:
  --day YYYY-MM-DD        Archive exactly this UTC day. Today is allowed, and its package says so
                          with partial_day: true.
  --backfill              The default sweep, named explicitly for callers such as session hooks.
  --root PATH             Repository root
  --memory-dir PATH       Memory directory (default .claude/memory)
  --observability-dir DIR Local event directory (default .local-test/memory-observability)
  --json                  Emit the run result instead of the summary`;
}

export function formatArchiveRun(result) {
  const lines = [`Archive ${result.installation_id}`];
  if (result.days.length === 0) {
    lines.push('  no day to archive: no event file on disk falls inside the archivable range');
  }
  for (const day of result.days) {
    const state = day.changed ? 'written  ' : (day.kept ? 'kept     ' : 'unchanged');
    const partial = day.partial_day ? ' (partial: the day was still in progress)' : '';
    // A kept package is not an unchanged one. Either the day was archived under an older schema and
    // is left as the evidence it already is, or this run could not name the build that collected it
    // and would have replaced a recorded identity with nulls.
    const why = day.kept === 'identity-downgrade'
      ? ' (finished day whose recorded build this run could not derive; left as it is, see the failure below)'
      : day.kept ? ' (finished day written under an older package schema; left as it is)' : '';
    lines.push(`  ${day.day}  ${state}  ${day.events} event(s)${partial}${why}`);
  }
  for (const failure of result.failed_days || []) {
    lines.push(`  ${failure.day}  failed     ${failure.error}`);
  }
  if (result.installations_changed) {
    lines.push(`  registered this installation in ${result.installations_file}; its alias is null until a person fills one in`);
  }
  return `${lines.join('\n')}\n`;
}

export function runCli(rawArgs = process.argv.slice(2)) {
  const options = parseArgs(rawArgs);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const result = runMemoryArchive({
    root: options.root,
    memoryDir: options.memoryDir,
    directory: options.directory,
    day: options.day,
  });
  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatArchiveRun(result));
  // The other days were still archived; the exit status says that not all of them were.
  return result.failed_days.length > 0 ? 1 : 0;
}

if (isMemoryCliEntry(import.meta.url)) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(`memory-archive: ${error.message}\n`);
    process.exitCode = 1;
  }
}
