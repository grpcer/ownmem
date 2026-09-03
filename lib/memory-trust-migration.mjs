import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fingerprintCodeAnchor } from './memory-code-fingerprint.mjs';
import { loadMemoryTopics } from './memory-schema.mjs';
import { memoryLifecycleTerminal } from './memory-lifecycle.mjs';
import { verifyMemoryEvidenceSet } from './memory-evidence-verifier.mjs';
import {
  bootstrapReceiptForTopic,
  createMemoryTrustLock,
  issueReceiptForTopic,
  memoryEvidenceRootSha256,
  memoryGitState,
  readMemoryTrustLock,
  validateMemoryTrustLock,
  writeMemoryTrustLock,
} from './memory-trust-store.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const SKIPPED_DIRECTORIES = new Set([
  '.git', '.local-test', 'node_modules', 'DerivedData', '.build', 'build', 'dist', 'coverage',
]);
const TEST_EXTENSIONS = new Set(['.swift', '.kt', '.java', '.mjs', '.js', '.ts', '.tsx', '.go', '.py']);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareText(left, right)).map(([key, item]) => [key, stableValue(item)]));
}

function reviewSemanticDigest(record) {
  const metadata = { ...record.metadata };
  for (const key of ['last_verified', 'review_by', 'originSessionId', 'created', 'modified']) delete metadata[key];
  return sha256(JSON.stringify(stableValue({
    name: record.name,
    description: record.description,
    metadata,
    body: record.body.replace(/\r\n/g, '\n').trim(),
  })));
}

function repositoryFile(root, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) return null;
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(absolute)) return null;
  return { absolute, relative: relative.split(path.sep).join('/') };
}

function pathDigest(absolute) {
  if (!statSync(absolute).isDirectory()) return sha256(readFileSync(absolute));
  const entries = [];
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target, relative);
      else if (entry.isFile()) entries.push(`${relative}\0${sha256(readFileSync(target))}`);
    }
  };
  visit(absolute);
  return sha256(entries.join('\n'));
}

// Content binding for instruction-bearing artefacts (the memory body, authority documents, human
// confirmation receipts): they are read verbatim, so they are bound byte for byte.
function contentEvidence(root, kind, locator, relativePath, symbol = null) {
  const resolved = repositoryFile(root, relativePath);
  return {
    kind,
    locator,
    path: resolved?.relative || null,
    sha256: resolved ? pathDigest(resolved.absolute) : null,
    fingerprint: null,
    symbol,
  };
}

// Code binding uses the shared symbol-slice fingerprint instead of a whole-file hash. A whole-file
// hash makes every unrelated edit in the same file look like the lesson expired; measured here,
// that is 33.3% of anchors versus 10.8% for symbol slices.
function codeEvidence(root, kind, locator, relativePath, symbol = null) {
  const resolved = repositoryFile(root, relativePath);
  if (!resolved) return { kind, locator, path: null, sha256: null, fingerprint: null, symbol };
  const anchor = fingerprintCodeAnchor(root, { path: resolved.relative, symbol });
  return {
    kind,
    locator,
    path: resolved.relative,
    sha256: null,
    fingerprint: anchor.fingerprint,
    symbol,
  };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// A directory that carries its own `.git` entry is another checkout: a linked worktree, a
// submodule, a nested clone. Its files are copies of this repository at some other commit, so an
// anchor bound there names something the repository does not own and that vanishes with the
// checkout. Measured 2026-09-03: an agent worktree under `.claude/worktrees/` sorted ahead of the
// real test file, the receipt bound the copy, the worktree was cleaned up, and the memory was
// quarantined as `missing-path` while its test sat untouched in the main tree.
export function isNestedCheckout(directory) {
  return existsSync(path.join(directory, '.git'));
}

function walkTestFiles(root) {
  const byStem = new Map();
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
      if (entry.isDirectory()) {
        const next = path.join(directory, entry.name);
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !isNestedCheckout(next)) visit(next);
        continue;
      }
      if (!entry.isFile() || !TEST_EXTENSIONS.has(path.extname(entry.name))) continue;
      const stem = path.basename(entry.name, path.extname(entry.name));
      const relative = path.relative(root, path.join(directory, entry.name)).split(path.sep).join('/');
      const values = byStem.get(stem) || [];
      values.push(relative);
      byStem.set(stem, values);
    }
  };
  visit(root);
  for (const values of byStem.values()) values.sort(compareText);
  return byStem;
}

