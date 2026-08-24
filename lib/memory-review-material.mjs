// Review-ready material: what this system produces when it may not put a change into effect.
//
// The policy module grades how far a change may travel. Most changes in this repository do not
// travel at all -- they land on `review`, `pr-only` or `forbidden` -- and the plan is explicit that
// this is the ordinary outcome rather than a gap waiting to be closed. So the deliverable for those
// three is not a smaller change; it is material a person can actually read and act on: the diff,
// the policy's own sentences about why it stopped there, locators the reader can recompute, and the
// measured quota cost.
//
// Three properties are enforced here rather than described:
//
//   1. Nothing on this path writes. This module imports no filesystem writer -- no writeFileSync,
//      no mkdirSync, no rename, no append -- so "R4 produced material and also edited a memory" is
//      not a bug that can be introduced by a careless caller. The self-test asserts it twice: once
//      by snapshotting the whole tree around a full run, and once by reading this file's own bytes,
//      because a behavioural test only proves that this run did not write.
//   2. `forbidden` and `pr-only` produce different things. pr-only says "here is the change, a
//      person merges it". forbidden is the control plane -- policy, gates, permissions, this
//      system's own code -- and drafting a ready-made patch for it from inside is the first half of
//      the loop that row exists to close. So a forbidden material carries no patch and settles no
//      quota, and the constructor refuses the inputs that would give it one.
//   3. No prose is invented. A correction says an existing memory may be wrong; what replaces it
//      has to be written by a person. This module states the situation, measures what retiring the
//      memory would free, and stops. A machine-written paragraph that later becomes the evidence
//      for itself is the laundering path the receipt design is built against.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { schemaPath } from './schema-paths.mjs';
import {
  PROMOTION_CHANGE_KINDS,
  anchorKey,
  collectPromotionQuotaSwapCandidates,
  planPromotionQuota,
  promotionAnchorRootSha256,
  promotionRiskForChange,
  readPromotionLedger,
} from './memory-promotion-receipt.mjs';
import { decideMemoryPromotion } from './memory-promotion-policy.mjs';
import {
  DEFAULT_MEMORY_CANDIDATE_DIRECTORY,
  readCandidateLedger,
} from './memory-candidates.mjs';
import { loadMemoryTopics } from './memory-schema.mjs';
import { readMemoryTrustLock } from './memory-trust-store.mjs';

export const REVIEW_MATERIAL_SCHEMA = 'ownmem-review-material/v1';
export const GOVERNANCE_SURFACE_SCHEMA = 'ownmem-governance-surface/v1';

/**
 * What a reader is being asked to do, one per automation level.
 *
 * Bound to `automation` in the schema as well as here. Two words for the same state that can drift
 * apart is how a `forbidden` material eventually starts reading like a pull request.
 */
export const REVIEW_MATERIAL_DISPOSITIONS = Object.freeze({
  review: 'needs-approval',
  'pr-only': 'needs-a-person-to-merge',
  forbidden: 'ordinary-release-process',
});

/** How many materials and ledger rows a preview carries. The command prints all of them. */
export const GOVERNANCE_PREVIEW_CAP = 8;

// Unified-diff context, and a ceiling past which the quadratic alignment below is not attempted.
// A memory topic in this repository is a few hundred lines; a file two orders of magnitude larger
// is not something a person is going to review as a diff anyway.
const DIFF_CONTEXT_LINES = 3;
const DIFF_MAX_LINES = 4000;

const ajv = new Ajv({ allErrors: true, strict: true });
let compiledMaterial = null;

