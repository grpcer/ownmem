// Promotion receipts: what was promoted, against which original evidence, and how to undo it.
//
// The policy module next door decides how far a change may travel. This one decides what has to be
// on the record before it travels at all, and it exists because three of the ways an evolving
// memory system quietly goes wrong are all shaped like a missing receipt.
//
//   1. Source laundering. An agent reads a file, writes a paragraph about it, and the paragraph
//      becomes the evidence. Every later check verifies the paragraph, which always agrees with
//      itself. So an anchor here has no field that accepts prose, and every anchor must carry
//      something the repository can recompute -- a file hash, a symbol fingerprint, a git object, a
//      digest over selected ledger lines. The readable summary lives outside the anchor set and is
//      excluded from its digest by construction, not by anybody remembering to exclude it.
//   2. Quota laundering. General knowledge growth remains net-zero, while a replay-proven R0
//      retrieval trigger may spend a small, explicit metadata allowance inside the repository's
//      existing hard byte cap. Splitting one oversized edit into several calls must not multiply
//      that allowance. Accounting is therefore settled per promotion id over every file the
//      promotion has touched, not per call, and a memory freed once cannot be spent twice.
//   3. Rollback laundering. Undoing a promotion by deleting its trace leaves a system that has
//      never made a mistake. A rollback here is another receipt, chained to the one it undoes.
//
// Nothing in this module writes a memory file, stages anything, or runs git. It produces values and
// one append-only ledger; applying a change is somebody else's decision.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { schemaPath } from './schema-paths.mjs';
import {
  MEMORY_LOGICAL_TYPES,
  memoryLifecycleTransitionAllowed,
} from './memory-lifecycle.mjs';
import { verifyMemoryEvidence } from './memory-evidence-verifier.mjs';
import { reachableLifecycle } from './memory-trust-store.mjs';
import { collectMemoryTrustAudit } from './memory-trust-audit.mjs';
import {
  PROMOTION_EVIDENCE_CHECKS,
  PROMOTION_POLICY_ID,
  PROMOTION_POLICY_VERSION,
  validateMemoryPromotionDecision,
} from './memory-promotion-policy.mjs';

export const PROMOTION_RECEIPT_SCHEMA = 'ownmem-promotion-receipt/v1';
export const PROMOTION_LEDGER_SCHEMA = 'ownmem.promotions/v1';
export const PROMOTION_QUOTA_SCHEMA = 'ownmem-promotion-quota/v1';
export const DEFAULT_PROMOTION_LEDGER_FILE = 'promotions.lock.json';

/** The measurement the quota is settled in. Named so a caller cannot quietly settle it in another. */
export const PROMOTION_QUOTA_METRIC = 'active-l3-utf8-bytes';
/** Maximum replay-proven retrieval metadata one automatic promotion may add inside the hard cap. */
export const PROMOTION_METADATA_GROWTH_LIMIT_BYTES = 256;

/**
 * What a promotion can edit.
 *
 * This is the input to the risk derivation, and choosing it as the input is the whole point. The
 * question a promotion risk answers is "what is the worst this promotion could do", which is a
 * property of the surface being edited -- not of the subject the memory happens to discuss.
 */
export const PROMOTION_CHANGE_KINDS = Object.freeze([
  'retrieval_metadata',
  'memory_body',
  'memory_created',
  'active_set',
  'repository_artifact',
  'governance_policy',
]);

/**
 * The frontmatter fields whose blast radius really is metadata alone.
 *
 * One field, and it is worth saying why the list is not longer. `triggers` decides which queries
 * reach a memory; getting it wrong costs a reader some attention and nothing else. Every other
 * field changes what the memory asserts, who may act on it, or when it stops counting:
 * `authority` and `type` change what it is allowed to authorise, `scopes` and `applies_to` change
 * where it applies, `code_evidence` changes what verifies it, `last_verified` changes whether the
 * staleness gate still admits it, and `review_by` defers a person's review -- the one edit the
 * repository's own rules already forbid making by hand.
 */
export const PROMOTION_METADATA_ONLY_FIELDS = Object.freeze(['triggers']);

/** The tripwire signals a receipt may arm. Mirrors the degradeSignal enum in the schema. */
export const PROMOTION_DEGRADE_SIGNALS = Object.freeze([
  'harmful-feedback',
  'wrong-feedback',
  'evidence-drift',
  'evidence-unverifiable',
  'wall-clock-stale',
  'gate-conflict',
  'agent-abandoned',
  'risk-out-of-scope',
]);

/** What the runtime must do when a rollback fires. */
export const PROMOTION_ROLLBACK_ACTIONS = Object.freeze(['stop-injection', 'record-event', 'open-review-change']);

/**
 * Which verification kind backs each evidence check.
 *
 * `machine_receipt_complete` is absent because this module computes it from the receipt's own
 * anchors rather than from a reported run, and `rollback_defined` and `scope_declared` are absent
 * because they are properties of the receipt itself. Those three are cross-checked below instead:
 * a receipt may not claim one while contradicting it.
 */
const CHECK_REQUIRES_VERIFICATION = Object.freeze({
  regression_gate_passed: 'test',
  sandbox_replay_passed: 'replay',
});

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const ZERO_ID = '0'.repeat(64);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort(compareText).map(key => [key, stableValue(value[key])]));
}

function stableJson(value, space = 0) {
  return `${JSON.stringify(stableValue(value), null, space)}\n`;
}

function digestOf(value) {
  return sha256(stableJson(value));
}

const ajv = new Ajv({ allErrors: true, strict: true });
let compiledReceipt = null;
let compiledLedger = null;

