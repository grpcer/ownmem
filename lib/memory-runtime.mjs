import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { budgetMemoryContext } from './memory-context-budgeter.mjs';
import {
  compileMemoryIndex,
  DEFAULT_MEMORY_DIRECTORY,
  DEFAULT_MEMORY_INDEX_DIRECTORY,
  isMemorySourceFile,
} from './memory-compiler.mjs';
import {
  MEMORY_QUERY_RESULT_SCHEMA,
  decideMemoryIndexRead,
  validateMemoryQueryResult,
} from './memory-contracts.mjs';
import { readPublishedMemorySnapshot, sha256 } from './memory-index-store.mjs';
import {
  createMemoryQueryPlanner,
  planMultiMemoryQuery,
  planMemoryQuery,
} from './memory-query-planner.mjs';
import { classifyMemoryQuery } from './memory-query-classifier.mjs';
import { rankPlannedMemoryQuery } from './memory-ranker.mjs';
import { estimateMemoryTokens } from './memory-token-budget.mjs';
import {
  MEMORY_CONTENT_TIER_THRESHOLD,
  MEMORY_CONTEXT_BUDGETS,
  MEMORY_MAX_POINTERS,
  MEMORY_RECALL_RUNTIME_VERSION,
  memoryEmbeddingMode,
  memoryEnvelopeHandedOver,
  memoryRankingProfileHash,
  publishedMemorySource,
} from './memory-runtime-contract.mjs';
import {
  memoryBlockedVerdictReason,
  memoryTrustBlockingGate,
  memoryTrustIsNominal,
  memoryTrustVerdicts,
  memoryQueryRefusalReason,
} from './memory-trust-policy.mjs';
import {
  memoryTrustIntegrity,
  readMemoryTrustLock,
  resolveMemoryTrust,
  MEMORY_WALL_CLOCK_STALENESS_DAYS,
} from './memory-trust-store.mjs';

/**
 * Recall-stack behavior version recorded as component_version and required by A/B activation.
 * Bump it whenever ranker, channel, or abstention behavior changes so old evidence cannot unlock
 * weighting for a new behavior contract.
 */
export { MEMORY_RECALL_RUNTIME_VERSION, memoryEmbeddingMode, memoryEnvelopeHandedOver, memoryRankingProfileHash };

const FALLBACK_RANKING_PROFILE = Object.freeze({
  profile: 'markdown-fallback-v1',
  lane: 'bm25f',
  normalization: 'query-top-score-v1',
  acceptance: 'legacy-deterministic-v1',
});
const MULTI_QUERY_SEPARATOR = '\n\u241E\n';

function nestedErrorMessages(error, seen = new Set()) {
  if (!error || seen.has(error)) return [];
  seen.add(error);
  const messages = error.message ? [String(error.message)] : [];
  for (const nested of error.errors || []) messages.push(...nestedErrorMessages(nested, seen));
  if (error.cause) messages.push(...nestedErrorMessages(error.cause, seen));
  return messages;
}

/**
 * Which of the five published triggers describes why a snapshot could not be used.
 *
 * Ordered most specific first, and `manifest-invalid` deliberately ahead of `missing`. When both the
 * current and the previous pointer are unusable, readPublishedMemorySnapshot raises an AggregateError
 * whose own message is "no valid memory index snapshot is available" -- which reads as absence even
 * though both snapshots were found, read and rejected. That is exactly the state a 0.6.0 consumer
 * upgrades into: measured 2026-09-20 on a real 0.6.0 checkout, both pointers carry
 * `ownmem-index.documents/v1` against this reader's v2, the nested messages both say
 * "memory index manifest is invalid", and the envelope reported `rebuild_trigger: "missing"`. Nothing
 * was missing, and the population most likely to be reading that field is the one upgrading.
 */
function rebuildTriggerForError(error) {
  const message = nestedErrorMessages(error).join(' | ').toLowerCase();
  if (/checksum|byte count|record count|snapshot id mismatch/.test(message)) return 'checksum-mismatch';
  if (/schema-incompatible|newer reader|requires validated|artifact contract/.test(message)) return 'schema-incompatible';
  if (/manifest is invalid/.test(message)) return 'manifest-invalid';
  if (/pointer is missing|enoent|no such file|snapshot is available/.test(message)) return 'missing';
  return 'manifest-invalid';
}

function rebuiltSource(manifest, trigger) {
  return {
    mode: 'snapshot',
    status: 'rebuilt',
    snapshot_id: manifest.snapshot.id,
    snapshot_schema: manifest.schema,
    degraded: false,
    rebuild_trigger: trigger,
    fallback_reason: null,
  };
}

/**
 * Source marker used when rebuild fails but the previous immutable snapshot remains intact.
 * It retains n-gram, exact-map, and graph lanes that a Markdown fallback cannot provide, and may
 * be the last valid state before source corruption. Body excerpts come from the snapshot's own
 * source_content, so an older snapshot can never quote text outside its own byte offsets; the cost
 * is that this path cannot observe on-disk topic drift, which is the compiler's job.
 */
