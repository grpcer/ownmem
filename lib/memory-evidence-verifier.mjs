// Evidence verification for memory trust receipts.
//
// Evidence is graded, because "the thing I pointed at is gone" and "the thing I pointed at was
// edited" are signals of very different strength:
//
//   blocking  the memory body or a human confirmation receipt no longer matches its content
//             binding, an authority document lost the structural property that made it an
//             authority (doc_id, active status, canonical authority, declared path), or a code
//             anchor has vanished (missing path, missing symbol, unsafe path, unknown commit).
//             These invalidate the receipt itself.
//   advisory  a code anchor or an authority document still exists and still is what it claimed to
//             be, but its content changed. That is usually a refactor or a doc revision.
//             Quarantining the memory for it silently removes the lesson from exactly the task
//             that needs it, which costs far more than showing a lesson whose source has moved.
//
// Code anchors are compared with the shared symbol-slice fingerprint rather than a whole-file
// hash: measured on this repository, a whole-file fingerprint fires on 33.3% of anchors after
// unrelated edits while a symbol-slice fingerprint fires on 10.8%. Anchors without a declared
// symbol degrade to a coarse whole-file fingerprint and stay advisory by construction.
//
// `test` evidence carries one extra question the other kinds do not: a test file existing with the
// declared name in it proves a test was written, never that it ran. That half is answered by the
// execution ledger, which holds outcomes parsed out of real batch output. It is consulted here and
// can only ever downgrade -- a failed or stale outcome is advisory, and no outcome at all is
// informational, because most of a corpus predates any ingest and "never run" is not "wrong".
//
// `replay` evidence used to be an alias for `path`: it verified that a file existed and that its
// bytes had not moved, which proves nothing whatsoever about a replay having happened. It now has
// its own verifier, and the three things that were missing are the three things it checks -- the
// fixture it ran against, the environment it ran in, and whether the postconditions it claims were
// ones the procedure actually declared. Nothing in this repository produces `kind: replay` yet, and
// that is why the verifier only ever runs on an evidence item that carries the kind: there is no
// sweep, no corpus-wide gate and no "unverified" status invented for memories that have no replay
// to speak of.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fingerprintCodeAnchor } from './memory-code-fingerprint.mjs';
import {
  memoryProcedureConditionIds,
  procedureEnvironmentFingerprint,
  validateMemoryProcedure,
  validateMemoryReplayRecord,
} from './memory-procedure.mjs';
import {
  TEST_EXECUTION_FAILED,
  TEST_EXECUTION_NEVER_RUN,
  TEST_EXECUTION_STALE,
  resolveTestExecution,
} from './memory-test-execution-ledger.mjs';

export const TEST_EXECUTION_FAILED_REASON = 'test-execution-failed';
export const TEST_EXECUTION_STALE_REASON = 'test-execution-stale';
export const TEST_EXECUTION_REASONS = [TEST_EXECUTION_FAILED_REASON, TEST_EXECUTION_STALE_REASON];

const sha256 = value => createHash('sha256').update(value).digest('hex');

export const EVIDENCE_SEVERITY_BLOCKING = 'blocking';
export const EVIDENCE_SEVERITY_ADVISORY = 'advisory';

// The trust reason each severity contributes. They are deliberately two different strings because
// they mean opposite things to whoever reads them: `evidence-unverifiable` says the anchor is gone
// or was tampered with, so there is nothing left to re-check the memory against and it is pulled
// out of recall; `evidence-drift` says the anchor is still there but its content moved, so the
// memory stays recallable at advisory authority until someone re-reads it and re-signs. One shared
// label had the audit printing "downgraded to advisory: evidence-drift" while recall printed
// "blocked-validity ... evidence-drift" for the opposite situation, and readers could not tell
// which of the two had happened without opening the code.
export const EVIDENCE_UNVERIFIABLE_REASON = 'evidence-unverifiable';
export const EVIDENCE_DRIFT_REASON = 'evidence-drift';