const sha256 = value => createHash('sha256').update(value).digest('hex');
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compareText).map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function digestOf(value) {
  return sha256(JSON.stringify(stableValue(value)));
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
 * The gate every material passes on its way out.
 *
 * At the exit rather than inside the constructor, for the same reason the decision and receipt
 * gates are: the shape has to bind producers that do not exist yet. The decision it carries is
 * validated by the policy module's own validator rather than re-described here, so there is one
 * definition of a promotion decision in this system and this file is not a second one.
 */
export function validateMemoryReviewMaterial(material) {
  if (!compiledMaterial) {
    compiledMaterial = ajv.compile(JSON.parse(readFileSync(schemaPath('promotion', 'review-material.schema.json'), 'utf8')));
  }
  if (!compiledMaterial(material)) {
    throw new Error(`memory review material is invalid: ${validationMessage(compiledMaterial.errors)}`);
  }
  if (material.anchor_root_sha256 !== promotionAnchorRootSha256(material.anchors)) {
    throw new Error('memory review material anchor root does not match its anchors');
  }
  if (material.material_id !== reviewMaterialId(material)) {
    throw new Error('memory review material_id does not match its content');
  }
  return material;
}

export function reviewMaterialId(material) {
  const { material_id: _id, ...content } = material;
  return digestOf(content);
}

// --- diff ---------------------------------------------------------------------------------------

function splitLines(text) {
  if (text === '') return [];
  const lines = text.split('\n');
  // A trailing newline yields one empty element that is not a line; dropping it keeps the diff from
  // reporting a phantom change at the end of every file that ends properly.
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * Longest common subsequence over lines, used only to place the hunks.
 *
 * Quadratic and deliberately so: the inputs are memory topics, the output is read by a person, and
 * a heuristic diff that occasionally mis-aligns would make a reviewer distrust every material this
 * module produces. Oversized inputs skip alignment entirely and are reported as a whole-file
 * replacement, which is honest rather than approximate.
 */
function lineOperations(before, after) {
  if (before.length + after.length > DIFF_MAX_LINES) {
    return [
      ...before.map(line => ({ op: '-', line })),
      ...after.map(line => ({ op: '+', line })),
    ];
  }
  const rows = before.length;
  const columns = after.length;
  const table = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1));
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      table[row][column] = before[row] === after[column]
        ? table[row + 1][column + 1] + 1
        : Math.max(table[row + 1][column], table[row][column + 1]);
    }
  }
  const operations = [];
  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (before[row] === after[column]) {
      operations.push({ op: ' ', line: before[row] });
      row += 1;
      column += 1;
    } else if (table[row + 1][column] >= table[row][column + 1]) {
      operations.push({ op: '-', line: before[row] });
      row += 1;
    } else {
      operations.push({ op: '+', line: after[column] });
      column += 1;
    }
  }
  while (row < rows) {
    operations.push({ op: '-', line: before[row] });
    row += 1;
  }
  while (column < columns) {
    operations.push({ op: '+', line: after[column] });
    column += 1;
  }
  return operations;
}

/**
 * A unified diff a reviewer can read, and a caller cannot fake.
 *
 * `before` is always the bytes on disk at the moment the material was built, never a description of
 * them, so what is shown is what would actually land.
 */
export function unifiedDiff(relativePath, before, after) {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const operations = lineOperations(beforeLines, afterLines);
  if (!operations.some(item => item.op !== ' ')) return '';
  const hunks = [];
  let current = null;
  let beforeLine = 0;
  let afterLine = 0;
  let pendingContext = [];
  for (const operation of operations) {
    if (operation.op === ' ') {
      beforeLine += 1;
      afterLine += 1;
      if (current) {
        pendingContext.push(operation);
        if (pendingContext.length > DIFF_CONTEXT_LINES * 2) {
          current.lines.push(...pendingContext.slice(0, DIFF_CONTEXT_LINES));
          current.before_count += DIFF_CONTEXT_LINES;
          current.after_count += DIFF_CONTEXT_LINES;
          hunks.push(current);
          current = null;
          pendingContext = [];
        }
      } else {
        pendingContext.push(operation);
        if (pendingContext.length > DIFF_CONTEXT_LINES) pendingContext.shift();
      }
      continue;
    }
    if (!current) {
      const lead = pendingContext.slice(-DIFF_CONTEXT_LINES);
      current = {
        before_start: Math.max(1, beforeLine - lead.length + 1),
        after_start: Math.max(1, afterLine - lead.length + 1),
        before_count: lead.length,
        after_count: lead.length,
        lines: [...lead],
      };
      pendingContext = [];
    } else if (pendingContext.length > 0) {
      current.lines.push(...pendingContext);
      current.before_count += pendingContext.length;
      current.after_count += pendingContext.length;
      pendingContext = [];
    }
    current.lines.push(operation);
    if (operation.op === '-') {
      beforeLine += 1;
      current.before_count += 1;
    } else {
      afterLine += 1;
      current.after_count += 1;
    }
  }
  if (current) {
    const tail = pendingContext.slice(0, DIFF_CONTEXT_LINES);
    current.lines.push(...tail);
    current.before_count += tail.length;
    current.after_count += tail.length;
    hunks.push(current);
  }
  const body = hunks.map(hunk => [
    `@@ -${hunk.before_start},${hunk.before_count} +${hunk.after_start},${hunk.after_count} @@`,
    ...hunk.lines.map(item => `${item.op}${item.line}`),
  ].join('\n')).join('\n');
  return `--- a/${relativePath}\n+++ b/${relativePath}\n${body}`;
}

