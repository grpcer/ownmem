import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import {
  DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  memoryInstallationId,
  readMemoryObservabilityEvents,
} from './memory-observability.mjs';
import { readFeedbackInbox, summarizeFeedback } from './memory-feedback.mjs';
import { DEFAULT_ATTRIBUTION_FILE, summarizeAttributionLabels } from './features/attribution.mjs';
import { DEFAULT_OUTCOME_FILE, summarizeOutcomeReceipts } from './features/outcome.mjs';
import { distribution, summarizeRetrievalBySurfaceAgent } from './memory-metrics.mjs';
import { schemaPath } from './schema-paths.mjs';

/**
 * The daily archive turns one day of local, expiring telemetry into a small counted package that is
 * committed alongside the memory it describes.
 *
 * Two facts force this to exist. Events are deleted after thirty days, so a longitudinal record of
 * how this memory system actually behaved cannot be kept in the event files themselves. And each
 * machine writes its own event files under `.local-test/`, which never leaves that machine, so a
 * report run anywhere answers only for the machine it ran on and says nothing about the days it
 * cannot see.
 *
 * The package therefore carries counts and never rows. What goes in is stated positively in the
 * schema and enforced negatively by `assertDailyArchiveRedacted`: no query text, no digest of a
 * query, no trace id, no file path, no machine or account name, and no timestamp finer than the day
 * the package is named after. Topic names are the one identifier that does go in, because they are
 * already public in the memory index this package sits next to.
 */
export const MEMORY_TELEMETRY_DAY_SCHEMA = 'ownmem-telemetry-day/v1';
export const MEMORY_TELEMETRY_INSTALLATIONS_SCHEMA = 'ownmem-telemetry-installations/v1';
export const MEMORY_TELEMETRY_DIRECTORY = 'telemetry';
export const MEMORY_TELEMETRY_INSTALLATIONS_FILE = 'installations.json';
/** How many `returned_topics` names a package keeps. Enough to see what a day was about. */
export const MEMORY_TELEMETRY_TOP_TOPICS = 20;
/** The first day this program collects. Nothing before it is archived, because nothing before it survived. */
export const MEMORY_TELEMETRY_FIRST_DAY = '2026-09-03';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.json$/;
const DAY_MS = 86_400_000;
const PUBLIC_MANIFEST = 'scripts/memory-public-assets/package.json';