/**
 * Every reason a replay anchor can fail, split the way every other kind here is split.
 *
 * Blocking is "there is nothing left to check this against, or what it says is not true": the
 * record or the procedure is gone, was edited, does not match the anchor that named it, claims a
 * postcondition the procedure never declared, ran somewhere the procedure forbids, or replayed
 * against a fixture that no longer exists.
 *
 * Advisory is "the replay happened, and something has moved since": the fixture's contents changed,
 * the environment moved, or the record itself reports a postcondition that did not hold. The last
 * one is graded like a red test rather than like a vanished anchor, following the same reasoning --
 * a failing outcome is a fact worth showing next to the memory, and removing the memory over it
 * takes the lesson away from the person looking at the failure.
 */
export const REPLAY_BLOCKING_REASONS = Object.freeze([
  'replay-record-missing',
  'replay-record-unbound',
  'replay-record-drift',
  'replay-record-invalid',
  'replay-locator-mismatch',
  'replay-procedure-missing',
  'replay-procedure-drift',
  'replay-procedure-invalid',
  'replay-procedure-identity-mismatch',
  'replay-environment-forbidden',
  'replay-postcondition-undeclared',
  'replay-failure-sample-undeclared',
  'replay-fixture-missing',
]);
export const REPLAY_ADVISORY_REASONS = Object.freeze([
  'replay-postcondition-failed',
  'replay-failure-sample-unexpected-success',
  'replay-fixture-drift',
  'replay-environment-drift',
]);

const ok = () => ({ valid: true, reason: null, severity: null });
const blocking = reason => ({ valid: false, reason, severity: EVIDENCE_SEVERITY_BLOCKING });
const advisory = reason => ({ valid: false, reason, severity: EVIDENCE_SEVERITY_ADVISORY });

function pathDigest(absolute) {
  if (!statSync(absolute).isDirectory()) return sha256(readFileSync(absolute));
  const entries = [];
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target, relative);
      else if (entry.isFile()) entries.push(`${relative}\0${sha256(readFileSync(target))}`);
    }
  };
  visit(absolute);
  return sha256(entries.join('\n'));
}

function safeRepositoryPath(root, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) return null;
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(path.resolve(root), absolute);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return absolute;
}

// Content binding for instruction-bearing artefacts: the memory body, the authority documents it
// defers to, and human confirmation receipts. Any byte change here is a blocking failure, because
// those are the inputs a reader would otherwise trust verbatim.
function verifyContentBoundFile(root, evidence) {
  const absolute = safeRepositoryPath(root, evidence.path);
  if (!absolute) return blocking('unsafe-path');
  if (!existsSync(absolute)) return blocking('missing-path');
  if (evidence.sha256 && pathDigest(absolute) !== evidence.sha256) return blocking('hash-drift');
  return ok();
}

// Code binding: existence is blocking, content change is advisory.
function verifyCodeEvidence(root, evidence, { requireSymbol = false } = {}) {
  const absolute = safeRepositoryPath(root, evidence.path);
  if (!absolute) return blocking('unsafe-path');
  if (!existsSync(absolute)) return blocking('missing-path');
  const symbol = String(evidence.symbol || '').trim() || null;
  if (requireSymbol && !symbol) return blocking('symbol-missing');
  const anchor = fingerprintCodeAnchor(root, { path: evidence.path, symbol });
  if (anchor.status === 'missing-path') return blocking('missing-path');
  if (anchor.status === 'missing-symbol') return blocking('symbol-missing');
  if (evidence.fingerprint) {
    if (evidence.fingerprint !== anchor.fingerprint) return advisory(anchor.coarse ? 'coarse-drift' : 'fingerprint-drift');
    return ok();
  }
  // Legacy receipts issued before symbol slicing bound a whole-file hash. Keep honouring them so
  // an older lock still verifies, but never above advisory: that binding is the 33.3%-noise one.
  if (evidence.sha256 && pathDigest(absolute) !== evidence.sha256) return advisory('hash-drift');
  return ok();
}

function verifyCommit(root, evidence) {
  try {
    execFileSync('git', ['-C', root, 'cat-file', '-e', `${evidence.locator}^{commit}`], { stdio: 'ignore' });
    return ok();
  } catch {
    return blocking('commit-missing');
  }
}

