import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { collectMemoryReport } from './features/report.mjs';
import { collectMemoryHealth } from './features/health.mjs';
import { buildMemoryEmbeddings, inspectMemoryEmbeddingStatus } from './features/embedding.mjs';
import {
  evaluateMemoryEmbeddingAb,
  MEMORY_RECALL_RUNTIME_VERSION,
} from './memory-embedding-evaluation.mjs';
import {
  applyEmbeddingConfig,
  createMemoryDashboardJobs,
  enableEmbedding,
  memoryEmbeddingPresetList,
  startEmbeddingAb,
  startEmbeddingBuild,
  testEmbeddingConnection,
} from './memory-dashboard-actions.mjs';
import { readFeedbackInbox, readTriggerBackfillReceipts, summarizeFeedback } from './memory-feedback.mjs';
import { loadMemoryTopics } from './memory-schema.mjs';
import {
  DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  readMemoryObservabilityEvents,
} from './memory-observability.mjs';
import { negotiateMemoryDashboardLocale } from './memory-dashboard-i18n.mjs';
import { renderMemoryDashboardPage } from './memory-dashboard-page-v2.mjs';

export const MEMORY_DASHBOARD_SCHEMA = 'ownmem-dashboard/v1';
export const DEFAULT_MEMORY_DASHBOARD_DIRECTORY = '.local-test/memory-dashboard';
export const MEMORY_DASHBOARD_WINDOWS = Object.freeze(['7d', '30d', '90d']);
export const MEMORY_DASHBOARD_HOST = '127.0.0.1';

const MAX_EVENT_POINTS = 600;
const REVIEW_HORIZON_DAYS = 60;
const AB_DIFF_PREVIEW = 12;
const AB_DIFF_LIST = 60;
const MAX_REQUEST_BYTES = 65_536;
const JOB_ID_PATTERN = /^[0-9a-f]{32}$/;

function readJsonFile(file) {
  if (!existsSync(file)) return { exists: false, valid: false, value: null, error: null };
  try {
    return { exists: true, valid: true, value: JSON.parse(readFileSync(file, 'utf8')), error: null };
  } catch (error) {
    return { exists: true, valid: false, value: null, error: error.message };
  }
}

function assertWindow(since) {
  if (!MEMORY_DASHBOARD_WINDOWS.includes(since)) {
    throw Object.assign(new Error(`unsupported window: ${since}`), { status: 400 });
  }
  return since;
}

  // Raw feedback queries remain local. The dashboard exposes the review queue without exporting it.
function collectFeedbackQueue({ root, memoryDir = '.claude/memory' }) {
  const feedbackFile = path.join(root, '.local-test/memory-recall-feedback.jsonl');
  const receiptFile = path.join(root, '.local-test/memory-trigger-backfill-receipts.jsonl');
  let activeNames = new Set();
  try {
    activeNames = new Set(loadMemoryTopics({ root, memoryDir })
      .filter(topic => topic.record)
      .map(topic => topic.record.name));
  } catch {
    activeNames = new Set();
  }
  const inbox = readFeedbackInbox(feedbackFile, activeNames);
  const receipts = readTriggerBackfillReceipts(receiptFile);
  const backfilled = new Set(receipts.entries.map(entry => entry.feedback_line));
  return {
    file_exists: existsSync(feedbackFile),
    receipts_file_exists: existsSync(receiptFile),
    ...summarizeFeedback(inbox),
    receipts: receipts.entries.length,
    pending: inbox.entries
      .filter(entry => entry.verdict !== 'correct')
      .map(entry => ({
        line: entry.line,
        verdict: entry.verdict,
        recorded_at: entry.recordedAt || null,
        query: entry.query,
        expected: entry.expected || null,
        returned: entry.returned,
        trigger_backfilled: backfilled.has(entry.line),
      })),
  };
}

  // Period comparisons recompute a real previous window. Missing evidence is never interpolated.
function previousWindowMetrics({ root, memoryDir, since, now, health }) {
  const days = Number.parseInt(since, 10);
  const previousNow = new Date(now.getTime() - days * 86_400_000);
  const previous = collectMemoryReport({ root, memoryDir, since, now: previousNow, health });
  return {
    window: since,
    from: previous.window.from,
    to: previous.window.to,
    recalls: previous.samples.recalls,
    fulltext_open_rate: previous.delivery.fulltext_open_rate,
    top1_open_share: previous.delivery.top1_open_share,
    delivery_rate: previous.delivery.delivery_rate,
    abstain_rate: previous.performance.retrieval_abstain_rate,
    p95_ms: previous.performance.current_runtime.total_ms.p95,
    truncation_rate: previous.context.truncation_rate,
  };
}