function compileSchemas() {
  if (compiledReceipt) return;
  // The decision schema is registered rather than restated: the receipt carries a decision in full,
  // and a second copy of its shape here would go stale the first time the matrix gained a field.
  ajv.addSchema(JSON.parse(readFileSync(schemaPath('promotion', 'decision.schema.json'), 'utf8')));
  const receiptSchema = JSON.parse(readFileSync(schemaPath('promotion', 'receipt.schema.json'), 'utf8'));
  ajv.addSchema(receiptSchema);
  compiledReceipt = ajv.getSchema(receiptSchema.$id);
  compiledLedger = ajv.compile({ $ref: `${receiptSchema.$id}#/$defs/ledger` });
}

function validationMessage(errors) {
  return (errors || []).slice(0, 8).map(error => {
    if (error.keyword === 'additionalProperties') {
      return `${error.instancePath || '/'} contains unknown field "${error.params.additionalProperty}"`;
    }
    return `${error.instancePath || '/'} ${error.message}`;
  }).join('; ');
}

/**
 * The gate every promotion receipt passes on its way out.
 *
 * At the exit rather than inside the constructor, for the same reason the decision gate is: the
 * shape has to bind producers that do not exist yet. Re-exported from memory-contracts.mjs, which
 * is where the other contract validators live; it is implemented here because that module sits a
 * layer above this one.
 */
export function validateMemoryPromotionReceipt(receipt) {
  compileSchemas();
  if (!compiledReceipt(receipt)) {
    throw new Error(`memory promotion receipt is invalid: ${validationMessage(compiledReceipt.errors)}`);
  }
  validateMemoryPromotionDecision(receipt.decision);
  for (const [check, kind] of Object.entries(CHECK_REQUIRES_VERIFICATION)) {
    if (receipt.evidence_checks[check] && !receipt.verification.some(item => item.kind === kind && item.outcome === 'passed')) {
      throw new Error(`memory promotion receipt claims ${check} with no passing ${kind} result to back it`);
    }
  }
  // The three self-referential checks. A receipt that says it can be rolled back and carries no
  // restore plan is not a bug in whoever reads it later; it is a false statement made now.
  if (receipt.evidence_checks.rollback_defined && !receipt.rollback.restore) {
    throw new Error('memory promotion receipt claims rollback_defined with no restore plan');
  }
  if (receipt.evidence_checks.scope_declared && receipt.scope.hosts.length === 0 && receipt.scope.scenarios.length === 0) {
    throw new Error('memory promotion receipt claims scope_declared with an empty scope');
  }
  if (receipt.anchor_root_sha256 !== promotionAnchorRootSha256(receipt.anchors)) {
    throw new Error('memory promotion receipt anchor root does not match its anchors');
  }
  if (receipt.receipt_id !== promotionReceiptId(receipt)) {
    throw new Error('memory promotion receipt_id does not match its content');
  }
  return receipt;
}

// --- anchors ---------------------------------------------------------------------------------

function normalizeAnchor(anchor) {
  return {
    kind: anchor.kind,
    locator: anchor.locator,
    path: anchor.path ?? null,
    sha256: anchor.sha256 ?? null,
    fingerprint: anchor.fingerprint ?? null,
    symbol: anchor.symbol ?? null,
  };
}

/**
 * The digest a receipt records for its evidence.
 *
 * Computed over the anchors alone. Every readable field of the receipt -- the summary above all --
 * sits outside this function's reach, so no producer can arrange for a transcription to affect what
 * the evidence root says, whatever it intends. Sorted so that the same evidence set in a different
 * order is the same root.
 */
export function promotionAnchorRootSha256(anchors) {
  const normalized = anchors.map(normalizeAnchor)
    .sort((left, right) => compareText(anchorKey(left), anchorKey(right)));
  return digestOf(normalized);
}

export function anchorKey(anchor) {
  return `${anchor.kind}:${anchor.locator}`;
}

// Two ledger-backed anchor kinds the trust store has no verifier for, because they point at local
// observation data rather than at repository artefacts.
//
// Both are line-selective on purpose. These files are appended to constantly, so a whole-file hash
// would drift within minutes of being taken and every receipt would read as tampered. And both bind
// a digest, never the text: a feedback anchor records the hash of the query, so the ledger keeps
// its promise that the confirmation wording never leaves the machine.
function readJsonLines(root, relativePath) {
  const absolute = path.resolve(root, relativePath);
  if (path.relative(path.resolve(root), absolute).startsWith('..')) return null;
  if (!existsSync(absolute)) return null;
  return readFileSync(absolute, 'utf8').split(/\r?\n/).filter(line => line.trim().length > 0);
}

function parseLineSelector(locator) {
  const index = locator.lastIndexOf('#');
  return index === -1 ? null : locator.slice(index + 1);
}

function verifyFeedbackAnchor(root, anchor) {
  const lines = readJsonLines(root, anchor.path);
  if (!lines) return { valid: false, reason: 'ledger-not-recomputable-here' };
  const selector = parseLineSelector(anchor.locator);
  const lineNumber = /^L([0-9]+)$/u.exec(selector || '')?.[1];
  if (!lineNumber) return { valid: false, reason: 'feedback-locator-has-no-line' };
  const line = lines[Number(lineNumber) - 1];
  if (!line) return { valid: false, reason: 'feedback-line-missing' };
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { valid: false, reason: 'feedback-line-unparsable' };
  }
  if (typeof parsed.query !== 'string') return { valid: false, reason: 'feedback-line-has-no-query' };
  return sha256(parsed.query) === anchor.sha256
    ? { valid: true, reason: null }
    : { valid: false, reason: 'feedback-query-drift' };
}