// Authority documents carry two independent claims, and only one of them is what makes them an
// authority: the structural claim ("this doc_id resolves, is active, is canonical, and lives at
// this path") and the content claim ("its prose still reads exactly as it did"). The structural
// claim going false makes the memory's deference assertion false on the spot, so it blocks. The
// prose being edited does not: canonical documents in this repository are revised far more often
// than code symbols -- 557 tracked documents, and replaying the last 100 commits over a
// whole-file binding hard-quarantines 7 memories against 0 real expirations. So content is graded
// exactly like a code anchor that moved: advisory, reported, never silently dropped.
//
// `kind: topic` and `kind: user-confirmation` are deliberately excluded from this grading. There
// the content *is* the assertion, so it stays content-bound and blocking.
function verifyDocumentContent(root, evidence) {
  const absolute = safeRepositoryPath(root, evidence.path);
  if (!absolute) return blocking('unsafe-path');
  if (!existsSync(absolute)) return blocking('missing-path');
  if (evidence.sha256 && pathDigest(absolute) !== evidence.sha256) return advisory('document-content-drift');
  return ok();
}

function verifyDocumentStructure(root, evidence, catalogPath) {
  if (!catalogPath) {
    const absolute = safeRepositoryPath(root, evidence.path);
    const text = readFileSync(absolute, 'utf8');
    const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(text)?.[1] || '';
    const docId = /^doc_id:\s*(.+)$/mu.exec(frontmatter)?.[1]?.trim();
    const status = /^status:\s*(.+)$/mu.exec(frontmatter)?.[1]?.trim();
    const authority = /^authority:\s*(.+)$/mu.exec(frontmatter)?.[1]?.trim();
    if (docId !== evidence.locator) return blocking('document-id-drift');
    if (status !== 'active' || authority !== 'canonical') return blocking('document-not-authoritative');
    return ok();
  }
  const file = safeRepositoryPath(root, catalogPath);
  if (!file || !existsSync(file)) return blocking('catalog-missing');
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return blocking('catalog-invalid');
  }
  const document = (catalog.documents || []).find(item => item.doc_id === evidence.locator);
  if (!document) return blocking('document-missing');
  if (document.status !== 'active' || document.authority !== 'canonical') {
    return blocking('document-not-authoritative');
  }
  if (document.path !== evidence.path) return blocking('document-path-drift');
  return ok();
}

function verifyDocument(root, evidence, catalogPath) {
  const content = verifyDocumentContent(root, evidence);
  // An unreadable or unsafe path short-circuits: without the file there is nothing to check the
  // authority claim against, and reading it for frontmatter would throw.
  if (content.severity === EVIDENCE_SEVERITY_BLOCKING) return content;
  const structure = verifyDocumentStructure(root, evidence, catalogPath);
  return structure.valid ? content : structure;
}

