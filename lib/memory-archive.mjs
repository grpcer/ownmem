import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import {
  DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  MEMORY_TELEMETRY_FIRST_DAY,
  memoryInstallationId,
  readMemoryObservabilityEvents,
} from './memory-observability.mjs';
import { readFeedbackInbox, summarizeFeedback } from './memory-feedback.mjs';
import { DEFAULT_ATTRIBUTION_FILE, summarizeAttributionLabels } from './features/attribution.mjs';
import { DEFAULT_OUTCOME_FILE, summarizeOutcomeReceipts } from './features/outcome.mjs';
import { distribution, summarizeRetrievalBySurfaceAgent } from './memory-metrics.mjs';
import { memoryLocalDailyDir, memoryLocalDailyFile } from './memory-paths.mjs';
import { schemaPath } from './schema-paths.mjs';

/**
 * The daily archive turns one day of local, expiring telemetry into a small counted package.
 *
 * Events are deleted after thirty days, so a rolling record of how this memory system behaved
 * cannot be kept in the event files themselves. The package lives beside those files under the
 * gitignored observability tree, carries counts and never rows, and is never committed.
 *
 * What goes in is stated positively in the schema and enforced negatively by
 * `assertDailyArchiveRedacted`. Topic names are the one identifier that does go in, because they
 * are already public in the memory index.
 */
export const MEMORY_TELEMETRY_DAY_SCHEMA = 'ownmem-telemetry-day/v3';
export const MEMORY_TELEMETRY_DAY_SCHEMA_V2 = 'ownmem-telemetry-day/v2';
export const MEMORY_TELEMETRY_INSTALLATIONS_SCHEMA = 'ownmem-telemetry-installations/v1';
export const MEMORY_TELEMETRY_DIRECTORY = 'telemetry';
export const MEMORY_TELEMETRY_INSTALLATIONS_FILE = 'installations.json';
/** How many `returned_topics` names a package keeps. Enough to see what a day was about. */
export const MEMORY_TELEMETRY_TOP_TOPICS = 20;
// Defined beside retention, which has to know which days the archive will never seal.
export { MEMORY_TELEMETRY_FIRST_DAY };

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/**
 * What an installation directory under `telemetry/` is named.
 *
 * The telemetry directory holds one folder per machine. Anything that is not shaped like an
 * installation id is skipped rather than guessed at.
 */
export const MEMORY_INSTALLATION_ID_PATTERN = /^local-[0-9a-f]{12}$/;
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
export function dayBuildIdentity(root, { day, partialDay = false, cache = null } = {}) {
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
  // Everything below is a function of the anchor commit alone, and re-deriving it is what makes a
  // sweep slow: the release marker is a pickaxe walk over the whole manifest history, repeated for
  // every retained day on every pass. Only a fully resolved answer is ever cached, so a failure is
  // retried rather than remembered.
  const hit = cache?.get(anchor);
  if (hit) {
    return {
      ...identity,
      scripts_tree_hash: hit.scripts_tree_hash,
      released_version: hit.released_version,
      release_marker_commit: hit.release_marker_commit,
      unreleased_delta: hit.unreleased_delta,
      unreleased_delta_reason: null,
    };
  }
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
  cache?.set(anchor, {
    scripts_tree_hash: identity.scripts_tree_hash,
    released_version: identity.released_version,
    release_marker_commit: identity.release_marker_commit,
    unreleased_delta: identity.unreleased_delta,
  });
  return identity;
}

