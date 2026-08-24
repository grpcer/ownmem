/**
 * Dashboard mutations and the single-job queue.
 *
 * Enabling writes changes the original read-only threat model, so every action enforces
 * its own preconditions instead of trusting callers. The only side effects are configuration,
 * connectivity tests, embedding builds, A/B evaluation, and channel activation. Long jobs call
 * the in-process build and evaluation functions without child processes. Every returned
 * configuration passes through publicMemoryEmbeddingConfig so credentials remain masked.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  createMemoryEmbeddingClient,
  createMemoryEmbeddingConfig,
  DEFAULT_MEMORY_EMBEDDING_DIRECTORY,
  MEMORY_EMBEDDING_PRESETS,
  MemoryEmbeddingProviderError,
  memoryEmbeddingSetupConfig,
  publicMemoryEmbeddingConfig,
  readMemoryEmbeddingConfig,
  validateMemoryEmbeddingConfig,
  writeMemoryEmbeddingConfig,
} from './memory-embedding-provider.mjs';
import {
  MEMORY_EMBEDDING_SUGGESTED_WEIGHT,
  MEMORY_RECALL_RUNTIME_VERSION,
  validateMemoryEmbeddingAbReport,
} from './memory-embedding-evaluation.mjs';

export const MEMORY_DASHBOARD_JOB_SCHEMA = 'ownmem-dashboard-job/v1';
export const MEMORY_DASHBOARD_JOB_KINDS = Object.freeze(['build', 'ab']);
export const MEMORY_DASHBOARD_ENABLE_MODES = Object.freeze(['off', 'observe', 'weighted']);
const JOB_HISTORY = 8;

export function actionError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function requireObject(body, label) {
  if (body === null || body === undefined) return {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw actionError(400, 'bad_body', `${label} must be a JSON object`);
  }
  return body;
}

function optionalText(value, label, max = 2048) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) {
    throw actionError(400, 'bad_field', `${label} must be a string of at most ${max} characters`);
  }
  return value.trim() || null;
}

/* ---------- Single-job queue ---------- */

function publicJob(job) {
  return {
    schema: MEMORY_DASHBOARD_JOB_SCHEMA,
    job_id: job.id,
    kind: job.kind,
    state: job.state,
    progress: { completed: job.completed, total: job.total },
    message_code: job.message_code,
    started_at: job.started_at,
    finished_at: job.finished_at,
    result: job.result,
    error: job.error,
  };
}

/**
 * Only one long-running job may exist at a time. Concurrent builds can overwrite each
 * other's vector checkpoints, so the second request is rejected instead of silently queued.
 */
export function createMemoryDashboardJobs({ now = () => new Date() } = {}) {
  const jobs = new Map();
  let activeId = null;

  function prune() {
    const finished = [...jobs.values()]
      .filter(job => job.state !== 'running')
      .sort((left, right) => Date.parse(left.finished_at) - Date.parse(right.finished_at));
    while (finished.length > JOB_HISTORY) jobs.delete(finished.shift().id);
  }

  return {
    get(id) {
      const job = jobs.get(id);
      return job ? publicJob(job) : null;
    },
    active() {
      return activeId ? publicJob(jobs.get(activeId)) : null;
    },
    list() {
      return [...jobs.values()].map(publicJob);
    },
    cancel(id) {
      const job = jobs.get(id);
      if (!job) throw actionError(404, 'job_not_found', 'unknown job id');
      if (job.state !== 'running') return publicJob(job);
      job.cancelled = true;
      job.controller.abort(new Error('cancelled by operator'));
      job.message_code = 'cancelling';
      return publicJob(job);
    },
    start({ kind, messageCode, run }) {
      if (!MEMORY_DASHBOARD_JOB_KINDS.includes(kind)) throw actionError(400, 'bad_job_kind', `unknown job kind: ${kind}`);
      if (activeId) {
        const running = jobs.get(activeId);
        throw Object.assign(
          actionError(409, 'job_in_progress', `a ${running.kind} job is already running`),
          { job: publicJob(running) },
        );
      }
      const id = randomUUID().replace(/-/g, '');
      const controller = new AbortController();
      const job = {
        id,
        kind,
        state: 'running',
        completed: 0,
        total: null,
        message_code: messageCode || 'preparing',
        started_at: now().toISOString(),
        finished_at: null,
        result: null,
        error: null,
        cancelled: false,
        controller,
      };
      jobs.set(id, job);
      activeId = id;
      const report = (progress) => {
        if (progress.completed !== undefined) job.completed = progress.completed;
        if (progress.total !== undefined) job.total = progress.total;
        if (progress.messageCode !== undefined) job.message_code = progress.messageCode;
      };
      job.promise = Promise.resolve()
        .then(() => run({ signal: controller.signal, report }))
        .then((result) => {
          job.state = job.cancelled ? 'cancelled' : 'done';
          job.result = result ?? null;
          job.message_code = null;
        })
        .catch((error) => {
      // AbortSignal surfaces as a network error below, but an explicit cancellation must be
      // recorded as cancelled so users do not mistake it for corrupted data.
          job.state = job.cancelled ? 'cancelled' : 'failed';
          job.error = job.cancelled ? null : String(error?.message || error).slice(0, 500);
          job.message_code = null;
        })
        .finally(() => {
          job.finished_at = now().toISOString();
          if (activeId === id) activeId = null;
          prune();
        });
      return publicJob(job);
    },
  };
}