function verifyUserConfirmation(root, evidence) {
  const absolute = safeRepositoryPath(root, evidence.path);
  if (!absolute || !existsSync(absolute)) return blocking('review-lock-missing');
  let lock;
  try {
    lock = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch {
    return blocking('review-lock-invalid');
  }
  const receipt = lock.topics?.[evidence.symbol];
  if (!receipt || receipt.receipt_id !== evidence.locator) return blocking('confirmation-missing');
  if (receipt.source !== 'confirmed') return blocking('confirmation-not-human');
  // Bound to the per-topic semantic digest inside the review lock, not to the whole file: other
  // topics being confirmed must not invalidate this confirmation.
  if (evidence.sha256 && receipt.content_sha256 !== evidence.sha256) return blocking('confirmation-content-drift');
  return ok();
}

// A test anchor is verified twice: as a code anchor (does the file still exist, did the slice
// change) and as an execution claim (did a real batch report an outcome for it, and does that
// outcome still describe the file as it is now).
//
// The two never merge. An anchor whose file vanished still blocks, exactly as before; the
// execution verdict only ever adds an advisory on top of an otherwise clean anchor. `never-run`
// adds nothing at all -- it is carried in `execution` for reporting and changes no verdict.
function verifyTestEvidence(root, evidence, testLedger) {
  const anchor = verifyCodeEvidence(root, evidence);
  const execution = resolveTestExecution(root, evidence, testLedger);
  if (!anchor.valid || execution.status === TEST_EXECUTION_NEVER_RUN) return { ...anchor, execution };
  if (execution.status === TEST_EXECUTION_FAILED) return { ...advisory(TEST_EXECUTION_FAILED_REASON), execution };
  if (execution.status === TEST_EXECUTION_STALE) return { ...advisory(TEST_EXECUTION_STALE_REASON), execution };
  return { ...anchor, execution };
}

/**
 * A replay anchor, which is a claim about something that happened rather than about a file.
 *
 * The claim travels as a committed record, and the evidence item is bound to that record's bytes.
 * From there every part of the claim is checked against something outside the record, because a
 * record that is only checked against itself is a note, not evidence:
 *
 *   the anchor names this replay        locator == record.replay_id
 *   the procedure still exists          the path in the record resolves and still hashes the same
 *   the procedure is a real procedure   it validates against the procedure schema and its own id
 *   it did not run somewhere forbidden  the environment it names is allowed by that procedure
 *   it checked what it says it checked  every postcondition id is one the procedure declares
 *   it ran against something real       the fixture path resolves
 *
 * The environment is compared through a fingerprint that covers the platform and the node major
 * version and nothing else. What it leaves out is the substantive half: absolute paths, user name,
 * home directory, host name, machine id, cpu count, memory, architecture, current commit, locale
 * and time zone are all excluded, because evidence here has to survive moving to another computer,
 * another user name and another checkout path, and a fingerprint holding any of those would expire
 * on the move rather than on a change. See procedureEnvironmentComponents for the full reasoning.
 *
 * Ordering matters, because one result carries one reason. Blocking checks run first and in the
 * order above; the advisory band runs last, most informative first.
 */
function verifyReplayEvidence(root, evidence) {
  const current = procedureEnvironmentFingerprint();
  const detail = {
    replay_id: null,
    procedure_id: null,
    procedure_version: null,
    environment_recorded: null,
    environment_current: current,
    postconditions_checked: null,
    fixture_path: null,
  };
  const graded = result => ({ ...result, replay: detail });

  const absolute = safeRepositoryPath(root, evidence.path);
  if (!absolute) return graded(blocking('unsafe-path'));
  if (!existsSync(absolute)) return graded(blocking('replay-record-missing'));
  // An unbound record is not evidence. Without a content hash on the anchor, anyone who can edit
  // the file can change what was replayed, and every check below would then pass against the edit.
  if (!evidence.sha256) return graded(blocking('replay-record-unbound'));
  if (pathDigest(absolute) !== evidence.sha256) return graded(blocking('replay-record-drift'));

  let record;
  try {
    record = validateMemoryReplayRecord(JSON.parse(readFileSync(absolute, 'utf8')));
  } catch {
    return graded(blocking('replay-record-invalid'));
  }
  detail.replay_id = record.replay_id;
  detail.environment_recorded = record.environment;
  detail.postconditions_checked = record.postconditions_checked;
  detail.fixture_path = record.fixture.path;
  if (evidence.locator !== record.replay_id) return graded(blocking('replay-locator-mismatch'));

  const procedureFile = safeRepositoryPath(root, record.procedure.path);
  if (!procedureFile) return graded(blocking('unsafe-path'));
  if (!existsSync(procedureFile)) return graded(blocking('replay-procedure-missing'));
  // The procedure is instruction-bearing, so it stays content-bound and blocking like a memory body
  // rather than graded like a code anchor. A step edited after the replay means the playbook a
  // reader is shown is not the playbook that was replayed -- and unlike source files, nothing
  // touches a procedure incidentally, so this costs no false quarantines.
  if (pathDigest(procedureFile) !== record.procedure.sha256) return graded(blocking('replay-procedure-drift'));
  let procedure;
  try {
    procedure = validateMemoryProcedure(JSON.parse(readFileSync(procedureFile, 'utf8')));
  } catch {
    return graded(blocking('replay-procedure-invalid'));
  }
  detail.procedure_id = procedure.procedure_id;
  detail.procedure_version = procedure.version;
  if (procedure.procedure_id !== record.procedure.procedure_id || procedure.version !== record.procedure.version) {
    return graded(blocking('replay-procedure-identity-mismatch'));
  }

  const environment = record.environment.name;
  if (procedure.forbidden_environments.includes(environment) || !procedure.allowed_environments.includes(environment)) {
    return graded(blocking('replay-environment-forbidden'));
  }
  const declared = memoryProcedureConditionIds(procedure);
  if (record.postconditions_checked.some(entry => !declared.postconditions.includes(entry.id))) {
    return graded(blocking('replay-postcondition-undeclared'));
  }
  if (record.failure_samples_checked.some(entry => !declared.failure_samples.includes(entry.id))) {
    return graded(blocking('replay-failure-sample-undeclared'));
  }
  const fixture = safeRepositoryPath(root, record.fixture.path);
  if (!fixture) return graded(blocking('unsafe-path'));
  if (!existsSync(fixture)) return graded(blocking('replay-fixture-missing'));

  if (record.postconditions_checked.some(entry => entry.outcome === 'failed')) {
    return graded(advisory('replay-postcondition-failed'));
  }
  if (record.failure_samples_checked.some(entry => entry.outcome === 'unexpected_success')) {
    return graded(advisory('replay-failure-sample-unexpected-success'));
  }
  if (pathDigest(fixture) !== record.fixture.sha256) return graded(advisory('replay-fixture-drift'));
  if (current.fingerprint !== record.environment.fingerprint) return graded(advisory('replay-environment-drift'));
  return graded(ok());
}

export function verifyMemoryEvidence(root, evidence, {
  catalogPath = null,
  topicSnapshot = null,
  testLedger = null,
} = {}) {
  let result;
  if (!evidence || typeof evidence !== 'object') result = blocking('evidence-invalid');
  else if (evidence.kind === 'commit') result = verifyCommit(root, evidence);
  else if (evidence.kind === 'document') result = verifyDocument(root, evidence, catalogPath);
  else if (evidence.kind === 'user-confirmation') result = verifyUserConfirmation(root, evidence);
  else if (evidence.kind === 'symbol') result = verifyCodeEvidence(root, evidence, { requireSymbol: true });
  else if (evidence.kind === 'test') result = verifyTestEvidence(root, evidence, testLedger);
  else if (evidence.kind === 'topic' && topicSnapshot
      && evidence.path === topicSnapshot.path
      && evidence.locator === topicSnapshot.path
      && evidence.sha256 === topicSnapshot.sha256
      && sha256(Buffer.from(topicSnapshot.content, 'utf8')) === topicSnapshot.sha256) {
    result = ok();
  } else if (evidence.kind === 'topic') result = verifyContentBoundFile(root, evidence);
  else if (evidence.kind === 'replay') result = verifyReplayEvidence(root, evidence);
  else if (evidence.kind === 'path') result = verifyCodeEvidence(root, evidence);
  else result = blocking('evidence-kind-unsupported');
  return {
    ...result,
    kind: evidence?.kind || null,
    locator: evidence?.locator || null,
    // Only test anchors can carry an execution verdict; null everywhere else keeps a consumer from
    // reading "no execution data" as "never run" for a kind that has no such notion.
    execution: result.execution ?? null,
  };
}

export function verifyMemoryEvidenceSet(root, evidence, options = {}) {
  const checks = evidence.map(item => verifyMemoryEvidence(root, item, options));
  const failures = checks.filter(check => !check.valid);
  const blocked = failures.filter(check => check.severity === EVIDENCE_SEVERITY_BLOCKING);
  const drifted = failures.filter(check => check.severity === EVIDENCE_SEVERITY_ADVISORY);
  return {
    // Only blocking failures invalidate the set. Advisory drift is reported separately so callers
    // can downgrade authority without removing the memory from recall.
    valid: blocked.length === 0,
    checks,
    failures,
    blocking: blocked,
    advisory: drifted,
  };
}