// --- anchors ------------------------------------------------------------------------------------

/**
 * The memory file itself, bound to its bytes.
 *
 * `topic` rather than `path`, because for a memory the content *is* the assertion: the evidence
 * verifier grades a moved-but-changed code file as advisory and a changed topic as blocking, and a
 * material about what a memory says has to be invalidated when what it says changes.
 */
export function topicAnchorForMemory(root, memoryDir, memoryId) {
  const relative = path.posix.join(memoryDir.split(path.sep).join('/'), `${memoryId}.md`);
  const absolute = path.resolve(root, relative);
  if (!existsSync(absolute)) return null;
  return {
    kind: 'topic',
    locator: relative,
    path: relative,
    sha256: sha256(readFileSync(absolute)),
    fingerprint: null,
    symbol: null,
  };
}

function normalizeAnchors(anchors) {
  return anchors
    .map(anchor => ({
      kind: anchor.kind,
      locator: anchor.locator,
      path: anchor.path ?? null,
      sha256: anchor.sha256 ?? null,
      fingerprint: anchor.fingerprint ?? null,
      symbol: anchor.symbol ?? null,
    }))
    .sort((left, right) => compareText(anchorKey(left), anchorKey(right)));
}

// --- what the memory asserts --------------------------------------------------------------------

/**
 * The logical type of an existing memory, read only from fields a person wrote.
 *
 * `memoryLogicalType` is deliberately not called here, and this is the one place in the promotion
 * path where that distinction is load bearing. That function falls back to a regex over the body
 * for the `lesson` type -- a lesson whose prose contains "run" or "step" comes back `procedural`,
 * which is the R3 row -- and the promotion evidence registered that fallback as the unreliable half
 * of its input. Everything below is a declared field: `type` and `authority` are written by hand
 * and reviewed, so what comes out is what somebody said the memory is, not what its wording
 * resembles.
 *
 * Returns the source alongside the value, so a reader of the material can see which field decided.
 */
export function declaredLogicalType(record) {
  const type = record?.metadata?.type ?? null;
  const authority = record?.metadata?.authority ?? null;
  if (type === 'decision-pointer') return { logical_type: 'normative', source: 'declared-type' };
  if (authority === 'normative') return { logical_type: 'normative', source: 'declared-authority' };
  if (type === 'preference') return { logical_type: 'preference', source: 'declared-type' };
  if (type === 'feedback') return { logical_type: 'feedback', source: 'declared-type' };
  // `lesson` and `debug` both land here. Neither states a rule and neither is a command, so both
  // are the engineering-prose row: generated and staged automatically, never shown to the agent
  // without a person, because no machine check reads prose.
  return { logical_type: 'diagnostic', source: 'declared-type' };
}

// --- material -----------------------------------------------------------------------------------

function measureFileEffect(root, memoryDir, entry) {
  const relative = path.posix.join(memoryDir.split(path.sep).join('/'), `${entry.memory_id}.md`);
  const absolute = path.resolve(root, relative);
  const existed = existsSync(absolute);
  const before = existed ? readFileSync(absolute, 'utf8') : '';
  const after = entry.effect === 'archive' ? '' : String(entry.next_content ?? '');
  return {
    path: relative,
    effect: entry.effect,
    bytes_before: existed ? statSync(absolute).size : 0,
    bytes_after: Buffer.byteLength(after, 'utf8'),
    diff: unifiedDiff(relative, before, after),
  };
}

/**
 * Build one piece of review material.
 *
 * The decision is graded elsewhere and handed in: this function does not decide anything, it makes
 * a decision readable. It refuses two inputs outright, and both refusals are the deliverable rather
 * than defensive programming:
 *
 *   - an `auto` decision, because a change the promotion engine may apply does not need a person,
 *     and producing review material for one would make "needs review" a label anybody can attach;
 *   - file effects on a `forbidden` decision, because a drafted patch for the control plane is the
 *     system proposing an edit to its own rules, which is exactly what that row forbids.
 */
