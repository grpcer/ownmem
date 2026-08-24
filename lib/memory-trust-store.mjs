import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { schemaPath } from './schema-paths.mjs';
import {
  assertMemoryLifecycleTransition,
  memoryContentActionRisk,
  memoryContainsInstructionOverride,
  memoryLifecycleInjectable,
  memoryLifecycleTransitionAllowed,
  memoryLogicalType,
} from './memory-lifecycle.mjs';
import {
  EVIDENCE_DRIFT_REASON,
  EVIDENCE_SEVERITY_BLOCKING,
  EVIDENCE_UNVERIFIABLE_REASON,
  TEST_EXECUTION_FAILED_REASON,
  TEST_EXECUTION_REASONS,
  TEST_EXECUTION_STALE_REASON,
  verifyMemoryEvidenceSet,
} from './memory-evidence-verifier.mjs';
import {
  TEST_EXECUTION_FAILED,
  TEST_EXECUTION_STALE,
  readTestExecutionLedger,
} from './memory-test-execution-ledger.mjs';

export const MEMORY_TRUST_SCHEMA = 'ownmem.trust/v1';
export const MEMORY_TRUST_POLICY_ID = 'evidence-governed-v1';
export const MEMORY_TRUST_POLICY_VERSION = '1.0.0';
export const DEFAULT_MEMORY_TRUST_FILE = 'trust.lock.json';