function verifyEpisodeAnchor(root, anchor) {
  const lines = readJsonLines(root, anchor.path);
  if (!lines) return { valid: false, reason: 'ledger-not-recomputable-here' };
  const episodeId = parseLineSelector(anchor.locator);
  if (!episodeId) return { valid: false, reason: 'episode-locator-has-no-id' };
  const selected = [];
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const id = parsed.episode_id ?? parsed.payload?.episode_id ?? null;
    if (id === episodeId) selected.push(stableValue(parsed));
  }
  if (selected.length === 0) return { valid: false, reason: 'episode-missing' };
  return digestOf(selected) === anchor.sha256
    ? { valid: true, reason: null }
    : { valid: false, reason: 'episode-content-drift' };
}

/**
 * Recompute one anchor against the repository as it is right now.
 *
 * The eight repository kinds are handed to the trust store's verifier rather than re-checked here:
 * there is one definition of "this path still hashes to that" in this system and this file is not a
 * second one. The verifier grades drift as advisory for recall, and this function deliberately does
 * not inherit that grading -- see evaluateMachineReceiptComplete.
 */
export function verifyPromotionAnchor(root, anchor, { catalogPath = null, testLedger = null } = {}) {
  if (anchor.kind === 'feedback') return { ...verifyFeedbackAnchor(root, anchor), kind: anchor.kind, locator: anchor.locator, severity: null };
  if (anchor.kind === 'episode') return { ...verifyEpisodeAnchor(root, anchor), kind: anchor.kind, locator: anchor.locator, severity: null };
  return verifyMemoryEvidence(root, anchor, { catalogPath, testLedger });
}

/**
 * The anchors a memory record claims for itself, in the receipt's vocabulary.
 *
 * Derived from the record's own declared evidence -- `code_evidence` and `authority_docs` -- using
 * the same locator conventions the trust migration writes, so "the receipt covers every anchor this
 * memory claims" is a comparison between two things built by the same rules rather than a
 * comparison between a rule and somebody's memory of it.
 */
export function claimedAnchorsForMemoryRecord(record) {
  const claims = [];
  for (const code of record.metadata.code_evidence || []) {
    if ((code.symbols || []).length === 0) claims.push({ kind: 'path', locator: code.path });
    for (const symbol of code.symbols || []) claims.push({ kind: 'symbol', locator: `${code.path}#${symbol}` });
    for (const test of code.tests || []) claims.push({ kind: 'test', locator: test });
    if (code.commit) claims.push({ kind: 'commit', locator: code.commit });
  }
  for (const doc of record.metadata.authority_docs || []) claims.push({ kind: 'document', locator: doc });
  const unique = new Map();
  for (const claim of claims) unique.set(anchorKey(claim), claim);
  return [...unique.values()];
}

/**
 * Whether this receipt is a complete machine receipt, and if not, exactly what is missing.
 *
 * This is the producer for `machine_receipt_complete`, the check the R1 row of the risk matrix
 * depends on for every one of its tiers. "Complete" is defined here rather than described, because
 * a check whose meaning lives in prose is a check that means something slightly different to each
 * caller:
 *
 *   1. the receipt is intact -- its id matches its own content and its anchor root matches its
 *      anchors, so nothing was edited after it was signed;
 *   2. it has at least one anchor, and every anchor the memory claims for itself appears in it;
 *   3. every anchor recomputes here and now and agrees;
 *   4. a source commit is named, without which nothing says which tree the anchors describe or
 *      which tree a rollback would restore from.
 *
 * The verifier identity is absent from that list because the schema already makes it required and
 * non-empty: a receipt nobody signed cannot be constructed, so restating the rule here would add a
 * branch no input can reach.
 *
 * Point 3 is stricter than the recall path on purpose. Recall grades a moved-but-present anchor as
 * advisory, because dropping a lesson from the task that needs it costs more than showing a lesson
 * whose source moved. Granting automation is the opposite trade: a binding that no longer reproduces
 * has stopped being a machine check, and the honest thing is to say so and let a person look.
 *
 * Returns reasons rather than a bare boolean, because "false" without "which anchor" is a check
 * nobody can act on.
 */
export function evaluateMachineReceiptComplete(receipt, {
  root,
  catalogPath = null,
  testLedger = null,
  claimed_anchors: claimedAnchors = [],
} = {}) {
  if (!root) throw new Error('evaluateMachineReceiptComplete requires a repository root');
  compileSchemas();
  const reasons = [];
  if (!compiledReceipt(receipt)) {
    return {
      check: 'machine_receipt_complete',
      complete: false,
      anchors_checked: 0,
      reasons: [`receipt-invalid:${validationMessage(compiledReceipt.errors)}`],
    };
  }
  if (receipt.receipt_id !== promotionReceiptId(receipt)) reasons.push('receipt-tampered');
  if (receipt.anchor_root_sha256 !== promotionAnchorRootSha256(receipt.anchors)) reasons.push('anchor-root-tampered');
  if (receipt.anchors.length === 0) reasons.push('no-anchors');
  const present = new Set(receipt.anchors.map(anchorKey));
  for (const claim of claimedAnchors) {
    if (!present.has(anchorKey(claim))) reasons.push(`claim-uncovered:${anchorKey(claim)}`);
  }
  for (const anchor of receipt.anchors) {
    const result = verifyPromotionAnchor(root, anchor, { catalogPath, testLedger });
    if (!result.valid) reasons.push(`anchor-${result.reason}:${anchorKey(anchor)}`);
  }
  // The verifier identity is not re-checked here: the schema makes it required with a non-empty id,
  // so a receipt without one cannot be built at all and this would be a branch nothing can reach.
  // `source_commit` is different -- it is nullable, because a draft receipt legitimately has no tree
  // yet -- so the absence of one is a real state and it is graded.
  if (!receipt.source_commit) reasons.push('source-commit-missing');
  return {
    check: 'machine_receipt_complete',
    complete: reasons.length === 0,
    anchors_checked: receipt.anchors.length,
    reasons,
  };
}

