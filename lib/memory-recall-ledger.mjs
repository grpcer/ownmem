import { randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY } from './memory-observability.mjs';

/**
 * Append-only ledger of recently delivered recalls. The hook daemon and the cold CLI both write
 * it, so a full-text open observed by the hook can pair with a recall no matter which surface
 * produced it, and the pairing survives daemon idle exits.
 */

export const MEMORY_RECALL_LEDGER_SCHEMA = 'ownmem-recent-recall/v1';
export const MEMORY_RECALL_LEDGER_FILE = 'recent-recalls.jsonl';
export const MEMORY_RECALL_LEDGER_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_LEDGER_BYTES = 256 * 1024;
const TRACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function ledgerFile(root, directory) {
  const absoluteRoot = path.resolve(root);
  const absoluteDirectory = path.resolve(absoluteRoot, directory);
  const relative = path.relative(absoluteRoot, absoluteDirectory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('memory recall ledger directory must be inside the repository root');
  }
  return path.join(absoluteDirectory, MEMORY_RECALL_LEDGER_FILE);
}

function freshEntries(file, now) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const cutoff = now.getTime() - MEMORY_RECALL_LEDGER_TTL_MS;
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.schema !== MEMORY_RECALL_LEDGER_SCHEMA) continue;
      if (!TRACE_ID_PATTERN.test(entry.trace_id || '')) continue;
      if (!Array.isArray(entry.topics) || entry.topics.length === 0) continue;
      const recordedAt = Date.parse(entry.recorded_at);
      if (!Number.isFinite(recordedAt) || recordedAt < cutoff) continue;
      entries.push({ ...entry, recordedAtMs: recordedAt });
    } catch {
      // An interrupted append leaves one partial line; skipping it loses one pairing, not the ledger.
    }
  }
  return entries;
}

function pruneLedger(file, now) {
  try {
    if (statSync(file).size <= MAX_LEDGER_BYTES) return;
  } catch {
    return;
  }
  const kept = freshEntries(file, now)
    .map(({ recordedAtMs, ...entry }) => `${JSON.stringify(entry)}\n`)
    .join('');
  const temporary = path.join(path.dirname(file), `.tmp-ledger-${process.pid}-${randomBytes(6).toString('hex')}`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, kept, 'utf8');
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
  } catch {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

export function rememberMemoryRecall({
  root,
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  traceId,
  sessionId = null,
  snapshotId = null,
  returnedTopics = [],
  source = 'cli',
  now = new Date(),
} = {}) {
  if (!root) return { written: false, reason: 'missing-root' };
  if (!TRACE_ID_PATTERN.test(traceId || '')) return { written: false, reason: 'missing-trace' };
  const topics = [...new Set(returnedTopics)].filter(Boolean).slice(0, 20);
  if (topics.length === 0) return { written: false, reason: 'no-topics' };
  try {
    const file = ledgerFile(root, directory);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const entry = {
      schema: MEMORY_RECALL_LEDGER_SCHEMA,
      recorded_at: now.toISOString(),
      trace_id: traceId,
      session_id: sessionId || null,
      snapshot_id: snapshotId || null,
      topics,
      source: source === 'claude-hook' ? 'claude-hook' : 'cli',
    };
    appendFileSync(file, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
    pruneLedger(file, now);
    return { written: true, reason: null };
  } catch (error) {
    return { written: false, reason: error.message };
  }
}

export class MemoryRecallLedger {
  constructor({ root, directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY } = {}) {
    if (!root) throw new Error('MemoryRecallLedger requires a repository root');
    this.root = root;
    this.directory = directory;
  }

  remember(entry = {}) {
    return rememberMemoryRecall({ root: this.root, directory: this.directory, ...entry });
  }

  /**
   * Pair a full-text open with the recall that returned the topic. A same-session hook delivery is
   * the strongest pairing; any other fresh delivery of the topic counts as recent.
   */
  consume({ sessionId = null, memoryId, now = new Date() } = {}) {
    if (!memoryId) return null;
    let entries;
    try {
      entries = freshEntries(ledgerFile(this.root, this.directory), now);
    } catch {
      return null;
    }
    const candidates = entries
      .filter((entry) => entry.topics.includes(memoryId))
      .sort((left, right) => right.recordedAtMs - left.recordedAtMs);
    if (candidates.length === 0) return null;
    const sameSession = sessionId
      ? candidates.find((entry) => entry.session_id === sessionId)
      : null;
    const matched = sameSession || candidates[0];
    return {
      traceId: matched.trace_id,
      snapshotId: matched.snapshot_id,
      topics: [memoryId],
      via: 'claude-hook',
      match: sameSession ? 'session' : 'recent',
    };
  }
}