export function collectDashboardOverview({ root, memoryDir = '.claude/memory', since = '7d', now = new Date() } = {}) {
  assertWindow(since);
  let health = null;
  let healthError = null;
  try {
    health = collectMemoryHealth({ root, memoryDir });
  } catch (error) {
    healthError = error.message;
  }
  // The report also reads health; pass it explicitly to avoid scanning the corpus twice per request.
  const report = collectMemoryReport({ root, memoryDir, since, now, health });
  return {
    schema: MEMORY_DASHBOARD_SCHEMA,
    generated_at: now.toISOString(),
    window: since,
    report,
    previous: previousWindowMetrics({ root, memoryDir, since, now, health }),
    health,
    health_error: healthError,
    feedback_queue: collectFeedbackQueue({ root, memoryDir }),
  };
}

export function collectDashboardEvents({
  root,
  since = '7d',
  now = new Date(),
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
} = {}) {
  assertWindow(since);
  const days = Number.parseInt(since, 10);
  const from = new Date(now.getTime() - days * 86_400_000);
  const read = readMemoryObservabilityEvents({ root, directory, since: from, until: now });
  const recalls = read.events.filter(event => event.event === 'recall.completed');
  const currentRecalls = recalls.filter(event => event.process.component_version === MEMORY_RECALL_RUNTIME_VERSION);
  const queryShape = (event) => {
    const classes = event.payload.query_class || [];
    if (classes.length === 1 && classes[0] === 'path') return 'pure-path';
    if (classes.length === 1 && ['natural', 'decision'].includes(classes[0])) return 'natural-only';
    if (classes.includes('mixed') || classes.length > 1) return 'mixed';
    return 'other';
  };
  // Export chart fields only. Events contain an HMAC query ID, and full payloads stay private.
  const points = currentRecalls.slice(-MAX_EVENT_POINTS).map(event => ({
    t: event.recorded_at,
    component_version: event.process.component_version,
    surface: event.payload.surface || 'unknown',
    query_shape: queryShape(event),
    total_ms: event.payload.total_ms,
    stage_ms: event.payload.stage_ms,
    execution: event.payload.execution,
    cache_hit: event.payload.cache_hit,
    abstained: event.payload.abstained,
    estimated_tokens: event.payload.estimated_tokens,
    truncated: event.payload.truncated,
    query_class: event.payload.query_class,
    returned: event.payload.returned_topics.length,
    channels: event.payload.channels,
    embedding: event.payload.embedding ?? null,
  }));
  return {
    schema: MEMORY_DASHBOARD_SCHEMA,
    generated_at: now.toISOString(),
    window: since,
    total_events: read.events.length,
    total_recalls: recalls.length,
    current_runtime: MEMORY_RECALL_RUNTIME_VERSION,
    historical_recalls: recalls.length - currentRecalls.length,
    truncated_series: currentRecalls.length > points.length,
    invalid_events: read.errors.length,
    embedding_degradation: summarizeEmbeddingDegradation(currentRecalls),
    points,
  };
}

/**
 * Runtime degradation uses only recalls where the semantic channel was actually active.
 * An unconfigured or disabled channel has no denominator and must render as unavailable,
 * not as a measured zero-percent degradation rate.
 */
function summarizeEmbeddingDegradation(recalls) {
  const active = recalls.filter(event => event.payload.embedding?.active === true);
  const reasons = {};
  let degraded = 0;
  for (const event of active) {
    const reason = event.payload.embedding.degraded_reason;
    if (!reason) continue;
    degraded += 1;
    reasons[reason] = (reasons[reason] || 0) + 1;
  }
  return {
    observed: active.length,
    degraded,
    rate: active.length === 0 ? null : Number((degraded / active.length).toFixed(6)),
    reasons: Object.fromEntries(Object.entries(reasons).sort(([left], [right]) => left.localeCompare(right, 'en'))),
    last_degraded_at: [...active].reverse().find(event => event.payload.embedding.degraded_reason)?.recorded_at ?? null,
  };
}