// --- promotion risk --------------------------------------------------------------------------

/**
 * The blast radius of performing this promotion.
 *
 * This is not `memoryContentActionRisk`, and the two being easy to confuse is the reason this
 * function exists at all. That one grades what a memory *talks about*, by matching words like "delete",
 * "deploy", "push" and "permission" against its prose. Measured on this repository's 356 active
 * topics it returns R4 or R5 for 181 of them -- 50.8% -- including a note about a mock's
 * StateFlow stub (R4) and a piece of feedback about a code block scrolling (R5), because
 * engineering prose is full of those words. Feeding it to the promotion policy would make more than
 * half the corpus permanently unpromotable while telling nobody why.
 *
 * What matters for a promotion is what the promotion touches. So the inputs are the surface being
 * edited and, for content changes, what the memory is allowed to assert once promoted -- taken from
 * the record's declared `type`, a field a person wrote, never from a regex over the body.
 *
 * The target lifecycle is deliberately not an input. The risk matrix already grades targets, one
 * tier per lifecycle; discounting risk because a request only asked for `shadow` would let the same
 * content climb higher by being requested twice, once per step.
 */
export function promotionRiskForChange({
  change_kind: changeKind,
  logical_type: logicalType = null,
  metadata_fields: metadataFields = [],
} = {}) {
  if (!PROMOTION_CHANGE_KINDS.includes(changeKind)) {
    throw new Error(`unknown promotion change kind "${changeKind}"; known kinds are ${PROMOTION_CHANGE_KINDS.join(', ')}`);
  }
  if (!Array.isArray(metadataFields)) throw new Error('promotion metadata_fields must be an array');
  if (changeKind !== 'retrieval_metadata' && metadataFields.length > 0) {
    throw new Error(`only a retrieval_metadata change may name frontmatter fields, got ${changeKind}`);
  }

  if (changeKind === 'governance_policy') {
    return { risk: 'R5', reason: 'The change edits the control plane -- policy, gates, quota or this system\'s own code -- which has no path to taking effect from inside.' };
  }
  if (changeKind === 'repository_artifact') {
    return { risk: 'R4', reason: 'The change writes outside the memory store, where deployment, permissions and release artefacts live, so the only output allowed is material a person reviews.' };
  }
  if (changeKind === 'active_set') {
    return { risk: 'R3', reason: 'The change edits which memories are injected without reviewing their content, which is a configuration edit: its failure mode is the agent acting on a rule it should not see, or missing one it should.' };
  }
  if (changeKind === 'retrieval_metadata') {
    const disallowed = metadataFields.filter(field => !PROMOTION_METADATA_ONLY_FIELDS.includes(field));
    if (disallowed.length > 0) {
      throw new Error(`"${disallowed.join(', ')}" changes what a memory asserts or who may act on it, so it is not a retrieval_metadata change; metadata-only fields are ${PROMOTION_METADATA_ONLY_FIELDS.join(', ')}`);
    }
    return {
      risk: 'R0',
      reason: metadataFields.length === 0
        ? 'The change produces a queue entry and touches no memory content, so being wrong costs a reader some attention.'
        : `The change edits ${metadataFields.join(', ')} only, which decides which queries reach the memory and cannot change what it asserts.`,
    };
  }

  // memory_body and memory_created. They grade identically: writing a new topic and rewriting an
  // existing one put the same prose in front of the same agent. What differs between them is the
  // quota, which is settled separately and does not belong in a blast radius.
  if (!MEMORY_LOGICAL_TYPES.includes(logicalType)) {
    throw new Error(`a ${changeKind} promotion must state logical_type (one of ${MEMORY_LOGICAL_TYPES.join(', ')}), got ${JSON.stringify(logicalType)}`);
  }
  if (logicalType === 'normative') {
    return { risk: 'R4', reason: 'The memory states a rule the agent is expected to follow, which is the normative row: never promoted automatically.' };
  }
  if (logicalType === 'procedural') {
    return { risk: 'R3', reason: 'The memory tells the agent what to run, so being wrong means a wrong command, and the row that covers commands requires sandbox evidence and observations.' };
  }
  if (logicalType === 'factual') {
    return { risk: 'R1', reason: 'The memory asserts facts about paths, symbols and platform constraints, which a machine can check in full -- and the receipt that checks them is what gates it.' };
  }
  return {
    risk: 'R2',
    reason: `The memory is ${logicalType} prose -- a root cause, a lesson, a stated preference -- and no machine check reads prose, so it may be generated and staged automatically but not shown to the agent.`,
  };
}

// --- quota -------------------------------------------------------------------------------------

function activeTopicFiles(root, memoryDir) {
  const directory = path.resolve(root, memoryDir);
  if (!existsSync(directory)) return [];
  // The same selection the audit's ratchet makes: top-level Markdown, minus the indexes. The
  // archive is a subdirectory and is excluded by not descending, exactly as the audit excludes it.
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'MEMORY.md' && !entry.name.startsWith('MEMORY-'))
    .map(entry => path.join(directory, entry.name))
    .sort(compareText);
}