const trustSchema = JSON.parse(readFileSync(schemaPath('trust', 'lock.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
const validateTrustSchema = ajv.compile(trustSchema);
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort(compareText).map(key => [key, stableValue(value[key])]));
}

function stableJson(value, space = 0) {
  return `${JSON.stringify(stableValue(value), null, space)}\n`;
}

export function memoryTrustDigest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function memoryTrustReceiptId(receipt) {
  const { receipt_id: _receiptId, ...content } = receipt;
  return memoryTrustDigest(content);
}

// Normalize every evidence item to the full field set so that receipts stay schema-valid and
// comparable regardless of which binding (content sha256 or code fingerprint) applies.
function normalizeEvidence(evidence) {
  return evidence.map(item => ({
    kind: item.kind,
    locator: item.locator,
    path: item.path ?? null,
    sha256: item.sha256 ?? null,
    fingerprint: item.fingerprint ?? null,
    symbol: item.symbol ?? null,
  }));
}

/**
 * The evidence root a receipt would carry for this evidence set. Exported so a caller can compare
 * freshly recomputed evidence against what a receipt recorded without building a whole receipt --
 * that comparison is the only honest definition of "this memory's evidence drifted".
 */
export function memoryEvidenceRootSha256(evidence) {
  return memoryTrustDigest(normalizeEvidence(evidence));
}

export function createMemoryTrustReceipt(input) {
  assertMemoryLifecycleTransition(input.transition?.from ?? null, input.lifecycle);
  if (input.transition?.to !== input.lifecycle) throw new Error('memory trust transition.to must equal lifecycle');
  const evidence = normalizeEvidence(input.evidence);
  const receipt = {
    receipt_id: '0'.repeat(64),
    memory_id: input.memory_id,
    memory_sha256: input.memory_sha256,
    issued_at: input.issued_at,
    policy_id: MEMORY_TRUST_POLICY_ID,
    policy_version: MEMORY_TRUST_POLICY_VERSION,
    transition: { from: input.transition?.from ?? null, to: input.lifecycle },
    lifecycle: input.lifecycle,
    logical_type: input.logical_type,
    action_risk: input.action_risk,
    authority: input.authority,
    scopes: [...new Set(input.scopes)].sort(compareText),
    change: input.change,
    valid_for: {
      commit_range: input.valid_for?.commit_range ?? null,
      semver: input.valid_for?.semver ?? null,
      platforms: [...new Set(input.valid_for?.platforms || [])].sort(compareText),
      environments: [...new Set(input.valid_for?.environments || [])].sort(compareText),
    },
    preconditions: [...new Set(input.preconditions || [])].sort(compareText),
    postconditions: [...new Set(input.postconditions || [])].sort(compareText),
    counterexamples: [...new Set(input.counterexamples || [])].sort(compareText),
    evidence,
    evidence_root_sha256: memoryTrustDigest(evidence),
    verifier: input.verifier,
    source_commit: input.source_commit ?? null,
    rollback: {
      previous_receipt_id: input.rollback?.previous_receipt_id ?? null,
      previous_memory_sha256: input.rollback?.previous_memory_sha256 ?? null,
    },
  };
  receipt.receipt_id = memoryTrustReceiptId(receipt);
  return receipt;
}

function validationMessage(errors) {
  return (errors || []).slice(0, 8).map(error => {
    if (error.keyword === 'additionalProperties') return `${error.instancePath || '/'} unknown field ${error.params.additionalProperty}`;
    return `${error.instancePath || '/'} ${error.message}`;
  }).join('; ');
}

export function validateMemoryTrustLock(lock) {
  if (!validateTrustSchema(lock)) throw new Error(`memory trust lock is invalid: ${validationMessage(validateTrustSchema.errors)}`);
  for (const [memoryId, receipts] of Object.entries(lock.receipts)) {
    let previous = null;
    for (const receipt of receipts) {
      if (receipt.memory_id !== memoryId) throw new Error(`memory trust receipt key mismatch: ${memoryId}`);
      if (receipt.receipt_id !== memoryTrustReceiptId(receipt)) throw new Error(`memory trust receipt_id is invalid: ${memoryId}`);
      if (receipt.evidence_root_sha256 !== memoryTrustDigest(receipt.evidence)) throw new Error(`memory trust evidence root is invalid: ${memoryId}`);
      assertMemoryLifecycleTransition(receipt.transition.from, receipt.transition.to);
      if (receipt.lifecycle !== receipt.transition.to) throw new Error(`memory trust lifecycle mismatch: ${memoryId}`);
      if (previous && receipt.transition.from !== previous.lifecycle) throw new Error(`memory trust history is discontinuous: ${memoryId}`);
      if (previous && receipt.rollback.previous_receipt_id !== previous.receipt_id) throw new Error(`memory trust rollback receipt is invalid: ${memoryId}`);
      if (previous && receipt.rollback.previous_memory_sha256 !== previous.memory_sha256) throw new Error(`memory trust rollback content is invalid: ${memoryId}`);
      if (!previous && (receipt.change.mode !== 'import' || receipt.change.base_memory_sha256 !== null)) {
        throw new Error(`initial memory trust receipt must be an import: ${memoryId}`);
      }
      if (previous && receipt.change.mode === 'import') throw new Error(`memory trust history cannot re-import active data: ${memoryId}`);
      if (previous && receipt.change.base_memory_sha256 !== previous.memory_sha256) {
        throw new Error(`memory trust change base is invalid: ${memoryId}`);
      }
      if (previous?.lifecycle === 'active' && !['delta', 'structured-merge'].includes(receipt.change.mode)) {
        throw new Error(`active memory only accepts delta or structured-merge changes: ${memoryId}`);
      }
      previous = receipt;
    }
  }
  return lock;
}

export function readMemoryTrustLock({ root, memoryDir = '.ownmem', fileName = DEFAULT_MEMORY_TRUST_FILE, required = true } = {}) {
  const file = path.resolve(root, memoryDir, fileName);
  if (!existsSync(file)) {
    if (required) throw new Error(`memory trust lock is missing: ${path.relative(root, file)}`);
    return { file, lock: null };
  }
  let lock;
  try {
    lock = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`memory trust lock is unreadable: ${error.message}`);
  }
  return { file, lock: validateMemoryTrustLock(lock) };
}

export function writeMemoryTrustLock({ root, memoryDir = '.ownmem', lock, fileName = DEFAULT_MEMORY_TRUST_FILE } = {}) {
  validateMemoryTrustLock(lock);
  const file = path.resolve(root, memoryDir, fileName);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, stableJson(lock, 2), 'utf8');
  renameSync(temporary, file);
  return file;
}