function previousSource(manifest, trigger) {
  return {
    mode: 'snapshot',
    status: 'previous',
    snapshot_id: manifest.snapshot.id,
    snapshot_schema: manifest.schema,
    // Content may lag one compilation; degraded tells callers that this is not the optimal source.
    degraded: true,
    rebuild_trigger: trigger,
    fallback_reason: 'rebuild-failed',
  };
}

function fallbackSource(snapshot, trigger) {
  return {
    mode: 'markdown-fallback',
    status: 'fallback',
    snapshot_id: snapshot?.manifest?.snapshot?.id || null,
    snapshot_schema: snapshot?.manifest?.schema === 'ownmem-index/v1'
      ? snapshot.manifest.schema
      : null,
    degraded: true,
    rebuild_trigger: trigger,
    fallback_reason: 'rebuild-failed',
  };
}

function observeBuild(observer, details, warnings) {
  if (!observer?.recordBuild) return;
  try {
    const warning = observer.recordBuild(details);
    if (warning) warnings.push(warning);
  } catch (error) {
    warnings.push(error.message);
  }
}

function snapshotRuntime(options, snapshot, source, started, warnings, observer) {
  const planner = createMemoryQueryPlanner(snapshot, { root: options.root, tokenizer: options.tokenizer });
  return {
    mode: 'snapshot',
    options,
    planner,
    source,
    activeTopics: planner.documents.size,
    topicIds: new Set(planner.documents.keys()),
    loadMs: performance.now() - started,
    warnings,
    observer,
    trustCache: { signature: null, lock: null },
  };
}

function fallbackRuntime(options, fallback, snapshot, trigger, started, warnings, observer) {
  const legacyIndex = fallback.load(options);
  return {
    mode: 'markdown-fallback',
    options,
    legacyIndex,
    source: fallbackSource(snapshot, trigger),
    activeTopics: legacyIndex.documents.length,
  // Report fallback-skipped topics so a partial corpus is distinguishable from a complete small one.
    skippedTopics: legacyIndex.skippedTopics || [],
    topicIds: new Set(legacyIndex.documents.map((document) => document.name)),
    loadMs: performance.now() - started,
    warnings,
    fallback,
    observer,
    trustCache: { signature: null, lock: null },
  };
}

/**
 * Callers that only pass a root must still resolve trust.lock.json and the Markdown corpus from the
 * directory the compiler defaults to; leaving memoryDir undefined made path.resolve throw on the
 * trust lookup and silently split the compile and verify directories everywhere else.
 */
function normalizeRuntimeOptions(options) {
  if (!options?.root) throw new Error('memory recall runtime requires a repository root');
  return {
    ...options,
    memoryDir: options.memoryDir || DEFAULT_MEMORY_DIRECTORY,
    indexDirectory: options.indexDirectory || DEFAULT_MEMORY_INDEX_DIRECTORY,
  };
}

