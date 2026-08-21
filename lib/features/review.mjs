#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import { resolveMemoryDir } from '../memory-paths.mjs';
import { loadMemoryTopics, parseMemoryContent } from '../memory-schema.mjs';

const DEFAULT_ROOT = process.cwd();
const LOCK_SCHEMA = 'engineering-memory.review-lock/v1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function semanticDigest(record) {
  const metadata = { ...record.metadata };
  for (const key of ['last_verified', 'review_by', 'originSessionId', 'created', 'modified']) delete metadata[key];
  const semantic = stable({
    name: record.name,
    description: record.description,
    metadata,
    body: record.body.replace(/\r\n/g, '\n').trim(),
  });
  return createHash('sha256').update(JSON.stringify(semantic)).digest('hex');
}

function receiptId(name, receipt) {
  return createHash('sha256').update([
    name,
    receipt.review_by,
    receipt.reviewed_on,
    receipt.content_sha256,
    receipt.source,
    receipt.reason,
  ].join('\u0000')).digest('hex').slice(0, 24);
}

function parseArgs(args) {
  const options = {
    command: 'check',
    root: DEFAULT_ROOT,
    memoryDir: null,
    name: '',
    reviewBy: '',
    reason: '',
  };
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--root') options.root = path.resolve(args[++index]);
    else if (argument === '--memory-dir') options.memoryDir = args[++index];
    else if (argument === '--review-by') options.reviewBy = args[++index];
    else if (argument === '--reason') options.reason = args[++index];
    else if (argument.startsWith('--')) throw new Error(`unknown option: ${argument}`);
    else positional.push(argument);
  }
  if (positional[0]) options.command = positional[0];
  if (positional[1]) options.name = positional[1];
  // Resolved after the loop so that --root is final; the .claude/memory default read review receipts
  // from a directory no installation uses.
  options.memoryDir = resolveMemoryDir(options.root, options.memoryDir);
  return options;
}

function lockPath(options) {
  return path.resolve(options.root, options.memoryDir, 'review.lock.json');
}

function readLock(options) {
  const file = lockPath(options);
  if (!existsSync(file)) return { schema: LOCK_SCHEMA, updated_at: null, topics: {} };
  const lock = JSON.parse(readFileSync(file, 'utf8'));
  if (lock.schema !== LOCK_SCHEMA || !lock.topics || typeof lock.topics !== 'object') {
    throw new Error(`review lock must use ${LOCK_SCHEMA}`);
  }
  return lock;
}

function preferenceTopics(options) {
  return loadMemoryTopics({ root: options.root, memoryDir: options.memoryDir })
    .filter((topic) => topic.record && ['preference', 'feedback'].includes(topic.record.metadata.type));
}