export function memoryGitState(root, memoryDir) {
  try {
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const status = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=all', '--', memoryDir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const entries = status ? status.split(/\r?\n/) : [];
    // Governance locks are expected to change in the same commit that establishes new receipts.
    // Strict mode protects the instruction-bearing Markdown sources; content-bound receipt hashes
    // and the audit schema independently protect the lock itself.
    const topicEntries = entries.filter(entry => /\.md(?:"|$)/u.test(entry));
    return { repository_head: head, working_tree: topicEntries.length > 0 ? 'dirty' : 'clean', entries: topicEntries };
  } catch {
    return { repository_head: null, working_tree: 'unavailable', entries: [] };
  }
}

function receiptForDocument(lock, document) {
  const receipts = lock?.receipts?.[document.id || document.name] || [];
  const receiptId = document.trust?.receipt_id;
  if (!receiptId) return receipts[receipts.length - 1] || null;
  return receipts.find(receipt => receipt.receipt_id === receiptId) || null;
}

function semverParts(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(value || '');
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareSemver(left, right) {
  const leftParts = semverParts(left);
  const rightParts = semverParts(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

function commitInRange(root, commit, range) {
  if (!commit) return false;
  try {
    execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', range.start, commit], { stdio: 'ignore' });
    if (range.end) execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', commit, range.end], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function memoryApplicabilityReasons(root, receipt, context, repositoryHead) {
  const validFor = receipt?.valid_for;
  if (!validFor) return [];
  const reasons = [];
  const commit = context.commit ?? repositoryHead;
  if (validFor.commit_range && !commitInRange(root, commit, validFor.commit_range)) reasons.push('commit-out-of-range');
  if (validFor.semver) {
    const version = context.semver;
    const minimum = version ? compareSemver(version, validFor.semver.min) : null;
    const maximum = version && validFor.semver.max ? compareSemver(version, validFor.semver.max) : null;
    if (minimum === null || minimum < 0 || (maximum !== null && maximum > 0)) reasons.push('semver-out-of-range');
  }
  if (validFor.platforms.length > 0 && !validFor.platforms.includes(context.platform)) reasons.push('platform-out-of-range');
  if (validFor.environments.length > 0 && !validFor.environments.includes(context.environment)) reasons.push('environment-out-of-range');
  return reasons;
}

export function compileMemoryTrust({
  root,
  memoryDir,
  record,
  sourceSha256,
  trustLock,
  now = new Date(),
  gitState = null,
} = {}) {
  const document = {
    id: record.name,
    source_sha256: sourceSha256,
    metadata: { last_verified: record.metadata.last_verified },
  };
  const resolved = resolveMemoryTrust({
    root,
    memoryDir,
    document,
    trustLock,
    now,
    gitState,
    // Compile time has no query, so it must not answer a question that only a query can answer.
    // Evaluating valid_for here reads an empty platform and environment, records
    // platform-out-of-range, and freezes integrity: blocked into the snapshot for every memory
    // that declares a scope -- a verdict recall then contradicts on every real query.
    evaluateApplicability: false,
  });
  const receipt = resolved.receipt;
  const instruction = memoryInstructionPolicy(record);
  return {
    receipt_id: receipt?.receipt_id || null,
    lifecycle: receipt?.lifecycle || 'advisory',
    logical_type: receipt?.logical_type || memoryLogicalType(record),
    action_risk: receipt?.action_risk || memoryContentActionRisk(record),
    authority: resolved.authority,
    issued_at: receipt?.issued_at || null,
    evidence_root_sha256: receipt?.evidence_root_sha256 || null,
    evidence_kinds: [...new Set((receipt?.evidence || []).map(item => item.kind))].sort(compareText),
    source_commit: receipt?.source_commit || null,
    change: receipt?.change || { mode: 'import', base_memory_sha256: null },
    valid_for: receipt?.valid_for || { commit_range: null, semver: null, platforms: [], environments: [] },
    preconditions: receipt?.preconditions || [],
    postconditions: receipt?.postconditions || [],
    counterexamples: receipt?.counterexamples || [],
    integrity: memoryTrustIntegrity(resolved),
    integrity_reasons: [...resolved.reasons, ...resolved.advisory_reasons],
    instruction,
  };
}

/**
 * The three integrity tiers a resolved trust result maps to: passed, advisory (still injectable
 * with capped authority), and blocked (never injected). Both the compiler and the query path derive
 * it here so a snapshot and a live query can never label the same receipt differently.
 * A receipt that is merely missing is advisory rather than blocked: topics that predate the trust
 * lock are downgraded, not silenced.
 */
export function memoryTrustIntegrity(resolved) {
  if (resolved.valid) return (resolved.advisory_reasons || []).length > 0 ? 'advisory' : 'passed';
  return resolved.reasons.length === 1 && resolved.reasons[0] === 'receipt-missing' ? 'advisory' : 'blocked';
}

export function memoryTrustRankingAuthority(trust) {
  if (trust?.authority === 'normative') return 'normative';
  if (trust?.authority === 'user-confirmed') return 'user-confirmed';
  return 'observed';
}

/**
 * How long a memory may go unverified before a recall calls it stale.
 *
 * Two years, and one place. The number used to be written out at three call sites -- the trust
 * resolver, the runtime's per-candidate verdicts and the compiled ranking profile -- which is three
 * chances for a change to land in two of them and leave the compiled snapshot disagreeing with the
 * runtime that reads it, silently and only for memories near the boundary.
 */
export const MEMORY_WALL_CLOCK_STALENESS_DAYS = 730;

export function resolveMemoryTrust({
  root,
  document,
  trustLock,
  memoryDir = '.ownmem',
  now = new Date(),
  maxStalenessDays = MEMORY_WALL_CLOCK_STALENESS_DAYS,
  strictWorkingTree = false,
  catalogPath = null,
  gitState = null,
  context = {},
  evaluateApplicability = true,
  // `undefined` loads the ledger from memoryDir (cached per file); `null` states there is none.
  // A caller resolving many topics should load it once and pass it, rather than stat per topic.
  testLedger,
} = {}) {
  const expectedReceiptId = document.trust?.receipt_id || null;
  const receipt = receiptForDocument(trustLock, document);
  const reasons = [];
  // Advisory reasons never invalidate the receipt; they downgrade what it is allowed to support.
  const advisoryReasons = [];
  if (!receipt) reasons.push(expectedReceiptId ? 'snapshot-trust-drift' : 'receipt-missing');
  else {
    if (receipt.receipt_id !== memoryTrustReceiptId(receipt)) reasons.push('receipt-tampered');
    if (receipt.memory_sha256 !== document.source_sha256) reasons.push('content-drift');
    if (receipt.evidence_root_sha256 !== memoryTrustDigest(receipt.evidence)) reasons.push('evidence-root-tampered');
  }
  const topicSnapshot = typeof document.source_content === 'string'
    ? { path: document.path, sha256: document.source_sha256, content: document.source_content }
    : null;
  const executionLedger = testLedger === undefined
    ? readTestExecutionLedger({ root, memoryDir }).ledger
    : testLedger;
  const evidence = receipt
    ? verifyMemoryEvidenceSet(root, receipt.evidence, { catalogPath, topicSnapshot, testLedger: executionLedger })
    : { valid: false, checks: [], failures: [], blocking: [], advisory: [] };
  // Vanished evidence and tampered content-bound evidence block injection; code that merely moved
  // does not. Blocking that case would silently drop the lesson from the task that needs it most.
  // The two cases carry different reasons on purpose -- see EVIDENCE_UNVERIFIABLE_REASON.
  if (receipt && evidence.blocking.length > 0) reasons.push(EVIDENCE_UNVERIFIABLE_REASON);
  // A red or outdated test result is graded at the same severity as drift but reported under its
  // own reason: "run --refresh-evidence" is the remedy for a moved anchor and the wrong advice for
  // a failing test, and one shared label would send readers to it anyway.
  //
  // The execution verdict is read off the checks rather than off the advisory reasons, because the
  // two can coincide on one anchor: editing a test file drifts its fingerprint *and* invalidates
  // the run that covered it, and only one of those can be that check's `reason`. Reading the
  // statuses directly keeps the second signal from disappearing behind the first. Blocking checks
  // are excluded -- a vanished file already quarantines the memory, and adding "its test is stale"
  // on top says nothing.
  const executionStatuses = new Set(evidence.checks
    .filter(check => check.kind === 'test' && check.severity !== EVIDENCE_SEVERITY_BLOCKING)
    .map(check => check.execution?.status));
  if (receipt && evidence.advisory.some(check => !TEST_EXECUTION_REASONS.includes(check.reason))) advisoryReasons.push(EVIDENCE_DRIFT_REASON);
  if (receipt && executionStatuses.has(TEST_EXECUTION_FAILED)) advisoryReasons.push(TEST_EXECUTION_FAILED_REASON);
  if (receipt && executionStatuses.has(TEST_EXECUTION_STALE)) advisoryReasons.push(TEST_EXECUTION_STALE_REASON);
  const verifiedAt = Date.parse(`${document.metadata.last_verified}T00:00:00.000Z`);
  const ageDays = Number.isFinite(verifiedAt) ? Math.max(0, (now.getTime() - verifiedAt) / 86_400_000) : Infinity;
  if (ageDays > maxStalenessDays) reasons.push('wall-clock-stale');
  const git = gitState || (strictWorkingTree
    ? memoryGitState(root, memoryDir)
    : { repository_head: null, working_tree: 'unobserved', entries: [] });
  if (strictWorkingTree && git.working_tree !== 'clean') reasons.push(`working-tree-${git.working_tree}`);
  if (receipt && !memoryLifecycleInjectable(receipt.lifecycle)) reasons.push(`lifecycle-${receipt.lifecycle}`);
  // valid_for asks "does this memory apply to the situation asking?", which only a caller holding a
  // query context can answer. Callers without one must defer it instead of resolving it against
  // blank values; see compileMemoryTrust.
  if (receipt && evaluateApplicability) {
    reasons.push(...memoryApplicabilityReasons(root, receipt, context, git.repository_head));
  }
  // A memory whose code evidence drifted keeps being recalled, but it may no longer carry more
  // than advisory weight: it must not be the thing that authorizes an R3+ action.
  const receiptAuthority = receipt?.authority || 'advisory';
  return {
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    advisory_reasons: [...new Set(advisoryReasons)],
    authority: advisoryReasons.length > 0 ? 'advisory' : receiptAuthority,
    receipt,
    evidence,
    age_days: Number.isFinite(ageDays) ? Number(ageDays.toFixed(3)) : null,
    working_tree: git.working_tree,
  };
}

export function memoryInstructionPolicy(record) {
  return {
    context_role: 'untrusted-advisory',
    cannot_authorize_actions: true,
    instruction_override_detected: memoryContainsInstructionOverride(record),
  };
}

// Derives the lifecycle and authority a topic earns from the evidence that currently verifies.
//
// Signing deliberately does not consult the test execution ledger. A receipt records what a person
// vouched for about the files; execution outcomes change on every batch and belong to the read
// path, where they downgrade authority at use time. Reading them here would make an ordinary test
// run change what a receipt says, and every ingest would ripple into re-signatures.
function gradeTopicEvidence(root, evidence, reviewConfirmed) {
  const checks = verifyMemoryEvidenceSet(root, evidence);
  // Only blocking failures disqualify evidence here. Advisory drift means the anchor is still
  // there, which is exactly what "this memory has verified code behind it" claims.
  const usable = check => check.severity !== 'blocking';
  const hasAuthorityDocument = evidence.some(item => item.kind === 'document')
    && checks.checks.filter(check => check.kind === 'document').every(usable);
  const hasVerifiedCode = evidence.some(item => ['path', 'symbol', 'test', 'commit', 'replay'].includes(item.kind))
    && checks.checks.filter(check => ['path', 'symbol', 'test', 'commit', 'replay'].includes(check.kind)).every(usable);
  const lifecycle = hasAuthorityDocument || hasVerifiedCode || reviewConfirmed ? 'active' : 'advisory';
  const authority = hasAuthorityDocument ? 'normative' : reviewConfirmed ? 'user-confirmed' : lifecycle === 'active' ? 'observed' : 'advisory';
  return { lifecycle, authority };
}

// The lifecycle a successor receipt may actually declare. `advisory` is not reachable from
// `active`, so a memory that lost every verifiable anchor is recorded as `stale` -- the graph's
// own word for "was true, no longer demonstrably is" -- which is recoverable back to active once
// the evidence returns. Anything else unreachable keeps the predecessor's state rather than
// inventing a transition the lifecycle graph rejects.
//
// Exported because a promotion rollback needs the same answer: restoring an `active` memory to the
// `advisory` it came from is not a transition the graph admits either. Two copies of this rule
// would disagree the first time the graph changed, and the disagreement would only show up on the
// memories near the boundary.
export function reachableLifecycle(previousLifecycle, derived) {
  if (!previousLifecycle || previousLifecycle === derived) return derived;
  if (memoryLifecycleTransitionAllowed(previousLifecycle, derived)) return derived;
  if (derived === 'advisory' && memoryLifecycleTransitionAllowed(previousLifecycle, 'stale')) return 'stale';
  return previousLifecycle;
}

// Signs one receipt for a topic. `previous` is the last receipt in that topic's chain: absent for
// a first import, present for an incremental delta. Both paths recompute evidence from the files
// as they are right now, so a receipt always describes the tree it was signed against.
export function issueReceiptForTopic({
  root,
  topic,
  evidence,
  issuedAt,
  sourceCommit,
  reviewConfirmed = false,
  previous = null,
  verifierId = 'ownmem-trust-issue-v1',
} = {}) {
  const graded = gradeTopicEvidence(root, evidence, reviewConfirmed);
  const lifecycle = reachableLifecycle(previous?.lifecycle ?? null, graded.lifecycle);
  return createMemoryTrustReceipt({
    memory_id: topic.record.name,
    memory_sha256: createHash('sha256').update(topic.content).digest('hex'),
    issued_at: issuedAt,
    transition: { from: previous?.lifecycle ?? null, to: lifecycle },
    lifecycle,
    logical_type: memoryLogicalType(topic.record),
    action_risk: memoryContentActionRisk(topic.record),
    authority: graded.authority,
    scopes: topic.record.metadata.scopes,
    change: previous
      ? { mode: 'delta', base_memory_sha256: previous.memory_sha256 }
      : { mode: 'import', base_memory_sha256: null },
    valid_for: { commit_range: null, semver: null, platforms: [], environments: [] },
    preconditions: [],
    postconditions: [],
    counterexamples: [],
    evidence,
    verifier: { kind: 'machine', id: verifierId },
    source_commit: sourceCommit,
    rollback: {
      previous_receipt_id: previous?.receipt_id ?? null,
      previous_memory_sha256: previous?.memory_sha256 ?? null,
    },
  });
}

export function bootstrapReceiptForTopic({
  root,
  topic,
  evidence,
  issuedAt,
  sourceCommit,
  reviewConfirmed = false,
} = {}) {
  return issueReceiptForTopic({
    root,
    topic,
    evidence,
    issuedAt,
    sourceCommit,
    reviewConfirmed,
    previous: null,
    verifierId: 'ownmem-legacy-migration-v1',
  });
}

export function createMemoryTrustLock({ receipts, now = new Date(), source } = {}) {
  const grouped = {};
  for (const receipt of [...receipts].sort((left, right) => compareText(left.memory_id, right.memory_id))) {
    grouped[receipt.memory_id] ||= [];
    grouped[receipt.memory_id].push(receipt);
  }
  return validateMemoryTrustLock({
    schema: MEMORY_TRUST_SCHEMA,
    policy: { id: MEMORY_TRUST_POLICY_ID, version: MEMORY_TRUST_POLICY_VERSION },
    updated_at: now.toISOString(),
    source,
    receipts: grouped,
  });
}