export function buildPromotionReviewMaterial({
  root,
  memoryDir = '.claude/memory',
  origin,
  memory_id: memoryId = null,
  decision,
  risk,
  change,
  entries = [],
  anchors = [],
  reviewer_actions: reviewerActions = [],
  quota_swap_candidates: quotaSwapCandidates = [],
  promotion_id: promotionId = null,
  generated_at: generatedAt,
} = {}) {
  if (!root) throw new Error('buildPromotionReviewMaterial requires a repository root');
  if (!decision) throw new Error('buildPromotionReviewMaterial requires a graded promotion decision');
  if (decision.automation === 'auto') {
    throw new Error('an automatic promotion needs no review material; review material is for changes that need a person');
  }
  if (!REVIEW_MATERIAL_DISPOSITIONS[decision.automation]) {
    throw new Error(`unknown promotion automation level "${decision.automation}"`);
  }
  if (!PROMOTION_CHANGE_KINDS.includes(change?.kind)) {
    throw new Error(`unknown promotion change kind "${change?.kind}"; known kinds are ${PROMOTION_CHANGE_KINDS.join(', ')}`);
  }
  if (decision.automation === 'forbidden' && entries.length > 0) {
    throw new Error('a forbidden change may not carry a drafted patch: the control plane goes through the ordinary release process, so a person writes the change');
  }
  if (anchors.length === 0) throw new Error('review material must carry at least one anchor; evidence is not optional');
  if (reviewerActions.length === 0) throw new Error('review material must say what a person can do with it');

  const files = entries.map(entry => measureFileEffect(root, memoryDir, entry));
  const normalizedAnchors = normalizeAnchors(anchors);
  const quota = decision.automation === 'forbidden'
    ? {
      settled: false,
      reason: 'There is no change to settle: the control plane is not edited from inside, so nothing here proposes bytes.',
      plan: null,
    }
    : entries.length === 0
      ? {
        settled: false,
        reason: 'Nothing is proposed yet, so there is nothing to settle. The quota is measured once a person decides what the replacement says.',
        plan: null,
      }
      : {
        settled: true,
        reason: null,
        plan: planPromotionQuota({
          root,
          memoryDir,
          promotion_id: promotionId || `review-material-${digestOf({ origin, memoryId, entries }).slice(0, 16)}`,
          entries,
          swap_candidates: quotaSwapCandidates,
        }),
      };

  const material = {
    schema: REVIEW_MATERIAL_SCHEMA,
    material_id: '0'.repeat(64),
    generated_at: generatedAt,
    origin: {
      kind: origin.kind,
      id: origin.id,
      attribution: origin.attribution ?? null,
    },
    memory_id: memoryId,
    automation: decision.automation,
    disposition: REVIEW_MATERIAL_DISPOSITIONS[decision.automation],
    risk: {
      level: risk.level,
      reason: risk.reason,
      logical_type: risk.logical_type ?? null,
      logical_type_source: risk.logical_type_source,
    },
    change: {
      kind: change.kind,
      current_lifecycle: change.current_lifecycle ?? null,
      target_lifecycle: change.target_lifecycle,
      metadata_fields: [...new Set(change.metadata_fields || [])].sort(compareText),
    },
    // Carried whole. The policy already wrote the sentences that answer "why did this stop here",
    // and paraphrasing them into this object would create a second account of the same decision
    // that drifts the first time either side is edited.
    decision,
    patch: {
      files,
      absent_reason: files.length > 0
        ? null
        : decision.automation === 'forbidden'
          ? 'No patch is drafted for the control plane. A person writes the change and it ships through the ordinary release process.'
          : 'No replacement text was proposed. Nothing in this system writes the body of a memory, so the words have to come from a person.',
    },
    anchors: normalizedAnchors,
    anchor_root_sha256: promotionAnchorRootSha256(normalizedAnchors),
    quota,
    reviewer_actions: reviewerActions.map(action => ({
      action: action.action,
      requires_human_text: action.requires_human_text === true,
      note: action.note,
      frees_bytes: Number.isInteger(action.frees_bytes) ? action.frees_bytes : null,
    })),
    merge_requirement: {
      automatic: false,
      actor: 'person',
      statement: decision.automation === 'forbidden'
        ? 'This needs a person to decide whether a change should exist at all, and to write it. Nothing here may take effect from inside the system.'
        : 'This needs a person to merge it. Producing this material changed nothing and applied nothing.',
    },
  };
  material.material_id = reviewMaterialId(material);
  return validateMemoryReviewMaterial(material);
}