const DAY_SCHEMA = JSON.parse(readFileSync(schemaPath('archive', 'daily.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
const validateDaySchema = ajv.compile(DAY_SCHEMA);

export function validateDailyArchive(archive) {
  if (!validateDaySchema(archive)) {
    const details = (validateDaySchema.errors || [])
      .map(error => `${error.instancePath || '/'} ${error.message}`)
      .join('; ');
    throw new Error(`daily telemetry archive is invalid: ${details}`);
  }
  return archive;
}

export function utcDay(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function dayStartMs(day) {
  return Date.parse(`${day}T00:00:00.000Z`);
}

export function shiftDay(day, offset) {
  return utcDay(new Date(dayStartMs(day) + offset * DAY_MS));
}

export function daysBetween(fromDay, toDay) {
  const days = [];
  for (let day = fromDay; day <= toDay; day = shiftDay(day, 1)) days.push(day);
  return days;
}

export function memoryTelemetryDir(memoryDir) {
  return path.posix.join(String(memoryDir).split(path.sep).join('/'), MEMORY_TELEMETRY_DIRECTORY);
}

/**
 * Object keys in a stable order and no floating point anywhere a count belongs.
 *
 * Byte-for-byte reproducibility is the property that lets the writer decide "nothing new happened"
 * by comparing the rendered file to the one on disk. Any field that changes on its own -- a
 * generation timestamp is the classic one -- turns every run into a write, and a package that
 * rewrites itself on every session is a package nobody can tell has changed.
 */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort((left, right) => left.localeCompare(right, 'en'));
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

export function renderDailyArchive(archive) {
  return `${JSON.stringify(JSON.parse(stableStringify(archive)), null, 2)}\n`;
}

function sha256File(file) {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * Which build was running on the day being archived, and whether that build was ever published.
 *
 * The hooks in this repository run `scripts/` straight from the working tree, so the code that
 * collected a day is a commit, not the released package. A paper that reports numbers per version
 * has to be able to separate the two, and after the fact the only place that survives is the
 * package itself.
 *
 * The anchor is the day, never HEAD. A finished day's package has to be a pure function of (that
 * day's events, the history up to the end of that day) or it is not idempotent: anchored to HEAD,
 * every commit that touches `scripts/` silently rewrites every historical package, and once the
 * session hooks call this that becomes an automatic commit of files nobody changed. Measured when
 * it happened: four packages rewritten by one unrelated commit, the whole diff being one line of
 * `scripts_tree_hash`.
 *
 * So the anchor commit is the last commit dated at or before the end of the UTC day. For a day
 * still in progress that is whatever HEAD is right now and will move, which is a different kind of
 * answer -- `tree_hash_basis` says which of the two the reader is holding.
 *
 * `released_version` is read at that commit too, not from the working tree. A package for a day
 * when 0.5.4 was current must not claim 0.5.5 because a later session bumped it.
 *
 * `unreleased_delta` compares the anchor's `scripts` tree with the tree at the commit that first
 * declared that version, which is the last point at which this tree and the published package were
 * the same thing. When any link cannot be resolved -- a shallow clone, no git, an untracked
 * manifest, a day older than the repository -- the answer is null with a reason. It is never
 * inferred from the version string: "the version did not change" is not evidence that the code
 * did not.
 */
export function dayBuildIdentity(root, { day, partialDay = false } = {}) {
  const identity = {
    day_head_commit: null,
    tree_hash_basis: partialDay ? 'head-at-archive' : 'last-commit-of-day',
    scripts_tree_hash: null,
    released_version: null,
    release_marker_commit: null,
    unreleased_delta: null,
    unreleased_delta_reason: null,
  };
  const anchor = git(root, ['rev-list', '-1', `--until=${shiftDay(day, 1)}T00:00:00Z`, 'HEAD']);
  if (!anchor) {
    identity.unreleased_delta_reason = `no commit in this history is dated on or before the end of ${day}, so the build that collected it cannot be named`;
    return identity;
  }
  identity.day_head_commit = anchor;
  const scriptsTreeHash = git(root, ['rev-parse', `${anchor}:scripts`]);
  if (!scriptsTreeHash) {
    identity.unreleased_delta_reason = `commit ${anchor} has no scripts tree, so the build that collected ${day} cannot be compared with any release`;
    return identity;
  }
  identity.scripts_tree_hash = scriptsTreeHash;
  const manifest = git(root, ['show', `${anchor}:${PUBLIC_MANIFEST}`]);
  let releasedVersion = null;
  if (manifest) {
    try {
      releasedVersion = JSON.parse(manifest).version ?? null;
    } catch {
      releasedVersion = null;
    }
  }
  identity.released_version = releasedVersion;
  if (!releasedVersion) {
    identity.unreleased_delta_reason = `${PUBLIC_MANIFEST} declared no version at ${anchor}, so there is no release to compare against`;
    return identity;
  }
  const marker = releaseMarkerCommit(root, anchor, releasedVersion);
  if (!marker) {
    identity.unreleased_delta_reason = `no commit up to ${anchor} sets the public package version to ${releasedVersion}, so the released tree is unknown here`;
    return identity;
  }
  identity.release_marker_commit = marker;
  const markerTree = git(root, ['rev-parse', `${marker}:scripts`]);
  if (!markerTree) {
    identity.unreleased_delta_reason = `commit ${marker} has no scripts tree, so the released tree cannot be read`;
    return identity;
  }
  identity.unreleased_delta = markerTree !== scriptsTreeHash;
  return identity;
}

/**
 * The commit that first declared `version`, seen from `anchor` rather than from HEAD.
 *
 * Walks the manifest's own history newest to oldest and returns the oldest consecutive commit whose
 * manifest already carried this version, which is the bump itself rather than a later edit to some
 * other field of the same file. Looking from the anchor keeps the answer stable: a release that
 * happened after the day being archived did not exist on that day and must not appear in it.
 */
function releaseMarkerCommit(root, anchor, version) {
  const log = git(root, ['log', '--format=%H', anchor, '--', PUBLIC_MANIFEST]);
  if (!log) return null;
  let marker = null;
  for (const commit of log.split('\n').filter(Boolean)) {
    const manifest = git(root, ['show', `${commit}:${PUBLIC_MANIFEST}`]);
    if (!manifest) break;
    let declared = null;
    try {
      declared = JSON.parse(manifest).version ?? null;
    } catch {
      break;
    }
    if (declared !== version) break;
    marker = commit;
  }
  return marker;
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function countsToSortedList(counts, nameKey) {
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([name, count]) => ({ [nameKey]: name, count }));
}

/**
 * Events counted along all four dimensions at once, because collapsing any of them loses a question
 * somebody will ask later: which host produced the traffic, through which entry point, and whether
 * the row is attributable at all.
 */
function summarizeEventBuckets(events) {
  const buckets = new Map();
  for (const event of events) {
    const surface = typeof event.payload?.surface === 'string' ? event.payload.surface : null;
    const agent = typeof event.agent === 'string' ? event.agent : null;
    const nested = event.nested === true;
    const key = `${event.event}\0${surface ?? ''}\0${agent ?? ''}\0${nested}`;
    const entry = buckets.get(key) || { event: event.event, surface, agent, nested, count: 0 };
    entry.count += 1;
    buckets.set(key, entry);
  }
  return [...buckets.values()].sort((left, right) => left.event.localeCompare(right.event, 'en')
    || String(left.surface).localeCompare(String(right.surface), 'en')
    || String(left.agent).localeCompare(String(right.agent), 'en')
    || Number(left.nested) - Number(right.nested));
}

/**
 * The same retrieval attempts the report counts, filtered the same way.
 *
 * Session deduplication is a benign abstention and legacy rows that abstained without recording a
 * reason cannot be graded, so both leave the denominator here exactly as they do there. Two
 * definitions of "attempt" between the daily package and the live report would be two different
 * abstain rates with one name.
 */
export function retrievalAttemptEvents(recalls) {
  return recalls.filter(event => event.payload.abstain_reason !== 'all-candidates-excluded'
    && (!event.payload.abstained || Object.hasOwn(event.payload, 'abstain_reason')));
}

function summarizeAbstainReasons(attempts) {
  const rows = new Map();
  for (const event of attempts) {
    if (!event.payload.abstained) continue;
    const surface = typeof event.payload.surface === 'string' ? event.payload.surface : null;
    const agent = typeof event.agent === 'string' ? event.agent : null;
    const reason = event.payload.abstain_reason || 'unrecorded';
    const key = `${surface ?? ''}\0${agent ?? ''}\0${reason}`;
    const entry = rows.get(key) || { surface, agent, reason, count: 0 };
    entry.count += 1;
    rows.set(key, entry);
  }
  return [...rows.values()].sort((left, right) => String(left.surface).localeCompare(String(right.surface), 'en')
    || String(left.agent).localeCompare(String(right.agent), 'en')
    || left.reason.localeCompare(right.reason, 'en'));
}

function ledgerRows(file, day) {
  if (!existsSync(file)) return [];
  const rows = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const recordedAt = parsed.recorded_at || parsed.recordedAt;
    if (typeof recordedAt === 'string' && recordedAt.slice(0, 10) === day) rows.push(parsed);
  }
  return rows;
}

/**
 * The three ledgers, counted for this day only and each by the module that owns its vocabulary.
 *
 * They are permanent files rather than expiring events, so a backfilled day reads them at full
 * fidelity. Rebuilding the buckets here instead of asking the summarizers is how a renamed verdict
 * silently drops out of a package that still validates.
 */
function summarizeLedgers({ root, day }) {
  const feedbackFile = path.join(root, '.local-test/memory-recall-feedback.jsonl');
  const dayEntries = ledgerRows(feedbackFile, day);
  const feedbackInbox = readFeedbackInbox(feedbackFile);
  const feedbackOfDay = {
    file: feedbackFile,
    entries: feedbackInbox.entries.filter(entry => String(entry.recordedAt || '').slice(0, 10) === day),
    errors: [],
    duplicates: 0,
  };
  const feedback = summarizeFeedback(feedbackOfDay);
  const attribution = summarizeAttributionLabels({
    entries: ledgerRows(path.join(root, DEFAULT_ATTRIBUTION_FILE), day),
    errors: [],
    duplicates: 0,
  });
  const outcome = summarizeOutcomeReceipts({
    entries: ledgerRows(path.join(root, DEFAULT_OUTCOME_FILE), day),
    errors: [],
    duplicates: 0,
  });
  return {
    feedback: {
      rows: feedback.total,
      // Rows this day's ledger holds that the reader refused. Counted so a package cannot report a
      // quiet day when the truth is an unreadable one.
      unreadable_rows: dayEntries.length - feedback.total,
      by_verdict: countsToSortedList(feedback.verdicts, 'verdict'),
    },
    attribution: {
      rows: attribution.total,
      by_label: countsToSortedList(attribution.labels, 'label'),
    },
    outcome: {
      rows: outcome.total,
      by_outcome: countsToSortedList(outcome.outcomes, 'outcome'),
      by_confirmed_by: countsToSortedList(outcome.confirmed_by, 'confirmed_by'),
    },
  };
}

function modeOf(counts) {
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return entries.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'en'))[0][0];
}

/**
 * Build the package for one UTC day. Pure with respect to the filesystem it reads: given the same
 * event files, ledgers, locks and git history it returns the same object every time.
 */
export function collectDailyArchive({
  root,
  memoryDir = '.claude/memory',
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  day,
  now = new Date(),
} = {}) {
  if (!DAY_PATTERN.test(String(day))) throw new Error(`--day must be a UTC date such as 2026-09-08, got ${day}`);
  const installationId = memoryInstallationId({ root, directory });
  if (!installationId) throw new Error('this repository has no observability key yet, so there is no installation to archive');
  const from = new Date(dayStartMs(day));
  const until = new Date(dayStartMs(day) + DAY_MS - 1);
  const read = readMemoryObservabilityEvents({ root, directory, since: from, until });
  const events = read.events;
  const recalls = events.filter(event => event.event === 'recall.completed');
  const attempts = retrievalAttemptEvents(recalls);
  const retrieval = summarizeRetrievalBySurfaceAgent(attempts);

  // The funnel is paired inside the day, which is the only pairing a per-day package can make: a
  // recall a minute before midnight and its delivery a minute after belong to two files. Stated in
  // the package rather than left for the reader to discover from a rate that looks slightly low.
  const eligible = recalls.filter(event => !event.payload.abstained && event.payload.returned_topics.length > 0);
  const eligibleTraces = new Set(eligible.map(event => event.trace_id));
  const deliveredTraces = new Set(events
    .filter(event => event.event === 'recall.delivered' && eligibleTraces.has(event.trace_id))
    .map(event => event.trace_id));
  const consumedTraces = new Set(events
    .filter(event => event.event === 'recall.consumed' && deliveredTraces.has(event.trace_id))
    .map(event => event.trace_id));

  const topicCounts = {};
  recalls.forEach(event => (event.payload.returned_topics || []).forEach(topic => increment(topicCounts, topic)));
  const recallVersions = {};
  recalls.forEach(event => increment(recallVersions, event.process.component_version));
  const allVersions = {};
  events.forEach(event => increment(allVersions, event.process.component_version));
  const partialDay = day === utcDay(now);

  const archive = {
    schema: MEMORY_TELEMETRY_DAY_SCHEMA,
    installation_id: installationId,
    day,
    // A day being archived before it is over is a real package with a real limitation, and the only
    // wrong answer is to let it look complete. Every consumer keys off this flag rather than
    // comparing the day against its own clock, which would give a different answer per machine.
    partial_day: partialDay,
    // Reserved for the frozen protocol windows of the next stage. Present from v1 so that adding a
    // window later does not change the shape of every package written before it.
    window_id: null,
    stack_version: modeOf(recallVersions) || modeOf(allVersions),
    stack_version_counts: countsToSortedList(recallVersions, 'version'),
    ...dayBuildIdentity(root, { day, partialDay }),
    quota_lock_sha256: sha256File(path.join(root, memoryDir, 'quota.lock.json')),
    quality_lock_sha256: sha256File(path.join(root, memoryDir, 'quality.lock.json')),
    events: {
      total: events.length,
      unreadable: read.errors.length,
      // Rows written before agent attribution existed. Those days were genuinely mixed, so they are
      // reported apart and enter no agent's numerator or denominator anywhere downstream.
      legacy: events.filter(event => typeof event.agent !== 'string').length,
      nested: events.filter(event => event.nested === true).length,
      buckets: summarizeEventBuckets(events),
    },
    retrieval: {
      attempts: attempts.length,
      abstained: attempts.filter(event => event.payload.abstained).length,
      buckets: Object.entries(retrieval.buckets)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, entry]) => {
          // The shared summarizer keys on `<surface>/<agent>`. Split at the last separator: an
          // agent name never contains one, while a surface name is not guaranteed not to.
          const cut = key.lastIndexOf('/');
          return {
            surface: key.slice(0, cut),
            agent: key.slice(cut + 1),
            attempts: entry.attempts,
            abstained: entry.abstained,
          };
        }),
      legacy_attempts: retrieval.legacy_attempts,
      legacy_abstained: retrieval.legacy_abstained,
      nested_attempts: retrieval.nested_attempts,
      nested_abstained: retrieval.nested_abstained,
      abstain_reasons: summarizeAbstainReasons(attempts),
    },
    latency: {
      // Percentiles, not the samples they came from: the samples are what a machine identifier
      // could be reconstructed from, and the distribution is what the question needs.
      samples: recalls.length,
      total_ms: distribution(recalls.map(event => event.payload.total_ms)),
    },
    funnel: {
      pairing_scope: 'same_utc_day',
      produced_traces: eligibleTraces.size,
      delivered_traces: deliveredTraces.size,
      consumed_traces: consumedTraces.size,
    },
    ledgers: summarizeLedgers({ root, day }),
    returned_topics: Object.entries(topicCounts)
      .sort(([leftName, leftCount], [rightName, rightCount]) => rightCount - leftCount
        || leftName.localeCompare(rightName, 'en'))
      .slice(0, MEMORY_TELEMETRY_TOP_TOPICS)
      .map(([topic, count]) => ({ topic, count })),
  };
  return validateDailyArchive(archive);
}