export const BUILD_IDENTITY_CACHE_SCHEMA = 'ownmem-build-identity-cache/v1';
export const BUILD_IDENTITY_CACHE_FILE = 'build-identity-cache.json';
const BUILD_IDENTITY_CACHE_LIMIT = 400;
const BUILD_IDENTITY_CACHE_MAX_BYTES = 1024 * 1024;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/**
 * A local memo of the build identity per anchor commit, next to this machine's key.
 *
 * It exists because the sweep re-derives the identity of every retained day on every pass, and the
 * release-marker walk inside it grows with the repository's history: on this repository the archive
 * step grew by roughly 0.74 s per retained day until it crowded the rest of the daily pass out of
 * its budget. A commit's identity cannot change, so the memo can only ever return what a fresh
 * derivation would -- with three exceptions, where history itself is not fixed: a shallow clone
 * (deepening it reveals the real release marker), and grafts or replace refs (which rewrite
 * ancestry), whether configured in the repository or through GIT_REPLACE_REF_BASE, GIT_GRAFT_FILE or
 * GIT_NO_REPLACE_OBJECTS. In any of those, or when the probe itself fails, there is no memo at all.
 *
 * The algorithm fingerprint is the source text of the functions whose output is memoised, so a
 * change to how the identity is derived empties the memo instead of serving answers the new code
 * would not give. Every miss is written at once, atomically, because a host is allowed to kill the
 * pass mid-sweep and the next pass should not start over. Nothing here is ever committed.
 */
export function openBuildIdentityCache(root, directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY) {
  if (['GIT_REPLACE_REF_BASE', 'GIT_GRAFT_FILE', 'GIT_NO_REPLACE_OBJECTS'].some(name => process.env[name] !== undefined)) return null;
  const probe = git(root, ['rev-parse', '--is-shallow-repository', '--git-common-dir']);
  if (!probe) return null;
  const [shallow, commonDir] = probe.split('\n');
  if (shallow !== 'false' || !commonDir) return null;
  if (existsSync(path.join(path.resolve(root, commonDir), 'info', 'grafts'))) return null;
  const replaced = git(root, ['for-each-ref', '--count=1', 'refs/replace/']);
  if (replaced === null || replaced !== '') return null;

  const file = path.join(path.resolve(root, directory), BUILD_IDENTITY_CACHE_FILE);
  const algorithm = createHash('sha256')
    .update(String(dayBuildIdentity))
    .update(String(releaseMarkerCommit))
    .update(String(manifestVersionAt))
    .update(PUBLIC_MANIFEST)
    .digest('hex');
  const entries = new Map();
  let oversized = false;
  try {
    // A memo can only ever hold the limit's worth of entries; a file far larger than that was not
    // written here, and parsing it on every pass would cost more than the memo saves.
    oversized = statSync(file).size > BUILD_IDENTITY_CACHE_MAX_BYTES;
    const stored = oversized ? null : JSON.parse(readFileSync(file, 'utf8'));
    if (stored?.schema === BUILD_IDENTITY_CACHE_SCHEMA && stored.algorithm === algorithm
      && stored.entries && typeof stored.entries === 'object') {
      for (const [anchor, value] of Object.entries(stored.entries)) {
        if (validBuildIdentityEntry(anchor, value)) entries.set(anchor, value);
      }
    }
  } catch {
    // Missing or unreadable: an empty memo, which only costs the derivation it would have saved.
  }
  const stats = { hits: 0, misses: 0 };
  const persist = () => {
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(temporary, `${JSON.stringify({
        schema: BUILD_IDENTITY_CACHE_SCHEMA,
        algorithm,
        entries: Object.fromEntries(entries),
      })}\n`, 'utf8');
      renameSync(temporary, file);
    } catch {
      // A memo that cannot be written is a slower pass, never a failed one; it leaves nothing behind.
      try {
        rmSync(temporary, { force: true });
      } catch {
        // Nothing more to do.
      }
    }
  };
  // Trim a memo that holds more than the limit (written by an older build, or by hand) once, here,
  // rather than only when a later miss happens to write it.
  if (entries.size > BUILD_IDENTITY_CACHE_LIMIT || oversized) {
    while (entries.size > BUILD_IDENTITY_CACHE_LIMIT) entries.delete(entries.keys().next().value);
    persist();
  }
  return {
    file,
    stats,
    get(anchor) {
      const value = entries.get(anchor);
      if (value) stats.hits += 1;
      else stats.misses += 1;
      return value ?? null;
    },
    set(anchor, value) {
      if (!validBuildIdentityEntry(anchor, value)) return;
      entries.delete(anchor);
      entries.set(anchor, value);
      while (entries.size > BUILD_IDENTITY_CACHE_LIMIT) entries.delete(entries.keys().next().value);
      persist();
    },
  };
}