/**
 * Turn one correction lead into material about each memory it names.
 *
 * The correction extractor already narrowed this to the case the system can act on: a memory was on
 * screen, and then the user said it was wrong. What follows from that is a change to an existing
 * memory -- revise it, narrow where it applies, or retire it -- so the change kind is `memory_body`
 * and never `retrieval_metadata` (only `triggers` is metadata-only; `scopes` and `applies_to` change
 * who may act on it) and never `active_set` (that grades lower, and choosing the surface with the
 * lower ceiling for the same real act is how a change climbs by being described differently).
 *
 * Nothing is drafted. Two of the three actions need a person to write words, and the third --
 * retirement -- is measured rather than proposed: the material reports what archiving the memory
 * would free, because that is a fact, and leaves the decision where the quota rules put it.
 */
export function buildCorrectionReviewMaterials({
  root,
  memoryDir = '.claude/memory',
  candidate,
  records = [],
  lifecycles = new Map(),
  generated_at: generatedAt,
} = {}) {
  if (candidate?.observation?.kind !== 'user-correction') {
    throw new Error(`buildCorrectionReviewMaterials expects a user-correction candidate, got ${JSON.stringify(candidate?.observation?.kind)}`);
  }
  const byName = new Map(records.filter(topic => topic.record).map(topic => [topic.record.name, topic.record]));
  const materials = [];
  const skipped = [];
  for (const memoryId of candidate.recalled_topics) {
    const record = byName.get(memoryId);
    const anchor = topicAnchorForMemory(root, memoryDir, memoryId);
    if (!record || !anchor) {
      // Reported rather than dropped: a lead about a memory that is no longer here is a different
      // fact from a lead nobody produced, and a queue that silently loses rows cannot be audited.
      skipped.push({ memory_id: memoryId, reason: record ? 'topic-file-missing' : 'topic-not-loaded' });
      continue;
    }
    const declared = declaredLogicalType(record);
    const graded = promotionRiskForChange({ change_kind: 'memory_body', logical_type: declared.logical_type });
    const lifecycle = lifecycles.get(memoryId) ?? null;
    const decision = decideMemoryPromotion({
      risk: graded.risk,
      logical_type: declared.logical_type,
      current_lifecycle: lifecycle,
      // The memory stays where it is while its content is questioned. Asking for a lower lifecycle
      // here would be graded as a demotion and answered with a sentence about demotions, which is
      // not what a reader of a correction needs to see.
      target_lifecycle: lifecycle ?? 'active',
      evidence: {},
      statistics: null,
      repo_policy: {},
    });
    materials.push(buildPromotionReviewMaterial({
      root,
      memoryDir,
      origin: {
        kind: 'correction-candidate',
        id: candidate.candidate_id,
        attribution: candidate.attribution,
      },
      memory_id: memoryId,
      decision,
      risk: {
        level: graded.risk,
        reason: graded.reason,
        logical_type: declared.logical_type,
        logical_type_source: declared.source,
      },
      change: {
        kind: 'memory_body',
        current_lifecycle: lifecycle,
        target_lifecycle: lifecycle ?? 'active',
        metadata_fields: [],
      },
      entries: [],
      anchors: [anchor],
      reviewer_actions: [
        {
          action: 'revise',
          requires_human_text: true,
          note: 'Correct what the memory says. The replacement wording is not drafted here: a machine-written body that later becomes its own evidence is the one thing the receipts are built to prevent.',
          frees_bytes: null,
        },
        {
          action: 'narrow_scope',
          requires_human_text: true,
          note: 'Keep it, but say where it stops applying. This edits scopes or applies_to, which change who may act on the memory, so it is not a metadata-only change.',
          frees_bytes: null,
        },
        {
          action: 'retire',
          requires_human_text: false,
          note: 'Archive it. Retiring a memory is a person\'s decision by rule, and no measurement can tell an obsolete note from a rare incident record.',
          frees_bytes: statSync(path.resolve(root, anchor.path)).size,
        },
      ],
      generated_at: generatedAt,
    }));
  }
  return { materials, skipped };
}

