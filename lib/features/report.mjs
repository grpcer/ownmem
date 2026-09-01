#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import { collectMemoryHealth } from './health.mjs';
import {
  DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  MEMORY_RECALL_COMPONENTS,
  readMemoryObservabilityEvents,
} from '../memory-observability.mjs';
import { readMemoryEmbeddingConfig } from '../memory-embedding-provider.mjs';
import { summarizeFeedback } from '../memory-feedback.mjs';
import { summarizeOutcomeReceipts } from './outcome.mjs';
import { summarizeAttributionLabels } from './attribution.mjs';
import {
  collectCorrectionReviewMaterials,
  formatPromotionReviewMaterial,
} from '../memory-review-material.mjs';
import { collectMemoryGovernance } from '../memory-governance-surface.mjs';
import {
  MEMORY_EVALUATION_INSUFFICIENT_EVIDENCE,
  MEMORY_EVALUATION_MEASURED,
  memoryEvaluationMetric,
} from '../memory-evaluation-cases.mjs';
import {
  MEMORY_RECALL_RUNTIME_VERSION,
  memoryEmbeddingMode,
} from '../memory-runtime-contract.mjs';
import { schemaPath } from '../schema-paths.mjs';
import { resolveMemoryDir } from '../memory-paths.mjs';

const DEFAULT_ROOT = process.cwd();
const SMALL_SAMPLE_THRESHOLD = 20;
const REPORT_SCHEMA = JSON.parse(readFileSync(schemaPath('observability', 'report.schema.json'), 'utf8'));
const reportAjv = new Ajv({
  allErrors: true,
  strict: true,
  formats: {
    'date-time': {
      type: 'string',
      validate: value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        && !Number.isNaN(Date.parse(value)),
    },
  },
});
const validateReportSchema = reportAjv.compile(REPORT_SCHEMA);

function parseDuration(value) {
  const match = String(value || '').match(/^(\d+)([dh])$/);
  if (!match) throw new Error('--since must use <positive integer>d or <positive integer>h, for example 7d');
  const amount = Number.parseInt(match[1], 10);
  if (amount < 1 || amount > 3650) throw new Error('--since must be between 1h and 3650d');
  return amount * (match[2] === 'd' ? 86_400_000 : 3_600_000);
}