// Whether the file a memory declared next to a test locator is that test's own file. The stem is
// the strong signal (`ChatPrependIntegrationTests.swift` for `ChatPrependIntegrationTests.case`);
// a file that merely contains the case name as an identifier is accepted too, for test suites
// whose file is not named after the type. A production file declared alongside its test names
// matches neither and falls through to the repository-wide lookup.
function declaredTestFile(root, declaredPath, className, symbol) {
  const declared = repositoryFile(root, declaredPath);
  if (!declared || statSync(declared.absolute).isDirectory()) return null;
  if (path.basename(declared.relative, path.extname(declared.relative)) === className) return declared;
  const pattern = new RegExp(`(?<![A-Za-z0-9_])${symbol.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![A-Za-z0-9_])`, 'u');
  return pattern.test(readFileSync(declared.absolute, 'utf8')) ? declared : null;
}

function testEvidence(root, locator, byStem, declaredPath = null) {
  const [pathPart, fragment = null] = locator.split('#', 2);
  const direct = repositoryFile(root, pathPart);
  if (direct) return codeEvidence(root, 'test', locator, direct.relative, fragment);
  const [className, ...caseParts] = locator.split('.');
  const symbol = caseParts.length > 0 ? caseParts.join('.') : className;
  // The path the memory itself declares wins over any lookup by file name: it is the author's
  // statement of where the test lives, and it cannot be confused by a same-named file elsewhere.
  const declared = declaredPath ? declaredTestFile(root, declaredPath, className, symbol) : null;
  if (declared) return codeEvidence(root, 'test', locator, declared.relative, symbol);
  const candidates = byStem.get(className) || [];
  const selected = candidates.find(value => /(?:test|tests)\./iu.test(value)) || candidates[0] || null;
  return codeEvidence(root, 'test', locator, selected, symbol);
}

function authorityDocumentEvidence(root, docId, catalog) {
  const document = (catalog.documents || []).find(item => item.doc_id === docId);
  return contentEvidence(root, 'document', docId, document?.path || null);
}

function topicEvidence({ root, memoryDir, topic, catalog, reviewLock, byStem }) {
  const topicPath = path.posix.join(memoryDir.split(path.sep).join('/'), topic.fileName);
  const evidence = [contentEvidence(root, 'topic', topicPath, topicPath)];
  for (const docId of topic.record.metadata.authority_docs) {
    evidence.push(authorityDocumentEvidence(root, docId, catalog));
  }
  for (const code of topic.record.metadata.code_evidence) {
    // Same anchor expansion as the documentation freshness gate: declared symbols replace the
    // coarse whole-file anchor instead of being added next to it. Keeping both would reintroduce
    // the whole-file noise through the back door, since the coarse anchor drifts on every
    // unrelated edit in the same file while the symbol slices stay stable.
    if (code.symbols.length === 0) evidence.push(codeEvidence(root, 'path', code.path, code.path));
    for (const symbol of code.symbols) {
      evidence.push(codeEvidence(root, 'symbol', `${code.path}#${symbol}`, code.path, symbol));
    }
    for (const test of code.tests) evidence.push(testEvidence(root, test, byStem, code.path));
    if (code.commit) evidence.push({ kind: 'commit', locator: code.commit, path: null, sha256: null, fingerprint: null, symbol: null });
  }
  const review = reviewLock.topics?.[topic.record.name];
  const confirmed = review?.source === 'confirmed' && review.content_sha256 === reviewSemanticDigest(topic.record);
  if (confirmed) {
    evidence.push({
      kind: 'user-confirmation',
      locator: review.receipt_id,
      path: path.posix.join(memoryDir.split(path.sep).join('/'), 'review.lock.json'),
      sha256: review.content_sha256,
      fingerprint: null,
      symbol: topic.record.name,
    });
  }
  const unique = new Map();
  for (const item of evidence) unique.set(`${item.kind}\0${item.locator}\0${item.path || ''}\0${item.symbol || ''}`, item);
  return [...unique.values()];
}