/**
 * Render material as text somebody can read end to end.
 *
 * The order is the order a reviewer needs it in: what this is about, what would change, why it is
 * not automatic, what it would cost, and what they can do. The reasons come from the decision
 * verbatim -- the risk matrix is not restated here, because a second copy of it in prose is a copy
 * that will eventually disagree with the table.
 */
export function formatPromotionReviewMaterial(material) {
  const lines = [
    `Review material ${material.material_id.slice(0, 12)} (${material.disposition})`,
    `  memory        ${material.memory_id ?? '(not about one memory)'}`,
    `  origin        ${material.origin.kind} ${material.origin.id.slice(0, 12)}`
      + (material.origin.attribution ? ` (${material.origin.attribution} only)` : ''),
    `  risk          ${material.risk.level} - ${material.risk.reason}`,
    `  asserts       ${material.risk.logical_type ?? 'n/a'} (from ${material.risk.logical_type_source})`,
    `  change        ${material.change.kind}: ${material.change.current_lifecycle ?? 'null'} -> ${material.change.target_lifecycle}`,
  ];
  lines.push('  why it is not automatic:');
  for (const reason of material.decision.reasons) lines.push(`    - ${reason}`);
  if (material.decision.blocked_by.length > 0) {
    lines.push(`    codes: ${material.decision.blocked_by.join(', ')}`);
  }
  lines.push('  evidence you can recompute:');
  for (const anchor of material.anchors) {
    lines.push(`    - ${anchor.kind} ${anchor.locator} ${anchor.sha256 ? `sha256 ${anchor.sha256.slice(0, 12)}` : `fingerprint ${anchor.fingerprint}`}`);
  }
  if (material.patch.files.length === 0) {
    lines.push(`  patch: none. ${material.patch.absent_reason}`);
  } else {
    lines.push('  patch:');
    for (const file of material.patch.files) {
      lines.push(`    ${file.effect} ${file.path} (${file.bytes_before} -> ${file.bytes_after} bytes)`);
      for (const line of file.diff.split('\n')) lines.push(`    ${line}`);
    }
  }
  lines.push(material.quota.settled
    ? `  quota: ${material.quota.plan.verdict} - ${material.quota.plan.reasons.join(' ')}`
    : `  quota: not settled. ${material.quota.reason}`);
  lines.push('  what you can do:');
  for (const action of material.reviewer_actions) {
    lines.push(`    - ${action.action}${action.requires_human_text ? ' (you write the words)' : ''}`
      + `${action.frees_bytes === null ? '' : ` (frees ${action.frees_bytes} bytes)`}: ${action.note}`);
  }
  lines.push(`  ${material.merge_requirement.statement}`);
  return `${lines.join('\n')}\n`;
}

// --- the read-only presentation surface -----------------------------------------------------------

/**
 * Why a surface has no numbers, in a form a machine can act on.
 *
 * Three states, not two, because they have three different remedies and a reader who cannot tell
 * them apart will fix the wrong one:
 *
 *   * `collector-not-wired` -- nothing has been looked at. Wire a collector in.
 *   * `source-unreadable` -- a collector exists and the file it reads is broken. Repair the file.
 *   * `collector-malformed` -- a collector exists, ran, and handed back a shape this console will
 *     not render. Fix the producer.
 *
 * All three are absences, and none of them is a zero.
 */
export const GOVERNANCE_ABSENCE_CODES = Object.freeze(['collector-not-wired', 'source-unreadable', 'collector-malformed']);

function notConnected(stream, reason, reasonCode) {
  if (!GOVERNANCE_ABSENCE_CODES.includes(reasonCode)) {
    throw new Error(`a disconnected governance surface must state why, one of ${GOVERNANCE_ABSENCE_CODES.join(', ')}, got ${JSON.stringify(reasonCode)}`);
  }
  return { stream, connected: false, reason, reason_code: reasonCode };
}

function connected(stream, fields) {
  return { stream, connected: true, ...fields };
}

/**
 * Accept a collector's output, or say plainly that it was refused.
 *
 * The observation window and the quarantine list are produced elsewhere. Until one exists this
 * console must say the surface is not wired -- not render a zero, which would claim that nothing
 * has been quarantined when in truth nothing has been looked at. A malformed shape gets the same
 * treatment with the defect named, because a producer that is broken and a producer that is absent
 * need different fixes and must not look alike.
 */
