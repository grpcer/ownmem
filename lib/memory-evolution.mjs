// Unattended low-risk evolution coordinator.
//
// This is intentionally a coordinator, not a second implementation of any gate. Candidate
// extraction, replay, promotion policy, quota, trust, audit, compilation and tripwires keep their
// own authority. The coordinator supplies ordering, exclusion, rollback and a truthful local
// status surface so a host can run the safe path at the end of a turn without a person supervising
// each step.

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { collectMemoryAudit } from './memory-audit.mjs';
import { scanCandidateQueue } from './features/candidates.mjs';
import { promoteTriggerBackfills } from './features/promote.mjs';
import { observeTripwire, parseTripwireOptions } from './features/tripwire.mjs';
import { compileMemoryIndex } from './memory-compiler.mjs';
import {
  CANDIDATE_MIN_FAILURES,
  DEFAULT_MEMORY_CANDIDATE_DIRECTORY,
} from './memory-candidates.mjs';
import {
  createMemoryObservabilityEvent,
  DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  recordMemoryObservabilityEvent,
} from './memory-observability.mjs';
import { rollbackPromotion } from './memory-promotion-rollback.mjs';
import { applyPromotionTripwire } from './memory-tripwire.mjs';
import { issueMemoryTrustReceipts } from './memory-trust-migration.mjs';
import { DEFAULT_BACKFILL_RECEIPT_FILE } from './memory-trigger-backfill.mjs';

export const MEMORY_EVOLUTION_SCHEMA = 'ownmem-evolution-run/v1';
export const MEMORY_EVOLUTION_STATE_SCHEMA = 'ownmem-evolution-state/v1';
export const DEFAULT_MEMORY_EVOLUTION_DIRECTORY = '.local-test/memory-evolution';
export const DEFAULT_MEMORY_EVOLUTION_MIN_INTERVAL_MS = 60_000;

function paths(root, directory = DEFAULT_MEMORY_EVOLUTION_DIRECTORY) {
  const base = path.resolve(root, directory);
  const relative = path.relative(path.resolve(root), base);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('memory evolution directory must be inside the repository root');
  }
  return {
    base,
    state: path.join(base, 'state.json'),
    lock: path.join(base, 'run.lock'),
    disabled: path.join(base, 'disabled'),
  };
}