function memorySourceSignatures(absoluteMemoryDir) {
  const signatures = new Map();
  for (const entry of readdirSync(absoluteMemoryDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    // isMemorySourceFile is the compiler's own predicate. Restating it here would let a newly
    // compiled lock file drift the two sets apart and make every probe report a phantom change.
    if (!isMemorySourceFile(entry.name)) continue;
    const stats = statSync(path.join(absoluteMemoryDir, entry.name));
    signatures.set(entry.name, { size: stats.size, mtimeMs: stats.mtimeMs });
  }
  return signatures;
}

/**
 * Use-time freshness probe for the fast path that returns a validated snapshot without compiling.
 *
 * validateSnapshotDirectory only re-hashes the checksum list the compiler recorded, so it is
 * self-consistent by construction and never reads the Markdown back. Without this probe an edited
 * topic stays invisible to recall -- no stale answer, no warning -- until someone happens to compile.
 *
 * Cost is kept to one readdir plus one stat per source file: a size change alone already proves
 * drift, and content is only re-hashed for files touched at or after the snapshot was created.
 * A file rewritten to the exact same size with an older mtime is the one case this misses, which is
 * why the compiler's own checksum comparison, not this probe, remains the authority.
 */
function memorySourceDrift(options, manifest) {
  const absoluteMemoryDir = path.resolve(options.root, options.memoryDir);
  const relativeMemoryDir = path.relative(options.root, absoluteMemoryDir).split(path.sep).join('/');
  if (relativeMemoryDir !== manifest.source.memory_dir) {
    return { stale: true, warning: null };
  }
  const signatures = memorySourceSignatures(absoluteMemoryDir);
  const recorded = manifest.source.files;
  if (signatures.size !== recorded.length) return { stale: true, warning: null };
  const createdAtMs = Date.parse(manifest.snapshot.created_at);
  const rehash = [];
  for (const file of recorded) {
    const seen = signatures.get(path.posix.basename(file.path));
    if (!seen || seen.size !== file.bytes) return { stale: true, warning: null };
    if (!(seen.mtimeMs < createdAtMs)) rehash.push(file);
  }
  for (const file of rehash) {
    if (sha256(readFileSync(path.resolve(options.root, file.path))) !== file.sha256) {
      return { stale: true, warning: null };
    }
  }
  return { stale: false, warning: null };
}

function probeMemorySourceDrift(options, manifest) {
  try {
    return memorySourceDrift(options, manifest);
  } catch (error) {
    // An unreadable memory directory is a reason to say so, never a reason to refuse recall.
    return { stale: false, warning: `Memory source freshness probe failed: ${error.message}` };
  }
}

function runtimeTrustLock(runtime) {
  const file = path.resolve(runtime.options.root, runtime.options.memoryDir, 'trust.lock.json');
  const signature = existsSync(file) ? `${statSync(file).size}:${statSync(file).mtimeMs}` : 'missing';
  if (runtime.trustCache.signature === signature) return runtime.trustCache;
  try {
    const lock = readMemoryTrustLock({
      root: runtime.options.root,
      memoryDir: runtime.options.memoryDir,
      required: false,
    }).lock || { receipts: {} };
    runtime.trustCache = { signature, lock, error: null };
  } catch (error) {
    runtime.trustCache = { signature, lock: null, error };
  }
  return runtime.trustCache;
}

function runtimeTrustEvaluator(runtime) {
  const state = runtimeTrustLock(runtime);
  return document => (state.error
    ? { valid: false, reasons: ['receipt-tampered'], receipt: document.trust, evidence: { valid: false, checks: [], failures: [] } }
    : resolveMemoryTrust({
      root: runtime.options.root,
      memoryDir: runtime.options.memoryDir,
      document,
      trustLock: state.lock,
      context: runtime.options.trustContext || {},
    }));
}

function rebuildSnapshotRuntime({ options, compile, readSnapshot, indexRoot, trigger, started, warnings, observer }) {
  const rebuildStarted = performance.now();
  const result = compile({
    root: options.root,
    memoryDir: options.memoryDir,
    indexDirectory: options.indexDirectory,
    tokenizer: options.tokenizer,
  });
  const rebuilt = readSnapshot({ indexRoot, allowPrevious: false });
  const compatibility = decideMemoryIndexRead({ manifest: rebuilt.manifest });
  if (compatibility.action !== 'use-snapshot') {
    throw new Error('rebuilt memory index is incompatible with the current reader');
  }
  observeBuild(observer, {
    options,
    result,
    durationMs: performance.now() - rebuildStarted,
  }, warnings);
  return snapshotRuntime(options, rebuilt, rebuiltSource(rebuilt.manifest, trigger), started, warnings, observer);
}

export function createMemoryRecallRuntime(rawOptions, {
  compile = compileMemoryIndex,
  readSnapshot = readPublishedMemorySnapshot,
  fallback = null,
  observer = null,
} = {}) {
  const started = performance.now();
  const options = normalizeRuntimeOptions(rawOptions);
  const indexRoot = path.resolve(options.root, options.indexDirectory);
  const warnings = [];
  let snapshot = null;
  let initialError = null;
  let trigger = null;
  try {
    snapshot = readSnapshot({ indexRoot, allowPrevious: true });
    trigger = snapshot.selected === 'previous' ? rebuildTriggerForError(snapshot.currentError) : null;
  } catch (error) {
    initialError = error;
    trigger = rebuildTriggerForError(error);
  }
  if (!trigger && snapshot?.selected === 'current') {
    const decision = decideMemoryIndexRead({ manifest: snapshot.manifest });
    if (decision.action === 'use-snapshot') {
      const drift = probeMemorySourceDrift(options, snapshot.manifest);
      if (drift.warning) warnings.push(drift.warning);
      if (!drift.stale) {
        return snapshotRuntime(options, snapshot, decision.source, started, warnings, observer);
      }
      trigger = 'source-changed';
    } else {
      trigger = decision.trigger;
    }
  }
  const rebuildStarted = performance.now();
  try {
    return rebuildSnapshotRuntime({ options, compile, readSnapshot, indexRoot, trigger, started, warnings, observer });
  } catch (rebuildError) {
    observeBuild(observer, {
      options,
      error: rebuildError,
      durationMs: performance.now() - rebuildStarted,
    }, warnings);
    const resolvedTrigger = trigger || rebuildTriggerForError(initialError || rebuildError);
      // Prefer the checksum-validated previous snapshot and preserve all retrieval lanes.
      // Fall back to Markdown only when that snapshot is also unavailable or incompatible.
    if (snapshot?.selected === 'previous'
      && decideMemoryIndexRead({ manifest: snapshot.manifest }).action === 'use-snapshot') {
      return snapshotRuntime(
        options,
        snapshot,
        previousSource(snapshot.manifest, resolvedTrigger),
        started,
        warnings,
        observer,
      );
    }
    if (!fallback?.load || !fallback?.search) throw rebuildError;
    return fallbackRuntime(options, fallback, snapshot, resolvedTrigger, started, warnings, observer);
  }
}

function estimateEnvelope(envelope) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const estimated = estimateMemoryTokens(envelope);
    if (estimated === envelope.budget.estimated_tokens) return estimated;
    envelope.budget.estimated_tokens = estimated;
  }
  throw new Error('memory fallback token estimate did not converge');
}