function upcomingReviews(reviewLock, now, horizonDays = REVIEW_HORIZON_DAYS) {
  if (!reviewLock.valid || !reviewLock.value?.topics) return [];
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000).toISOString().slice(0, 10);
  return Object.entries(reviewLock.value.topics)
    .map(([name, entry]) => ({
      name,
      review_by: entry.review_by,
      reviewed_on: entry.reviewed_on ?? null,
      overdue: entry.review_by < today,
      days_left: Math.round((Date.parse(`${entry.review_by}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000),
    }))
    .filter(entry => entry.review_by <= horizon)
    .sort((left, right) => left.review_by.localeCompare(right.review_by, 'en'));
}

export function collectDashboardLocks({ root, memoryDir = '.claude/memory', now = new Date() } = {}) {
  const quota = readJsonFile(path.join(root, memoryDir, 'quota.lock.json'));
  const quality = readJsonFile(path.join(root, memoryDir, 'quality.lock.json'));
  const review = readJsonFile(path.join(root, memoryDir, 'review.lock.json'));
  return {
    schema: MEMORY_DASHBOARD_SCHEMA,
    generated_at: now.toISOString(),
    quota: { exists: quota.exists, valid: quota.valid, error: quota.error, value: quota.value },
    quality: { exists: quality.exists, valid: quality.valid, error: quality.error, value: quality.value },
    review: {
      exists: review.exists,
      valid: review.valid,
      error: review.error,
      topics: review.valid ? Object.keys(review.value.topics || {}).length : 0,
      upcoming: upcomingReviews(review, now),
      horizon_days: REVIEW_HORIZON_DAYS,
    },
  };
}

function summarizeAbReport(report, file, mtime) {
  return {
    file,
    modified_at: mtime,
    report_id: report.report_id,
    provider: report.provider,
    model: report.model,
    dimensions: report.dimensions,
  // Historical reports may come from an older ranker. Expose staleness instead of presenting
  // an obsolete guard result as permission to activate weighting.
    component_version: report.component_version ?? null,
    component_current: report.component_version === MEMORY_RECALL_RUNTIME_VERSION,
    weights: report.weights,
    corpus: report.corpus,
    metrics: report.metrics,
    guard: report.guard,
    diff_counts: (report.diffs || []).reduce((counts, diff) => {
      counts[diff.change] = (counts[diff.change] || 0) + 1;
      return counts;
    }, {}),
    diff_preview: changedDiffs(report).slice(0, AB_DIFF_PREVIEW).map(publicDiff),
    // The final wizard step shows improved and regressed cases and reports every truncated count.
    diff_improved: changedDiffs(report).filter(diff => diff.change === 'improved').slice(0, AB_DIFF_LIST).map(publicDiff),
    diff_regressed: changedDiffs(report).filter(diff => diff.change === 'regressed').slice(0, AB_DIFF_LIST).map(publicDiff),
    diff_list_cap: AB_DIFF_LIST,
  };
}

function changedDiffs(report) {
  return (report.diffs || []).filter(diff => diff.change !== 'unchanged');
}

function publicDiff(diff) {
  return {
  // case_id is a SHA-256 query receipt; only its prefix crosses the dashboard boundary.
    case_id: diff.case_id.slice(0, 12),
    kind: diff.kind,
    group: diff.group,
    partition: diff.partition ?? null,
    change: diff.change,
    rank_a: diff.a?.rank ?? null,
    rank_b: diff.b?.rank ?? null,
    abstained_a: diff.a?.abstained ?? null,
    abstained_b: diff.b?.abstained ?? null,
  };
}

export function collectDashboardBenchmark({
  root,
  memoryDir = '.claude/memory',
  embeddingDirectory = '.local-test/memory-embedding',
  now = new Date(),
} = {}) {
  const quality = readJsonFile(path.join(root, memoryDir, 'quality.lock.json'));
  const reportDirectory = path.join(root, embeddingDirectory, 'ab-reports');
  const files = existsSync(reportDirectory)
    ? readdirSync(reportDirectory)
      .filter(name => name.endsWith('.json'))
      .map(name => ({ name, mtime: statSync(path.join(reportDirectory, name)).mtimeMs }))
      .sort((left, right) => right.mtime - left.mtime)
    : [];
  const history = [];
  for (const entry of files.slice(0, 10)) {
    const parsed = readJsonFile(path.join(reportDirectory, entry.name));
    if (!parsed.valid) continue;
    history.push(summarizeAbReport(
      parsed.value,
      path.posix.join(embeddingDirectory, 'ab-reports', entry.name),
      new Date(entry.mtime).toISOString(),
    ));
  }
  return {
    schema: MEMORY_DASHBOARD_SCHEMA,
    generated_at: now.toISOString(),
  // quality.lock is the benchmark ratchet; the dashboard does not invent another baseline.
    quality_lock: quality.valid ? quality.value : null,
    ab_reports: history.length,
    latest: history[0] ?? null,
    history,
  };
}

export function collectDashboardEmbedding({ root, memoryDir = '.claude/memory', embeddingDirectory, indexDirectory, now = new Date() } = {}) {
  try {
    const status = inspectMemoryEmbeddingStatus({
      root,
      memoryDir,
      directory: embeddingDirectory,
      indexDirectory,
    });
    return { schema: MEMORY_DASHBOARD_SCHEMA, generated_at: now.toISOString(), error: null, status };
  } catch (error) {
    return {
      schema: MEMORY_DASHBOARD_SCHEMA,
      generated_at: now.toISOString(),
      error: error.message,
      status: { configured: false, config: null, artifact: null, reconciliation: null },
    };
  }
}

function sendJson(response, status, body) {
  const payload = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  response.end(payload);
}

function sendHtml(response, html, locale) {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-language': locale,
  // The page is self-contained and loads no external resources or additional execution surface.
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'",
  });
  response.end(html);
}

function tokenMatches(expected, received) {
  if (typeof received !== 'string' || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received, 'utf8'), Buffer.from(expected, 'utf8'));
}

function allowedOrigins(port) {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

function allowedHosts(port) {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let overflowed = false;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
      // Stop accumulating and record overflow without destroying the socket before sending 413.
        overflowed = true;
        return;
      }
      chunks.push(chunk);
    });
    request.once('error', reject);
    request.once('end', () => {
      if (overflowed) {
        reject(Object.assign(new Error('request body too large'), { status: 413, code: 'payload_too_large' }));
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const value = JSON.parse(raw);
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('body must be a JSON object');
        }
        resolve(value);
      } catch (error) {
        reject(Object.assign(new Error(error.message), { status: 400, code: 'bad_body' }));
      }
    });
  });
}

/**
 * Dashboard service: numeric loopback, random port, bearer token, and Origin/Host validation.
 *
 * Every route declares allowed methods; other methods receive 405 and unknown paths receive 404.
 * Writes require a present same-origin Origin header and application/json. JSON plus the custom
 * token header makes cross-site writes preflighted, while this service emits no CORS permission.
 * When Sec-Fetch-Site is present it must be same-origin or none. Request bodies are capped at 64 KiB.
 * The five embedding configuration/job actions remain in-process with no child-process surface.
 */
export function createMemoryDashboardServer({
  root,
  memoryDir = '.claude/memory',
  token = randomBytes(32).toString('hex'),
  embeddingDirectory,
  indexDirectory,
  observabilityDirectory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  now = () => new Date(),
  jobs = createMemoryDashboardJobs({ now }),
  buildImpl = buildMemoryEmbeddings,
  evaluateImpl = evaluateMemoryEmbeddingAb,
  fetchImpl,
} = {}) {
  if (!root) throw new Error('ownmem dashboard requires a repository root');

  const embeddingStatus = () => inspectMemoryEmbeddingStatus({ root, memoryDir, directory: embeddingDirectory, indexDirectory });

  const ROUTES = {
    '/api/ping': {
      GET: ({ port }) => ({ schema: MEMORY_DASHBOARD_SCHEMA, ok: true, port, pid: process.pid }),
    },
    '/api/overview': {
      GET: ({ since }) => collectDashboardOverview({ root, memoryDir, since, now: now() }),
    },
    '/api/events': {
      GET: ({ since }) => collectDashboardEvents({ root, since, now: now(), directory: observabilityDirectory }),
    },
    '/api/locks': {
      GET: () => collectDashboardLocks({ root, memoryDir, now: now() }),
    },
    '/api/benchmark/latest': {
      GET: () => collectDashboardBenchmark({ root, memoryDir, embeddingDirectory, now: now() }),
    },
    '/api/embedding/status': {
      GET: () => collectDashboardEmbedding({ root, memoryDir, embeddingDirectory, indexDirectory, now: now() }),
    },
    '/api/embedding/presets': {
      GET: () => memoryEmbeddingPresetList(),
    },
    '/api/embedding/config': {
      PUT: ({ body }) => applyEmbeddingConfig({ root, directory: embeddingDirectory, body, now: now() }),
    },
    '/api/embedding/test': {
      POST: ({ body }) => testEmbeddingConnection({ root, directory: embeddingDirectory, body, fetchImpl, now: now() }),
    },
    '/api/embedding/build': {
      POST: () => startEmbeddingBuild({
        jobs, root, memoryDir, directory: embeddingDirectory, indexDirectory, buildImpl, fetchImpl, now,
      }),
    },
    '/api/embedding/ab': {
      POST: ({ body }) => startEmbeddingAb({
        jobs, root, memoryDir, directory: embeddingDirectory, indexDirectory, evaluateImpl, fetchImpl, body, now,
      }),
    },
    '/api/embedding/enable': {
      POST: ({ body }) => enableEmbedding({
        root, directory: embeddingDirectory, body, status: embeddingStatus(), now: now(),
      }),
    },
    '/api/jobs': {
      GET: () => ({ schema: MEMORY_DASHBOARD_SCHEMA, active: jobs.active(), jobs: jobs.list() }),
    },
  };

  function resolveRoute(pathname) {
    if (ROUTES[pathname]) return ROUTES[pathname];
    const job = /^\/api\/jobs\/([^/]+)(\/cancel)?$/.exec(pathname);
    if (!job) return null;
    const id = job[1];
    if (!JOB_ID_PATTERN.test(id)) return null;
    if (job[2]) return { POST: () => jobs.cancel(id) };
    return {
      GET: () => {
        const found = jobs.get(id);
        if (!found) throw Object.assign(new Error('unknown job id'), { status: 404, code: 'job_not_found' });
        return found;
      },
    };
  }

  const server = createServer(async (request, response) => {
    let url;
    try {
      url = new URL(request.url, `http://${MEMORY_DASHBOARD_HOST}`);
    } catch {
      sendJson(response, 400, { error: 'bad_request' });
      return;
    }
    const port = server.address()?.port;
    const host = String(request.headers.host || '');
    if (!allowedHosts(port).includes(host)) {
      sendJson(response, 403, { error: 'forbidden_host' });
      return;
    }
    const origin = request.headers.origin;
    if (origin && !allowedOrigins(port).includes(origin)) {
      sendJson(response, 403, { error: 'forbidden_origin' });
      return;
    }
    const fetchSite = request.headers['sec-fetch-site'];
    if (fetchSite && !['same-origin', 'none'].includes(String(fetchSite))) {
      sendJson(response, 403, { error: 'forbidden_origin' });
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'method_not_allowed' });
        return;
      }
      const locale = negotiateMemoryDashboardLocale({
        requested: url.searchParams.get('lang'),
        acceptLanguage: request.headers['accept-language'],
      });
      sendHtml(response, renderMemoryDashboardPage({ locale }), locale);
      return;
    }
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    const route = url.pathname.startsWith('/api/') ? resolveRoute(url.pathname) : null;
    if (!route) {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    const handler = route[request.method];
    if (!handler) {
      sendJson(response, 405, { error: 'method_not_allowed', allow: Object.keys(route).join(', ') });
      return;
    }
    if (!tokenMatches(token, request.headers['x-memory-token'])) {
      sendJson(response, 401, { error: 'unauthorized' });
      return;
    }

    const writes = request.method !== 'GET';
    if (writes) {
    // Browsers attach Origin to cross-site writes. A missing value is untrusted and rejected.
      if (!origin) {
        sendJson(response, 403, { error: 'origin_required' });
        return;
      }
      const contentType = String(request.headers['content-type'] || '');
      if (contentType && !contentType.startsWith('application/json')) {
        sendJson(response, 415, { error: 'unsupported_media_type' });
        return;
      }
    }

    const since = url.searchParams.get('since') || '7d';
    try {
      const body = writes ? await readRequestBody(request) : null;
      sendJson(response, 200, await handler({ since, body, port, url, request }));
    } catch (error) {
      const status = error.status || 500;
      sendJson(response, status, {
        error: error.code || (status === 400 ? 'bad_window' : 'server_error'),
        message: error.message,
        ...(error.guard ? { guard: error.guard, report_id: error.report_id } : {}),
        ...(error.job ? { job: error.job } : {}),
      });
    }
  });

  return {
    server,
    token,
    jobs,
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, MEMORY_DASHBOARD_HOST, () => {
          server.removeListener('error', reject);
          const address = server.address();
          resolve({ port: address.port, url: `http://${MEMORY_DASHBOARD_HOST}:${address.port}/#t=${token}` });
        });
      });
    },
    close() {
      return new Promise(resolve => server.close(() => resolve()));
    },
  };
}