/**
 * The redaction boundary, enforced on the rendered bytes rather than on the object.
 *
 * A field-by-field review is only as good as the last person who added a field; this reads what is
 * actually about to be committed. It fails closed: a package that trips it is not written at all,
 * because the alternative is a commit that cannot be taken back out of a shared history.
 */
export function assertDailyArchiveRedacted(text, {
  hostname = os.hostname(),
  username = safeUsername(),
  homedir = os.homedir(),
  day = null,
} = {}) {
  const violations = [];
  const forbid = (label, pattern) => {
    if (pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern)) violations.push(label);
  };
  forbid('a POSIX home directory path', '/Users/');
  forbid('a POSIX home directory path', '/home/');
  forbid('a Windows profile path', '\\Users\\');
  forbid('the local telemetry directory', '.local-test');
  forbid('a memory directory path', '.claude/memory');
  forbid('a memory directory path', '.ownmem/');
  forbid('a query identifier field', /"quer(y|ies)(_id|_sha256|_hash)?"\s*:/u);
  forbid('a trace identifier field', /"(trace_id|snapshot_id|episode_id|session_id)"\s*:/u);
  forbid('a clock time', /T\d{2}:\d{2}/u);
  if (hostname) forbid('the machine name', hostname);
  if (username) forbid('the account name', username);
  if (homedir) forbid('the home directory', homedir);
  // A day the package is not named after would mean rows from another day leaked into it.
  if (day) {
    for (const match of text.matchAll(/\d{4}-\d{2}-\d{2}/gu)) {
      if (match[0] !== day) violations.push(`a date other than ${day} (${match[0]})`);
    }
  }
  if (violations.length > 0) {
    throw new Error(`daily telemetry archive would publish ${[...new Set(violations)].join(', ')}; refusing to write it`);
  }
  return text;
}