function gitReceiptCommit(root, relativeLock, receiptIdValue) {
  try {
    return execFileSync('git', ['-C', root, 'log', '-1', '--format=%H', '-S', receiptIdValue, '--', relativeLock], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function hasUncommittedChanges(root, paths) {
  try {
    execFileSync('git', ['-C', root, 'diff', '--quiet', '--', ...paths], { stdio: 'ignore' });
    execFileSync('git', ['-C', root, 'diff', '--cached', '--quiet', '--', ...paths], { stdio: 'ignore' });
    return false;
  } catch {
    return true;
  }
}

function requireGitRepository(root) {
  try {
    const inside = execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (inside !== 'true') throw new Error('not a git worktree');
  } catch {
    throw new Error('confirmed review receipts require an available git repository; commit evidence cannot be skipped');
  }
}

function check(options) {
  const lock = readLock(options);
  const topics = preferenceTopics(options);
  if (Object.values(lock.topics).some(receipt => receipt?.source === 'confirmed')) {
    requireGitRepository(options.root);
  }
  const expected = new Set(topics.map((topic) => topic.record.name));
  const errors = [];
  const relativeLock = path.relative(options.root, lockPath(options));
  for (const topic of topics) {
    const name = topic.record.name;
    const receipt = lock.topics[name];
    if (!receipt) {
      errors.push(`${name}: review receipt is missing; run ownmem review bootstrap or confirm`);
      continue;
    }
    if (receipt.review_by !== topic.record.metadata.review_by) {
      errors.push(`${name}: review_by ${topic.record.metadata.review_by} does not match receipt ${receipt.review_by}`);
    }
    const digest = semanticDigest(topic.record);
    if (receipt.content_sha256 !== digest) {
      errors.push(`${name}: reviewed content changed; confirm the current text before extending or delivering it`);
    }
    if (receipt.receipt_id !== receiptId(name, receipt)) {
      errors.push(`${name}: review receipt_id is invalid`);
    }
    if (receipt.source === 'confirmed') {
      const topicPath = topic.relativePath;
      if (!hasUncommittedChanges(options.root, [relativeLock, topicPath])) {
        const commit = gitReceiptCommit(options.root, relativeLock, receipt.receipt_id);
        if (!commit) {
          errors.push(`${name}: confirmed review receipt has no git commit fact`);
        } else {
          const files = execFileSync('git', ['-C', options.root, 'show', '--format=', '--name-only', commit], { encoding: 'utf8' }).split(/\r?\n/);
          if (!files.includes(topicPath)) errors.push(`${name}: review receipt and topic were not committed together`);
        }
      }
    }
  }
  for (const name of Object.keys(lock.topics)) {
    if (!expected.has(name)) errors.push(`${name}: stale review receipt points to a non-reviewable or inactive topic`);
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
  process.stdout.write(`Memory reviews: ${topics.length} receipt(s) valid.\n`);
}

function bootstrap(options) {
  const lock = readLock(options);
  let added = 0;
  for (const topic of preferenceTopics(options)) {
    const name = topic.record.name;
    if (lock.topics[name]) continue;
    const receipt = {
      review_by: topic.record.metadata.review_by,
      reviewed_on: topic.record.metadata.last_verified,
      content_sha256: semanticDigest(topic.record),
      source: 'baseline',
      reason: 'strict lifecycle migration baseline; not a new human confirmation',
    };
    receipt.receipt_id = receiptId(name, receipt);
    lock.topics[name] = receipt;
    added += 1;
  }
  lock.updated_at = new Date().toISOString().slice(0, 10);
  lock.topics = Object.fromEntries(Object.entries(lock.topics).sort(([left], [right]) => left.localeCompare(right)));
  writeFileSync(lockPath(options), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  process.stdout.write(`Memory review baseline: ${added} receipt(s) added.\n`);
}

function confirm(options) {
  if (!options.name) throw new Error('confirm requires a topic name');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.reviewBy)) throw new Error('confirm requires --review-by YYYY-MM-DD');
  const today = new Date().toISOString().slice(0, 10);
  if (options.reviewBy <= today) throw new Error('--review-by must be in the future');
  const horizon = new Date(`${today}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 365);
  if (options.reviewBy > horizon.toISOString().slice(0, 10)) throw new Error('--review-by must be within 365 days');
  if (options.reason.trim().length < 10) throw new Error('confirm requires --reason with at least 10 characters');

  const topic = preferenceTopics(options).find((candidate) => candidate.record.name === options.name);
  if (!topic) throw new Error(`active preference/feedback topic not found: ${options.name}`);
  const updated = topic.content
    .replace(/^(\s{2}last_verified:)\s*.*$/m, `$1 ${today}`)
    .replace(/^(\s{2}review_by:)\s*.*$/m, `$1 ${options.reviewBy}`);
  const parsed = parseMemoryContent(updated, {
    source: topic.relativePath,
    fileName: topic.fileName,
    active: true,
  });
  const errors = parsed.issues.filter((item) => item.level === 'error');
  if (errors.length > 0) throw new Error(errors.map((item) => item.message).join('; '));
  writeFileSync(topic.path, updated, 'utf8');

  const lock = readLock(options);
  const receipt = {
    review_by: options.reviewBy,
    reviewed_on: today,
    content_sha256: semanticDigest(parsed.record),
    source: 'confirmed',
    reason: options.reason.trim(),
  };
  receipt.receipt_id = receiptId(options.name, receipt);
  lock.updated_at = today;
  lock.topics[options.name] = receipt;
  lock.topics = Object.fromEntries(Object.entries(lock.topics).sort(([left], [right]) => left.localeCompare(right)));
  writeFileSync(lockPath(options), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  process.stdout.write(`Confirmed ${options.name} through ${options.reviewBy}; commit the topic and review.lock.json together.\n`);
}

export function runReviewCli(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.command === 'check') check(options);
  else if (options.command === 'bootstrap') bootstrap(options);
  else if (options.command === 'confirm') confirm(options);
  else throw new Error(`unknown command: ${options.command}`);
  return 0;
}

if (isMemoryCliEntry(import.meta.url)) {
  try {
    process.exitCode = runReviewCli();
  } catch (error) {
    process.stderr.write(`ownmem review: ${error.message}\n`);
    process.exitCode = 1;
  }
}
