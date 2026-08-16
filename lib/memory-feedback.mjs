import { existsSync, readFileSync } from 'node:fs';

const VERDICTS = new Set(['correct', 'wrong', 'miss']);

export function readFeedbackInbox(file, activeNames = new Set()) {
  if (!existsSync(file)) {
    return { file, entries: [], errors: [], duplicates: 0 };
  }

  const entries = [];
  const errors = [];
  const seen = new Set();
  let duplicates = 0;
  for (const [index, line] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      errors.push(`line ${index + 1}: invalid JSON: ${error.message}`);
      continue;
    }
    if (!['ownmem-recall-feedback/v1', 'oriveo.memory-recall-feedback/v1'].includes(entry.schema)) {
      errors.push(`line ${index + 1}: unsupported schema ${entry.schema || '(missing)'}`);
      continue;
    }
    if (!VERDICTS.has(entry.verdict)) {
      errors.push(`line ${index + 1}: invalid verdict ${entry.verdict || '(missing)'}`);
      continue;
    }
    if (typeof entry.query !== 'string' || !entry.query.trim()) {
      errors.push(`line ${index + 1}: query must be a non-empty string`);
      continue;
    }
    if (!Array.isArray(entry.returned) || entry.returned.some((name) => typeof name !== 'string')) {
      errors.push(`line ${index + 1}: returned must be an array of memory names`);
      continue;
    }
    if (entry.verdict !== 'correct' && (typeof entry.expected !== 'string' || !entry.expected)) {
      errors.push(`line ${index + 1}: ${entry.verdict} requires expected`);
      continue;
    }
    if (entry.expected && activeNames.size > 0 && !activeNames.has(entry.expected)) {
      errors.push(`line ${index + 1}: expected memory is no longer active: ${entry.expected}`);
      continue;
    }
    const key = `${entry.query}\u0000${entry.verdict}\u0000${entry.expected || ''}`;
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
    entries.push({ ...entry, line: index + 1 });
  }
  return { file, entries, errors, duplicates };
}

// resolvedLines carries misses that a later recall improvement already fixed. They stay in the inbox as
// history but must leave the actionable count, or the queue can never reach zero and every consumer
// keeps reporting work that no longer exists.
export function summarizeFeedback(inbox, { resolvedLines = new Set() } = {}) {
  const verdicts = { correct: 0, wrong: 0, miss: 0 };
  for (const entry of inbox.entries) verdicts[entry.verdict] += 1;
  return {
    total: inbox.entries.length,
    verdicts,
    resolved: inbox.entries.filter((entry) => resolvedLines.has(entry.line)).length,
    actionable: inbox.entries
      .filter((entry) => entry.verdict !== 'correct' && !resolvedLines.has(entry.line)).length,
    invalid: inbox.errors.length,
    duplicates: inbox.duplicates,
  };
}

export function readTriggerBackfillReceipts(file) {
  if (!existsSync(file)) return { file, entries: [], errors: [] };
  const entries = [];
  const errors = [];
  const seen = new Set();
  for (const [index, line] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      errors.push(`line ${index + 1}: invalid JSON: ${error.message}`);
      continue;
    }
    if (!['ownmem-trigger-backfill-receipt/v1', 'oriveo.memory-trigger-backfill-receipt/v1'].includes(entry.schema)) {
      errors.push(`line ${index + 1}: unsupported schema ${entry.schema || '(missing)'}`);
      continue;
    }
    const fields = Object.keys(entry).sort().join(',');
    if (fields !== 'feedback_line,feedback_recorded_at,query_sha256,recorded_at,schema,target,trigger') {
      errors.push(`line ${index + 1}: receipt contains missing or unknown fields`);
      continue;
    }
    if (!Number.isInteger(entry.feedback_line) || entry.feedback_line < 1) {
      errors.push(`line ${index + 1}: feedback_line must be a positive integer`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(entry.recorded_at || '')
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(entry.feedback_recorded_at || '')
        || typeof entry.target !== 'string' || !entry.target
        || typeof entry.trigger !== 'string' || !entry.trigger
        || !/^[a-f0-9]{64}$/.test(entry.query_sha256 || '')) {
      errors.push(`line ${index + 1}: target, trigger, and query_sha256 are required`);
      continue;
    }
    if (seen.has(entry.feedback_line)) {
      errors.push(`line ${index + 1}: duplicate receipt for feedback line ${entry.feedback_line}`);
      continue;
    }
    seen.add(entry.feedback_line);
    entries.push({ ...entry, line: index + 1 });
  }
  return { file, entries, errors };
}

export function readMissResolutionReceipts(file) {
  if (!existsSync(file)) return { entries: [], errors: [] };
  const entries = [];
  const errors = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.schema !== 'ownmem-miss-resolution-receipt/v1') throw new Error('unexpected schema');
      entries.push({ ...parsed, line: index + 1 });
    } catch (error) {
      errors.push(`resolution receipt line ${index + 1}: ${error.message}`);
    }
  }
  return { entries, errors };
}