function parseArgs(args) {
  const options = {
    root: DEFAULT_ROOT,
    memoryDir: null,
    directory: DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
    since: '7d',
    json: false,
    governance: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--root') options.root = path.resolve(args[++index]);
    else if (argument === '--memory-dir') options.memoryDir = args[++index];
    else if (argument === '--observability-dir') options.directory = args[++index];
    else if (argument === '--since') options.since = args[++index];
    else if (argument === '--json') options.json = true;
    else if (argument === '--governance') options.governance = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  options.memoryDir = resolveMemoryDir(options.root, options.memoryDir);
  parseDuration(options.since);
  return options;
}

function usage() {
  return `Usage: npx ownmem report [options]

Summarize local engineering-memory runtime evidence. The report never uploads data or prints raw queries.

Options:
  --since 7d|30d          Time window (default 7d; hours such as 24h are also accepted)
  --root PATH             Repository root
  --memory-dir PATH       Memory directory (default .claude/memory)
  --observability-dir DIR Local event directory (default .local-test/memory-observability)
  --json                  Output the closed v1 report object
  --governance            Print the review material waiting for a person instead of the summary.
                          Nothing on that path writes: it reads the queue and prints, and every
                          item it prints still has to be merged by somebody.`;
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

export function percentile(values, ratio) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function distribution(values) {
  const rounded = value => value === null ? null : Number(value.toFixed(3));
  return {
    samples: values.length,
    p50: rounded(percentile(values, 0.5)),
    p95: rounded(percentile(values, 0.95)),
    p99: rounded(percentile(values, 0.99)),
  };
}

function recallQueryShape(event) {
  const classes = event.payload.query_class || [];
  if (classes.length === 1 && classes[0] === 'path') return 'pure-path';
  if (classes.length === 1 && ['natural', 'decision'].includes(classes[0])) return 'natural-only';
  if (classes.includes('mixed') || classes.length > 1) return 'mixed';
  return 'other';
}

function summarizeRecallPerformance(events) {
  return {
    samples: events.length,
    observed_from: events.map(event => event.recorded_at).sort()[0] || null,
    observed_to: events.map(event => event.recorded_at).sort().at(-1) || null,
    total_ms: distribution(events.map(event => event.payload.total_ms)),
    hot_ms: distribution(events.filter(event => event.payload.execution === 'hot').map(event => event.payload.total_ms)),
    cold_ms: distribution(events.filter(event => event.payload.execution === 'cold').map(event => event.payload.total_ms)),
  };
}

// Cohorts split three ways (surface × execution × query shape), which is the right granularity for
// latency but too fine to read an abstain rate off. This one groups by surface alone.
function summarizeRetrievalBySurface(attempts) {
  const bySurface = new Map();
  for (const event of attempts) {
    const surface = event.payload.surface || 'unknown';
    const entry = bySurface.get(surface) || { attempts: 0, abstained: 0 };
    entry.attempts += 1;
    if (event.payload.abstained) entry.abstained += 1;
    bySurface.set(surface, entry);
  }
  return Object.fromEntries([...bySurface.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([surface, entry]) => [surface, {
      attempts: entry.attempts,
      abstained: entry.abstained,
      abstain_rate: ratio(entry.abstained, entry.attempts),
    }]));
}

function summarizeRuntimeCohorts(events) {
  const groups = new Map();
  for (const event of events) {
    const surface = event.payload.surface || 'unknown';
    const execution = event.payload.execution;
    const queryShape = recallQueryShape(event);
    const key = `${surface}\0${execution}\0${queryShape}`;
    const group = groups.get(key) || { surface, execution, query_shape: queryShape, events: [] };
    group.events.push(event);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((left, right) => left.surface.localeCompare(right.surface, 'en')
      || left.execution.localeCompare(right.execution, 'en')
      || left.query_shape.localeCompare(right.query_shape, 'en'))
    .map(({ events: cohortEvents, ...identity }) => {
      const retrieval = cohortEvents.filter(event => event.payload.abstain_reason !== 'all-candidates-excluded');
      const abstained = retrieval.filter(event => event.payload.abstained).length;
      return {
        ...identity,
        samples: cohortEvents.length,
        total_ms: distribution(cohortEvents.map(event => event.payload.total_ms)),
        retrieval_attempts: retrieval.length,
        retrieval_abstained: abstained,
        retrieval_abstain_rate: ratio(abstained, retrieval.length),
        deduplicated: cohortEvents.filter(event => event.payload.abstain_reason === 'all-candidates-excluded').length,
      };
    });
}

function summarizeEmbeddingEvents(events) {
  const degraded = events.filter(event => event.payload.embedding.degraded_reason !== null);
  const reasons = {};
  degraded.forEach(event => increment(reasons, event.payload.embedding.degraded_reason));
  return {
    samples: events.length,
    successful: events.length - degraded.length,
    degraded: degraded.length,
    degradation_rate: ratio(degraded.length, events.length),
    latency_ms: distribution(events.map(event => event.payload.embedding.latency_ms)),
    reasons,
  };
}

/**
 * Identity of the population one feedback stream was counted over.
 *
 * Every stream block carries its own, because the three streams answer different questions and are
 * produced at wildly different rates: retrieval verdicts arrive a couple of times a month, weak
 * labels arrive at the rate turns happen, and outcome receipts only when a person or the host says
 * something. A block that stated a count without naming what it was counted over would be read
 * against whichever denominator happened to sit next to it on the page, which is exactly how one
 * stream ends up impersonating another.
 */
function streamProfile({ sourceEvent, recordSchema, from, to }) {
  return {
    profile_id: `${sourceEvent}@${MEMORY_RECALL_RUNTIME_VERSION}`,
    source_event: sourceEvent,
    record_schema: recordSchema,
    runtime_version: MEMORY_RECALL_RUNTIME_VERSION,
    window_from: from.toISOString(),
    window_to: to.toISOString(),
  };
}

/**
 * Shape the window's events like the inbox the stream summarizers already read.
 *
 * The counting itself belongs to the stream that owns the vocabulary -- summarizeFeedback seeds one
 * bucket per verdict it accepts, and the other two do the same for their own enums. Re-deriving the
 * buckets here is what produced the crash this function exists to prevent: `miss` was renamed to
 * `retrieval_miss` in the stream, a hardcoded bucket list here kept the old spelling, and the first
 * real row of the new verdict made the report fail its own closed schema.
 */
function eventInbox(events, payloadFields) {
  return {
    entries: events.map((event, index) => ({
      line: index + 1,
      ...Object.fromEntries(payloadFields.map(field => [field, event.payload[field]])),
    })),
    errors: [],
    duplicates: 0,
  };
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

export function validateMemoryReport(report) {
  if (!validateReportSchema(report)) {
    const details = (validateReportSchema.errors || [])
      .map(error => `${error.instancePath || '/'} ${error.message}`)
      .join('; ');
    throw new Error(`ownmem report is invalid: ${details}`);
  }
  return report;
}

function readJson(file) {
  try {
    return { exists: true, valid: true, value: JSON.parse(readFileSync(file, 'utf8')), error: null };
  } catch (error) {
    return { exists: existsSync(file), valid: false, value: null, error: error.message };
  }
}

function localInstallationId(root, directory) {
  try {
    const key = readFileSync(path.resolve(root, directory, 'hmac.key'));
    return `local-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
  } catch {
    return null;
  }
}

function currentEmbeddingState(root) {
  try {
    const config = readMemoryEmbeddingConfig({ root });
    if (!config) return { configured: false, mode: 'off', since: null, provider: null, model: null, rrf_weight: 0, timeout_ms: null };
    const mode = memoryEmbeddingMode({ enabled: config.enabled, rrfWeight: config.rrf_weight });
    return {
      configured: true,
      mode,
      since: config.enabled_at || config.updated_at || null,
      provider: config.provider,
      model: config.model,
      rrf_weight: config.rrf_weight,
      timeout_ms: config.timeout_ms,
    };
  } catch {
    return { configured: null, mode: 'unknown', since: null, provider: null, model: null, rrf_weight: null, timeout_ms: null };
  }
}

function staticGateHealth(root, memoryDir, health) {
  const quota = readJson(path.join(root, memoryDir, 'quota.lock.json'));
  const quality = readJson(path.join(root, memoryDir, 'quality.lock.json'));
  const quotaSchemaHealthy = quota.valid && ['ownmem.quota/v2', 'ownmem.quota/v3'].includes(quota.value.schema);
  const quotaHealthy = quotaSchemaHealthy
    && health
    && health.corpus.active_topics <= quota.value.max_active_l3
    && health.corpus.active_bytes <= quota.value.max_active_bytes;
  const qualityHealthy = quality.valid
    && typeof quality.value.schema === 'string'
    && quality.value.schema.startsWith('ownmem.quality/');
  return {
    schema: health ? {
      healthy: health.corpus.schema_errors === 0,
      errors: health.corpus.schema_errors,
      warnings: health.corpus.schema_warnings,
      valid_topics: health.corpus.valid_topics,
      active_topics: health.corpus.active_topics,
    } : null,
    quota: {
      healthy: Boolean(quotaHealthy),
      lock_exists: quota.exists,
      lock_valid: quota.valid,
      active_topics: health?.corpus.active_topics ?? null,
      max_active_topics: quota.value?.max_active_l3 ?? null,
      active_bytes: health?.corpus.active_bytes ?? null,
      max_active_bytes: quota.value?.max_active_bytes ?? null,
    },
    quality_lock: {
      healthy: Boolean(qualityHealthy),
      lock_exists: quality.exists,
      lock_valid: quality.valid,
      schema: quality.value?.schema ?? null,
    },
  };
}

function recommendations(report) {
  const candidates = [];
  // The action text ships in English; the code lets a localized surface render the same advice in its
  // own language without maintaining a second copy of the recommendation rules.
  const add = (code, priority, impact, cost, evidence, action) => candidates.push({ code, priority, impact, cost, evidence, action });
  if (report.data_quality.invalid_events > 0) {
    // Two different problems wear the same count, and only one of them is the producer's fault.
    // A recommendation that says "fix the producer" about rows written under a retired schema is
    // unactionable, and an unactionable recommendation in a list of three is a permanent squatter.
    const outdatedOnly = report.data_quality.invalid_outdated_schema === report.data_quality.invalid_events;
    add(outdatedOnly ? 'discard-outdated-events' : 'fix-invalid-events', 100, 'high', 'low',
      `${report.data_quality.invalid_events} unreadable event line(s), ${report.data_quality.invalid_outdated_schema} of them written under a retired schema`,
      outdatedOnly
        ? 'Delete the .local-test/ event files written under the retired schema; the current build will collect fresh telemetry within a day of normal use.'
        : 'Fix or quarantine the invalid events so the report stops underreporting real traffic.');
  }
  // Gated on the latest build, not on the window total: the question a recommendation answers is
  // "is something wrong now", and a later successful build is the fix. The window counts stay in the
  // evidence so a run of failures that ended in success is still visible.
  if (report.maintenance.latest_build_succeeded === false || report.maintenance.latest_build_used_fallback === true) {
    const state = report.maintenance.latest_build_succeeded === false ? 'failed' : 'fell back to the previous snapshot';
    add('fix-builds', 95, 'high', 'medium', `the most recent build ${state} (${report.maintenance.failed_builds} failed / ${report.maintenance.fallback_builds} fallback in this window)`, 'Track down the latest failed or fallback build so queries read a current, complete snapshot.');
  }
  if (report.maintenance.orphans > 0 || report.maintenance.drift > 0) {
    add('clear-maintenance', 85, 'high', 'medium', `${report.maintenance.orphans} orphan(s), ${report.maintenance.drift} drift, ${report.maintenance.proposals} proposal(s)`, 'Clear the orphans and drift. Check proposals against the authoritative decision first, so an accepted blocked proposal is not counted as backlog.');
  }
  // There used to be an `investigate-open-rate` recommendation here, firing whenever full-text opens
  // fell below 20%. It was wrong on three counts and has been removed rather than retuned:
  //
  //   1. A low open rate is the design working. The whole point of the 400-token envelope is that
  //      the caller does not need to open the source, so this number is structurally low forever.
  //   2. The action it asked for -- separate "the summary was enough" from "the recall was
  //      worthless" -- is exactly the distinction this system has established it cannot observe.
  //   3. Standing at impact:high, it permanently occupied one of the three recommendation slots and
  //      pushed out advice someone could actually act on.
  //
  // The number itself still ships on the north-star line, where it is stated as a coverage floor
  // rather than an adoption rate.
  if (report.performance.current_runtime.hot_ms.samples >= SMALL_SAMPLE_THRESHOLD
      && report.performance.current_runtime.hot_ms.p95 > 20) {
    add('profile-hot-path', 75, 'high', 'medium', `current ${report.performance.current_runtime.version} hot P95 ${report.performance.current_runtime.hot_ms.p95}ms`, 'Profile the hot recall path of the current version only; older versions no longer gate this round.');
  }
  if (report.performance.embedding.current_state.samples >= SMALL_SAMPLE_THRESHOLD
      && report.performance.embedding.current_state.degradation_rate > 0.2) {
    add('check-provider-latency', 73, 'high', 'low', `${report.performance.embedding.current_state.degraded}/${report.performance.embedding.current_state.samples} current-state embedding request(s) degraded`, 'Check provider latency and the timeout first. Keep observe at weight 0; weighted stays closed until the degradation rate settles.');
  }
  // This report counts verdicts from the event stream, which cannot tell whether a later retrieval
  // improvement already fixed a retrieval_miss -- deciding that requires actually re-running the
  // recall, which only memory-feedback-review does. So the wording points at that tool instead of
  // asserting a backlog: on 2026-08-15 the single logged miss showed up here as "1/1 wrong or miss"
  // while the review queue had already resolved it and reported 0 actionable.
  if (report.quality.feedback.total > 0 && report.quality.feedback.wrong_miss_rate > 0.1) {
    const shape = report.quality.feedback.wrong_result_shape;
    add('review-feedback', 70, 'high', 'medium', `${shape.returned} wrong delivery / ${shape.abstained} wrong abstention / ${shape.unknown} legacy-unknown / ${report.quality.feedback.verdicts.retrieval_miss} retrieval_miss among ${report.quality.feedback.total} receipt(s) (resolved ones not deducted here)`, 'Review wrong deliveries as precision failures and wrong abstentions as missing-retrieval or corpus failures; then run memory-feedback-review to re-run each named miss and drop the ones a later improvement already fixed.');
  }
  // Recommend a larger budget only when whole topics are dropped; excerpt shortening is expected.
  if (report.context.samples > 0 && report.context.topic_dropping_envelopes / report.context.samples > 0.05) {
    add('review-budget-tier', 60, 'medium', 'medium', `${report.context.topic_dropping_envelopes}/${report.context.samples} envelope(s) dropped ${report.context.dropped_topics} trusted topic(s)`, 'Topics the ranker trusted do not fit the current budget tier. Confirm whether what was dropped mattered before raising the tier or tightening the ranking.');
  }
  if (candidates.length === 0 && report.samples.recalls < SMALL_SAMPLE_THRESHOLD) {
    add('keep-collecting', 10, 'unknown', 'low', `${report.samples.recalls} recall sample(s) in window`, 'Keep collecting real calls and adoption events; the sample is too small to justify an algorithm change yet.');
  }
  return candidates.sort((left, right) => right.priority - left.priority).slice(0, 3)
    .map(({ priority, ...item }) => item);
}

export function collectMemoryReport({
  root = DEFAULT_ROOT,
  memoryDir = '.claude/memory',
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  since = '7d',
  from: suppliedFrom = null,
  now = new Date(),
  health: suppliedHealth,
  // Overrides for the two tripwire-owned surfaces. Both are collected for real when nothing is
  // supplied; passing one pins it, which is what a fixture needs and what a host with its own
  // collector would use. Absent collectors report themselves as absent rather than as a zero.
  observation_window: observationWindow = null,
  quarantine = null,
} = {}) {
  // A session window is shorter than the 1h floor --since accepts, so callers may pin an exact start.
  const from = suppliedFrom instanceof Date ? suppliedFrom : new Date(now.getTime() - parseDuration(since));
  const requestedWindow = suppliedFrom instanceof Date ? `custom:${suppliedFrom.toISOString()}` : since;
  const eventRead = readMemoryObservabilityEvents({ root, directory, since: from, until: now });
  const events = eventRead.events;
  const byType = {};
  for (const event of events) increment(byType, event.event);
  const recalls = events.filter(event => event.event === 'recall.completed');
  const delivered = events.filter(event => event.event === 'recall.delivered');
  const consumed = events.filter(event => event.event === 'recall.consumed');
  const feedback = events.filter(event => event.event === 'feedback.recorded');
  const outcomeReceipts = events.filter(event => event.event === 'outcome.recorded');
  const attributionLabels = events.filter(event => event.event === 'attribution.recorded');
  const builds = events.filter(event => event.event === 'index.build');
  const maintenance = events.filter(event => event.event === 'maintenance.completed');
  const gates = events.filter(event => event.event === 'gate.completed');
  const observedTimes = events.map(event => event.recorded_at).filter(Boolean).sort();

  // Derive consumption surfaces from observed events instead of assuming one producer.
  const consumptionSources = [...new Set(consumed.map(event => event.payload.via || 'claude-hook'))].sort();
  const consumedByTrace = new Map();
  for (const event of consumed) {
    const state = consumedByTrace.get(event.trace_id)
      || { topics: new Set(), authority_followed: false, authority_observed: false };
    event.payload.topics.forEach(topic => state.topics.add(topic));
  // authority_followed=null means the producer cannot observe it; exclude those events from the denominator.
    if (typeof event.payload.authority_followed === 'boolean') {
      state.authority_observed = true;
      state.authority_followed ||= event.payload.authority_followed;
    }
    consumedByTrace.set(event.trace_id, state);
  }
  const eligible = recalls.filter(event => !event.payload.abstained && event.payload.returned_topics.length > 0);
  const currentRuntimeRecalls = recalls.filter(event => event.process.component_version === MEMORY_RECALL_RUNTIME_VERSION);
  const currentRuntimeEligible = currentRuntimeRecalls.filter(event => (
    !event.payload.abstained && event.payload.returned_topics.length > 0
  ));
  const allRecallTraceIds = new Set(recalls.map(event => event.trace_id));
  const currentRuntimeTraceIds = new Set(currentRuntimeRecalls.map(event => event.trace_id));
  const deliveredByTrace = new Map();
  for (const event of delivered) {
    const topics = deliveredByTrace.get(event.trace_id) || new Set();
    event.payload.topics.forEach(topic => topics.add(topic));
    deliveredByTrace.set(event.trace_id, topics);
  }
  const currentDeliveredTraceIds = new Set(currentRuntimeEligible
    .filter(event => deliveredByTrace.has(event.trace_id))
    .map(event => event.trace_id));
  const currentFulltextOpenTraceIds = new Set(consumed
    .filter(event => currentDeliveredTraceIds.has(event.trace_id))
    .map(event => event.trace_id));
  let currentTop1Open = 0;
  for (const recall of currentRuntimeEligible) {
    if (!currentFulltextOpenTraceIds.has(recall.trace_id)) continue;
    const consumption = consumedByTrace.get(recall.trace_id);
    if (consumption?.topics.has(recall.payload.returned_topics[0])) currentTop1Open += 1;
  }
  const orphanDeliveries = delivered.filter(event => !allRecallTraceIds.has(event.trace_id));
  const currentConsumedWithoutDelivery = consumed.filter(event => (
    currentRuntimeTraceIds.has(event.trace_id) && !currentDeliveredTraceIds.has(event.trace_id)
  ));
  // Legacy events without a producer surface cannot prove consumption-pairing coverage. Confirmed
  // consumption still counts toward adoption but must not manufacture an eligible denominator.
  const observableEligible = eligible.filter(event => (
    event.payload.consumption_eligible === true
    && ['cli', 'claude-hook'].includes(event.payload.surface)
  ));
  const observableEligibleTraceIds = new Set(observableEligible.map(event => event.trace_id));
  let consumedTraces = 0;
  let adopted = 0;
  let top1 = 0;
  let topK = 0;
  let authorityFollowed = 0;
  let authorityObservedTraces = 0;
  let observableConsumedTraces = 0;
  for (const recall of eligible) {
    const consumption = consumedByTrace.get(recall.trace_id);
    if (!consumption) continue;
    consumedTraces += 1;
    if (observableEligibleTraceIds.has(recall.trace_id)) observableConsumedTraces += 1;
    if (consumption.authority_observed) {
      authorityObservedTraces += 1;
      if (consumption.authority_followed) authorityFollowed += 1;
    }
    const returned = recall.payload.returned_topics;
    const intersection = returned.filter(topic => consumption.topics.has(topic));
    if (intersection.length > 0) adopted += 1;
    if (consumption.topics.has(returned[0])) top1 += 1;
    if (intersection.length > 0) topK += 1;
  }

  const queryClasses = {};
  const channelCandidates = {};
  const channelQueries = {};
  recalls.forEach(event => {
    event.payload.query_class.forEach(value => increment(queryClasses, value));
    Object.entries(event.payload.channels).forEach(([channel, count]) => {
      increment(channelCandidates, channel, count);
      if (count > 0) increment(channelQueries, channel);
    });
  });
  // Component names distinguish ready, previous-snapshot, and lexical fallback levels. Legacy
  // generic events are excluded because a smaller proven denominator is better than fabricated attribution.
  const degradationObservable = recalls.filter(event => MEMORY_RECALL_COMPONENTS.includes(event.process?.component));
  const snapshotDegradation = {
    observed: degradationObservable.length,
    ...Object.fromEntries(MEMORY_RECALL_COMPONENTS.map(component => [
      component.replace('memory-recall-', ''),
      degradationObservable.filter(event => event.process.component === component).length,
    ])),
  };
  snapshotDegradation.rate = ratio(
    snapshotDegradation.previous + snapshotDegradation.fallback,
    degradationObservable.length,
  );
  const cacheObservable = recalls.filter(event => (
    event.payload.consumption_eligible === true
    && ['cli', 'claude-hook'].includes(event.payload.surface)
    && typeof event.payload.cache_hit === 'boolean'
  ));
  const legacyCachePlaceholders = recalls.filter(event => (
    !event.payload.surface && typeof event.payload.cache_hit === 'boolean'
  ));
  const embeddingObservable = recalls.filter(event => event.payload.embedding?.active === true);
  const embeddingDegraded = embeddingObservable.filter(event => event.payload.embedding.degraded_reason !== null);
  const embeddingReasons = {};
  embeddingDegraded.forEach(event => increment(embeddingReasons, event.payload.embedding.degraded_reason));
  const embeddingModes = {};
  for (const event of embeddingObservable) {
    const mode = event.payload.embedding.mode || 'unknown';
    const state = embeddingModes[mode] || { samples: 0, successful: 0, degraded: 0, latency: [] };
    state.samples += 1;
    if (event.payload.embedding.degraded_reason === null) state.successful += 1;
    else state.degraded += 1;
    state.latency.push(event.payload.embedding.latency_ms);
    embeddingModes[mode] = state;
  }
  const embeddingCurrent = currentEmbeddingState(root);
  const embeddingStateSince = embeddingCurrent.since ? new Date(embeddingCurrent.since) : from;
  const currentRuntimeFrom = currentRuntimeRecalls.length > 0
    ? new Date([...currentRuntimeRecalls].sort((left, right) => left.recorded_at.localeCompare(right.recorded_at))[0].recorded_at)
    : from;
  const embeddingStateFrom = new Date(Math.max(from.getTime(), embeddingStateSince.getTime(), currentRuntimeFrom.getTime()));
  const currentEmbeddingEvents = ['observe', 'weighted'].includes(embeddingCurrent.mode)
    ? embeddingObservable.filter(event => (
      event.payload.embedding.mode === embeddingCurrent.mode
      && event.process.component_version === MEMORY_RECALL_RUNTIME_VERSION
      && new Date(event.recorded_at) >= embeddingStateFrom
    ))
    : [];
  const currentEmbeddingSummary = summarizeEmbeddingEvents(currentEmbeddingEvents);
  const abstainReasons = {};
  recalls.filter(event => event.payload.abstained)
    .forEach(event => increment(abstainReasons, event.payload.abstain_reason || 'unrecorded'));
  const hitRecalls = recalls.filter(event => !event.payload.abstained && event.payload.returned_topics.length > 0);
  const currentContextRecalls = hitRecalls.filter(event => (
    event.payload.consumption_eligible === true
    && ['cli', 'claude-hook'].includes(event.payload.surface)
  ));
  // dropped_topics is a newer field; include only events that actually observed it.
  const droppedObservable = currentContextRecalls.filter(event => Number.isInteger(event.payload.dropped_topics));
  const droppedTopicEnvelopes = droppedObservable.filter(event => event.payload.dropped_topics > 0);
  const deduplicated = recalls.filter(event => event.payload.abstain_reason === 'all-candidates-excluded');
  const unclassifiedAbstains = recalls.filter(event => event.payload.abstained && !Object.hasOwn(event.payload, 'abstain_reason'));
  const retrievalAttempts = recalls.filter(event => (
    event.payload.abstain_reason !== 'all-candidates-excluded'
    && (!event.payload.abstained || Object.hasOwn(event.payload, 'abstain_reason'))
  ));
  const retrievalAbstained = retrievalAttempts.filter(event => event.payload.abstained);
  // Three streams, three summarizers, three denominators. Each block below is built by the module
  // that owns the vocabulary, so a verdict, outcome or label added or renamed there arrives here
  // without a second inventory to keep in step. Every recordable value is seeded by those
  // summarizers, so one nobody used this window reports 0 rather than dropping out of the object.
  // Rates deliberately keep their original definitions; widening what they mean is a metric change,
  // not a collection change.
  const recallByTrace = new Map(recalls.map((event) => [event.trace_id, event]));
  const feedbackSummary = summarizeFeedback({
    entries: feedback.map((event, index) => ({
      line: index + 1,
      verdict: event.payload.verdict,
      returned_count: Array.isArray(recallByTrace.get(event.trace_id)?.payload?.returned_topics)
        ? recallByTrace.get(event.trace_id).payload.returned_topics.length
        : null,
    })),
    errors: [],
    duplicates: 0,
  });
  const outcomeSummary = summarizeOutcomeReceipts(eventInbox(outcomeReceipts, ['outcome', 'confirmed_by']));
  const attributionSummary = summarizeAttributionLabels(eventInbox(attributionLabels, ['label']));
  // Labels anchor to the trace that delivered the memory, and one turn can label more than one
  // memory, so the count of labels is not the count of labelled deliveries. Both are reported: the
  // difference between them is the whole point -- a delivery nobody labelled is unknown, and the
  // only way to keep that visible is to state how many there were.
  const attributionTraceIds = new Set(attributionLabels.map(event => event.trace_id));
  const labelledDeliveries = [...currentDeliveredTraceIds].filter(traceId => attributionTraceIds.has(traceId)).length;
  // Which memories are still unlabelled, by name. A count tells the agent that something is
  // missing; a name tells it what to type. The whole reason this stream has zero rows in practice
  // is that "you labelled 0 of 13" leaves the reader to reconstruct which 13 those were.
  const labelledMemoryIds = new Set(attributionLabels.map(event => event.payload.memory_id));
  const unlabelledMemories = [...new Set([...currentDeliveredTraceIds]
    .filter(traceId => !attributionTraceIds.has(traceId))
    .flatMap(traceId => [...(deliveredByTrace.get(traceId) || [])]))]
    .filter(name => !labelledMemoryIds.has(name))
    .sort((left, right) => left.localeCompare(right, 'en'))
    .slice(0, 5);
  const feedbackCounts = feedbackSummary.verdicts;
  const feedbackTopK = feedback.filter(event => event.payload.expected_in_top_k === true).length;
  const feedbackWithExpected = feedback.filter(event => event.payload.expected_in_top_k !== null).length;
  const feedbackProfile = streamProfile({
    sourceEvent: 'feedback.recorded', recordSchema: 'ownmem-recall-feedback/v3', from, to: now,
  });
  const outcomeProfile = streamProfile({
    sourceEvent: 'outcome.recorded', recordSchema: 'ownmem-outcome-receipt/v1', from, to: now,
  });
  const attributionProfile = streamProfile({
    sourceEvent: 'attribution.recorded', recordSchema: 'ownmem-attribution/v1', from, to: now,
  });
  // The one honest collection surface for actual application. Its denominator is the receipts, not
  // the deliveries: most deliveries are never confirmed either way, so dividing by deliveries would
  // report a near-zero application rate that measures how rarely anyone writes a receipt. Below the
  // shared minimum sample the status is insufficient_evidence and the value stays null -- a handful
  // of receipts cannot carry a percentage, and `recall.consumed` (a full text was opened) is not a
  // substitute for one at any sample size.
  const actualApplication = memoryEvaluationMetric({
    numerator: outcomeSummary.outcomes.applied,
    denominator: outcomeSummary.total,
    sample: outcomeSummary.total,
    profile: outcomeProfile,
  });

  let health = suppliedHealth;
  let healthError = null;
  if (health === undefined) {
    try {
      health = collectMemoryHealth({ root, memoryDir });
    } catch (error) {
      health = null;
      healthError = error.message;
    }
  }
  const gateHealth = staticGateHealth(root, memoryDir, health);
  const failedGates = gates.filter(event => event.payload.status === 'failed').length;
  const gateCounts = {};
  gates.forEach(event => {
    const current = gateCounts[event.payload.gate] || { passed: 0, failed: 0, errors: 0, warnings: 0 };
    current[event.payload.status] += 1;
    current.errors += event.payload.errors;
    current.warnings += event.payload.warnings;
    gateCounts[event.payload.gate] = current;
  });

  // Each gap carries a stable code alongside its English text. The text ships in the package; the
  // code lets a local surface (the session hook) show the same finding in its own language without
  // maintaining a second set of gap definitions, which is how the numbers would start to drift.
  const dataGaps = [];
  const gap = (code, text) => dataGaps.push({ code, text });
  if (recalls.length === 0) gap('no-recall-events', 'No recall.completed in this window, so recall performance and adoption cannot be assessed.');
  else if (recalls.length < SMALL_SAMPLE_THRESHOLD) gap('few-recall-samples', `Only ${recalls.length} recall sample(s); too few for a stable distribution.`);
  if (eligible.length > 0 && consumedTraces === 0) gap('no-consumed', 'No recall.consumed, so returned results must not be passed off as actual adoption.');
  if (eligible.length > observableEligible.length) {
    gap('legacy-unpairable', `${eligible.length - observableEligible.length} legacy recall(s) lack pairable producer evidence (surface + consumption_eligible) and are excluded from the consumption-coverage denominator.`);
  }
  if (unclassifiedAbstains.length > 0) {
    gap('legacy-abstain-no-reason', `${unclassifiedAbstains.length} legacy abstain(s) carry no reason and are excluded from the retrieval-abstain denominator.`);
  }
  if (currentRuntimeRecalls.length === 0) {
    gap('no-current-stack-samples', `No samples yet on recall stack ${MEMORY_RECALL_RUNTIME_VERSION}; historical performance does not represent the current version.`);
  }
  if (orphanDeliveries.length > 0) {
    gap('orphan-deliveries', `${orphanDeliveries.length} recall.delivered event(s) have no matching recall.completed and are excluded from the delivery funnel.`);
  }
  if (currentConsumedWithoutDelivery.length > 0) {
    gap('consumed-without-delivery', `${currentConsumedWithoutDelivery.length} current-version full-text open(s) have no recall.delivered and are excluded from the normal funnel.`);
  }
  // Deliberately not phrased as "so accuracy cannot be inferred": that implies feedback would yield
  // an accuracy, and it would not. `wrong` has no source regardless of how much feedback accrues.
  if (feedback.length === 0) gap('no-feedback', 'No explicit receipts in this window, so there is nothing to review for retrieval quality.');
  if (embeddingObservable.length > 0 && embeddingObservable.length < SMALL_SAMPLE_THRESHOLD) {
    gap('few-embedding-samples', `Only ${embeddingObservable.length} active embedding sample(s); too few for a stable conclusion about its effect.`);
  }
  if (['observe', 'weighted'].includes(embeddingCurrent.mode)
      && currentEmbeddingSummary.samples < SMALL_SAMPLE_THRESHOLD) {
    gap('few-embedding-state-samples', `The embedding ${embeddingCurrent.mode} state has only ${currentEmbeddingSummary.samples} sample(s) since ${embeddingStateFrom.toISOString()}; too few to conclude anything about this state.`);
  }
  // Legacy cache_hit=false values were placeholders before production observed cache results.
  // Preserve history but disclose the gap until those events age out of retention.
  if (legacyCachePlaceholders.length > 0) {
    gap('legacy-cache-placeholder', `${legacyCachePlaceholders.length} legacy recall(s) hardcoded cache_hit to false; treated as unobservable placeholders and excluded from the cache-hit denominator.`);
  }
  // Not a count on its own: a count reads the same at 20 dropped rows and at 6,638, and only one of
  // those means every number above it is computed over a fifth of the ledger. Say what share was
  // readable, and split the reason, because the two have different remedies -- an older schema is a
  // file to delete, while a current-schema row failing the payload contract is a producer that has
  // to be fixed before it writes any more of them.
  if (eventRead.errors.length > 0) {
    const outdated = eventRead.errors.filter(item => /does not read rows written by an older schema/u.test(item.error)).length;
    const total = eventRead.errors.length + eventRead.events.length;
    gap('invalid-events', `${eventRead.errors.length} of ${total} event line(s) could not be read`
      + ` (${Math.round((eventRead.events.length / Math.max(1, total)) * 100)}% of the ledger is readable):`
      + ` ${outdated} written under an older schema, ${eventRead.errors.length - outdated} failing the current payload contract.`
      + ' Every count in this report is over the readable rows only.');
  }
  if (healthError) gap('health-read-failed', `Static health read failed: ${healthError}`);

  const report = {
    schema: 'ownmem-report/v8',
    generated_at: now.toISOString(),
    environment: {
      installation_id: localInstallationId(root, directory),
      event_data_local_only: true,
    },
    window: {
      requested: requestedWindow,
      from: from.toISOString(),
      to: now.toISOString(),
      observed_from: observedTimes[0] || null,
      observed_to: observedTimes.at(-1) || null,
    },
    metric_roles: {
      north_star: 'recall.consumed confirmed_fulltext_open_rate',
      north_star_event: 'recall.consumed',
      offline_quality_role: 'process_gate',
      offline_quality_metrics: ['Recall@1', 'Recall@5', 'MRR'],
      accuracy_evidence: 'explicit_feedback_only',
      // Names the stream allowed to answer it, the way accuracy_evidence names its own. Whether it
      // currently has enough of a sample to state a rate is a different question, answered by
      // quality.outcome.actual_application.status, never by silence here.
      actual_application_evidence: 'outcome_receipt',
    },
    samples: { events: events.length, recalls: recalls.length, delivered: delivered.length, consumed: consumed.length, feedback: feedback.length, builds: builds.length, maintenance: maintenance.length, gates: gates.length, by_type: byType },
    delivery: {
      runtime_version: MEMORY_RECALL_RUNTIME_VERSION,
      produced_traces: currentRuntimeEligible.length,
      delivered_traces: currentDeliveredTraceIds.size,
      delivery_rate: ratio(currentDeliveredTraceIds.size, currentRuntimeEligible.length),
      fulltext_open_traces: currentFulltextOpenTraceIds.size,
      fulltext_open_rate: ratio(currentFulltextOpenTraceIds.size, currentDeliveredTraceIds.size),
      top1_open_share: ratio(currentTop1Open, currentFulltextOpenTraceIds.size),
      // Supplied by the outcome receipts, and null until they carry a printable sample. The audit
      // trail -- status, numerator, denominator, profile -- lives with the receipts themselves in
      // quality.outcome.actual_application; this is the scalar the funnel line reads.
      actual_application_rate: actualApplication.value,
      orphan_delivery_events: orphanDeliveries.length,
      fulltext_open_without_delivery_events: currentConsumedWithoutDelivery.length,
    },
    adoption: {
      eligible_recalls: eligible.length,
      observable_eligible_recalls: observableEligible.length,
      unobservable_eligible_recalls: eligible.length - observableEligible.length,
      coverage_source: consumptionSources,
      consumed_traces: consumedTraces,
      observable_consumed_traces: observableConsumedTraces,
      consumption_coverage_rate: ratio(observableConsumedTraces, observableEligible.length),
      adopted_recalls: adopted,
      adoption_rate: ratio(adopted, consumedTraces),
      top1_adoption_rate: ratio(top1, consumedTraces),
      topk_adoption_rate: ratio(topK, consumedTraces),
      authority_observed_traces: authorityObservedTraces,
      authority_follow_rate: ratio(authorityFollowed, authorityObservedTraces),
    },
    performance: {
      total_ms: distribution(recalls.map(event => event.payload.total_ms)),
      hot_ms: distribution(recalls.filter(event => event.payload.execution === 'hot').map(event => event.payload.total_ms)),
      cold_ms: distribution(recalls.filter(event => event.payload.execution === 'cold').map(event => event.payload.total_ms)),
      cold_rate: ratio(recalls.filter(event => event.payload.execution === 'cold').length, recalls.length),
      hot_rate: ratio(recalls.filter(event => event.payload.execution === 'hot').length, recalls.length),
      current_runtime: {
        version: MEMORY_RECALL_RUNTIME_VERSION,
        ...summarizeRecallPerformance(currentRuntimeRecalls),
        cohorts: summarizeRuntimeCohorts(currentRuntimeRecalls),
      },
      historical_runtime_samples: recalls.length - currentRuntimeRecalls.length,
    // Only boolean cache_hit values prove an observable cache surface; 0/0 remains null, not 0%.
      cache_hit_observed: cacheObservable.length,
      cache_hit_rate: ratio(cacheObservable.filter(event => event.payload.cache_hit).length, cacheObservable.length),
      snapshot_degradation: snapshotDegradation,
      embedding: {
        current: embeddingCurrent,
        current_state: {
          from: embeddingStateFrom.toISOString(),
          to: now.toISOString(),
          ...currentEmbeddingSummary,
        },
        observed: embeddingObservable.length,
        successful: embeddingObservable.length - embeddingDegraded.length,
        degraded: embeddingDegraded.length,
        degradation_rate: ratio(embeddingDegraded.length, embeddingObservable.length),
        latency_ms: distribution(embeddingObservable.map(event => event.payload.embedding.latency_ms)),
        reasons: embeddingReasons,
        by_mode: Object.fromEntries(Object.entries(embeddingModes).sort(([left], [right]) => left.localeCompare(right, 'en'))
          .map(([mode, state]) => [mode, {
            samples: state.samples,
            successful: state.successful,
            degraded: state.degraded,
            degradation_rate: ratio(state.degraded, state.samples),
            latency_ms: distribution(state.latency),
          }])),
      },
      query_classes: queryClasses,
      channels: Object.fromEntries([...new Set([...Object.keys(channelCandidates), ...Object.keys(channelQueries)])].sort()
        .map(channel => [channel, { candidates: channelCandidates[channel] || 0, queries_with_candidates: channelQueries[channel] || 0 }])),
      retrieval_attempts: retrievalAttempts.length,
      retrieval_abstained: retrievalAbstained.length,
      retrieval_abstain_rate: ratio(retrievalAbstained.length, retrievalAttempts.length),
      // The blended rate above hides the only split that matters. `cli` is an agent deliberately
      // asking a question; `claude-hook` fires on every Read/Edit/Write whether or not memory has
      // anything to say. Measured over three days on 2026-08-15: cli abstained 3/61 (4.9%),
      // claude-hook 669/708 (94.2%). Blended, that is 87.4% — which reads as a broken retriever,
      // when the deliberate path actually answers 95% of the time. Never report only the blend.
      retrieval_by_surface: summarizeRetrievalBySurface(retrievalAttempts),
      unclassified_abstains: unclassifiedAbstains.length,
      deduplicated: deduplicated.length,
      deduplication_rate: ratio(deduplicated.length, recalls.length),
      // Session deduplication is a benign abstention, unlike below-threshold or no-trusted-candidate.
      // Keep the reasons separate instead of misclassifying deduplication as retrieval failure.
      abstain_reasons: abstainReasons,
    },
    quality: {
      // Stream 1 of three: did recall return the right thing. Judged by a person or an agent that
      // deliberately sat down to record a verdict, which is why the denominator is the receipts and
      // not the recalls -- roughly two rows a month in this repository, against thousands of calls.
      feedback: {
        stream: 'retrieval_verdict',
        total: feedbackSummary.total,
        verdicts: feedbackCounts,
        wrong_result_shape: feedbackSummary.wrong_result_shape,
        denominator: feedback.length,
        denominator_definition: 'retrieval receipts recorded in this window; the recalls nobody judged are not in it, and they are not neutral either',
        sample: feedback.length,
        profile: feedbackProfile,
        wrong_miss_rate: ratio(feedbackCounts.wrong + feedbackCounts.retrieval_miss, feedback.length),
        expected_in_top_k_rate: ratio(feedbackTopK, feedbackWithExpected),
        // Accuracy = correct/(correct+wrong) is not reported, and no sample threshold will change
        // that. `wrong` has no source: a wrong recall produces no observable consequence — the agent
        // simply ignores the envelope and carries on, so nobody notices there was anything to report.
        // Two months of real use produced zero `wrong` (only one `retrieval_miss`, a different verdict).
        //
        // "Unavailable" would be the wrong word. It reads as "not collected yet", promising a number
        // that cannot arrive; this one is structural. Same distinction the codebase already draws for
        // cache_hit, and the same class of bug as rendering "snapshot not fetched yet" as
        // "model unsupported": one empty value carrying two meanings.
        accuracy_measurable: false,
        accuracy_unmeasurable_reason: 'a wrong recall leaves no behavioural trace, so `wrong` has no source and the denominator cannot form',
      },
      // Stream 2 of three: what happened after a memory was used. The only surface allowed to speak
      // about actual application, and deliberately expensive to write -- a user or the host has to
      // confirm it, so receipts do not accumulate on their own and their absence is not evidence
      // that memories go unused.
      outcome: {
        stream: 'outcome_receipt',
        total: outcomeSummary.total,
        outcomes: outcomeSummary.outcomes,
        confirmed_by: outcomeSummary.confirmed_by,
        denominator: outcomeSummary.total,
        denominator_definition: 'outcome receipts confirmed by a user or the host in this window; deliveries without a receipt are unconfirmed, so they must not enlarge this denominator',
        sample: outcomeSummary.total,
        profile: outcomeProfile,
        actual_application: actualApplication,
      },
      // Stream 3 of three: the agent's own weak, turn-scoped label. Counts only, forever. The
      // summarizer pins rate_measurable to false because the sample selects itself, and this block
      // reproduces its reason verbatim rather than paraphrasing or quietly computing a percentage
      // around it. `deliveries` is here so the counts can be read against something real, and it is
      // explicitly not the denominator: an unlabelled delivery is unknown, not neutral.
      attribution: {
        stream: 'self_attribution',
        total: attributionSummary.total,
        labels: attributionSummary.labels,
        basis: attributionSummary.basis,
        scope: attributionSummary.scope,
        deliveries: currentDeliveredTraceIds.size,
        labelled_deliveries: labelledDeliveries,
        unlabelled_deliveries: currentDeliveredTraceIds.size - labelledDeliveries,
        unlabelled_memories: unlabelledMemories,
        denominator: null,
        denominator_definition: 'none exists: labels are self-reported and self-selected, so the deliveries they correspond to are context, never a denominator',
        sample: attributionSummary.total,
        profile: attributionProfile,
        rate_measurable: attributionSummary.rate_measurable,
        rate_unmeasurable_reason: attributionSummary.rate_unmeasurable_reason,
      },
    },
    context: {
      samples: currentContextRecalls.length,
      legacy_samples: hitRecalls.length - currentContextRecalls.length,
      estimated_tokens: distribution(currentContextRecalls.map(event => event.payload.estimated_tokens)),
      truncated: currentContextRecalls.filter(event => event.payload.truncated).length,
      truncation_rate: ratio(currentContextRecalls.filter(event => event.payload.truncated).length, currentContextRecalls.length),
      // Excerpt shortening and whole-topic exclusion both set truncated, but only the latter loses a topic.
      dropped_topics_observed: droppedObservable.length,
      topic_dropping_envelopes: droppedTopicEnvelopes.length,
      dropped_topics: droppedTopicEnvelopes.reduce((sum, event) => sum + event.payload.dropped_topics, 0),
    },
    maintenance: {
      builds: builds.length,
      failed_builds: builds.filter(event => !event.payload.success).length,
      fallback_builds: builds.filter(event => event.payload.fallback).length,
      // Window totals above answer "what happened"; these answer "what is true now". A build that
      // failed and was then fixed used to keep the alert lit for the rest of the window, because the
      // recommendation read the accumulated counter -- it healed by expiring, not by being fixed.
      // The backlog fields below already used .at(-1) for exactly this reason; builds did not.
      latest_build_succeeded: builds.length === 0 ? null : builds.at(-1).payload.success === true,
      latest_build_used_fallback: builds.length === 0 ? null : builds.at(-1).payload.fallback === true,
      latest_snapshot_bytes: builds.at(-1)?.payload.snapshot_bytes ?? null,
      build_ms: distribution(builds.map(event => event.payload.duration_ms)),
      runs: maintenance.length,
      // Maintenance artifacts are rebuilt wholesale; backlog is current state, not an accumulated
      // counter -- hence `.at(-1)` rather than a sum.
      //
      // These are null, not 0, when no maintenance run exists in the window. `?? 0` used to render
      // "never measured" as "measured, and the backlog is empty", which is the exact failure this
      // codebase forbids: a clean-looking zero standing in for an absent measurement. A real run
      // reporting zero backlog still reports 0, and the two must stay distinguishable.
      proposals: maintenance.at(-1)?.payload.proposals ?? null,
      conflicts: maintenance.at(-1)?.payload.conflicts ?? null,
      orphans: maintenance.at(-1)?.payload.orphans ?? null,
      drift: maintenance.at(-1)?.payload.drift ?? null,
    },
    // Promotion governance. Every block states its own denominator, and two of them state instead
    // that they have no collector yet: an absent surface and an empty one are different facts, and
    // only one of them is measured.
    governance: collectMemoryGovernance({
      root,
      memoryDir,
      observation_window: observationWindow,
      quarantine,
      now,
    }),
    gates: { runs: gates.length, failed: failedGates, by_gate: gateCounts, current: gateHealth },
    data_quality: {
      files: eventRead.files.length,
      invalid_events: eventRead.errors.length,
      // The denominator of every count in this report, stated rather than left to be derived.
      readable_events: eventRead.events.length,
      readable_share: ratio(eventRead.events.length, eventRead.errors.length + eventRead.events.length),
      invalid_outdated_schema: eventRead.errors.filter(item => /does not read rows written by an older schema/u.test(item.error)).length,
      event_errors: eventRead.errors.slice(0, 10),
      gaps: dataGaps.map(item => item.text),
      gap_codes: dataGaps.map(item => item.code),
    },
    recommendations: [],
  };
  report.recommendations = recommendations(report);
  return validateMemoryReport(report);
}

function percentage(value) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function formatAbstainReasons(reasons) {
  const entries = Object.entries(reasons || {}).sort((left, right) => right[1] - left[1]);
  return entries.length === 0 ? '' : ` (${entries.map(([reason, count]) => `${reason} ${count}`).join(', ')})`;
}

function formatEmbeddingPerformance(embedding) {
  const current = embedding?.current;
  const state = current
    ? `current ${current.mode}${current.since ? ` (configured since ${current.since}, stack ${MEMORY_RECALL_RUNTIME_VERSION})` : ` (stack ${MEMORY_RECALL_RUNTIME_VERSION})`}${current.timeout_ms ? `, timeout ${current.timeout_ms}ms` : ''}`
    : 'current state unknown';
  if (!embedding || embedding.observed === 0) return `embedding ${state}; no active samples in the current state`;
  const reasons = Object.entries(embedding.reasons || {}).sort((left, right) => right[1] - left[1]);
  const currentState = embedding.current_state;
  const currentReasons = Object.entries(currentState.reasons || {}).sort((left, right) => right[1] - left[1]);
  return `embedding ${state}; current state ${currentState.samples} call(s) (ok ${currentState.successful} / degraded ${currentState.degraded}, P95 ${currentState.latency_ms.p95 ?? 'n/a'}ms`
    + `${currentReasons.length > 0 ? `, ${currentReasons.map(([reason, count]) => `${reason} ${count}`).join(', ')}` : ''})`
    + `; window history ${embedding.observed} call(s) (ok ${embedding.successful} / degraded ${embedding.degraded}${reasons.length > 0 ? `, ${reasons.map(([reason, count]) => `${reason} ${count}`).join(', ')}` : ''})`;
}

    // Degradation rates include only recalls whose source component can be distinguished.
function formatSnapshotDegradation(degradation) {
  if (!degradation || degradation.observed === 0) return ', snapshot degradation unavailable (no recall in this window could be attributed to a source)';
  return `, snapshot degradation ${percentage(degradation.rate)}`
    + ` (${degradation.snapshot} snapshot / ${degradation.previous} previous / ${degradation.fallback} lexical fallback, attributable ${degradation.observed})`;
}

function formatRuntimeCohorts(cohorts) {
  if (!cohorts || cohorts.length === 0) return 'no cohort samples';
  return cohorts.map(cohort => (
    `${cohort.surface}/${cohort.execution}/${cohort.query_shape} n=${cohort.samples} P95=${cohort.total_ms.p95 ?? 'n/a'}ms`
  )).join('; ');
}

// Backlog counts come from the most recent maintenance run. With no run in the window there is no
// backlog to report -- printing zeros there would claim a clean queue nobody ever looked at.
function formatMaintenanceBacklog(maintenance) {
  if (maintenance.runs === 0) {
    return `backlog unavailable (no maintenance run in this window)`;
  }
  return `proposal=${maintenance.proposals}, orphan=${maintenance.orphans}, drift=${maintenance.drift}`;
}

// Actual application has one collection surface -- the outcome receipt -- and three honest states.
// None of them is a percentage over deliveries, and none of them is `recall.consumed`: a confirmed
// full-text open proves a body was read, never that the answer used it.
function formatActualApplication(outcome) {
  const metric = outcome.actual_application;
  if (metric.status === MEMORY_EVALUATION_MEASURED) {
    return `actual application ${percentage(metric.value)} (${metric.numerator}/${metric.denominator} outcome receipt(s))`;
  }
  if (outcome.total === 0) {
    return 'actual application has no sample yet (0 outcome receipt(s); only a user or the host can confirm one, so receipts do not accumulate on their own)';
  }
  return `actual application ${MEMORY_EVALUATION_INSUFFICIENT_EVIDENCE}`
    + ` (${outcome.outcomes.applied}/${outcome.total} outcome receipt(s), below the ${metric.minimum_sample} a rate may be printed over)`;
}

// One line per stream, each carrying its own denominator. Printing them as a single blended tally
// is the failure the three-way split exists to prevent.
function formatQualityStreams(quality) {
  const verdicts = Object.entries(quality.feedback.verdicts)
    .filter(([, count]) => count > 0)
    .map(([verdict, count]) => `${verdict} ${count}`)
    .join(', ') || 'none';
  const outcomes = Object.entries(quality.outcome.outcomes)
    .filter(([, count]) => count > 0)
    .map(([outcome, count]) => `${outcome} ${count}`)
    .join(', ') || 'none';
  const labels = Object.entries(quality.attribution.labels)
    .map(([label, count]) => `${label} ${count}`)
    .join(', ');
  const attribution = quality.attribution;
  const wrongShape = quality.feedback.wrong_result_shape;
  return [
    `Quality / retrieval verdicts (n=${quality.feedback.total} recorded receipts): ${verdicts}; wrong direction: delivered ${wrongShape.returned}, abstained ${wrongShape.abstained}, legacy-unknown ${wrongShape.unknown}; offline Recall@1/Recall@5/MRR are process gates only; accuracy is not reported — ${quality.feedback.accuracy_unmeasurable_reason}`,
    `Quality / outcome receipts (n=${quality.outcome.total} confirmed by ${quality.outcome.confirmed_by.user} user / ${quality.outcome.confirmed_by.host} host): ${outcomes}; ${formatActualApplication(quality.outcome)}`,
    `Quality / weak self-attribution (n=${attribution.total} labels): ${labels}; ${attribution.labelled_deliveries}/${attribution.deliveries} delivery(ies) labelled, ${attribution.unlabelled_deliveries} unlabelled; no rate is computed — ${attribution.rate_unmeasurable_reason}`,
  ];
}

// Printed right after the blended abstain rate so the blend is never read on its own.
function formatRetrievalBySurface(bySurface) {
  const entries = Object.entries(bySurface || {});
  if (entries.length < 2) return '';
  const detail = entries
    .map(([surface, entry]) => `${surface} ${percentage(entry.abstain_rate)} (${entry.abstained}/${entry.attempts})`)
    .join(', ');
  return ` [by surface: ${detail}]`;
}

// One line per governance surface, and no rate on any of them. Three of the four are empty today,
// and the difference between the two ways of being empty is the whole content of these lines: a
// surface with a collector reports a sample of zero and why it does not fill on its own, while a
// surface without one reports that nothing has been looked at. Printing either as a percentage
// would turn an absence into a measurement.
function formatGovernanceBlocks(governance) {
  // Three ways to have no numbers, printed as three different sentences: nothing has been looked
  // at, the file behind a collector is broken, or a collector handed back a shape this report will
  // not render. They have three different fixes, and one shared phrase would send the reader to the
  // wrong one.
  const absence = {
    'collector-not-wired': 'surface not wired',
    'source-unreadable': 'source unreadable',
    'collector-malformed': 'collector output refused',
  };
  const describe = (label, block, detail) => {
    if (!block.connected) return `Governance / ${label}: ${absence[block.reason_code]} — ${block.reason}`;
    const head = `Governance / ${label} (n=${block.sample}, denominator ${block.denominator})`;
    const body = block.sample === 0 ? `none yet — ${block.empty_reason}` : detail(block);
    return `${head}: ${body}. Denominator: ${block.denominator_definition}`;
  };
  const byAutomation = block => Object.entries(block.by_automation)
    .filter(([, count]) => count > 0)
    .map(([automation, count]) => `${automation} ${count}`)
    .join(', ');
  const byVerdict = block => Object.entries(block.verdicts)
    .filter(([, count]) => count > 0)
    .map(([verdict, count]) => `${verdict} ${count}`)
    .join(', ');
  return [
    describe('review material awaiting a person', governance.review_material, block => `${byAutomation(block)}; every one of them needs a person and none may be applied from here`),
    describe('promotion observation window', governance.observation_window, block => `${block.entries} entry(ies) being watched`),
    describe('runtime quarantine', governance.quarantine, block => `${block.entries} entry(ies) quarantined`),
    describe('promotion quota settlement', governance.quota_settlement, block => `${block.entries} promotion(s), ${byVerdict(block)}`),
  ];
}

export function formatMemoryReport(report) {
  const observedWindow = report.window.observed_from
    ? `${report.window.observed_from} → ${report.window.observed_to}`
    : 'no local events';
  const lines = [
    `Memory report (${report.window.requested}; install ${report.environment.installation_id || 'uninitialised'}; observed ${observedWindow})`,
    `North star (recall.consumed, stack ${report.delivery.runtime_version}): produced ${report.delivery.produced_traces} -> delivered ${report.delivery.delivered_traces} (${percentage(report.delivery.delivery_rate)}) -> confirmed full-text opens ${report.delivery.fulltext_open_traces} (${percentage(report.delivery.fulltext_open_rate)}); ${formatActualApplication(report.quality.outcome)}. A low open rate is expected: the 400-token envelope is built so the caller rarely needs the source, so this is a coverage floor, not an adoption rate`,
    `Performance (current stack): ${report.performance.current_runtime.samples} call(s), P50/P95/P99=${report.performance.current_runtime.total_ms.p50 ?? 'n/a'}/${report.performance.current_runtime.total_ms.p95 ?? 'n/a'}/${report.performance.current_runtime.total_ms.p99 ?? 'n/a'}ms, hot P95=${report.performance.current_runtime.hot_ms.p95 ?? 'n/a'}ms, cold P95=${report.performance.current_runtime.cold_ms.p95 ?? 'n/a'}ms; ${report.performance.historical_runtime_samples} sample(s) from older versions are background only. Cohorts: ${formatRuntimeCohorts(report.performance.current_runtime.cohorts)}`,
    `Whole window: ${report.samples.recalls} recall(s), overall P95=${report.performance.total_ms.p95 ?? 'n/a'}ms; ${formatEmbeddingPerformance(report.performance.embedding)}, cache hit ${report.performance.cache_hit_observed === 0 ? 'unavailable (production recall has no result cache, so it cannot be measured)' : `${percentage(report.performance.cache_hit_rate)} (observable ${report.performance.cache_hit_observed}/${report.samples.recalls})`}, retrieval abstain ${percentage(report.performance.retrieval_abstain_rate)} (${report.performance.retrieval_abstained}/${report.performance.retrieval_attempts})${formatRetrievalBySurface(report.performance.retrieval_by_surface)}, session dedup ${report.performance.deduplicated} (${percentage(report.performance.deduplication_rate)})${formatAbstainReasons(report.performance.abstain_reasons)}${formatSnapshotDegradation(report.performance.snapshot_degradation)}`,
    ...formatQualityStreams(report.quality),
    `Cost: token P50/P95/P99=${report.context.estimated_tokens.p50 ?? 'n/a'}/${report.context.estimated_tokens.p95 ?? 'n/a'}/${report.context.estimated_tokens.p99 ?? 'n/a'}, truncation ${percentage(report.context.truncation_rate)}; whole topics were actually dropped in ${report.context.topic_dropping_envelopes} envelope(s), ${report.context.dropped_topics} topic(s) short (observable ${report.context.dropped_topics_observed}/${report.context.samples}; ${report.context.legacy_samples} legacy event(s) excluded from the current-policy denominator)`,
    ...formatGovernanceBlocks(report.governance),
    `Maintenance: build=${report.maintenance.builds} (failed ${report.maintenance.failed_builds} / fallback ${report.maintenance.fallback_builds}), ${formatMaintenanceBacklog(report.maintenance)}; invalid events=${report.data_quality.invalid_events}`,
  ];
  if (report.data_quality.gaps.length > 0) lines.push(`Data gaps: ${report.data_quality.gaps.join('; ')}`);
  if (report.recommendations.length > 0) {
    lines.push('Recommended actions:');
    report.recommendations.forEach((item, index) => lines.push(`${index + 1}. ${item.action} (evidence: ${item.evidence}; impact ${item.impact} / cost ${item.cost})`));
  }
  return `${lines.join('\n')}\n`;
}

export function runCli(rawArgs = process.argv.slice(2)) {
  const options = parseArgs(rawArgs);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (options.governance) {
    // The summary above says how many are waiting; this prints the thing itself, because a count of
    // pending review material is not something anybody can review.
    const collected = collectCorrectionReviewMaterials({ root: options.root, memoryDir: options.memoryDir });
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ schema: 'ownmem-review-material-list/v1', ...collected }, null, 2)}\n`);
      return 0;
    }
    if (!collected.available) {
      process.stdout.write(`Review material is unavailable: ${collected.reason}\n`);
      return 0;
    }
    if (collected.materials.length === 0) {
      process.stdout.write(`No review material. ${collected.corrections.length} correction lead(s) in a queue of ${collected.candidates.length};`
        + ' a correction is recorded only when the user pushes back in a turn that delivered a memory, so this does not accumulate on its own.\n');
      return 0;
    }
    for (const material of collected.materials) process.stdout.write(formatPromotionReviewMaterial(material));
    for (const skipped of collected.skipped) {
      process.stdout.write(`Skipped ${skipped.memory_id}: ${skipped.reason}\n`);
    }
    process.stdout.write(`${collected.materials.length} item(s), every one of them waiting on a person.\n`);
    return 0;
  }
  const report = collectMemoryReport(options);
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatMemoryReport(report));
  return 0;
}

if (isMemoryCliEntry(import.meta.url)) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(`memory-report: ${error.message}\n`);
    process.exitCode = 1;
  }
}