// Everything both the one-off baseline and the incremental issuance need. Loading it once keeps
// the two paths building evidence from the exact same rules; forking that logic is how a bootstrap
// lock and a later delta start disagreeing about what a topic's evidence even is.
function loadTrustInputs({ root, memoryDir, catalogPath }) {
  const loaded = loadMemoryTopics({ root, memoryDir });
  const invalid = loaded.filter(topic => !topic.record || topic.issues.some(item => item.level === 'error'));
  if (invalid.length > 0) throw new Error(`memory trust migration requires a schema-valid corpus; ${invalid.length} topic(s) are invalid`);
  const reviewLock = readJson(path.resolve(root, memoryDir, 'review.lock.json'), { topics: {} });
  return {
    topics: loaded.filter(topic => topic.record),
    catalog: catalogPath ? readJson(path.resolve(root, catalogPath), { documents: [] }) : { documents: [] },
    reviewLock,
    byStem: walkTestFiles(root),
    git: memoryGitState(root, memoryDir),
  };
}

const evidenceKey = item => `${item.kind}:${item.locator}`;

// What changed between the evidence a receipt recorded and the evidence the files produce right
// now, or null when nothing did. The evidence root is the decision: it is the same digest the
// receipt carries, so "differs" cannot disagree with what a later verification would find.
// The reasons are for the human reading the output -- which anchor moved, which one appeared or
// vanished -- because "re-sign this" is only an informed decision if the drift is named.
function evidenceDriftSince(root, previous, evidence, { catalogPath = null } = {}) {
  if (!previous || previous.evidence_root_sha256 === memoryEvidenceRootSha256(evidence)) return null;
  const verified = verifyMemoryEvidenceSet(root, previous.evidence, { catalogPath });
  const reasons = verified.failures.map(item => `${item.kind}:${item.locator}:${item.reason}`);
  const before = new Set(previous.evidence.map(evidenceKey));
  const after = new Set(evidence.map(evidenceKey));
  for (const key of after) if (!before.has(key)) reasons.push(`${key}:added`);
  for (const key of before) if (!after.has(key)) reasons.push(`${key}:removed`);
  // An evidence root can move without any single anchor failing -- a document was re-catalogued to
  // the same content, for instance. Saying so beats printing an empty list.
  if (reasons.length === 0) reasons.push('evidence-root-changed');
  return [...new Set(reasons)].sort(compareText);
}

function topicReviewConfirmed(reviewLock, topic) {
  const review = reviewLock.topics?.[topic.record.name];
  return review?.source === 'confirmed' && review.content_sha256 === reviewSemanticDigest(topic.record);
}

function receiptSummary(receipts) {
  return {
    topics: new Set(receipts.map(receipt => receipt.memory_id)).size,
    receipts: receipts.length,
    active: receipts.filter(receipt => receipt.lifecycle === 'active').length,
    advisory: receipts.filter(receipt => receipt.lifecycle === 'advisory').length,
    normative: receipts.filter(receipt => receipt.authority === 'normative').length,
    user_confirmed: receipts.filter(receipt => receipt.authority === 'user-confirmed').length,
    evidence_items: receipts.reduce((sum, receipt) => sum + receipt.evidence.length, 0),
  };
}

export function bootstrapMemoryTrust({
  root,
  memoryDir = '.ownmem',
  now = new Date(),
  write = false,
  catalogPath = null,
} = {}) {
  const trustFile = path.resolve(root, memoryDir, 'trust.lock.json');
  if (write && existsSync(trustFile)) throw new Error(`memory trust baseline already exists: ${path.relative(root, trustFile)}`);
  const { topics, catalog, reviewLock, byStem, git } = loadTrustInputs({ root, memoryDir, catalogPath });
  const receipts = topics.map(topic => bootstrapReceiptForTopic({
    root,
    topic,
    evidence: topicEvidence({ root, memoryDir, topic, catalog, reviewLock, byStem }),
    issuedAt: now.toISOString(),
    sourceCommit: git.repository_head,
    reviewConfirmed: topicReviewConfirmed(reviewLock, topic),
  }));
  const lock = createMemoryTrustLock({
    receipts,
    now,
    source: { repository_head: git.repository_head, working_tree: git.working_tree },
  });
  const summary = receiptSummary(receipts);
  const file = write ? writeMemoryTrustLock({ root, memoryDir, lock }) : null;
  return { lock, summary, file };
}