function safeUsername() {
  try {
    return os.userInfo().username || null;
  } catch {
    return null;
  }
}

export function dailyArchiveFile({ root, memoryDir, installationId, day }) {
  return path.join(root, memoryTelemetryDir(memoryDir), installationId, `${day}.json`);
}

/**
 * Write the package only when it differs from the one already on disk.
 *
 * Every session hook in this repository can call this, so "write unconditionally" means a tracked
 * file whose mtime and content churn on every turn. The comparison is on rendered bytes, which is
 * why the renderer has to be deterministic: the same day archived twice has to produce the same
 * file, or "nothing changed" can never be observed.
 */
export function writeDailyArchive({ root, memoryDir = '.claude/memory', archive }) {
  const file = dailyArchiveFile({
    root, memoryDir, installationId: archive.installation_id, day: archive.day,
  });
  // Serialise once. `changed` is decided by comparing exactly these bytes with exactly what is on
  // disk, and exactly these bytes are what gets written -- comparing one rendering and writing
  // another is how a run reports "unchanged" over a file it just rewrote.
  const text = assertDailyArchiveRedacted(renderDailyArchive(archive), { day: archive.day });
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (existing === text) return { file, changed: false, bytes: Buffer.byteLength(text), sha256 };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
  return { file, changed: true, bytes: Buffer.byteLength(text), sha256 };
}