function readQuotaLock(root, memoryDir) {
  const file = path.resolve(root, memoryDir, 'quota.lock.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function topicRelativePath(root, memoryDir, memoryId) {
  return path.posix.join(memoryDir.split(path.sep).join('/'), `${memoryId}.md`);
}

/**
 * One file effect, measured rather than estimated.
 *
 * `bytes_before` is read off the disk and `bytes_after` off the proposed bytes themselves, so the
 * delta this records is the delta that will actually land. Estimating here would be the same
 * mistake as reporting a metric with no producer: a number that looks measured and is not.
 */
function measureEntry(root, memoryDir, entry) {
  if (!['create', 'edit', 'archive'].includes(entry.effect)) {
    throw new Error(`unknown quota entry effect "${entry.effect}"`);
  }
  const relative = topicRelativePath(root, memoryDir, entry.memory_id);
  const absolute = path.resolve(root, relative);
  const existed = existsSync(absolute);
  const before = existed ? statSync(absolute).size : 0;
  if (entry.effect === 'archive') {
    if (entry.next_content !== null && entry.next_content !== undefined) {
      throw new Error(`archiving ${entry.memory_id} cannot also propose content`);
    }
    return { memory_id: entry.memory_id, effect: 'archive', path: relative, bytes_before: before, bytes_after: 0, existed_before: existed, exists_after: false };
  }
  if (typeof entry.next_content !== 'string') {
    throw new Error(`${entry.effect} of ${entry.memory_id} must carry the proposed content, so its size is measured and not guessed`);
  }
  return {
    memory_id: entry.memory_id,
    effect: entry.effect,
    path: relative,
    bytes_before: before,
    bytes_after: Buffer.byteLength(entry.next_content, 'utf8'),
    existed_before: existed,
    exists_after: true,
  };
}

/**
 * Settle the quota for one promotion.
 *
 * Accounting is per memory across the whole promotion, not per delta per call, and that is the
 * mechanism rather than a detail. Take the first `bytes_before` ever recorded for a memory under
 * this promotion and the last `bytes_after`, and the difference is what that memory costs the
 * corpus however many times the promotion touched it. A topic named as a swap-out twice is
 * therefore freed once: its first-before is its real size and its last-after is zero, no matter how
 * many changes point at it. That is what makes splitting an over-quota change into two individually
 * innocent ones fail -- the second one is graded against everything the first already booked.
 *
 * Knowledge growth is refused unless something leaves in the same promotion. Retrieval-only
 * metadata may use a small caller-declared allowance, but only inside the repository's existing
 * hard byte cap and only without adding a topic. Requiring a person to retire an entire lesson
 * before the machine may add one replay-proven trigger would turn the safest autonomous change
 * into permanent manual work; allowing arbitrary prose through the same exception would erase the
 * quota. The risk-specific caller and the hard cap keep the exception narrow.
 */
export function planPromotionQuota({
  root,
  memoryDir = '.ownmem',
  promotion_id: promotionId,
  entries = [],
  prior_receipts: priorReceipts = [],
  swap_candidates: swapCandidates = [],
  automatic_metadata_growth_bytes: automaticMetadataGrowthBytes = 0,
} = {}) {
  if (!root) throw new Error('planPromotionQuota requires a repository root');
  if (!promotionId) throw new Error('planPromotionQuota requires a promotion_id to settle against');
  if (!Number.isInteger(automaticMetadataGrowthBytes) || automaticMetadataGrowthBytes < 0) {
    throw new Error('automatic_metadata_growth_bytes must be a non-negative integer');
  }
  const measured = entries.map(entry => measureEntry(root, memoryDir, entry));
  const priorEntries = priorReceipts
    .filter(receipt => receipt.promotion_id === promotionId)
    .flatMap(receipt => receipt.quota.entries);

  const touched = new Map();
  for (const entry of [...priorEntries, ...measured]) {
    const seen = touched.get(entry.memory_id);
    if (!seen) touched.set(entry.memory_id, { first: entry, last: entry });
    else touched.set(entry.memory_id, { first: seen.first, last: entry });
  }
  let bytesDelta = 0;
  let countDelta = 0;
  for (const { first, last } of touched.values()) {
    bytesDelta += last.bytes_after - first.bytes_before;
    countDelta += (last.exists_after ? 1 : 0) - (first.existed_before ? 1 : 0);
  }
  const changeBytes = measured.reduce((sum, entry) => sum + (entry.bytes_after - entry.bytes_before), 0);
  const changeCount = measured.reduce((sum, entry) => sum + ((entry.exists_after ? 1 : 0) - (entry.existed_before ? 1 : 0)), 0);

  const files = activeTopicFiles(root, memoryDir);
  const measuredBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
  const lock = readQuotaLock(root, memoryDir);
  const limitCount = Number(lock?.max_active_l3 ?? files.length);
  const limitBytes = Number(lock?.max_active_bytes ?? measuredBytes);
  const swapOuts = [...touched.values()].filter(item => !item.last.exists_after).map(item => item.last.memory_id);

  const plan = {
    schema: PROMOTION_QUOTA_SCHEMA,
    verdict: 'no_growth',
    metric: PROMOTION_QUOTA_METRIC,
    measured_count: files.length,
    measured_bytes: measuredBytes,
    limit_count: limitCount,
    limit_bytes: limitBytes,
    promotion_count_delta: countDelta,
    promotion_bytes_delta: bytesDelta,
    change_count_delta: changeCount,
    change_bytes_delta: changeBytes,
    growth_policy: automaticMetadataGrowthBytes > 0 ? 'bounded-metadata' : 'net-zero',
    automatic_growth_limit: automaticMetadataGrowthBytes,
    automatic_growth_remaining: Math.max(0, Math.min(automaticMetadataGrowthBytes, limitBytes - measuredBytes)),
    prior_entries: priorEntries.length,
    entries: measured,
    proposals: [],
    reasons: [],
  };

  // A repository whose quota is still in growth mode has no ratchet engaged yet, and mirroring that
  // here rather than inventing a stricter rule keeps this gate from contradicting the audit that
  // will grade the same change a minute later.
  const growthMode = lock?.schema === 'ownmem.quota/v3' && lock.mode === 'growth'
    && files.length < Number(lock.growth_threshold ?? 50);
  if (growthMode) {
    plan.verdict = 'growth_mode';
    plan.reasons.push(`The quota is still filling (${files.length} of ${lock.growth_threshold} topics) and its ratchet has not engaged, so this change owes nothing yet.`);
    return plan;
  }

  const overCap = (files.length + countDelta) > limitCount || (measuredBytes + bytesDelta) > limitBytes;
  if (bytesDelta <= 0 && countDelta <= 0 && !overCap) {
    if (swapOuts.length > 0) {
      plan.verdict = 'swap_planned';
      plan.reasons.push(`Growth is covered by retiring ${swapOuts.join(', ')} in the same promotion; retiring a memory is a person's decision, so this cannot be applied automatically.`);
      return plan;
    }
    plan.verdict = 'no_growth';
    plan.reasons.push(`The promotion changes the active set by ${bytesDelta} byte(s) and ${countDelta} topic(s), so it owes the quota nothing.`);
    return plan;
  }

  if (automaticMetadataGrowthBytes > 0
    && countDelta === 0
    && bytesDelta > 0
    && bytesDelta <= automaticMetadataGrowthBytes
    && !overCap) {
    plan.verdict = 'bounded_metadata_growth';
    plan.reasons.push(`The promotion adds ${bytesDelta} byte(s) of replay-proven retrieval metadata, within both the ${automaticMetadataGrowthBytes}-byte per-promotion allowance and the repository's existing hard cap.`);
    return plan;
  }

  plan.verdict = 'over_quota';
  plan.reasons.push(`The promotion grows the active set by ${bytesDelta} byte(s) and ${countDelta} topic(s) across ${priorEntries.length + measured.length} file effect(s); memory is net-zero growth, so something has to leave in the same promotion.`);
  if (priorEntries.length > 0) {
    plan.reasons.push(`Settled over the whole promotion: ${priorEntries.length} earlier file effect(s) already counted, and a memory retired once is only freed once.`);
  }
  if (overCap) {
    plan.reasons.push(`Projected totals are ${files.length + countDelta}/${limitCount} topics and ${measuredBytes + bytesDelta}/${limitBytes} bytes.`);
  }
  let needed = bytesDelta;
  for (const candidate of swapCandidates) {
    if (needed <= 0 && countDelta <= 0) break;
    if (touched.has(candidate.memory_id)) continue;
    plan.proposals.push(candidate);
    needed -= candidate.frees_bytes;
  }
  if (plan.proposals.length === 0) {
    plan.reasons.push('No swap candidate was available, so this promotion has nothing to offer in exchange and cannot proceed.');
  }
  return plan;
}

/**
 * Whether this quota plan stops the promotion from being applied without a person.
 *
 * `swap_planned` blocks as firmly as `over_quota`, and that is the deliberate part. A promotion
 * that names what should leave has done the honest thing, but retiring a memory is exactly the
 * decision the quota rules reserve for a person -- normative and low-frequency incident knowledge
 * must not be dropped for being unused, and no measurement here can tell which is which.
 */
export function promotionQuotaBlocksAutomation(plan) {
  return !['no_growth', 'growth_mode', 'bounded_metadata_growth'].includes(plan.verdict);
}

/**
 * Candidates a promotion may offer in exchange for growth.
 *
 * Drawn from the trust audit's existing quota utility proposals -- the advisory and quarantined
 * topics it already reports -- and then narrowed by the two rules that make the difference between
 * a proposal and a bad idea: a hub, meaning a topic two or more other topics link to, is never
 * proposed, because its value is the connections and archiving it fragments the graph; and a
 * normative topic is never proposed, because low use is not evidence that a rule stopped applying.
 *
 * Every candidate carries `requires_review: true`. This function proposes; nothing here deletes.
 */
export function collectPromotionQuotaSwapCandidates({
  root,
  memoryDir = '.ownmem',
  trustAudit = null,
  limit = 10,
} = {}) {
  if (!root) throw new Error('collectPromotionQuotaSwapCandidates requires a repository root');
  const audit = trustAudit || collectMemoryTrustAudit({ root, memoryDir });
  // Counted off the raw files rather than off parsed records: a topic that currently fails schema
  // validation still links to the topics it links to, and treating it as having no links would let
  // a hub be proposed for retirement on the day some unrelated frontmatter broke.
  const references = new Map();
  for (const file of activeTopicFiles(root, memoryDir)) {
    const name = path.basename(file, '.md');
    for (const match of readFileSync(file, 'utf8').matchAll(/\[\[([^\]|]+)\]\]/gu)) {
      const target = match[1].trim();
      if (target === name) continue;
      references.set(target, (references.get(target) || 0) + 1);
    }
  }
  const candidates = [];
  for (const proposal of audit.quota_utility.review_proposals) {
    const referenceCount = references.get(proposal.memory_id) || 0;
    if (referenceCount >= 2) continue;
    if (proposal.authority === 'normative') continue;
    const file = path.resolve(root, memoryDir, `${proposal.memory_id}.md`);
    if (!existsSync(file)) continue;
    candidates.push({
      memory_id: proposal.memory_id,
      frees_bytes: statSync(file).size,
      authority: proposal.authority,
      references: referenceCount,
      recommendation: proposal.recommendation,
      requires_review: true,
    });
  }
  return candidates
    .sort((left, right) => right.frees_bytes - left.frees_bytes || compareText(left.memory_id, right.memory_id))
    .slice(0, limit);
}

