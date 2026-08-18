#!/usr/bin/env node

import path from 'node:path';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import {
  collectMemoryAudit,
  formatMemoryAudit,
  recordMemoryAuditObservability,
} from '../memory-audit.mjs';

function parseArgs(args) {
  const options = { root: process.cwd(), memoryDir: '.ownmem', writeLock: false, json: false, observability: true };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--root' || argument === '--memory-dir') {
      const value = args[++index];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === '--root') options.root = path.resolve(value);
      else options.memoryDir = value;
    } else if (argument === '--write-lock') options.writeLock = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--no-observability') options.observability = false;
    else if (argument === '--skip-benchmark') continue;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  return options;
}

function usage() {
  return `Usage: ownmem audit [options]

Run the local schema, routing, quota, evidence, wiki-link, and duplicate gates.

Options:
  --root PATH          Repository root
  --memory-dir PATH    Memory directory (default .ownmem)
  --write-lock         Tighten a mature quota lock; never raise it
  --json               Emit the structured audit report`;
}

export function runCli(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const started = performance.now();
  const report = collectMemoryAudit(options);
  if (options.observability) {
    const recorded = recordMemoryAuditObservability({
      root: options.root,
      report,
      durationMs: performance.now() - started,
    });
    if (!recorded.written && recorded.error) {
      process.stderr.write(`memory-audit: local observability skipped: ${recorded.error}\n`);
    }
  }
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    const formatted = formatMemoryAudit(report);
    (report.issues.some(item => item.level === 'error') ? process.stderr : process.stdout).write(formatted);
  }
  return report.issues.some(item => item.level === 'error') ? 1 : 0;
}

if (isMemoryCliEntry(import.meta.url)) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(`memory-audit: ${error.message}\n`);
    process.exitCode = 1;
  }
}