function acceptInjectedSurface(stream, value, missingReason) {
  if (value === null || value === undefined) return notConnected(stream, missingReason, 'collector-not-wired');
  // A collector that ran and could not read its own source. Distinct from having no collector,
  // because a broken ledger is a file somebody has to repair and an absent collector is code
  // somebody has to write, and both of them rendering as "nothing yet" sends the reader nowhere.
  if (typeof value.unreadable === 'string' && value.unreadable) {
    return notConnected(stream, value.unreadable, 'source-unreadable');
  }
  const required = ['entries', 'denominator', 'denominator_definition', 'sample'];
  const missing = required.filter(key => value[key] === undefined || value[key] === null);
  if (missing.length > 0) {
    return notConnected(stream, `the collector for this surface returned a shape without ${missing.join(', ')}, so nothing here has a denominator`, 'collector-malformed');
  }
  return connected(stream, {
    entries: value.entries,
    denominator: value.denominator,
    denominator_definition: value.denominator_definition,
    sample: value.sample,
    empty_reason: value.sample === 0 ? (value.empty_reason || null) : null,
    items: (value.items || []).slice(0, GOVERNANCE_PREVIEW_CAP),
  });
}

/**
 * Every piece of review material the local queue currently supports.
 *
 * Separate from the surface below because the two answer different questions with the same work:
 * the console needs counts and a preview, and a reader needs the material itself. Computing it
 * twice would let the summary and the thing it summarises disagree.
 */
export function collectCorrectionReviewMaterials({
  root,
  memoryDir = '.claude/memory',
  candidateDirectory = DEFAULT_MEMORY_CANDIDATE_DIRECTORY,
  now = new Date(),
} = {}) {
  const generatedAt = now instanceof Date ? now.toISOString() : String(now);
  let ledger;
  try {
    ledger = readCandidateLedger({ root, directory: candidateDirectory });
  } catch (error) {
    return { available: false, reason: `the candidate ledger could not be read: ${error.message}`, materials: [], corrections: [], candidates: [], skipped: [] };
  }
  const candidates = Object.values(ledger.candidates);
  const corrections = candidates.filter(item => item.observation?.kind === 'user-correction');
  const materials = [];
  const skipped = [];
  if (corrections.length > 0) {
    // Only loaded when there is something to grade. Reading the corpus to answer a question about
    // an empty queue would make an idle console the most expensive thing on the machine.
    let records = [];
    try {
      records = loadMemoryTopics({ root, memoryDir });
    } catch (error) {
      return { available: false, reason: `the memory directory could not be read: ${error.message}`, materials: [], corrections, candidates, skipped: [] };
    }
    const lifecycles = new Map();
    try {
      const { lock } = readMemoryTrustLock({ root, memoryDir, required: false });
      for (const [name, receipts] of Object.entries(lock?.receipts || {})) {
        const lifecycle = receipts.at(-1)?.lifecycle;
        if (lifecycle) lifecycles.set(name, lifecycle);
      }
    } catch {
      // An unreadable trust lock leaves the lifecycle unknown, which the graph admits as a first
      // import. It must not take the queue down: the lead is still a lead.
    }
    for (const candidate of corrections) {
      const built = buildCorrectionReviewMaterials({
        root, memoryDir, candidate, records, lifecycles, generated_at: generatedAt,
      });
      materials.push(...built.materials);
      skipped.push(...built.skipped);
    }
  }
  return { available: true, reason: null, materials, corrections, candidates, skipped };
}