export function installationsFile({ root, memoryDir }) {
  return path.join(root, memoryTelemetryDir(memoryDir), MEMORY_TELEMETRY_INSTALLATIONS_FILE);
}

export function readInstallations({ root, memoryDir = '.claude/memory' }) {
  const file = installationsFile({ root, memoryDir });
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (value.schema !== MEMORY_TELEMETRY_INSTALLATIONS_SCHEMA) {
      return { file, schema: MEMORY_TELEMETRY_INSTALLATIONS_SCHEMA, installations: {}, valid: false };
    }
    return { file, schema: value.schema, installations: value.installations || {}, valid: true };
  } catch {
    return { file, schema: MEMORY_TELEMETRY_INSTALLATIONS_SCHEMA, installations: {}, valid: existsSync(file) ? false : true };
  }
}

/**
 * Add this machine to the registry the first time it archives anything.
 *
 * The alias is left null on purpose. A machine can be recognised by whoever owns it and by nobody
 * else; guessing one from the hostname would both put a machine name in a committed file and be
 * wrong. A person fills it in later, and an entry that already exists is never rewritten.
 */
export function ensureInstallationRegistered({
  root, memoryDir = '.claude/memory', installationId, firstSeen,
}) {
  const registry = readInstallations({ root, memoryDir });
  if (Object.hasOwn(registry.installations, installationId)) return { file: registry.file, changed: false };
  const installations = {
    ...registry.installations,
    [installationId]: { alias: null, first_seen: firstSeen },
  };
  const ordered = Object.fromEntries(Object.keys(installations)
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map(key => [key, installations[key]]));
  const text = `${JSON.stringify({
    schema: MEMORY_TELEMETRY_INSTALLATIONS_SCHEMA,
    installations: ordered,
  }, null, 2)}\n`;
  mkdirSync(path.dirname(registry.file), { recursive: true });
  writeFileSync(registry.file, text, 'utf8');
  return { file: registry.file, changed: true };
}