const MAX_ENVELOPE_WARNING_LENGTH = 160;

/**
 * Surface invalid fallback topics in envelope warnings. They do not belong in dropped_topics,
 * which measures token-budget exclusion; merging those losses would corrupt the metric.
 */
function skippedTopicWarnings(runtime) {
  const skipped = runtime.skippedTopics || [];
  if (skipped.length === 0) return [];
  const shown = [];
  let warning = `Markdown fallback skipped ${skipped.length} corrupt topic file(s)`;
  for (const file of skipped) {
    const remaining = skipped.length - shown.length - 1;
    const candidate = `Markdown fallback skipped ${skipped.length} corrupt topic file(s): ${[...shown, file].join(', ')}${remaining > 0 ? ` (+${remaining} more)` : ''}`;
    if (candidate.length > MAX_ENVELOPE_WARNING_LENGTH) break;
    shown.push(file);
    warning = candidate;
  }
  return [warning];
}

function uniqueStrings(values, limit) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function fallbackGateScore(result) {
  const signals = [
    result.coverage || 0,
    result.exactAnchor ? 1 : 0,
    result.exactHighSignal ? 0.95 : 0,
    result.exactBody ? 0.85 : 0,
    Math.min(1, (result.matchedConceptCount || 0) / 2),
    Math.min(1, (result.matchedCount || 0) / 5),
  ];
  return Number(Math.max(...signals).toFixed(6));
}

/** Query-time trust, exactly as the snapshot path publishes it; see measuredTrust in the ranker. */
function fallbackResultTrust(document, resolved) {
  const compiled = document.trust;
  if (!resolved) {
    return {
      lifecycle: compiled.lifecycle,
      authority: compiled.authority,
      action_risk: compiled.action_risk,
      logical_type: compiled.logical_type,
      integrity: compiled.integrity,
    };
  }
  return {
    lifecycle: resolved.receipt?.lifecycle || compiled.lifecycle,
    authority: resolved.authority || compiled.authority,
    action_risk: resolved.receipt?.action_risk || compiled.action_risk,
    logical_type: resolved.receipt?.logical_type || compiled.logical_type,
    integrity: memoryTrustIntegrity(resolved),
  };
}

/**
 * Shape parity with the budgeter's compactResult: only the lanes that ranked the topic, no
 * channels array restating those lane names, and no verdicts block.
 *
 * Taking the whole evaluated candidate rather than its pieces is what makes the fail-closed check
 * below reachable. A delivered result can no longer disclose that a gate blocked it, so the one
 * moment where the shape is built is the moment that has to refuse: any caller that stops
 * filtering on blockingGate crashes here instead of shipping a blocked memory that looks clean.
 */
