// Persistent rollback for an OwnMem promotion.
//
// The tripwire decides whether a promotion became unsafe. This module performs the compensating
// transaction without giving automation permission to undo somebody else's work. Only receipts
// that were originally admitted as `automation: auto` are eligible for unattended rollback, and
// the current file must still hash to the promoted candidate before any byte is replaced.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  appendPromotionReceipt,
  createPromotionRollback,
  planPromotionQuota,
  promotionReceiptsFor,
  readPromotionLedger,
} from './memory-promotion-receipt.mjs';
import { recordQuarantine } from './memory-quarantine.mjs';

export const PROMOTION_ROLLBACK_RESULT_SCHEMA = 'ownmem-promotion-rollback-result/v1';

const sha256 = value => createHash('sha256').update(value).digest('hex');

function atomicWrite(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.ownmem-rollback-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Recover the bytes a restore plan names and verify them against its immutable hash. */
export function restoreContentFromPlan({ root, restore }) {
  if (restore.operation !== 'restore-content') throw new Error(`unknown restore operation ${restore.operation}`);
  if (!restore.source_commit) throw new Error('a restore needs the commit it was taken from');
  let content;
  try {
    content = execFileSync('git', ['-C', root, 'show', `${restore.source_commit}:${restore.path}`], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`could not read ${restore.path} at ${restore.source_commit.slice(0, 12)}: ${error.message}`);
  }
  const digest = sha256(Buffer.from(content, 'utf8'));
  if (digest !== restore.content_sha256) {
    throw new Error(`restored ${restore.path} hashes to ${digest.slice(0, 12)} but the receipt expects ${String(restore.content_sha256).slice(0, 12)}`);
  }
  return content;
}

function reverseByteInsert(content, restore) {
  const source = Buffer.from(content);
  const start = restore.byte_offset;
  const end = start + restore.inserted_bytes;
  if (!Number.isInteger(start) || !Number.isInteger(restore.inserted_bytes) || start < 0 || end > source.length) {
    throw new Error('reverse-byte-insert carries an invalid byte range');
  }
  const inserted = source.subarray(start, end);
  if (sha256(inserted) !== restore.inserted_sha256) {
    throw new Error('reverse-byte-insert does not match the bytes recorded by the promotion');
  }
  const restored = Buffer.concat([source.subarray(0, start), source.subarray(end)]);
  if (sha256(restored) !== restore.content_sha256) {
    throw new Error('reverse-byte-insert did not recover the pre-promotion content hash');
  }
  return restored.toString('utf8');
}

/**
 * Plan or apply one rollback using the append-only promotion chain.
 *
 * `requireAutomatic` is the capability boundary used by unattended evolution. The explicit CLI
 * may set it to false, but automation cannot retract a manually approved promotion by accident.
 */
export function rollbackPromotion({
  root,
  memoryDir = '.ownmem',
  promotionId,
  ledgerFile,
  quarantineFile,
  signal = 'wrong-feedback',
  reason = 'promotion rolled back',
  verifier = { kind: 'machine', id: 'ownmem-promotion-rollback' },
  requireAutomatic = false,
  quarantine = true,
  apply = false,
  now = new Date(),
} = {}) {
  if (!root) throw new Error('rollbackPromotion requires a repository root');
  if (!promotionId) throw new Error('rollbackPromotion requires a promotion id');
  const { ledger } = readPromotionLedger({
    root,
    memoryDir,
    ...(ledgerFile ? { fileName: ledgerFile } : {}),
  });
  const chain = promotionReceiptsFor(ledger, promotionId);
  const promoted = [...chain].reverse().find(receipt => receipt.operation === 'promote');
  if (!promoted) throw new Error(`no promotion named ${promotionId}`);
  if (chain[chain.length - 1]?.operation === 'rollback') {
    throw new Error(`promotion ${promotionId} has already been rolled back by ${chain[chain.length - 1].receipt_id.slice(0, 12)}`);
  }
  if (requireAutomatic && promoted.decision.automation !== 'auto') {
    throw new Error(`promotion ${promotionId} was admitted as ${promoted.decision.automation}, so unattended rollback is forbidden`);
  }

  const undone = createPromotionRollback({
    receipt: promoted,
    issued_at: now.toISOString(),
    verifier,
    quota: planPromotionQuota({ root, memoryDir, promotion_id: promotionId }),
    reason,
  });
  const restore = undone.change.operations[0];
  const absolute = path.resolve(root, restore.path);
  const current = existsSync(absolute) ? readFileSync(absolute) : null;
  const currentDigest = current ? sha256(current) : null;
  if (currentDigest !== promoted.candidate.content_sha256) {
    throw new Error(`${restore.path} no longer matches the promoted candidate; rollback refused to preserve later edits`);
  }
  const restored = restore.operation === 'remove-topic'
    ? null
    : restore.operation === 'reverse-byte-insert'
      ? reverseByteInsert(current, restore)
      : restoreContentFromPlan({ root, restore });

  const result = {
    schema: PROMOTION_ROLLBACK_RESULT_SCHEMA,
    promotion_id: promotionId,
    memory_id: promoted.candidate.memory_id,
    previous_receipt_id: promoted.receipt_id,
    rollback_receipt_id: undone.receipt.receipt_id,
    operations: undone.change.operations,
    runtime: undone.runtime,
    automatic_eligible: promoted.decision.automation === 'auto',
    applied: false,
    receipt: undone.receipt,
  };
  if (!apply) return result;

  if (quarantine) {
    recordQuarantine({
      root,
      ...(quarantineFile ? { file: quarantineFile } : {}),
      memoryId: promoted.candidate.memory_id,
      signal,
      promotionId,
      receiptId: promoted.receipt_id,
      source: 'rollback',
      reason,
      now,
    });
  }
  try {
    if (restore.operation === 'remove-topic') rmSync(absolute, { force: true });
    else atomicWrite(absolute, restored);
    appendPromotionReceipt({
      root,
      memoryDir,
      ...(ledgerFile ? { fileName: ledgerFile } : {}),
      ledger,
      receipt: undone.receipt,
      now,
    });
  } catch (error) {
    if (current) atomicWrite(absolute, current.toString('utf8'));
    else rmSync(absolute, { force: true });
    throw error;
  }
  result.applied = true;
  return result;
}