// Incremental issuance. Without it the baseline is a one-way door: writing a new memory produces
// `receipt-missing` and editing one produces `content-drift`, both audit errors with no command
// that resolves them.
//
// Two deliberate limits. Issuance never runs inside the audit: a receipt means somebody vouched
// for this change, and a gate that signs its own findings vouches for nothing. And a topic whose
// body is unchanged is reported `up-to-date` rather than re-signed, because evidence drift is
// already graded at recall time (advisory, not fatal) -- re-signing for it by default would grow an
// append-only chain on every unrelated refactor while changing no decision.
//
// `refreshEvidence` is the explicit exit from that second limit. Without it, evidence drift is a
// one-way ratchet: an edit to a file a memory points at downgrades that memory to advisory forever,
// because the body never changed and nothing else re-signs. Measured on this repository, editing two
// lines of one canonical document downgraded four memories at once, so within months most of the
// corpus would be advisory and the grading would carry no signal at all.
//
// It stays a flag a person types, never a step some other command performs, and it re-signs only
// what actually drifted. A receipt asserts that somebody vouched for this memory against these
// files; a refresh that happened automatically, or that fired on topics with nothing to refresh,
// would assert exactly nothing.
export function issueMemoryTrustReceipts({
  root,
  memoryDir = '.ownmem',
  memoryIds = [],
  all = false,
  now = new Date(),
  write = true,
  catalogPath = null,
  refreshEvidence = false,
} = {}) {
  const { lock } = readMemoryTrustLock({ root, memoryDir });
  const { topics, catalog, reviewLock, byStem, git } = loadTrustInputs({ root, memoryDir, catalogPath });
  const byName = new Map(topics.map(topic => [topic.record.name, topic]));
  if (!all && memoryIds.length === 0) throw new Error('memory trust issue requires a memory id or --all');
  const requested = all ? topics.map(topic => topic.record.name) : [...new Set(memoryIds)];
  for (const memoryId of requested) {
    if (!byName.has(memoryId)) throw new Error(`memory trust issue targets an unknown topic: ${memoryId}`);
  }

  const receipts = { ...lock.receipts };
  const issued = [];
  const upToDate = [];
  const skipped = [];
  for (const memoryId of requested) {
    const topic = byName.get(memoryId);
    const chain = receipts[memoryId] || [];
    const previous = chain[chain.length - 1] || null;
    const memorySha256 = sha256(topic.content);
    const bodyUnchanged = Boolean(previous) && previous.memory_sha256 === memorySha256;
    // Recomputing evidence hashes every anchor a topic declares, so an unchanged body short-circuits
    // before paying for it unless a refresh is what was actually asked for.
    if (bodyUnchanged && !refreshEvidence) {
      upToDate.push(memoryId);
      continue;
    }
    const evidence = topicEvidence({ root, memoryDir, topic, catalog, reviewLock, byStem });
    const drift = bodyUnchanged ? evidenceDriftSince(root, previous, evidence, { catalogPath }) : null;
    if (bodyUnchanged && !drift) {
      upToDate.push(memoryId);
      continue;
    }
    if (previous && memoryLifecycleTerminal(previous.lifecycle)) {
      skipped.push({ memory_id: memoryId, reason: `lifecycle-terminal-${previous.lifecycle}` });
      continue;
    }
    const receipt = issueReceiptForTopic({
      root,
      topic,
      evidence,
      issuedAt: now.toISOString(),
      sourceCommit: git.repository_head,
      reviewConfirmed: topicReviewConfirmed(reviewLock, topic),
      previous,
    });
    receipts[memoryId] = [...chain, receipt];
    issued.push({
      memory_id: memoryId,
      mode: receipt.change.mode,
      // Why this receipt exists. A refresh signs the same body against changed evidence, so
      // `mode` alone (delta, in both cases) cannot tell the two apart in the output or the JSON.
      reason: drift ? 'evidence-refresh' : previous ? 'content-change' : 'first-import',
      receipt_id: receipt.receipt_id,
      memory_sha256: receipt.memory_sha256,
      base_memory_sha256: receipt.change.base_memory_sha256,
      previous_lifecycle: receipt.transition.from,
      lifecycle: receipt.lifecycle,
      authority: receipt.authority,
      evidence_items: receipt.evidence.length,
      evidence_drift: drift || [],
    });
  }

  const nextLock = validateMemoryTrustLock({
    ...lock,
    updated_at: issued.length > 0 ? now.toISOString() : lock.updated_at,
    source: issued.length > 0
      ? { repository_head: git.repository_head, working_tree: git.working_tree }
      : lock.source,
    receipts,
  });
  const file = write && issued.length > 0 ? writeMemoryTrustLock({ root, memoryDir, lock: nextLock }) : null;
  return {
    schema: 'ownmem-trust-issue/v1',
    dry_run: !write,
    issued,
    up_to_date: upToDate,
    skipped,
    file,
    lock: nextLock,
  };
}