function validBuildIdentityEntry(anchor, value) {
  return OBJECT_ID.test(anchor)
    && value && typeof value === 'object'
    && OBJECT_ID.test(String(value.scripts_tree_hash))
    && OBJECT_ID.test(String(value.release_marker_commit))
    && typeof value.released_version === 'string' && value.released_version.length > 0
    && typeof value.unreleased_delta === 'boolean';
}

/**
 * The commit that first declared `version`, seen from `anchor` rather than from HEAD.
 *
 * The marker is the *earliest* reachable commit whose manifest sets this version, and a version
 * that was later changed to something else and then changed back does not move it. Walking the
 * manifest's history newest to oldest and stopping at the first commit that declares a different
 * version looked equivalent and is not: a bump that is reverted -- 0.6.0, then 0.7.0, then 0.6.0
 * again because the release was called off -- makes that walk stop at the revert and call the
 * revert the release point. Everything published under 0.6.0 then compares equal to a tree that was
 * never published, and `unreleased_delta` reports no delta for a tree that is entirely unreleased.
 * The release point is where the version was first claimed, not the last time it was written down.
 *
 * Looking from the anchor keeps the answer stable: a release that happened after the day being
 * archived did not exist on that day and must not appear in it.
 */
function releaseMarkerCommit(root, anchor, version) {
  // One pickaxe call covers the common case: the oldest commit that changed how often the version
  // string occurs in the manifest is the one that introduced it. `--pickaxe-regex` keeps this
  // independent of the manifest's indentation. The hit is confirmed against the manifest itself,
  // because a change in occurrence count is not by itself proof of what the file then declared.
  const pattern = `"version"[[:space:]]*:[[:space:]]*"${version.replace(/[.\\+*?[^\]$(){}=!<>|:#/-]/gu, '\\$&')}"`;
  const pickaxe = git(root, ['log', '--format=%H', '--reverse', '--pickaxe-regex', `-S${pattern}`, anchor, '--', PUBLIC_MANIFEST]);
  const earliest = pickaxe ? pickaxe.split('\n').filter(Boolean)[0] : null;
  if (earliest && manifestVersionAt(root, earliest) === version) return earliest;

  // Fallback: read every commit that touched the manifest and keep the oldest match. The log is
  // newest first, so the last match wins; nothing here breaks early, because breaking early is the
  // bug this function exists to avoid.
  const log = git(root, ['log', '--format=%H', anchor, '--', PUBLIC_MANIFEST]);
  if (!log) return null;
  let marker = null;
  for (const commit of log.split('\n').filter(Boolean)) {
    if (manifestVersionAt(root, commit) === version) marker = commit;
  }
  return marker;
}