/* ---------- Configuration writes ---------- */

function carriedEnablement(existing, next) {
  // Changing the provider, model, or dimensions invalidates old A/B evidence and disables weighting.
  const sameSetup = existing
    && existing.provider === next.provider
    && existing.model === next.model
    && existing.base_url === next.base_url
    && existing.dimensions === next.dimensions;
  if (!sameSetup) return {};
  return {
    enabled: existing.enabled,
    rrf_weight: existing.rrf_weight,
    confidence_contribution: existing.confidence_contribution,
    last_ab_report: existing.last_ab_report,
    ...(existing.last_ab_report_id === undefined ? {} : { last_ab_report_id: existing.last_ab_report_id }),
    ...(existing.enable_forced === undefined ? {} : { enable_forced: existing.enable_forced }),
    ...(existing.enabled_at === undefined ? {} : { enabled_at: existing.enabled_at }),
  };
}

function readConfigOrNull({ root, directory }) {
  try {
    return readMemoryEmbeddingConfig({ root, directory });
  } catch {
    return null;
  }
}

/**
 * The stored key may only be inherited while the request still points at the same upstream.
 * createMemoryEmbeddingConfig lets a caller-supplied base_url override the preset, and base_url
 * validation accepts any HTTP(S) host, so inheriting unconditionally means one connection test can
 * forward the saved key verbatim to an arbitrary endpoint — the masking the page shows is only
 * decorative once a caller holds the token. Changing provider or host requires the key again.
 */
function inheritsStoredKey(input, existing, provider) {
  if (!existing || existing.provider !== provider) return false;
  const requested = optionalText(input.base_url, 'base_url');
  if (!requested) return true;
  try {
    return new URL(requested).host === new URL(existing.base_url).host;
  } catch {
    return false;
  }
}

export function draftEmbeddingConfig(body, { existing = null, now = new Date() } = {}) {
  const input = requireObject(body, 'config');
  const provider = optionalText(input.provider, 'provider', 64);
  if (!provider || !MEMORY_EMBEDDING_PRESETS[provider]) {
    throw actionError(400, 'unknown_provider', `unknown memory embedding provider: ${provider}`);
  }
  // The key may be omitted when changing models on the same upstream; it stays unreadable to the page.
  const apiKey = optionalText(input.api_key, 'api_key', 4096)
    || (inheritsStoredKey(input, existing, provider) ? existing.api_key : null);
  if (!apiKey) throw actionError(400, 'api_key_required', 'an API key is required for a new provider or endpoint');
  if (input.timeout_ms !== undefined && input.timeout_ms !== null
      && (!Number.isInteger(input.timeout_ms) || input.timeout_ms < 100 || input.timeout_ms > 120_000)) {
    throw actionError(400, 'bad_timeout', 'timeout_ms must be an integer between 100 and 120000');
  }
  if (input.dimensions !== undefined && input.dimensions !== null
      && (!Number.isInteger(input.dimensions) || input.dimensions < 1 || input.dimensions > 65_536)) {
    throw actionError(400, 'bad_dimensions', 'dimensions must be an integer between 1 and 65536');
  }
  try {
    return createMemoryEmbeddingConfig({
      provider,
      baseUrl: optionalText(input.base_url, 'base_url'),
      model: optionalText(input.model, 'model', 256),
      accountId: optionalText(input.account_id, 'account_id', 256),
      apiKey,
      dimensions: input.dimensions ?? null,
      timeoutMs: input.timeout_ms ?? 800,
      now,
    });
  } catch (error) {
    throw actionError(400, 'invalid_config', error.message);
  }
}