// --- receipts --------------------------------------------------------------------------------

export function promotionReceiptId(receipt) {
  const { receipt_id: _id, ...content } = receipt;
  return digestOf(content);
}

function sortedUnique(values) {
  return [...new Set(values || [])].sort(compareText);
}

function assertSubset(values, allowed, label) {
  for (const value of values) {
    if (!allowed.includes(value)) throw new Error(`${label} must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`);
  }
}

/**
 * Build one receipt.
 *
 * `receipt_id` is the digest of everything else, so the id is the integrity check: no signature to
 * verify, no key to hold, and editing any byte of any field makes the id stop matching. The
 * evidence checks are taken as given rather than computed, except that they are cross-checked at
 * the exit -- this module produces `machine_receipt_complete` and only validates the rest, because
 * the runs behind `regression_gate_passed` and `sandbox_replay_passed` belong to whoever ran them.
 */
export function createPromotionReceipt({
  promotion_id: promotionId,
  operation = 'promote',
  issued_at: issuedAt,
  memory_id: memoryId,
  content_sha256: contentSha256,
  summary = '',
  decision,
  change,
  anchors,
  evidence_checks: evidenceChecks = {},
  verification = [],
  verifier,
  source_commit: sourceCommit = null,
  target_commit: targetCommit = null,
  scope = {},
  guards = {},
  quota,
  rollback = {},
} = {}) {
  if (!Array.isArray(anchors) || anchors.length === 0) {
    throw new Error('a promotion receipt must carry at least one anchor; evidence is not optional');
  }
  for (const check of Object.keys(evidenceChecks)) {
    if (!PROMOTION_EVIDENCE_CHECKS.includes(check)) {
      throw new Error(`unknown promotion evidence check "${check}"; known checks are ${PROMOTION_EVIDENCE_CHECKS.join(', ')}`);
    }
  }
  assertSubset(guards.quarantine_on || [], PROMOTION_DEGRADE_SIGNALS, 'promotion quarantine signal');
  assertSubset(guards.rollback_on || [], PROMOTION_DEGRADE_SIGNALS, 'promotion rollback signal');
  assertSubset(guards.on_rollback || [], PROMOTION_ROLLBACK_ACTIONS, 'promotion rollback action');

  const normalizedAnchors = anchors.map(normalizeAnchor)
    .sort((left, right) => compareText(anchorKey(left), anchorKey(right)));
  const receipt = {
    schema: PROMOTION_RECEIPT_SCHEMA,
    receipt_id: ZERO_ID,
    promotion_id: promotionId,
    operation,
    issued_at: issuedAt,
    candidate: {
      memory_id: memoryId,
      content_sha256: contentSha256 ?? null,
      // The one prose field, and it is placed here rather than anywhere near `anchors` so that the
      // separation is structural. Nothing downstream can promote it into evidence.
      summary: String(summary || ''),
    },
    policy: { id: PROMOTION_POLICY_ID, version: PROMOTION_POLICY_VERSION },
    decision,
    change: {
      kind: change.kind,
      current_lifecycle: change.current_lifecycle ?? null,
      target_lifecycle: change.target_lifecycle,
      metadata_fields: sortedUnique(change.metadata_fields),
    },
    anchors: normalizedAnchors,
    anchor_root_sha256: promotionAnchorRootSha256(normalizedAnchors),
    evidence_checks: Object.fromEntries(PROMOTION_EVIDENCE_CHECKS.map(check => [check, evidenceChecks[check] === true])),
    verification: verification.map(item => ({
      kind: item.kind,
      locator: item.locator,
      outcome: item.outcome,
      observed_at: item.observed_at,
    })),
    verifier: { kind: verifier.kind, id: verifier.id },
    source_commit: sourceCommit,
    target_commit: targetCommit,
    scope: { hosts: sortedUnique(scope.hosts), scenarios: sortedUnique(scope.scenarios) },
    guards: {
      quarantine_on: sortedUnique(guards.quarantine_on),
      rollback_on: sortedUnique(guards.rollback_on),
      on_rollback: sortedUnique(guards.on_rollback),
    },
    quota,
    rollback: {
      previous_receipt_id: rollback.previous_receipt_id ?? null,
      previous_content_sha256: rollback.previous_content_sha256 ?? null,
      previous_lifecycle: rollback.previous_lifecycle ?? null,
      restore: rollback.restore ?? null,
    },
  };
  receipt.receipt_id = promotionReceiptId(receipt);
  return validateMemoryPromotionReceipt(receipt);
}