/** The version the public manifest declared at one commit, or null when it cannot be read there. */
function manifestVersionAt(root, commit) {
  const manifest = git(root, ['show', `${commit}:${PUBLIC_MANIFEST}`]);
  if (!manifest) return null;
  try {
    return JSON.parse(manifest).version ?? null;
  } catch {
    return null;
  }
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
  // Where the ranking files are read from. Nothing in production passes it: production is the
  // installed package. A self-test needs it because its repository is a temporary directory, and
  // the ranking read out of a commit has to come from that repository rather than from this one.
  packageRoot = undefined,
  // A memo from openBuildIdentityCache, shared by one sweep. Omitted, every call derives afresh.
  buildIdentityCache = null,
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
    stack_version: modeOf(recallVersions) || modeOf(allVersions),
    stack_version_counts: countsToSortedList(recallVersions, 'version'),
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
  // A package that legitimately spans more than one day -- the loop package a window exports --
  // passes the span it is allowed to mention instead of a single day. The rest of the boundary is
  // identical for both, so it is one function with a widened date rule rather than a second copy:
  // a copied redaction check is a check that stops being updated the first time only one of the
  // two callers gains a field.
  dayRange = null,
  label = 'daily telemetry archive',
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
  // Names are matched as whole tokens inside values, never as substrings of the whole text. A
  // substring rule refused every package for an account called `li`, `al` or `ed`, because words
  // like `delivered` and `partial_day` are in every package -- and a refused package is a day that
  // never gets archived. Topic names are left out: they are already public in the memory index
  // this package sits next to. Paths stay fail-closed above, on the raw bytes.
  const values = identifyingValues(text);
  if (hostname && namedIn(values, text, hostname)) violations.push('the machine name');
  if (username && namedIn(values, text, username)) violations.push('the account name');
  if (homedir) forbid('the home directory', homedir);
  // A day the package is not named after would mean rows from another day leaked into it.
  if (day) {
    for (const match of text.matchAll(/\d{4}-\d{2}-\d{2}/gu)) {
      if (match[0] !== day) violations.push(`a date other than ${day} (${match[0]})`);
    }
  } else if (dayRange) {
    for (const match of text.matchAll(/\d{4}-\d{2}-\d{2}/gu)) {
      if (match[0] < dayRange.from || match[0] > dayRange.to) {
        violations.push(`a date outside ${dayRange.from}..${dayRange.to} (${match[0]})`);
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(`${label} would publish ${[...new Set(violations)].join(', ')}; refusing to write it`);
  }
  return text;
}

/**
 * Every string value of a rendered package except topic names, or null when the text is not JSON.
 * Keys are left out too: they are the schema's vocabulary, not anything a machine contributed.
 */
function identifyingValues(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const values = [];
  const walk = (node, parentKey) => {
    if (typeof node === 'string') {
      values.push(node);
    } else if (Array.isArray(node)) {
      for (const item of node) walk(item, parentKey);
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (parentKey === 'returned_topics' && key === 'topic') continue;
        walk(value, key);
      }
    }
  };
  walk(parsed, null);
  return values;
}

/** Whether `name` appears as a whole token -- bounded by anything but a letter or digit. */
function namedIn(values, text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const token = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu');
  // Text that is not JSON has no fields to exempt, so the whole of it is checked as one value.
  return (values ?? [text]).some(value => token.test(value));
}

function safeUsername() {
  try {
    return os.userInfo().username || null;
  } catch {
    return null;
  }
}

export function dailyArchiveFile({
  root,
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  installationId,
  day,
}) {
  return path.join(root, memoryLocalDailyFile(directory, installationId, day));
}

/**
 * Write the package only when it differs from the one already on disk.
 *
 * Every session hook in this repository can call this, so "write unconditionally" means a tracked
 * file whose mtime and content churn on every turn. The comparison is on rendered bytes, which is
 * why the renderer has to be deterministic: the same day archived twice has to produce the same
 * file, or "nothing changed" can never be observed.
 */
export function writeDailyArchive({
  root,
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  archive,
}) {
  const file = dailyArchiveFile({
    root, directory, installationId: archive.installation_id, day: archive.day,
  });
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const kept = keptLegacyPackage(existing, archive.schema);
  if (kept) {
    return {
      file,
      changed: false,
      kept: 'legacy-schema',
      kept_schema: kept,
      bytes: Buffer.byteLength(existing),
      sha256: createHash('sha256').update(existing, 'utf8').digest('hex'),
    };
  }
  // Serialise once. `changed` is decided by comparing exactly these bytes with exactly what is on
  // disk, and exactly these bytes are what gets written -- comparing one rendering and writing
  // another is how a run reports "unchanged" over a file it just rewrote.
  const text = assertDailyArchiveRedacted(renderDailyArchive(archive), { day: archive.day });
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  if (existing === text) return { file, changed: false, kept: null, bytes: Buffer.byteLength(text), sha256 };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
  return { file, changed: true, kept: null, bytes: Buffer.byteLength(text), sha256 };
}

const SEALED_IDENTITY_FIELDS = Object.freeze([
  'day_head_commit',
  'scripts_tree_hash',
  'released_version',
  'release_marker_commit',
  'unreleased_delta',
  'ranking_hash',
]);

/**
 * The identity fields a rewrite of a finished day would turn from resolved into null.
 *
 * Only a finished package of the same schema and day is protected. A null that becomes resolved is an
 * upgrade and is written; one resolved value replacing another is an anchor that moved and is written
 * too. First seals that honestly record null are untouched, because there is nothing to downgrade.
 */
function sealedIdentityDowngrade(existing, archive) {
  if (existing === null || archive.partial_day !== false) return [];
  let parsed;
  try {
    parsed = JSON.parse(existing);
  } catch {
    return [];
  }
  if (parsed.partial_day !== false || parsed.schema !== archive.schema || parsed.day !== archive.day) return [];
  return SEALED_IDENTITY_FIELDS.filter(field => parsed[field] !== null && parsed[field] !== undefined && archive[field] === null);
}

/**
 * Whether the git this process would use can answer questions about this repository at all, with the
 * facts that tell the causes apart.
 *
 * Asked only when a rewrite would downgrade a sealed identity. Two commands must succeed: locating
 * the repository and naming a commit on HEAD. A spawn error (no git on PATH, a broken Xcode shim), a
 * failing exit, or a GIT_DIR/GIT_WORK_TREE that redirects git elsewhere makes git unusable for
 * deriving this repository's builds. The failure that produced 6f1b1f6ae left no trace of why git was
 * unusable; what is kept here is small and local: the variable names (never their values), the exit
 * status or spawn error of the first failing command, and the first line of its stderr.
 */
export function gitHealth(root) {
  const names = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'].filter(name => process.env[name] !== undefined);
  let failure = null;
  let located = null;
  for (const args of [['rev-parse', '--absolute-git-dir', '--is-shallow-repository'], ['rev-list', '-1', 'HEAD']]) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      failure = {
        status: result.error ? String(result.error.code || result.error.message) : String(result.status),
        firstLine: String(result.stderr || '').split('\n').find(Boolean) || '',
      };
      break;
    }
    if (!located) located = result.stdout.trim().split('\n');
  }
  const shallow = located?.[1] === 'true';
  // GIT_DIR is set by git itself for hooks in a linked worktree, where it names that worktree's own
  // directory; only a value that makes git read a different repository than it would discover counts.
  let redirected = false;
  if (!failure && (names.includes('GIT_DIR') || names.includes('GIT_WORK_TREE'))) {
    const env = { ...process.env };
    for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete env[name];
    const discovered = spawnSync('git', ['-C', root, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8', env });
    redirected = discovered.error || discovered.status !== 0 || discovered.stdout.trim() !== located?.[0];
  }
  // Shortest facts first: the names and the exit status are what tell the causes apart, and git's own
  // message (which can carry a long path) is what a length limit may cut.
  const check = failure
    ? `${failure.status}${failure.firstLine ? ` ${failure.firstLine.slice(0, 80)}` : ''}`
    : `0${shallow ? ' shallow' : ''}${redirected ? ' redirected' : ''}`;
  return {
    usable: failure === null && !redirected && !shallow,
    summary: `git env: ${names.length > 0 ? names.join(', ') : 'none'}; git check: ${check}`,
  };
}

/** The package this module was loaded from: the code that is deriving identities right now. */
const RUNNING_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Whether the running package is the copy this repository tracks. The ranking hash of a day is read
 * out of a commit at the running package's path inside the repository; code loaded from anywhere
 * else -- npx or a global install outside the checkout, or an untracked copy inside it such as a
 * nested worktree under .claude/worktrees -- names a path the commit does not carry, and the null that
 * comes back describes where the code runs from, not the day. Decided from the paths and the index,
 * never from the wording of a reason.
 */
function runningPackageTracked(root) {
  let relative;
  try {
    relative = path.relative(realpathSync(root), realpathSync(RUNNING_PACKAGE_ROOT));
  } catch {
    return false;
  }
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  const probe = spawnSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', `${relative.split(path.sep).join('/')}/lib/memory-archive.mjs`], {
    encoding: 'utf8',
  });
  return !probe.error && probe.status === 0;
}