function observedEventDays(root, directory) {
  const absolute = path.resolve(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name))
    .map(entry => entry.name.slice('events-'.length, -'.jsonl'.length))
    .sort((left, right) => left.localeCompare(right, 'en'));
}

/**
 * Archive one day, or every day whose events are still on disk.
 *
 * The default deliberately includes days that were already archived: re-reading them is cheap and
 * writing them is a no-op, whereas remembering which days are done would be a second piece of state
 * that can disagree with the packages themselves.
 */
export function runMemoryArchive({
  root,
  memoryDir = '.claude/memory',
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  day = null,
  now = new Date(),
} = {}) {
  const installationId = memoryInstallationId({ root, directory });
  if (!installationId) throw new Error('this repository has no observability key yet, so there is no installation to archive');
  const today = utcDay(now);
  const days = day
    ? [day]
    : observedEventDays(root, directory).filter(candidate => candidate >= MEMORY_TELEMETRY_FIRST_DAY && candidate < today);
  const results = [];
  for (const candidate of days) {
    const archive = collectDailyArchive({ root, memoryDir, directory, day: candidate, now });
    const write = writeDailyArchive({ root, memoryDir, archive });
    results.push({
      day: candidate,
      file: path.relative(root, write.file),
      changed: write.changed,
      partial_day: archive.partial_day,
      events: archive.events.total,
    });
  }
  const registry = days.length > 0
    ? ensureInstallationRegistered({ root, memoryDir, installationId, firstSeen: days[0] })
    : { file: installationsFile({ root, memoryDir }), changed: false };
  return {
    schema: 'ownmem-archive-run/v1',
    installation_id: installationId,
    days: results,
    installations_file: path.relative(root, registry.file),
    installations_changed: registry.changed,
  };
}