export function applyEmbeddingConfig({ root, directory, body, now = new Date() } = {}) {
  const existing = readConfigOrNull({ root, directory });
  const draft = draftEmbeddingConfig(body, { existing, now });
  const config = validateMemoryEmbeddingConfig({ ...draft, ...carriedEnablement(existing, draft) });
  writeMemoryEmbeddingConfig({ root, directory }, config);
  return {
    schema: 'ownmem-embedding-config-result/v1',
    reset_enablement: !existing || existing.provider !== config.provider || existing.model !== config.model,
    config: publicMemoryEmbeddingConfig(config),
  };
}

/* ---------- Connectivity test ---------- */

export async function testEmbeddingConnection({ root, directory, body, fetchImpl, now = new Date() } = {}) {
  const input = requireObject(body, 'test request');
  const existing = readConfigOrNull({ root, directory });
  const config = input.draft
    ? draftEmbeddingConfig(input.draft, { existing, now })
    : existing;
  if (!config) throw actionError(400, 'not_configured', 'memory embedding is not configured yet');
  const client = createMemoryEmbeddingClient(memoryEmbeddingSetupConfig(config), fetchImpl ? { fetchImpl } : {});
  try {
    const result = await client.test();
    return { schema: 'ownmem-dashboard-test-result/v1', ok: true, ...result, category: null };
  } catch (error) {
    const category = error instanceof MemoryEmbeddingProviderError ? error.category : 'network';
    return {
      schema: 'ownmem-dashboard-test-result/v1',
      ok: false,
      provider: config.provider,
      model: config.model,
      dimensions: null,
      latency_ms: null,
      category,
    // The provider layer has already masked credentials; this boundary only limits message size.
      message: String(error?.message || error).slice(0, 500),
    };
  }
}

/* ---------- A/B report lookup and activation gate ---------- */

function abReportDirectory({ root, directory = DEFAULT_MEMORY_EMBEDDING_DIRECTORY }) {
  return path.join(path.resolve(root), directory, 'ab-reports');
}

/**
 * A valid A/B report has a consistent checksum and exactly matches the current provider,
 * model, corpus snapshot, and recall-stack version. Any identity change invalidates the report.
 *
 * component_version is required because snapshot_id covers corpus and compiled ranking data,
 * not ranker or semantic-channel code. Reports from different behavior versions may share a
 * snapshot while reaching incompatible safety conclusions.
 *
 * File modification time is not evidence of production order: checkout and clone operations
 * can rewrite directory timestamps. It is only a deterministic tie-breaker after report-owned
 * identity fields have established validity.
 */
