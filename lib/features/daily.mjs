#!/usr/bin/env node

import path from 'node:path';
import {
  currentAgentIdentity,
  MEMORY_DECLARABLE_AGENTS,
  resolveAgentIdentity,
  setProcessAgentIdentity,
} from '../memory-agent-identity.mjs';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import { resolveMemoryDir, resolveRepositoryRoot } from '../memory-paths.mjs';
import { DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY } from '../memory-observability.mjs';
import {
  formatMemoryDailyFindings,
  MEMORY_DAILY_TIMEOUT_MS,
  runMemoryDaily,
} from '../memory-daily.mjs';

// grok reads this repository's Claude hook configuration through a compatibility layer, so
// CLAUDE_PROJECT_DIR is the portable name for "the checkout" rather than a Claude-only one. Codex
// sets nothing at all, so there the working directory is walked up to the repository instead.
const DEFAULT_ROOT = process.env.CLAUDE_PROJECT_DIR || resolveRepositoryRoot();

function parseArgs(args) {
  const options = {
    root: DEFAULT_ROOT,
    memoryDir: null,
    directory: DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
    timeoutMs: MEMORY_DAILY_TIMEOUT_MS,
    force: false,
    source: 'manual',
    host: null,
    fetch: true,
    commit: true,
    json: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--root') options.root = path.resolve(args[++index]);
    else if (argument === '--memory-dir') options.memoryDir = args[++index];
    else if (argument === '--observability-dir') options.directory = args[++index];
    else if (argument === '--timeout-ms') options.timeoutMs = Number.parseInt(args[++index], 10);
    else if (argument === '--source') options.source = args[++index];
    else if (argument === '--host') options.host = args[++index];
    else if (argument === '--force') options.force = true;
    else if (argument === '--no-fetch') options.fetch = false;
    else if (argument === '--no-commit') options.commit = false;
    else if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
    throw new Error('--timeout-ms must be a non-negative number of milliseconds');
  }
  if (options.host !== null && !MEMORY_DECLARABLE_AGENTS.includes(options.host)) {
    throw new Error(`--host must be one of: ${MEMORY_DECLARABLE_AGENTS.join(', ')}`);
  }
  options.memoryDir = resolveMemoryDir(options.root, options.memoryDir);
  return options;
}

function usage() {
  return `Usage: npx ownmem daily [options]

The unattended daily pass. Archives every finished day that is still on disk, commits the packages
it wrote, and inspects what is already in Git. It is wired to session start, session stop and
post-commit, and runs at most once per UTC day; the later triggers cost nothing.

It prints nothing when there is nothing wrong. Its output reaches a model's context on session
start, so a daily "all clear" would cost context forever and teach the reader to skip the one day
it says something else. Findings go to stdout one line at a time; timings, skips and everything
inspected and found ordinary go to .local-test/memory-hook/daily.jsonl.

It always exits 0. A step that fails leaves a trace and the next step still runs, and a step that
starts past the deadline is skipped rather than started -- nothing here may block a session or a
commit.

Options:
  --host NAME             Which agent is running this (${MEMORY_DECLARABLE_AGENTS.join(', ')})
  --source NAME           What triggered it, recorded in the trace (session-start, stop, post-commit)
  --force                 Run even though today has already been handled
  --timeout-ms N          Budget for the whole pass (default ${MEMORY_DAILY_TIMEOUT_MS})
  --no-fetch              Skip the network reach for the ahead/behind counts
  --no-commit             Archive the day but leave the packages uncommitted in the working tree
  --root PATH             Repository root
  --memory-dir PATH       Memory directory (default .claude/memory)
  --observability-dir DIR Local event directory (default ${DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY})
  --json                  Emit the whole run record instead of the findings`;
}

export function runCli(rawArgs = process.argv.slice(2)) {
  const options = parseArgs(rawArgs);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  setProcessAgentIdentity(resolveAgentIdentity({ declaredHost: options.host }));
  const record = runMemoryDaily({
    root: options.root,
    memoryDir: options.memoryDir,
    directory: options.directory,
    timeoutMs: options.timeoutMs,
    force: options.force,
    source: options.source,
    agent: currentAgentIdentity().agent,
    fetch: options.fetch,
    commit: options.commit,
  });
  process.stdout.write(options.json ? `${JSON.stringify(record, null, 2)}\n` : formatMemoryDailyFindings(record));
  return 0;
}

if (isMemoryCliEntry(import.meta.url)) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    // Even a broken invocation exits 0. This runs from a post-commit hook, where a non-zero exit is
    // a red line in the middle of somebody's commit for a telemetry pass that nobody was waiting on.
    process.stderr.write(`memory-daily: ${error.message}\n`);
    process.exitCode = 0;
  }
}
