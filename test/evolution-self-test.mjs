#!/usr/bin/env node

// Production-path proof for unattended R0 promotion and automatic rollback.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeMemoryRepository } from '../lib/memory-init.mjs';
import { runMemoryEvolution } from '../lib/memory-evolution.mjs';
import { readPromotionLedger, promotionReceiptsFor } from '../lib/memory-promotion-receipt.mjs';
import { readMemoryTrustLock } from '../lib/memory-trust-store.mjs';
import { issueMemoryTrustReceipts } from '../lib/memory-trust-migration.mjs';
import { recordOutcomeReceipt } from '../lib/features/outcome.mjs';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}

const root = mkdtempSync(path.join(tmpdir(), 'ownmem-evolution-'));
process.on('exit', () => rmSync(root, { recursive: true, force: true }));
const memoryDir = '.claude/memory';
const memory = path.join(root, memoryDir);
const topic = path.join(memory, 'example_repository_memory.md');
const query = 'cerulean orbital latch refuses to close';
const now = new Date('2026-08-24T08:00:00.000Z');
const retryNow = new Date('2026-08-24T08:01:00.000Z');
const later = new Date('2026-08-24T08:03:00.000Z');
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');

function git(...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
}

mkdirSync(root, { recursive: true });
git('init', '-q');
git('config', 'user.name', 'OwnMem Test');
git('config', 'user.email', 'ownmem-test@example.invalid');
initializeMemoryRepository({
  root,
  memoryDir,
  layers: ['core', 'gates', 'compiler', 'dashboard'],
  hosts: ['generic'],
  command: 'npx ownmem',
});
git('add', '.');
git('commit', '-q', '-m', 'initial ownmem fixture');

const original = `---
name: example_repository_memory
description: "alpha widget timeout under saturation"
metadata:
  node_type: memory
  type: lesson
  status: active
  scopes: [general]
  applies_to: [all]
  triggers: ["alpha widget", "connection pool saturation"]
  last_verified: 2026-08-24
  expires_at: null
  authority: observed
  authority_docs: []
  history_docs: []
  supersedes: []
  code_evidence: []
  evidence: [synthetic-evolution-test]
---

# Alpha widget timeout

The alpha widget times out only when its connection pool is saturated.
`;
writeFileSync(topic, original, 'utf8');
writeFileSync(path.join(memory, 'recall-cases.json'), `${JSON.stringify({
  schema: 'ownmem-recall-benchmark/v4',
  description: 'Synthetic regression corpus for unattended evolution.',
  privacy: { visibility: 'public', deidentified_only: true, notes: 'synthetic' },
  golden: [{ id: 'alpha', partition: 'regression', source: 'curated', added_at: '2026-08-24', group: 'anchor', query: 'alpha widget', expected: 'example_repository_memory' }],
  negative: [{ id: 'unrelated', partition: 'regression', source: 'curated', added_at: '2026-08-24', group: 'negative', query: 'purple monsoon ledger' }],
  behavioral: [],
}, null, 2)}\n`, 'utf8');
issueMemoryTrustReceipts({ root, memoryDir, memoryIds: ['example_repository_memory'], write: true, now });
git('add', '.');
git('commit', '-q', '-m', 'prepare evolution fixture');

mkdirSync(path.join(root, '.local-test'), { recursive: true });
writeFileSync(path.join(root, '.local-test', 'memory-recall-feedback.jsonl'), `${JSON.stringify({
  schema: 'ownmem-recall-feedback/v3',
  recordedAt: '2026-08-24T07:59:00.000Z',
  query,
  verdict: 'retrieval_miss',
  expected: 'example_repository_memory',
  returned: [],
})}\n`, 'utf8');

const compensated = runMemoryEvolution({
  root,
  memoryDir,
  source: 'self-test',
  force: true,
  now,
  operations: { compileMemoryIndex: () => { throw new Error('injected compile failure'); } },
});
assert(compensated.status === 'failed' && compensated.rollbacks.applied === 1,
  'a post-promotion infrastructure failure triggers compensating rollback in the same pass');
assert(readFileSync(topic, 'utf8') === original, 'compensation restores the topic before the failed pass returns');
assert(!existsSync(path.join(root, '.local-test', 'memory-trigger-backfill-receipts.jsonl')),
  'a failed transaction does not suppress the unresolved feedback from a later retry');

const promoted = runMemoryEvolution({ root, memoryDir, source: 'self-test', force: true, now: retryNow });
assert(promoted.status === 'completed', `the unattended pass completes: ${promoted.error || JSON.stringify(promoted.promotions.blocked_details)}`);
assert(promoted.promotions.applied === 1, 'the pass applies the replay-proven R0 trigger without a manual --apply step');
const candidate = readFileSync(topic, 'utf8');
assert(candidate.includes(query), 'the production coordinator materializes the trigger in the topic');
assert(candidate !== original, 'the promoted bytes differ from the pre-promotion topic');
const { ledger } = readPromotionLedger({ root, memoryDir });
const promotionId = Object.keys(ledger.promotions).find(id => id.endsWith('-retry-1'));
assert(Boolean(promotionId), 'a retry after compensated rollback receives a fresh quota and receipt chain');
const firstChain = promotionReceiptsFor(ledger, promotionId);
assert(firstChain.length === 1 && firstChain[0].operation === 'promote', 'the automatic write carries an append-only promotion receipt');
assert(firstChain[0].decision.automation === 'auto', 'the receipt proves the risk matrix admitted automation');
assert(firstChain[0].rollback.restore.operation === 'reverse-byte-insert', 'the receipt carries a content-addressed inverse operation');
const trustAfterPromotion = readMemoryTrustLock({ root, memoryDir }).lock.receipts.example_repository_memory;
assert(trustAfterPromotion.at(-1).memory_sha256 === hash(candidate), 'automatic trust issuance binds the promoted bytes');
assert(promoted.compile?.published === true || promoted.compile?.unchanged === true,
  `the trusted promoted corpus is compiled through the production index path: ${JSON.stringify(promoted.compile)}`);

recordOutcomeReceipt({
  root,
  file: path.join(root, '.local-test', 'memory-outcome-receipts.jsonl'),
  memoryId: 'example_repository_memory',
  outcome: 'harmful',
  confirmedBy: 'host',
  confirmation: 'the promoted trigger caused a harmful recall',
  ledger: { pair: () => ({ traceId: 'fixture-trace', snapshotId: null, match: 'declared' }) },
  now: new Date('2026-08-24T08:02:00.000Z'),
});

const rolledBack = runMemoryEvolution({ root, memoryDir, source: 'self-test', force: true, now: later });
assert(rolledBack.rollbacks.applied === 1, `the harmful automatic promotion rolls back: ${rolledBack.blocked.join('; ')}`);
assert(readFileSync(topic, 'utf8') === original, 'rollback restores the exact pre-promotion bytes');
const finalLedger = readPromotionLedger({ root, memoryDir }).ledger;
const finalChain = promotionReceiptsFor(finalLedger, promotionId);
assert(finalChain.length === 2 && finalChain[1].operation === 'rollback', 'rollback appends history instead of erasing the mistake');
const trustAfterRollback = readMemoryTrustLock({ root, memoryDir }).lock.receipts.example_repository_memory;
assert(trustAfterRollback.at(-1).memory_sha256 === hash(original), 'the restored bytes receive a new trust delta before audit and compilation');

process.stdout.write(`memory evolution self-test: ${passed}/${passed} passed\n`);