function atomicText(file, content) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function atomicJson(file, value) {
  atomicText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function emptyState() {
  return {
    schema: MEMORY_EVOLUTION_STATE_SCHEMA,
    updated_at: null,
    enabled: true,
    last_run: null,
    totals: { runs: 0, promotions: 0, rollbacks: 0, blocked: 0, failures: 0 },
  };
}

export function readMemoryEvolutionState({ root, directory = DEFAULT_MEMORY_EVOLUTION_DIRECTORY } = {}) {
  const location = paths(root, directory);
  let state = emptyState();
  if (existsSync(location.state)) {
    try {
      const parsed = JSON.parse(readFileSync(location.state, 'utf8'));
      if (parsed?.schema === MEMORY_EVOLUTION_STATE_SCHEMA) state = parsed;
    } catch {
      state = emptyState();
    }
  }
  state.enabled = !existsSync(location.disabled);
  return { ...state, directory: path.relative(root, location.base) };
}

export function setMemoryEvolutionEnabled({ root, directory = DEFAULT_MEMORY_EVOLUTION_DIRECTORY, enabled }) {
  const location = paths(root, directory);
  mkdirSync(location.base, { recursive: true, mode: 0o700 });
  if (enabled) rmSync(location.disabled, { force: true });
  else writeFileSync(location.disabled, 'disabled by repository operator\n', { encoding: 'utf8', mode: 0o600 });
  const state = readMemoryEvolutionState({ root, directory });
  state.updated_at = new Date().toISOString();
  const { directory: _directory, ...stored } = state;
  atomicJson(location.state, stored);
  return state;
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function acquireLock(file, now) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor;
    try {
      descriptor = openSync(file, 'wx', 0o600);
      writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, started_at: now.toISOString() })}\n`, 'utf8');
      closeSync(descriptor);
      return { acquired: true, release: () => rmSync(file, { force: true }) };
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (error.code !== 'EEXIST') throw error;
      let owner = null;
      try { owner = JSON.parse(readFileSync(file, 'utf8')); } catch { /* stale malformed lock */ }
      const old = (() => { try { return now.getTime() - statSync(file).mtimeMs > 30 * 60_000; } catch { return true; } })();
      if (!old && processAlive(owner?.pid)) return { acquired: false, reason: 'locked' };
      rmSync(file, { force: true });
    }
  }
  return { acquired: false, reason: 'locked' };
}

function auditErrors(report) {
  return report.issues.filter(item => item.level === 'error');
}

function compileSummary(compiled) {
  if (!compiled) return null;
  return {
    published: compiled.published === true,
    unchanged: compiled.unchanged === true,
    snapshot_id: compiled.manifest?.snapshot?.id || null,
    mode: compiled.stats?.mode || null,
    source_files: compiled.stats?.source_files ?? null,
    compiled_topics: compiled.stats?.compiled_topics ?? null,
    reused_topics: compiled.stats?.reused_topics ?? null,
  };
}

function candidateOptions(options) {
  return {
    root: options.root,
    memoryDir: options.memoryDir,
    observabilityDirectory: options.observabilityDirectory,
    directory: options.candidateDirectory,
    minFailures: CANDIDATE_MIN_FAILURES,
    externalContextPresent: false,
  };
}

function tripwireOptions(options) {
  return parseTripwireOptions([
    'apply', '--root', options.root, '--memory-dir', options.memoryDir,
    '--observability-dir', options.observabilityDirectory,
  ]);
}

function uniquePromotionHits(evaluation) {
  const seen = new Set();
  return evaluation.hits.filter(hit => {
    if (hit.action !== 'rollback' || seen.has(hit.promotion_id)) return false;
    seen.add(hit.promotion_id);
    return true;
  });
}

function recordRunEvent(options, result, durationMs, now) {
  const event = createMemoryObservabilityEvent({
    event: 'evolution.completed',
    component: 'memory-evolution',
    now,
    payload: {
      status: result.status,
      source: options.source,
      dry_run: options.dryRun,
      candidates: result.candidates.accepted,
      promotions: result.promotions.applied,
      rollbacks: result.rollbacks.applied,
      blocked: result.blocked.length,
      audit_errors: result.audit.errors,
      duration_ms: durationMs,
    },
  });
  return recordMemoryObservabilityEvent({ root: options.root, directory: options.observabilityDirectory, event });
}

function persistRun(options, result, durationMs, now) {
  const location = paths(options.root, options.directory);
  const previous = readMemoryEvolutionState({ root: options.root, directory: options.directory });
  const state = {
    schema: MEMORY_EVOLUTION_STATE_SCHEMA,
    updated_at: now.toISOString(),
    enabled: true,
    last_run: { ...result, duration_ms: durationMs },
    totals: {
      runs: previous.totals.runs + 1,
      promotions: previous.totals.promotions + result.promotions.applied,
      rollbacks: previous.totals.rollbacks + result.rollbacks.applied,
      blocked: previous.totals.blocked + result.blocked.length,
      failures: previous.totals.failures + (result.status === 'failed' ? 1 : 0),
    },
  };
  atomicJson(location.state, state);
  return state;
}

function skippedResult(reason, now, enabled = true) {
  return {
    schema: MEMORY_EVOLUTION_SCHEMA,
    run_at: now.toISOString(),
    status: 'skipped',
    skipped: reason,
    enabled,
    candidates: { accepted: 0, queue: 0 },
    promotions: { pending: 0, applied: 0, blocked_details: [] },
    rollbacks: { proposed: 0, applied: 0 },
    blocked: [],
    audit: { errors: 0, warnings: 0 },
    compile: null,
    error: null,
  };
}

/** Run one bounded safe-maintenance transaction. */
export function runMemoryEvolution({
  root,
  memoryDir = '.ownmem',
  directory = DEFAULT_MEMORY_EVOLUTION_DIRECTORY,
  observabilityDirectory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  candidateDirectory = DEFAULT_MEMORY_CANDIDATE_DIRECTORY,
  source = 'host-turn',
  dryRun = false,
  force = false,
  minIntervalMs = DEFAULT_MEMORY_EVOLUTION_MIN_INTERVAL_MS,
  operations = {},
  now = new Date(),
} = {}) {
  if (!root) throw new Error('runMemoryEvolution requires a repository root');
  if (!/^[a-z0-9._-]+$/u.test(source)) throw new Error('memory evolution source must be a short identifier');
  const options = { root: path.resolve(root), memoryDir, directory, observabilityDirectory, candidateDirectory, source, dryRun, force };
  const compileIndex = operations.compileMemoryIndex || compileMemoryIndex;
  const location = paths(options.root, directory);
  const prior = readMemoryEvolutionState({ root: options.root, directory });
  if (!prior.enabled) return skippedResult('disabled', now, false);
  const last = Date.parse(prior.last_run?.run_at || '');
  if (!force && Number.isFinite(last) && now.getTime() - last < minIntervalMs) return skippedResult('debounced', now);
  const lock = acquireLock(location.lock, now);
  if (!lock.acquired) return skippedResult(lock.reason, now);

  const started = performance.now();
  const result = {
    schema: MEMORY_EVOLUTION_SCHEMA,
    run_at: now.toISOString(),
    status: 'completed',
    skipped: null,
    enabled: true,
    candidates: { accepted: 0, queue: 0 },
    promotions: { pending: 0, applied: 0, blocked_details: [] },
    rollbacks: { proposed: 0, applied: 0 },
    blocked: [],
    audit: { errors: 0, warnings: 0 },
    compile: null,
    error: null,
  };
  const appliedPromotionIds = [];
  const backfillReceiptFile = path.resolve(options.root, DEFAULT_BACKFILL_RECEIPT_FILE);
  let backfillReceiptBefore = null;
  let backfillReceiptExisted = false;
  try {
    const tripOptions = tripwireOptions(options);
    const observed = observeTripwire(tripOptions, { now });
    const rollbackHits = uniquePromotionHits(observed.evaluation);
    const tripwireRestoredMemories = [];
    const reviewRollbackPromotions = new Set();
    result.rollbacks.proposed = rollbackHits.length;
    for (const hit of rollbackHits) {
      try {
        const rollback = rollbackPromotion({
          root: options.root,
          memoryDir,
          promotionId: hit.promotion_id,
          signal: hit.signal,
          reason: `unattended tripwire: ${hit.signal}`,
          verifier: { kind: 'machine', id: 'ownmem-evolution-tripwire' },
          requireAutomatic: true,
          apply: !dryRun,
          now,
        });
        if (rollback.applied) {
          result.rollbacks.applied += 1;
          tripwireRestoredMemories.push(rollback.memory_id);
        }
      } catch (error) {
        result.blocked.push(`rollback:${hit.promotion_id}:${error.message}`);
        reviewRollbackPromotions.add(hit.promotion_id);
      }
    }
    const safety = applyPromotionTripwire({
      root: options.root,
      memoryDir,
      quarantineFile: tripOptions.quarantineFile,
      changeDirectory: tripOptions.changeDirectory,
      ledger: observed.ledger,
      evaluation: {
        ...observed.evaluation,
        hits: observed.evaluation.hits.filter(hit => hit.action !== 'rollback'
          || reviewRollbackPromotions.has(hit.promotion_id)),
      },
      apply: !dryRun,
      now,
    });
    if (!dryRun && tripwireRestoredMemories.length > 0) {
      issueMemoryTrustReceipts({
        root: options.root,
        memoryDir,
        memoryIds: [...new Set(tripwireRestoredMemories)],
        write: true,
        now,
      });
    }
    for (const skipped of safety.skipped) {
      if (!String(skipped.skipped).startsWith('already-quarantined')) result.blocked.push(`tripwire:${skipped.memory_id}:${skipped.skipped}`);
    }

    const scanned = scanCandidateQueue(candidateOptions(options), { now, write: !dryRun });
    result.candidates = { accepted: scanned.accepted, queue: scanned.queue };

    const preflight = collectMemoryAudit({ root: options.root, memoryDir, strictWorkingTree: false });
    const preflightErrors = auditErrors(preflight);
    result.audit = {
      errors: preflightErrors.length,
      warnings: preflight.issues.filter(item => item.level === 'warning').length,
    };
    if (preflightErrors.length > 0) {
      result.status = 'blocked';
      result.blocked.push(...preflightErrors.slice(0, 10).map(item => `audit:${item.code}`));
    } else {
      backfillReceiptExisted = existsSync(backfillReceiptFile);
      backfillReceiptBefore = backfillReceiptExisted ? readFileSync(backfillReceiptFile, 'utf8') : null;
      const promoted = promoteTriggerBackfills({
        root: options.root,
        memoryDir,
        apply: !dryRun,
        casesFile: null,
        limit: 3,
        json: false,
      }, { now });
      result.promotions = {
        pending: promoted.pending,
        applied: promoted.applied,
        blocked_details: promoted.results.filter(item => !item.applied).map(item => ({
          memory_id: item.proposal.memory_id,
          blockers: item.plan.blockers,
          replay: item.gate.replay.reason,
          regression: item.gate.regression.reason,
        })),
      };
      result.blocked.push(...promoted.results
        .filter(item => !item.applied && item.plan.blockers.length > 0)
        .map(item => `promotion:${item.proposal.memory_id}:${item.plan.blockers.join('+')}`));
      appliedPromotionIds.push(...promoted.results.filter(item => item.applied).map(item => item.proposal.promotion_id));

      if (!dryRun && promoted.applied > 0) {
        const memoryIds = [...new Set(promoted.results.filter(item => item.applied).map(item => item.proposal.memory_id))];
        issueMemoryTrustReceipts({ root: options.root, memoryDir, memoryIds, write: true, now });
        const postflight = collectMemoryAudit({ root: options.root, memoryDir, strictWorkingTree: false });
        const postflightErrors = auditErrors(postflight);
        result.audit = {
          errors: postflightErrors.length,
          warnings: postflight.issues.filter(item => item.level === 'warning').length,
        };
        if (postflightErrors.length > 0) {
          throw new Error(`post-promotion audit failed: ${postflightErrors.slice(0, 5).map(item => item.code).join(', ')}`);
        }
      }
      if (!dryRun) result.compile = compileSummary(compileIndex({ root: options.root, memoryDir, now }));
      if (result.blocked.length > 0 && result.status === 'completed') result.status = 'blocked';
    }
  } catch (error) {
    result.status = 'failed';
    result.error = error.message;
    if (!dryRun) {
      // A local resolution receipt is written alongside materialization so later turns do not
      // reapply a successful backfill. If the enclosing transaction fails, restore the prior queue
      // state so an infrastructure failure does not suppress a still-unresolved retrieval miss.
      if (appliedPromotionIds.length > 0) {
        try {
          if (backfillReceiptExisted) atomicText(backfillReceiptFile, backfillReceiptBefore);
          else rmSync(backfillReceiptFile, { force: true });
        } catch (receiptRecoveryError) {
          result.blocked.push(`feedback-recovery:${receiptRecoveryError.message}`);
        }
      }
      const restoredMemories = [];
      for (const promotionId of [...appliedPromotionIds].reverse()) {
        try {
          const rollback = rollbackPromotion({
            root: options.root,
            memoryDir,
            promotionId,
            signal: 'gate-conflict',
            reason: `unattended transaction failed: ${error.message}`,
            verifier: { kind: 'machine', id: 'ownmem-evolution-compensation' },
            requireAutomatic: true,
            quarantine: false,
            apply: true,
            now,
          });
          result.rollbacks.applied += 1;
          restoredMemories.push(rollback.memory_id);
        } catch (rollbackError) {
          result.blocked.push(`compensation:${promotionId}:${rollbackError.message}`);
        }
      }
      if (restoredMemories.length > 0) {
        try {
          issueMemoryTrustReceipts({ root: options.root, memoryDir, memoryIds: [...new Set(restoredMemories)], write: true, now });
          result.compile = compileSummary(compileIndex({ root: options.root, memoryDir, now, force: true }));
        } catch (recoveryError) {
          result.blocked.push(`recovery:${recoveryError.message}`);
        }
      }
    }
  } finally {
    const durationMs = Math.max(0, performance.now() - started);
    if (!dryRun) {
      try { recordRunEvent(options, result, durationMs, now); } catch { /* observability is fail-open */ }
      persistRun(options, result, durationMs, now);
    }
    lock.release();
  }
  return result;
}