function reviewMaterialSurface({ root, memoryDir, candidateDirectory, generatedAt }) {
  const stream = 'promotion_review_material';
  const collected = collectCorrectionReviewMaterials({ root, memoryDir, candidateDirectory, now: generatedAt });
  if (!collected.available) return notConnected(stream, collected.reason, 'source-unreadable');
  const { materials, corrections, candidates, skipped } = collected;
  const byAutomation = { review: 0, 'pr-only': 0, forbidden: 0 };
  for (const material of materials) byAutomation[material.automation] += 1;
  return connected(stream, {
    entries: materials.length,
    denominator: corrections.length,
    denominator_definition: 'correction leads in the local review queue: turns where a memory was on screen and the user then pushed back. Recovery and maintenance leads propose writing something new and are graded on a different path, so they are not in this denominator',
    sample: materials.length,
    empty_reason: materials.length > 0 ? null : (corrections.length > 0
      ? 'Every correction lead named memories this repository no longer has, so there is nothing to review'
      : `No correction lead has been recorded. ${candidates.length} lead(s) are queued, none of them a correction; a correction is only recorded when the user pushes back in a turn that delivered a memory, so this does not accumulate on its own`),
    by_automation: byAutomation,
    candidates_queued: candidates.length,
    skipped_memories: skipped,
    items: materials.slice(0, GOVERNANCE_PREVIEW_CAP).map(material => ({
      material_id: material.material_id,
      memory_id: material.memory_id,
      risk: material.risk.level,
      automation: material.automation,
      disposition: material.disposition,
      headline: material.decision.reasons[0],
    })),
  });
}

function quotaSettlementSurface({ root, memoryDir }) {
  const stream = 'promotion_quota_settlement';
  let ledger;
  try {
    ({ ledger } = readPromotionLedger({ root, memoryDir }));
  } catch (error) {
    return notConnected(stream, `the promotion ledger could not be read: ${error.message}`, 'source-unreadable');
  }
  const receipts = Object.values(ledger.promotions).flat();
  const verdicts = { no_growth: 0, growth_mode: 0, swap_planned: 0, over_quota: 0 };
  for (const receipt of receipts) {
    if (verdicts[receipt.quota?.verdict] !== undefined) verdicts[receipt.quota.verdict] += 1;
  }
  return connected(stream, {
    entries: Object.keys(ledger.promotions).length,
    denominator: receipts.length,
    denominator_definition: 'promotion receipts in the local ledger, each carrying the quota it was settled against. A promotion touching several files settles once across all of them, so one promotion may hold several receipts and only one accounting',
    sample: receipts.length,
    empty_reason: receipts.length > 0
      ? null
      : 'No promotion has been settled on this machine. A receipt is written only when a promotion is applied, and nothing here is applied without a person, so this stays empty until one is',
    verdicts,
    items: receipts.slice(0, GOVERNANCE_PREVIEW_CAP).map(receipt => ({
      receipt_id: receipt.receipt_id,
      promotion_id: receipt.promotion_id,
      operation: receipt.operation,
      memory_id: receipt.candidate.memory_id,
      verdict: receipt.quota.verdict,
    })),
  });
}

/**
 * Everything the governance surfaces can currently say, in one read-only value.
 *
 * Four blocks, and two of them have no producer in this build. That asymmetry is the point: a
 * surface with a collector reports its denominator and its sample even when the sample is zero,
 * and a surface without one reports that it is not wired. Rendering both as `0` would put a
 * measurement where an absence belongs, which is the failure this repository has a gate for.
 */
export function collectPromotionGovernance({
  root,
  memoryDir = '.claude/memory',
  candidateDirectory = DEFAULT_MEMORY_CANDIDATE_DIRECTORY,
  observation_window: observationWindow = null,
  quarantine = null,
  now = new Date(),
} = {}) {
  if (!root) throw new Error('collectPromotionGovernance requires a repository root');
  const generatedAt = now.toISOString();
  return {
    schema: GOVERNANCE_SURFACE_SCHEMA,
    generated_at: generatedAt,
    review_material: reviewMaterialSurface({ root, memoryDir, candidateDirectory, generatedAt }),
    observation_window: acceptInjectedSurface(
      'promotion_observation_window',
      observationWindow,
      'the observation-window collector is not wired into this build, so no entry has been watched and there is no denominator to count against',
    ),
    quarantine: acceptInjectedSurface(
      'promotion_quarantine',
      quarantine,
      'the runtime quarantine collector is not wired into this build, so nothing has been examined and a count of zero would claim otherwise',
    ),
    quota_settlement: quotaSettlementSurface({ root, memoryDir }),
  };
}

/**
 * Swap candidates for a material that proposes growth.
 *
 * Re-exported rather than reimplemented: the rules that make a proposal safe -- never a hub, never
 * a normative topic, always `requires_review` -- belong to the receipt module, and a second copy
 * here would be a second set of rules to keep in step.
 */
export { collectPromotionQuotaSwapCandidates };