export function findEmbeddingAbReport({ root, directory, config, snapshotId } = {}) {
  const reports = abReportDirectory({ root, directory });
  if (!existsSync(reports)) return null;
  const files = readdirSync(reports)
    .filter(name => name.endsWith('.json'))
    .map(name => ({ name, mtime: statSync(path.join(reports, name)).mtimeMs }))
    .sort((left, right) => (right.mtime - left.mtime) || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const matches = [];
  for (const entry of files) {
    let report;
    try {
      report = validateMemoryEmbeddingAbReport(JSON.parse(readFileSync(path.join(reports, entry.name), 'utf8')));
    } catch {
      continue;
    }
    if (report.provider !== config.provider || report.model !== config.model) continue;
    if (snapshotId && report.snapshot_id !== snapshotId) continue;
  // Reports without component_version predate this proof field and cannot unlock the current stack.
    if (report.component_version !== MEMORY_RECALL_RUNTIME_VERSION) continue;
    matches.push({
      report,
      file: path.posix.join(directory || DEFAULT_MEMORY_EMBEDDING_DIRECTORY, 'ab-reports', entry.name),
      modified_at: new Date(entry.mtime).toISOString(),
    });
  }
  if (matches.length === 0) return null;
  const [best] = matches;
  // Conflicting reports with identical identities and weights are self-contradictory evidence.
  // Deterministic A/B inputs must agree, so the non-permissive conclusion wins.
  const contradiction = matches.find(candidate => candidate.report.weights.b === best.report.weights.b
    && candidate.report.report_id !== best.report.report_id
    && !candidate.report.guard.recommended_weight_safe);
  return contradiction && best.report.guard.recommended_weight_safe ? contradiction : best;
}

// One sentence per verdict, each naming what the evidence actually said rather than the fact that a
// gate returned false. `no_change` and `uninformative` read almost the same to a gate and not at all
// the same to a person: one is a result, the other is the absence of one.
const AB_VERDICT_REASONS = {
  regresses: 'the suggested weight made a measured metric worse',
  no_change: 'the suggested weight changed nothing on cases this corpus could still improve on',
  uninformative: 'this corpus cannot show a benefit — the baseline already scores at the ceiling on every metric, so the comparison can only detect harm',
  insufficient_evidence: 'the A/B ran with no scored golden cases',
};

function assertVectorsReady(status) {
  if (!status.configured) throw actionError(400, 'not_configured', 'memory embedding is not configured yet');
  if (!status.artifact) throw actionError(409, 'vectors_missing', 'run an embedding build before enabling the channel');
  const reconciliation = status.reconciliation || {};
  if (reconciliation.stale > 0 || reconciliation.deleted > 0) {
    throw actionError(409, 'vectors_stale',
      `vectors are stale (${reconciliation.stale} stale, ${reconciliation.deleted} deleted); rebuild before enabling`);
  }
}

export function enableEmbedding({
  root,
  directory,
  body,
  status,
  now = new Date(),
} = {}) {
  const input = requireObject(body, 'enable request');
  const mode = optionalText(input.mode, 'mode', 32) || 'observe';
  if (!MEMORY_DASHBOARD_ENABLE_MODES.includes(mode)) {
    throw actionError(400, 'bad_mode', `mode must be one of ${MEMORY_DASHBOARD_ENABLE_MODES.join(', ')}`);
  }
  const config = readConfigOrNull({ root, directory });
  if (!config) throw actionError(400, 'not_configured', 'memory embedding is not configured yet');

  if (mode === 'off') {
    const next = validateMemoryEmbeddingConfig({
      ...config,
      enabled: false,
      rrf_weight: 0,
      enabled_at: null,
      updated_at: now.toISOString(),
    });
    writeMemoryEmbeddingConfig({ root, directory }, next);
    return { schema: 'ownmem-dashboard-enable-result/v1', mode, forced: false, report_id: null, config: publicMemoryEmbeddingConfig(next) };
  }

  assertVectorsReady(status);
  const found = findEmbeddingAbReport({ root, directory, config, snapshotId: status.reconciliation.snapshot_id });
  if (!found) {
    throw actionError(409, 'ab_report_missing',
      'no valid A/B report matches this provider, model, corpus snapshot and recall stack version '
      + `(${MEMORY_RECALL_RUNTIME_VERSION}); run the A/B evaluation first`);
  }
  const { report } = found;
  const weight = mode === 'weighted'
    ? (input.weight === undefined || input.weight === null ? report.weights.b : Number(input.weight))
    : 0;
  if (mode === 'weighted' && (!Number.isFinite(weight) || weight <= 0 || weight > 100)) {
    throw actionError(400, 'bad_weight', 'weight must be greater than 0 and at most 100');
  }

  const forced = Boolean(input.force);
  // Weighted mode opens automatically on one verdict only: a measured gain. Everything else --
  // a regression, a tie the corpus could have broken, or a corpus that was never able to show a
  // gain -- is a judgement call, and the operator has to make it out loud. The gate used to accept
  // "nothing got worse", which on a corpus where arm A already scores 1.000 everywhere is a
  // sentence about the corpus rather than about the channel; that is how the channel was enabled
  // on 2026-08-14 with no measured benefit behind it.
  if (mode === 'weighted' && report.guard.verdict !== 'improves') {
    // force acknowledges the failed gate; confirm independently acknowledges the named reason.
    if (!forced || input.confirm !== true) {
      throw Object.assign(
        actionError(409, 'ab_guard_blocked',
          `${AB_VERDICT_REASONS[report.guard.verdict] || 'the A/B evidence does not support this weight'}`
          + '; weighted mode requires force + confirm'),
        {
          guard: report.guard,
          report_id: report.report_id,
        },
      );
    }
  }

  const next = validateMemoryEmbeddingConfig({
    ...config,
    enabled: true,
    rrf_weight: mode === 'weighted' ? weight : 0,
    last_ab_report: found.file,
    last_ab_report_id: report.report_id,
    enable_forced: mode === 'weighted' ? forced && report.guard.verdict !== 'improves' : false,
    enabled_at: now.toISOString(),
    updated_at: now.toISOString(),
  });
  writeMemoryEmbeddingConfig({ root, directory }, next);
  return {
    schema: 'ownmem-dashboard-enable-result/v1',
    mode,
    forced: next.enable_forced,
    report_id: report.report_id,
    guard: report.guard,
    config: publicMemoryEmbeddingConfig(next),
  };
}

/* ---------- Long-running embedding and A/B jobs ---------- */

export function startEmbeddingBuild({ jobs, root, memoryDir, directory, indexDirectory, buildImpl, fetchImpl, now = () => new Date() } = {}) {
  const config = readConfigOrNull({ root, directory });
  if (!config) throw actionError(400, 'not_configured', 'memory embedding is not configured yet');
  return jobs.start({
    kind: 'build',
    messageCode: 'compiling',
    run: ({ signal, report }) => buildImpl({
      root,
      memoryDir,
      directory,
      indexDirectory,
      config,
      fetchImpl,
      signal,
      now,
      onProgress: ({ completed, total }) => {
        report({ completed, total, messageCode: 'embedding' });
      },
    }),
  });
}

export function startEmbeddingAb({ jobs, root, memoryDir, directory, indexDirectory, evaluateImpl, fetchImpl, body, now = () => new Date() } = {}) {
  const input = requireObject(body, 'ab request');
  const config = readConfigOrNull({ root, directory });
  if (!config) throw actionError(400, 'not_configured', 'memory embedding is not configured yet');
  const suggestedWeight = input.weight === undefined || input.weight === null
    ? MEMORY_EMBEDDING_SUGGESTED_WEIGHT
    : Number(input.weight);
  if (!Number.isFinite(suggestedWeight) || suggestedWeight <= 0 || suggestedWeight > 100) {
    throw actionError(400, 'bad_weight', 'weight must be greater than 0 and at most 100');
  }
  return jobs.start({
    kind: 'ab',
    messageCode: 'preparing_vectors',
    run: ({ signal, report }) => evaluateImpl({
      root,
      memoryDir,
      directory,
      indexDirectory,
      config,
      suggestedWeight,
    // A/B has no signal parameter; cancellation reaches its fetches and preserves reusable cache entries.
      fetchImpl: (input_, init) => {
        if (signal.aborted) return Promise.reject(new Error('cancelled by operator'));
        return (fetchImpl || globalThis.fetch)(input_, init);
      },
      onProgress: ({ completed, total }) => {
        report({ completed, total, messageCode: 'caching' });
      },
    }),
  });
}

export function memoryEmbeddingPresetList() {
  return {
    schema: 'ownmem-embedding-presets/v1',
// This registry is the wizard's only provider data source; the page does not duplicate policy metadata.
    presets: Object.values(MEMORY_EMBEDDING_PRESETS).map(preset => ({ ...preset })),
    suggested_weight: MEMORY_EMBEDDING_SUGGESTED_WEIGHT,
  };
}