/** Read every package this repository carries, from every machine that has ever committed one. */
export function readFleetArchives({ root, memoryDir = '.claude/memory' }) {
  const telemetryRoot = path.join(root, memoryTelemetryDir(memoryDir));
  const registry = readInstallations({ root, memoryDir });
  const found = new Map();
  if (existsSync(telemetryRoot)) {
    for (const entry of readdirSync(telemetryRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packages = [];
      for (const file of readdirSync(path.join(telemetryRoot, entry.name), { withFileTypes: true })) {
        const match = file.isFile() && DAY_FILE_PATTERN.exec(file.name);
        if (!match) continue;
        try {
          packages.push(JSON.parse(readFileSync(path.join(telemetryRoot, entry.name, file.name), 'utf8')));
        } catch {
          // A package that cannot be parsed is a missing day, and it is reported as one. Guessing at
          // its counts would put a fabricated row where an absence belongs.
        }
      }
      found.set(entry.name, packages.sort((left, right) => String(left.day).localeCompare(String(right.day), 'en')));
    }
  }
  // Registered machines with nothing on disk are the whole point of the registry: a machine that has
  // never pushed a package is exactly the failure the fleet view has to be able to name.
  for (const installationId of Object.keys(registry.installations)) {
    if (!found.has(installationId)) found.set(installationId, []);
  }
  return {
    telemetry_dir: memoryTelemetryDir(memoryDir),
    registry,
    installations: [...found.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([installationId, packages]) => ({ installation_id: installationId, packages })),
  };
}

/** Commits landed on this day, used to say how much work a missing package covered up. */
export function commitsOnDay(root, day) {
  const output = git(root, [
    'log',
    `--since=${day}T00:00:00Z`,
    `--until=${shiftDay(day, 1)}T00:00:00Z`,
    '--format=%H',
  ]);
  if (output === null) return null;
  return output ? output.split('\n').filter(Boolean).length : 0;
}