/**
 * Undo one promotion.
 *
 * Two layers, because §8.4 asks for two and collapsing them loses the property that matters. The
 * runtime layer is immediate and local: stop injecting, record that it happened. The persistent
 * layer is a change somebody reviews -- this function returns it, and nothing here writes a file or
 * touches git, because a system that rewrites shared history to undo its own mistakes is a system
 * whose history stops being evidence.
 *
 * The result is itself a receipt, chained to the one it undoes. A rollback is an explainable event.
 *
 * The restored lifecycle goes through the trust store's `reachableLifecycle`, not through a local
 * guess: `active` cannot go back to `advisory` in the lifecycle graph, and the graph's own word for
 * "was true, no longer demonstrably is" -- `stale`, which is recoverable back to active -- is what
 * a rollback of an active promotion actually restores.
 */
export function createPromotionRollback({
  receipt,
  issued_at: issuedAt,
  verifier,
  quota,
  decision = null,
  target_commit: targetCommit = null,
  reason = '',
} = {}) {
  if (receipt.operation !== 'promote') throw new Error('only a promotion can be rolled back');
  const restore = receipt.rollback.restore;
  if (!restore) throw new Error(`promotion ${receipt.receipt_id} declared no way to undo itself, so it cannot be rolled back`);
  const current = receipt.change.target_lifecycle;
  const declared = restore.lifecycle;
  let reachable = declared === null ? current : reachableLifecycle(current, declared);
  if (reachable === current && declared !== current) {
    // The graph refused and left it where it was, which for a rollback is the one answer that is
    // certainly wrong: there is no edge from advisory back to candidate, and none from active back
    // to advisory, so "no change" would leave the retracted content still being injected. The plan
    // names the persistent result of a demotion itself -- stale or deprecated -- and `stale` is the
    // recoverable one, so that is where a retraction lands. Injection has already stopped at the
    // runtime layer by then, so nothing is shown while the reviewable change waits.
    reachable = memoryLifecycleTransitionAllowed(current, 'stale') ? 'stale' : current;
  }
  if (reachable === current && declared !== current) {
    throw new Error(`rollback of ${receipt.candidate.memory_id} has no legal lifecycle: ${current} -> ${declared}`);
  }
  // The declared destination stays visible on the restore plan while `change.target_lifecycle`
  // carries the reachable one, so nobody has to wonder whether the graph quietly rewrote the ask.
  const rollbackReceipt = createPromotionReceipt({
    promotion_id: receipt.promotion_id,
    operation: 'rollback',
    issued_at: issuedAt,
    memory_id: receipt.candidate.memory_id,
    content_sha256: restore.operation === 'remove-topic' ? null : restore.content_sha256,
    summary: reason,
    // The decision being undone, unless the caller graded the rollback itself. Restoring a state
    // this repository already trusted is not a new claim, so there is usually nothing new to grade.
    decision: decision || receipt.decision,
    change: {
      kind: receipt.change.kind,
      current_lifecycle: receipt.change.target_lifecycle,
      target_lifecycle: reachable,
      metadata_fields: receipt.change.metadata_fields,
    },
    anchors: receipt.anchors,
    // A rollback asserts nothing new, so it claims nothing. Carrying the promotion's checks forward
    // would say the restored state had been verified by runs that were about the promoted state.
    evidence_checks: {},
    verification: [],
    verifier,
    source_commit: restore.source_commit ?? receipt.source_commit,
    target_commit: targetCommit,
    scope: receipt.scope,
    guards: receipt.guards,
    quota,
    rollback: {
      previous_receipt_id: receipt.receipt_id,
      previous_content_sha256: receipt.candidate.content_sha256,
      previous_lifecycle: receipt.change.target_lifecycle,
      restore,
    },
  });
  return {
    receipt: rollbackReceipt,
    // Consumed by the runtime layer: stop injecting now, leave a trace, and let the persistent half
    // be reviewed. Declared here so a host cannot choose a quieter subset.
    runtime: {
      stop_injection: true,
      memory_id: receipt.candidate.memory_id,
      actions: receipt.guards.on_rollback.length > 0 ? receipt.guards.on_rollback : ['stop-injection', 'record-event'],
      reason: reason || 'rollback requested',
    },
    change: {
      requires_review: true,
      auto_apply: false,
      operations: [restore],
    },
  };
}