/** The memory's own one-line description, or its name spelled out when the index carries none. */
function fallbackPointerSummary(match) {
  const parsed = match?.result?.document?.parsed || {};
  const description = Array.isArray(parsed.description) ? parsed.description.join(' ') : String(parsed.description || '');
  const text = description.trim() || String(match?.result?.document?.name || '').replace(/_/g, ' ');
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

function fallbackResult({ result, trust = null, blockingGate }, rank, topScore) {
  if (blockingGate) {
    throw new Error(
      `memory markdown fallback refuses to deliver ${result.document.name}: blocked by the ${blockingGate} gate`,
    );
  }
  const excerpt = result.excerpt?.text?.trim()
    ? { field: result.excerpt.field, text: result.excerpt.text.slice(0, 160) }
    : null;
  return {
    rank,
    memory_id: result.document.name,
    path: result.document.relativePath,
    score: Number((topScore > 0 ? Math.max(0, result.score) / topScore : 0).toFixed(6)),
    gate_score: fallbackGateScore(result),
    lanes: { bm25f: rank },
    trust: fallbackResultTrust(result.document, trust),
    provenance: {
      receipt_id: result.document.trust.receipt_id,
      evidence_root_sha256: result.document.trust.evidence_root_sha256,
      source_commit: result.document.trust.source_commit,
    },
    matched_fields: uniqueStrings(result.fields.length > 0 ? result.fields : ['body'], 12),
    matched_terms: uniqueStrings(result.matchedTerms.map(({ term }) => term), 6),
    excerpt,
    authority_docs: uniqueStrings(result.document.parsed.authorityDocs || [], 2),
    explanation: ['Markdown BM25F fallback after snapshot rebuild failed'],
  };
}

function fallbackTrust(runtime, result, queries) {
  const supersededBy = runtime.legacyIndex.documents.find((document) => (
    document.name !== result.document.name && document.relations.supersedes.includes(result.document.name)
  ));
  const conflicts = supersededBy ? [{ kind: 'superseded-by-candidate' }] : [];
  const trust = runtimeTrustEvaluator(runtime)(result.document);
  const verdicts = memoryTrustVerdicts({
    document: result.document,
    queries,
    conflicts,
    maxStalenessDays: MEMORY_WALL_CLOCK_STALENESS_DAYS,
    trust,
  });
  return { result, verdicts, trust, blockingGate: memoryTrustBlockingGate(verdicts) };
}

function fallbackBlockedGate(values) {
  const gates = values.map((value) => value.blockingGate).filter(Boolean);
  return ['risk', 'validity', 'applicability'].find((gate) => gates.includes(gate)) || null;
}

function compactFallbackEnvelope(envelope) {
  const { maxTopics, maxTokens } = MEMORY_CONTEXT_BUDGETS[envelope.budget.tier];
  while (envelope.results.length > maxTopics) {
    envelope.results.pop();
    envelope.budget.truncated = true;
  }
  // Pointers are trimmed before anything a quote is made of, and to one rather than to none: on the
  // pointers tier they are the whole answer, so an envelope that keeps the last one still tells the
  // caller where to look, while an empty one claims the corpus had nothing.
  const floor = envelope.results.length > 0 ? 0 : 1;
  while (envelope.pointers.length > floor && estimateEnvelope(envelope) > maxTokens) {
    envelope.pointers.pop();
    envelope.budget.truncated = true;
  }
  // Same last resort as the budgeter: a pointers tier that cannot afford a single pointer has
  // nothing to hand over, so it says so rather than overrunning its own ceiling.
  if (envelope.results.length === 0 && envelope.pointers.length > 0 && estimateEnvelope(envelope) > maxTokens) {
    envelope.pointers = [];
    envelope.delivery.tier = 'abstain';
    envelope.abstain = { abstained: true, reason: 'budget-empty', gate: 'budget', verdict_reason: null };
    envelope.budget.truncated = true;
  }
  if (estimateEnvelope(envelope) <= maxTokens) return;
  envelope.budget.truncated = true;
  for (const result of envelope.results) {
    // The contract requires at least one explanation. Compress it without emptying the fallback envelope.
    result.explanation = ['markdown-fallback'];
    result.authority_docs = result.authority_docs.slice(0, 1);
    result.matched_terms = result.matched_terms.slice(0, 3);
    if (result.excerpt?.text.length > 80) result.excerpt.text = `${result.excerpt.text.slice(0, 79)}…`;
  }
  while (envelope.results.length > 1 && estimateEnvelope(envelope) > maxTokens) {
    envelope.results.pop();
  }
  if (estimateEnvelope(envelope) > maxTokens && envelope.results[0]) {
    // Same degradation order as compactUntilFit: provenance digests go first, then a trust block
    // that says nothing (active, passed, never downgraded), then the excerpt and matched terms.
    // Non-nominal trust is never dropped -- it is the only thing telling the reader that this
    // memory is advisory or that its evidence drifted, and the two paths must not disagree about
    // that or the same memory would be labelled differently depending on how recall degraded.
    const result = envelope.results[0];
    delete result.provenance;
    if (memoryTrustIsNominal(result.trust) && estimateEnvelope(envelope) > maxTokens) {
      delete result.trust;
    }
    if (estimateEnvelope(envelope) > maxTokens) {
      result.excerpt = null;
      result.matched_terms = [];
      result.authority_docs = [];
    }
    // Same last rung as compactUntilFit: matched_fields restates the lane names once matched_terms
    // is gone, so it is what pays for keeping a trust block that is actually saying something.
    if (estimateEnvelope(envelope) > maxTokens) {
      result.matched_fields = result.matched_fields.slice(0, 1);
    }
    // Same final rung as compactUntilFit: a surviving trust block gives up logical_type before it
    // gives up anything that says the memory is not fully verified. Losing it costs the specific
    // follow-up advice, not the disclosure itself.
    if (result.trust && estimateEnvelope(envelope) > maxTokens) {
      delete result.trust.logical_type;
    }
  }
  if (estimateEnvelope(envelope) > maxTokens) {
    envelope.results = [];
    envelope.abstain = { abstained: true, reason: 'budget-empty', gate: 'budget', verdict_reason: null };
  }
  envelope.results.forEach((result, index) => { result.rank = index + 1; });
  estimateEnvelope(envelope);
}

function fallbackEnvelope(runtime, query, { limit, tier }, warnings = []) {
  const evaluated = runtime.fallback.search(runtime.legacyIndex, query, { limit: 50 })
    .map((result) => fallbackTrust(runtime, result, [query]));
  const matches = evaluated.filter((value) => value.blockingGate === null).slice(0, Math.min(limit, 3));
  // Same split as the canonical lane: only a whole-exchange refusal outranks the candidate gates.
  const queryRefusalReason = memoryQueryRefusalReason([query]);
  const blockedGate = queryRefusalReason ? 'risk' : fallbackBlockedGate(evaluated);
  const topScore = matches[0]?.result.score || 0;
  const ranked = matches.map((value, index) => fallbackResult(value, index + 1, topScore));
  // Same tier rule as the canonical lane, applied to the same field. A degraded lane that keeps
  // quoting where the healthy one would point is the kind of divergence the migration parity gate
  // exists to catch, and it would show up precisely when the snapshot is already broken.
  //
  // The canonical lane additionally requires the top candidate to explain the query
  // (candidateExplainsQuery in the budgeter). This lane deliberately does not, because it cannot:
  // the coverage features it reads -- query_span_coverage and query_coverage -- are computed by the
  // deterministic ranker from the compiled query context, and this lane exists precisely for the
  // case where no compiled snapshot could be produced. Markdown BM25F publishes a score and matched
  // terms, no coverage. Restating the condition against absent features would evaluate it as 0 and
  // reduce the degraded lane to pointers on every query, which is strictly worse than the honest
  // "this lane is less selective, and the envelope says the snapshot failed" it does today. Lane
  // parity is unaffected: it compares which memory each lane names first across both surfaces, not
  // which tier it arrived in.
  const contentTier = ranked.length > 0 && ranked[0].gate_score >= MEMORY_CONTENT_TIER_THRESHOLD;
  const results = contentTier ? ranked : [];
  const pointers = contentTier
    ? []
    : ranked.slice(0, MEMORY_MAX_POINTERS).map((result, index) => ({
      memory_id: result.memory_id,
      path: result.path,
      gate_score: result.gate_score,
      summary: fallbackPointerSummary(matches[index]),
    }));
  const envelope = {
    schema: MEMORY_QUERY_RESULT_SCHEMA,
    trace_id: randomBytes(16).toString('hex'),
    runtime: {
      version: MEMORY_RECALL_RUNTIME_VERSION,
      profile_id: FALLBACK_RANKING_PROFILE.profile,
    },
    policy: 'untrusted-memory-v1',
    query: { classifications: classifyMemoryQuery(query) },
    source: publishedMemorySource(runtime.source),
    results,
    abstain: results.length > 0
      ? { abstained: false, reason: null, gate: null, verdict_reason: null }
      : pointers.length > 0
        ? { abstained: true, reason: 'below-content-threshold', gate: 'relevance', verdict_reason: null }
        : blockedGate
          ? {
            abstained: true,
            reason: `blocked-${blockedGate}`,
            gate: blockedGate,
            verdict_reason: queryRefusalReason
              || memoryBlockedVerdictReason(blockedGate, evaluated.map((value) => value.verdicts)),
          }
          : { abstained: true, reason: 'no-trusted-candidate', gate: 'relevance', verdict_reason: null },
    budget: { tier, estimated_tokens: 0, truncated: false },
    delivery: {
      tier: results.length > 0 ? 'content' : pointers.length > 0 ? 'pointers' : 'abstain',
      content_threshold: MEMORY_CONTENT_TIER_THRESHOLD,
      eligible: matches.length,
    },
    pointers,
    warnings: [...new Set([
      'Snapshot rebuild failed; using validated Markdown BM25F fallback',
      ...skippedTopicWarnings(runtime),
      ...warnings,
    ])].slice(0, 5),
  };
  compactFallbackEnvelope(envelope);
  validateMemoryQueryResult(envelope);
  return envelope;
}

function fallbackMultiResults(runtime, queries, limit) {
  const k = 10;
  const fused = new Map();
  for (const query of queries) {
    const results = runtime.fallback.search(runtime.legacyIndex, query, { limit: 50 });
    results.forEach((result, index) => {
      let aggregate = fused.get(result.document.name);
      if (!aggregate) aggregate = { result, score: 0 };
      aggregate.score += 1 / (k + index + 1);
      if (index < (aggregate.bestRank ?? Infinity)) {
        aggregate.result = result;
        aggregate.bestRank = index;
      }
      fused.set(result.document.name, aggregate);
    });
  }
  const ranked = [...fused.values()]
    .sort((left, right) => right.score - left.score
      || left.bestRank - right.bestRank
      || left.result.document.name.localeCompare(right.result.document.name, 'en'));
  const evaluated = ranked.map((item) => fallbackTrust(runtime, { ...item.result, score: item.score }, queries));
  const accepted = evaluated.filter((value) => value.blockingGate === null).slice(0, Math.min(limit, 3));
  const topScore = accepted[0]?.result.score || 0;
  const blockedGate = fallbackBlockedGate(evaluated);
  return {
    results: accepted.map((value, index) => fallbackResult(value, index + 1, topScore)),
    accepted,
    blockedGate,
    blockedVerdictReason: memoryBlockedVerdictReason(blockedGate, evaluated.map((value) => value.verdicts)),
  };
}

function fallbackMultiEnvelope(runtime, queries, { limit, tier }, warnings = []) {
  const queryKey = queries.join(MULTI_QUERY_SEPARATOR);
  const fused = fallbackMultiResults(runtime, queries, limit);
  // Same tier rule as the other two lanes, and the same reason for not carrying the coverage
  // condition the canonical lane adds; see fallbackEnvelope.
  const contentTier = fused.results.length > 0
    && fused.results[0].gate_score >= MEMORY_CONTENT_TIER_THRESHOLD;
  const results = contentTier ? fused.results : [];
  const pointers = contentTier
    ? []
    : fused.results.slice(0, MEMORY_MAX_POINTERS).map((result, index) => ({
      memory_id: result.memory_id,
      path: result.path,
      gate_score: result.gate_score,
      summary: fallbackPointerSummary(fused.accepted[index]),
    }));
  const queryRefusalReason = memoryQueryRefusalReason(queries);
  const blockedGate = queryRefusalReason ? 'risk' : fused.blockedGate;
  const classifications = [];
  for (const query of queries) {
    for (const classification of classifyMemoryQuery(query)) {
      if (!classifications.includes(classification)) classifications.push(classification);
    }
  }
  const envelope = {
    schema: MEMORY_QUERY_RESULT_SCHEMA,
    trace_id: randomBytes(16).toString('hex'),
    runtime: {
      version: MEMORY_RECALL_RUNTIME_VERSION,
      profile_id: FALLBACK_RANKING_PROFILE.profile,
    },
    policy: 'untrusted-memory-v1',
    query: { classifications },
    source: publishedMemorySource(runtime.source),
    results,
    abstain: results.length > 0
      ? { abstained: false, reason: null, gate: null, verdict_reason: null }
      : pointers.length > 0
        ? { abstained: true, reason: 'below-content-threshold', gate: 'relevance', verdict_reason: null }
        : blockedGate
          ? {
            abstained: true,
            reason: `blocked-${blockedGate}`,
            gate: blockedGate,
            verdict_reason: queryRefusalReason || fused.blockedVerdictReason,
          }
          : { abstained: true, reason: 'no-trusted-candidate', gate: 'relevance', verdict_reason: null },
    budget: { tier, estimated_tokens: 0, truncated: false },
    delivery: {
      tier: results.length > 0 ? 'content' : pointers.length > 0 ? 'pointers' : 'abstain',
      content_threshold: MEMORY_CONTENT_TIER_THRESHOLD,
      eligible: fused.results.length,
    },
    pointers,
    warnings: [...new Set([
      'Snapshot rebuild failed; using validated Markdown BM25F multi-query fallback',
      ...skippedTopicWarnings(runtime),
      ...warnings,
    ])].slice(0, 5),
  };
  compactFallbackEnvelope(envelope);
  validateMemoryQueryResult(envelope);
  return envelope;
}

function observeRecall(runtime, details) {
  if (!runtime.observer?.recordRecall) return { traceId: null, warning: null };
  try {
    return runtime.observer.recordRecall(details) || { traceId: null, warning: null };
  } catch (error) {
    return { traceId: null, warning: error.message };
  }
}
/** Degradation belongs in the envelope warnings, which both humans and agents already consume. */
function sourceWarnings(runtime) {
  if (runtime.source.status !== 'previous') return [];
  return ['Snapshot rebuild failed; serving the previous snapshot, which may lag the current memory files'];
}

function querySnapshotRuntime(runtime, query, { limit, tier, excludeMemoryIds }, embedding = null) {
  const planner = embedding?.planner || runtime.planner;
  let stage = performance.now();
  const planResult = planMemoryQuery(planner, query, {
    embeddingResponse: embedding?.responses?.[0],
  });
  const plan = performance.now() - stage;
  stage = performance.now();
  const ranked = rankPlannedMemoryQuery(planner, query, planResult, { limit, trustEvaluator: runtimeTrustEvaluator(runtime) });
  const rank = performance.now() - stage;
  stage = performance.now();
  const envelope = budgetMemoryContext(planner, query, ranked, {
    tier,
    excludeMemoryIds,
    source: runtime.source,
    warnings: [...sourceWarnings(runtime), ...(embedding?.warning ? [embedding.warning] : [])],
  });
  return { envelope, plan, rank, context: performance.now() - stage, planResult, ranked };
}

function querySnapshotRuntimeMulti(runtime, queries, { limit, tier, excludeMemoryIds }, embedding = null) {
  const planner = embedding?.planner || runtime.planner;
  const queryKey = queries.join(MULTI_QUERY_SEPARATOR);
  let stage = performance.now();
  const planResult = planMultiMemoryQuery(planner, queries, {
    embeddingResponses: embedding?.responses || undefined,
  });
  const plan = performance.now() - stage;
  stage = performance.now();
  const ranked = rankPlannedMemoryQuery(planner, queries[0], planResult, {
    limit,
    featureQueries: queries,
    trustEvaluator: runtimeTrustEvaluator(runtime),
  });
  const rank = performance.now() - stage;
  stage = performance.now();
  const envelope = budgetMemoryContext(planner, queryKey, ranked, {
    tier,
    excludeMemoryIds,
    source: runtime.source,
    warnings: [...sourceWarnings(runtime), ...(embedding?.warning ? [embedding.warning] : [])],
  });
  return { envelope, plan, rank, context: performance.now() - stage, planResult, ranked };
}

function queryFallbackRuntime(runtime, query, { limit, tier }, embedding = null) {
  const started = performance.now();
  return {
    envelope: fallbackEnvelope(runtime, query, { limit, tier }, embedding?.warning ? [embedding.warning] : []),
    plan: 0,
    rank: performance.now() - started,
    context: 0,
    planResult: null,
    ranked: null,
  };
}

function embeddingMetrics(embedding) {
  if (!embedding?.active) return null;
  const rrfWeight = Number.isFinite(embedding.rrfWeight) ? embedding.rrfWeight : 0;
  return {
    active: true,
    mode: memoryEmbeddingMode({ rrfWeight }),
    rrf_weight: rrfWeight,
    latency_ms: Number(Math.max(0, embedding.latencyMs || 0).toFixed(3)),
    cache_hit: Boolean(embedding.cacheHit),
    degraded_reason: embedding.degradedReason || null,
  };
}

function contractDegradedEmbedding(embedding, planner) {
  return {
    active: true,
    responses: null,
    planner,
    latencyMs: embedding?.latencyMs || 0,
    cacheHit: Boolean(embedding?.cacheHit),
    degradedReason: 'contract',
    rrfWeight: Number.isFinite(embedding?.rrfWeight) ? embedding.rrfWeight : 0,
    warning: 'Embedding channel degraded (contract); lexical results are unchanged',
  };
}

export function queryMemoryRuntime(runtime, query, options = {}) {
  const raw = String(query || '').trim();
  if (!raw) throw new Error('memory query must not be empty');
  const normalized = {
    limit: options.limit ?? 3,
    tier: options.tier || 'default',
    excludeMemoryIds: options.excludeMemoryIds || [],
  };
  const started = performance.now();
  let resolvedEmbedding = options.embedding || null;
  let result;
  try {
    result = runtime.mode === 'snapshot'
      ? querySnapshotRuntime(runtime, raw, normalized, resolvedEmbedding)
      : queryFallbackRuntime(runtime, raw, normalized, resolvedEmbedding);
  } catch (error) {
    if (!resolvedEmbedding?.active) throw error;
    resolvedEmbedding = contractDegradedEmbedding(resolvedEmbedding, runtime.planner);
    result = runtime.mode === 'snapshot'
      ? querySnapshotRuntime(runtime, raw, normalized, resolvedEmbedding)
      : queryFallbackRuntime(runtime, raw, normalized, resolvedEmbedding);
  }
  const metrics = { ...result, total: performance.now() - started };
  delete metrics.envelope;
  metrics.embedding = embeddingMetrics(resolvedEmbedding);
  const execution = options.execution || 'cold';
  const observation = observeRecall(runtime, {
    runtime,
    query: raw,
    envelope: result.envelope,
    metrics,
    execution,
    episodeId: options.episodeId || null,
  });
  return {
    envelope: result.envelope,
    observationTraceId: observation.traceId,
    warning: observation.warning,
    metrics,
  };
}

export function queryMemoryRuntimeMulti(runtime, queries, options = {}) {
  if (!Array.isArray(queries) || queries.length < 2 || queries.length > 3) {
    throw new Error('memory multi-query requires 2-3 phrasings');
  }
  const values = queries.map((query) => String(query || '').trim());
  if (values.some((query) => !query)) throw new Error('memory multi-query phrasing must not be empty');
  const normalized = {
    limit: options.limit ?? 3,
    tier: options.tier || 'default',
    excludeMemoryIds: options.excludeMemoryIds || [],
  };
  const started = performance.now();
  let resolvedEmbedding = options.embedding || null;
  let result;
  const query = () => runtime.mode === 'snapshot'
    ? querySnapshotRuntimeMulti(runtime, values, normalized, resolvedEmbedding)
    : {
      envelope: fallbackMultiEnvelope(
        runtime,
        values,
        normalized,
        resolvedEmbedding?.warning ? [resolvedEmbedding.warning] : [],
      ),
      plan: 0,
      rank: performance.now() - started,
      context: 0,
      planResult: null,
      ranked: null,
    };
  try {
    result = query();
  } catch (error) {
    if (!resolvedEmbedding?.active) throw error;
    resolvedEmbedding = contractDegradedEmbedding(resolvedEmbedding, runtime.planner);
    result = query();
  }
  const metrics = { ...result, total: performance.now() - started };
  delete metrics.envelope;
  metrics.embedding = embeddingMetrics(resolvedEmbedding);
  const observation = observeRecall(runtime, {
    runtime,
    query: values.join(MULTI_QUERY_SEPARATOR),
    envelope: result.envelope,
    metrics,
    execution: options.execution || 'cold',
    episodeId: options.episodeId || null,
  });
  return {
    envelope: result.envelope,
    observationTraceId: observation.traceId,
    warning: observation.warning,
    metrics,
  };
}
