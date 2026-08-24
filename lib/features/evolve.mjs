#!/usr/bin/env node

// Host-facing entry for unattended safe memory evolution.

import path from 'node:path';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import {
  readMemoryEvolutionState,
  runMemoryEvolution,
  setMemoryEvolutionEnabled,
} from '../memory-evolution.mjs';

const COMMANDS = new Set(['run', 'status', 'enable', 'disable']);
const USAGE = `Usage: ownmem evolve [run|status|enable|disable] [options]

  run                       Execute one bounded safe-maintenance pass (default)
  status                    Show whether automation is enabled and the last result
  enable                    Enable end-of-turn evolution for this repository
  disable                   Pause end-of-turn evolution for this repository

Options:
  --root <path>             Repository root (default: cwd)
  --memory-dir <path>       Memory directory (default: .claude/memory)
  --source <id>             Host surface that triggered the pass (default: host-turn)
  --dry-run                 Compute the pass without writing candidates, memory, trust or index
  --force                   Ignore the one-minute debounce window
  --quiet                   Print nothing on a successful or skipped run
  --json                    Emit structured JSON`;

export function parseEvolutionOptions(args = []) {
  const options = {
    command: 'run',
    root: process.cwd(),
    memoryDir: '.claude/memory',
    source: 'host-turn',
    dryRun: false,
    force: false,
    quiet: false,
    json: false,
    help: false,
  };
  let commandSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--force') options.force = true;
    else if (argument === '--quiet') options.quiet = true;
    else if (argument === '--json') options.json = true;
    else if (argument.startsWith('--')) {
      const value = args[++index];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === '--root') options.root = path.resolve(value);
      else if (argument === '--memory-dir') options.memoryDir = value;
      else if (argument === '--source') options.source = value;
      else throw new Error(`unknown evolve option: ${argument}`);
    } else if (!commandSeen && COMMANDS.has(argument)) {
      options.command = argument;
      commandSeen = true;
    } else throw new Error(`unknown evolve command or argument: ${argument}`);
  }
  return options;
}

function formatStatus(state) {
  const last = state.last_run;
  return [
    `Unattended evolution: ${state.enabled ? 'enabled' : 'disabled'}.`,
    last
      ? `Last run ${last.run_at}: ${last.status}; promotions=${last.promotions.applied}, rollbacks=${last.rollbacks.applied}, blocked=${last.blocked.length}.`
      : 'No evolution pass has completed on this machine yet.',
    `Totals: runs=${state.totals.runs}, promotions=${state.totals.promotions}, rollbacks=${state.totals.rollbacks}, blocked=${state.totals.blocked}, failures=${state.totals.failures}.`,
  ].join('\n');
}

export function runCli(args = process.argv.slice(2), { now = new Date() } = {}) {
  const options = parseEvolutionOptions(args);
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (options.command === 'enable' || options.command === 'disable') {
    const state = setMemoryEvolutionEnabled({ root: options.root, enabled: options.command === 'enable' });
    if (!options.quiet) process.stdout.write(options.json ? `${JSON.stringify(state, null, 2)}\n` : `${formatStatus(state)}\n`);
    return 0;
  }
  if (options.command === 'status') {
    const state = readMemoryEvolutionState({ root: options.root });
    process.stdout.write(options.json ? `${JSON.stringify(state, null, 2)}\n` : `${formatStatus(state)}\n`);
    return 0;
  }
  const result = runMemoryEvolution({
    root: options.root,
    memoryDir: options.memoryDir,
    source: options.source,
    dryRun: options.dryRun,
    force: options.force,
    now,
  });
  if (!options.quiet || result.status === 'failed') {
    process.stdout.write(options.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `Evolution ${result.status}: candidates=${result.candidates.accepted}, promotions=${result.promotions.applied}, rollbacks=${result.rollbacks.applied}, blocked=${result.blocked.length}${result.error ? `; ${result.error}` : ''}.\n`);
  }
  return result.status === 'failed' ? 1 : 0;
}

export { USAGE as EVOLVE_USAGE };

if (isMemoryCliEntry(import.meta.url)) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(`ownmem evolve: ${error.message}\n`);
    process.exitCode = 1;
  }
}