/**
 * Whether a run could see what it would have to see to derive a sealed day's identity. Git has to be
 * usable; and when the ranking hash is among the fields that would turn null, the running package has
 * to be the one this repository tracks.
 */
function derivationHealth(root, downgraded, health) {
  if (!health.usable) return health;
  if (downgraded.includes('ranking_hash') && !runningPackageTracked(root)) {
    return { usable: false, summary: `${health.summary}; package outside this checkout` };
  }
  return health;
}

/** The schema of a complete package already on disk that this writer must not overwrite, or null. */
function keptLegacyPackage(existing, schema) {
  if (existing === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(existing);
  } catch {
    // An unparseable package is not evidence of anything, so it is replaced rather than protected.
    return null;
  }
  if (parsed.partial_day !== false) return null;
  if (typeof parsed.schema !== 'string' || parsed.schema === schema) return null;
  return parsed.schema;
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

export function observedEventDays(root, directory) {
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
  // One day that cannot be archived must not cost the others: every day is attempted, and the ones
  // that failed are returned with their reasons for the caller to report.
  const failed = [];
  for (const candidate of days) {
    try {
      const archive = collectDailyArchive({ root, memoryDir, directory, day: candidate, now });
      const write = writeDailyArchive({ root, directory, archive });
      results.push({
        day: candidate,
        file: path.relative(root, write.file),
        changed: write.changed,
        kept: write.kept ?? null,
        partial_day: archive.partial_day,
        events: archive.events.total,
      });
    } catch (error) {
      failed.push({ day: candidate, error: String(error?.message || error) });
    }
  }
  return {
    schema: 'ownmem-archive-run/v1',
    installation_id: installationId,
    days: results,
    failed_days: failed,
  };
}

/**
 * Read a daily package without crashing on a v2 file a consumer still has on disk.
 * v2 packages are returned as-is; they are not rewritten and not revalidated against v3.
 */
export function readDailyArchiveFile(file) {
  const text = readFileSync(file, 'utf8');
  const parsed = JSON.parse(text);
  if (parsed?.schema === MEMORY_TELEMETRY_DAY_SCHEMA_V2) return { file, archive: parsed, schema: parsed.schema };
  return { file, archive: validateDailyArchive(parsed), schema: parsed.schema };
}

export function readLocalDailyPackages({
  root,
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  installationId = null,
} = {}) {
  const dailyRoot = path.join(root, memoryLocalDailyDir(directory));
  if (!existsSync(dailyRoot)) return [];
  const packages = [];
  const installations = installationId
    ? [installationId]
    : readdirSync(dailyRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && MEMORY_INSTALLATION_ID_PATTERN.test(entry.name))
      .map(entry => entry.name);
  for (const id of installations) {
    const folder = path.join(dailyRoot, id);
    if (!existsSync(folder)) continue;
    for (const file of readdirSync(folder, { withFileTypes: true })) {
      const match = file.isFile() && DAY_FILE_PATTERN.exec(file.name);
      if (!match) continue;
      try {
        packages.push(readDailyArchiveFile(path.join(folder, file.name)).archive);
      } catch {
        // Unreadable packages are absences, not fabricated rows.
      }
    }
  }
  return packages.sort((left, right) => String(left.day).localeCompare(String(right.day), 'en'));
}

/** Read every package this repository carries, from every machine that has ever committed one. */
export function readFleetArchives({ root, memoryDir = '.claude/memory' }) {
  const telemetryRoot = path.join(root, memoryTelemetryDir(memoryDir));
  const registry = readInstallations({ root, memoryDir });
  const found = new Map();
  if (existsSync(telemetryRoot)) {
    for (const entry of readdirSync(telemetryRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !MEMORY_INSTALLATION_ID_PATTERN.test(entry.name)) continue;
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
  // never written a package is exactly the failure this listing has to be able to name.
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