// --- ledger ----------------------------------------------------------------------------------

export function validatePromotionLedger(ledger) {
  compileSchemas();
  if (!compiledLedger(ledger)) {
    throw new Error(`memory promotion ledger is invalid: ${validationMessage(compiledLedger.errors)}`);
  }
  for (const [promotionId, receipts] of Object.entries(ledger.promotions)) {
    let previous = null;
    for (const receipt of receipts) {
      if (receipt.promotion_id !== promotionId) throw new Error(`promotion ledger key mismatch: ${promotionId}`);
      validateMemoryPromotionReceipt(receipt);
      if (!previous && receipt.operation !== 'promote') throw new Error(`a promotion ledger chain must start with a promotion: ${promotionId}`);
      if (previous && receipt.rollback.previous_receipt_id !== previous.receipt_id) {
        // Without this the ledger would accept a second "first" change, which is precisely how a
        // split change would hide from the cumulative quota accounting above.
        throw new Error(`promotion ledger chain is discontinuous: ${promotionId}`);
      }
      previous = receipt;
    }
  }
  return ledger;
}

export function readPromotionLedger({ root, memoryDir = '.ownmem', fileName = DEFAULT_PROMOTION_LEDGER_FILE } = {}) {
  const file = path.resolve(root, memoryDir, fileName);
  if (!existsSync(file)) {
    return { file, ledger: { schema: PROMOTION_LEDGER_SCHEMA, updated_at: new Date(0).toISOString().replace(/\.\d+Z$/u, '.000Z'), promotions: {} } };
  }
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`memory promotion ledger is unreadable: ${error.message}`);
  }
  return { file, ledger: validatePromotionLedger(ledger) };
}

export function promotionReceiptsFor(ledger, promotionId) {
  return ledger.promotions[promotionId] || [];
}

export function appendPromotionReceipt({
  root,
  memoryDir = '.ownmem',
  fileName = DEFAULT_PROMOTION_LEDGER_FILE,
  ledger,
  receipt,
  now = new Date(),
} = {}) {
  const next = {
    schema: PROMOTION_LEDGER_SCHEMA,
    updated_at: now.toISOString(),
    promotions: { ...ledger.promotions },
  };
  next.promotions[receipt.promotion_id] = [...(next.promotions[receipt.promotion_id] || []), receipt];
  validatePromotionLedger(next);
  const file = path.resolve(root, memoryDir, fileName);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, stableJson(next, 2), 'utf8');
  renameSync(temporary, file);
  return { file, ledger: next };
}
