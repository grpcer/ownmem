import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { currentAgentIdentity } from './memory-agent-identity.mjs';
import { memoryLocalDailyFile, resolveMemoryDir } from './memory-paths.mjs';
import { schemaPath } from './schema-paths.mjs';
import Ajv from 'ajv/dist/2020.js';

const EVENT_SCHEMA = JSON.parse(readFileSync(schemaPath('observability', 'events.schema.json'), 'utf8'));
const ajv = new Ajv({
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
const validateEventSchema = ajv.compile(EVENT_SCHEMA);

// v2 because `episode_id` became a required (nullable) field on recall.completed and command
// events, and a payload contract that tightens under an unchanged version string is the worst of
// both worlds: every historical row starts failing, and it fails with a message that reads as
// "your producer is broken" rather than "these were written under the previous contract". Measured
// when it happened: 2478 rows in the last seven days went dark under a message that pointed at the
// wrong remedy. The version bump makes the break one uniform, actionable statement -- older rows
// are refused with the sentence below, and the local ledger rebuilds within a day of normal use.
export const MEMORY_OBSERVABILITY_SCHEMA = 'ownmem-observability.event/v2';
export const MEMORY_OBSERVABILITY_VERSION = '0.1.0';
export const DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY = '.local-test/memory-observability';
/**
 * Ordered recall-degradation component names, with later entries representing deeper fallback.
 * Producers, reports, and instrumentation health share this single registry so a newly added
 * fallback cannot be emitted while remaining unknown to degradation and coverage calculations.
 */
export const MEMORY_RECALL_COMPONENTS = Object.freeze([
  'memory-recall-snapshot',
  'memory-recall-previous',
  'memory-recall-fallback',
]);
/**
 * Event names that no live producer emits. Historical rows stay on disk; the reader skips them
 * rather than scoring them as invalid, because "the producer was deleted" is not a broken line.
 */
export const RETIRED_OBSERVABILITY_EVENTS = Object.freeze([
  'evolution.completed',
  'maintenance.completed',
  // Retired in 2.0 with the three collection hooks that wrote them. They are by far the largest
  // share of any ledger that predates the change -- 29,234 of 32,950 rows on this machine -- so
  // leaving them off this list made `report` announce that 77% of the ledger was unreadable. That
  // reads as data corruption somebody has to go fix, when the honest statement is that the producer
  // was deleted on purpose.
  'command.completed',
  'correction.observed',
  'external.context.observed',
]);
export const DEFAULT_MEMORY_OBSERVABILITY_RETENTION_DAYS = 30;
export const DEFAULT_MEMORY_OBSERVABILITY_MAX_BYTES = 20 * 1024 * 1024;
/** The first day this program collects. Nothing before it is archived, because nothing before it survived. */
export const MEMORY_TELEMETRY_FIRST_DAY = '2026-09-03';

const EVENT_FILE_PATTERN = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/;

// 0.3.0 is a clean break: rows written under an older schema id are rejected, never migrated and
// never dual-parsed. Saying only "invalid" leaves the reader stuck, so the rejection carries what
// to do about it. These files live under .local-test/, which is discardable local telemetry.
const DISCARD_LOCAL_TELEMETRY = 'OwnMem 0.3.0 does not read rows written by an older schema; delete this .local-test/ file and let the current build collect fresh telemetry';

function validationMessage(errors) {
  return (errors || []).map(error => `${error.instancePath || '/'} ${error.message}`).join('; ');
}

export function validateMemoryObservabilityEvent(event) {
  if (!validateEventSchema(event)) {
    throw new Error(`memory observability event is invalid: ${validationMessage(validateEventSchema.errors)}`);
  }
  return event;
}

function observabilityRoot(root, directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY) {
  const absoluteRoot = path.resolve(root);
  const absoluteDirectory = path.resolve(absoluteRoot, directory);
  const relative = path.relative(absoluteRoot, absoluteDirectory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('memory observability directory must be inside the repository root');
  }
  return absoluteDirectory;
}

function hmacKey(root, directory) {
  const outputRoot = observabilityRoot(root, directory);
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  const keyFile = path.join(outputRoot, 'hmac.key');
  if (!existsSync(keyFile)) {
    let descriptor;
    try {
      descriptor = openSync(keyFile, 'wx', 0o600);
      writeFileSync(descriptor, randomBytes(32));
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    } finally {
      if (descriptor !== undefined) {
        // writeFileSync does not close caller-owned descriptors.
        try { closeSync(descriptor); } catch { /* best effort */ }
      }
    }
  }
  chmodSync(keyFile, 0o600);
  const key = readFileSync(keyFile);
  if (key.byteLength !== 32) throw new Error('memory observability HMAC key must contain exactly 32 bytes');
  return key;
}

/**
 * A stable, non-identifying name for the machine this ledger was collected on.
 *
 * Derived from the local HMAC key, which never leaves the repository and is never itself published:
 * the digest is one-way, so the id says "these rows came from the same install" without saying
 * which install. It lives here rather than beside any one consumer because a second consumer would
 * otherwise invent a second derivation, and two spellings of the same machine read as two machines.
 *
 * Returns null when no key exists yet, which is an install that has never recorded an event. It
 * deliberately does not create one: naming a machine is not a reason to start collecting on it.
 */
export function memoryInstallationId({ root, directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY } = {}) {
  try {
    const key = readFileSync(path.resolve(root, directory, 'hmac.key'));
    return `local-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
  } catch {
    return null;
  }
}

export function memoryQueryId({ root, query, directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY }) {
  if (typeof query !== 'string' || query.length === 0) throw new Error('memory query ID requires a non-empty query');
  return createHmac('sha256', hmacKey(root, directory)).update(query, 'utf8').digest('hex');
}

/**
 * The one place an event is built, which is why the agent is stamped here rather than at each of
 * the two dozen call sites. Attribution that a producer has to remember to add is attribution that
 * a producer eventually forgets; three hosts share this ledger, and a row with no agent is
 * permanently unattributable because the environment that would have answered is long gone.
 *
 * `identity` exists for the daemon and the resident recall process, which serve one host's request
 * at a time and must stamp that requester rather than whoever started them.
 */
export function createMemoryObservabilityEvent({
  event,
  payload,
  snapshotId = null,
  traceId = randomUUID(),
  component,
  componentVersion = MEMORY_OBSERVABILITY_VERSION,
  now = new Date(),
  identity = currentAgentIdentity(),
}) {
  return validateMemoryObservabilityEvent({
    schema: MEMORY_OBSERVABILITY_SCHEMA,
    event,
    recorded_at: now.toISOString(),
    trace_id: traceId,
    snapshot_id: snapshotId,
    process: {
      runtime: 'node',
      runtime_version: process.versions.node,
      component,
      component_version: componentVersion,
    },
    agent: identity.agent,
    nested: Boolean(identity.nested),
    payload,
  });
}

function eventFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && EVENT_FILE_PATTERN.test(entry.name))
    .map(entry => ({
      name: entry.name,
      file: path.join(directory, entry.name),
      day: entry.name.match(EVENT_FILE_PATTERN)[1],
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

function trimCurrentFile(file, maxBytes) {
  const content = readFileSync(file);
  if (content.byteLength <= maxBytes) return;
  const lines = content.toString('utf8').split('\n').filter(Boolean).reverse();
  const kept = [];
  let bytes = 0;
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line) + 1;
    if (lineBytes > maxBytes) continue;
    if (bytes + lineBytes > maxBytes) break;
    kept.push(line);
    bytes += lineBytes;
  }
  // Replace atomically. Direct overwrite truncates first and can erase a complete event file if killed.
  writeFileAtomically(file, kept.reverse().map(line => `${line}\n`).join(''));
}

function writeFileAtomically(file, text) {
  const temporary = path.join(path.dirname(file), `.tmp-events-${process.pid}-${randomBytes(6).toString('hex')}`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, text, 'utf8');
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** Remove an interrupted trailing partial line before appending, so it cannot corrupt the next event. */
function endsWithoutNewline(file) {
  let descriptor;
  try {
    const { size } = statSync(file);
    if (size === 0) return false;
    descriptor = openSync(file, 'r');
    const buffer = Buffer.alloc(1);
    readSync(descriptor, buffer, 0, 1, size - 1);
    return buffer[0] !== 0x0a;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

const retentionMemoryDirs = new Map();
const retentionConfigs = new Map();

function positiveInteger(value, minimum) {
  return Number.isInteger(value) && value >= minimum ? value : null;
}

/**
 * The retention period and byte cap this installation asked for, from `<memory dir>/config.json`.
 *
 * Read on every event write, so it costs one `stat` once warm: the memory directory is resolved
 * once per root per process, and the file is parsed again only when its size or mtime moves. A
 * long-lived daemon therefore still sees an edited config without a restart. A missing, unreadable
 * or out-of-range value falls back to the default rather than throwing -- a throw here would turn
 * every recall's event write into a silent `written: false`.
 */
export function readMemoryObservabilityRetentionConfig({ root, memoryDir = null } = {}) {
  const absoluteRoot = path.resolve(root);
  let directory = memoryDir;
  if (!directory) {
    directory = retentionMemoryDirs.get(absoluteRoot);
    if (!directory) {
      directory = resolveMemoryDir(absoluteRoot);
      retentionMemoryDirs.set(absoluteRoot, directory);
    }
  }
  const file = path.join(absoluteRoot, directory, 'config.json');
  const defaults = {
    memory_dir: directory,
    retention_days: DEFAULT_MEMORY_OBSERVABILITY_RETENTION_DAYS,
    max_bytes: DEFAULT_MEMORY_OBSERVABILITY_MAX_BYTES,
  };
  let stat;
  try {
    stat = statSync(file);
  } catch {
    return defaults;
  }
  const cached = retentionConfigs.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value;
  let telemetry = null;
  try {
    telemetry = JSON.parse(readFileSync(file, 'utf8'))?.telemetry ?? null;
  } catch {
    telemetry = null;
  }
  const value = {
    memory_dir: directory,
    retention_days: positiveInteger(telemetry?.raw_retention_days, 1) ?? defaults.retention_days,
    max_bytes: positiveInteger(telemetry?.raw_max_bytes, 1024) ?? defaults.max_bytes,
  };
  retentionConfigs.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
  return value;
}

/**
 * Whether this installation has already sealed `day` into a complete package.
 *
 * Only asked about a day retention actually wants to remove, which is rare, so the installation id
 * and each package are read lazily and at most once per pass. No key means no installation, and an
 * installation that cannot name itself cannot have sealed anything.
 */
function sealedDayReader({ root, directory, memoryDir }) {
  let installationId;
  const answers = new Map();
  return day => {
    if (installationId === undefined) installationId = memoryInstallationId({ root, directory });
    if (!installationId) return false;
    if (!answers.has(day)) {
      let sealed = false;
      try {
        const archived = JSON.parse(readFileSync(path.join(path.resolve(root), memoryLocalDailyFile(directory, installationId, day)), 'utf8'));
        sealed = archived?.partial_day === false && archived.day === day;
      } catch {
        sealed = false;
      }
      answers.set(day, sealed);
    }
    return answers.get(day);
  };
}

/**
 * What retention would remove right now, and which days it has to keep because nothing seals them.
 *
 * Raw events are the only copy of a day until the daily archive seals it into a package, so both
 * limits are soft for an unsealed day: the age limit and the byte cap skip it rather than delete
 * the only record of what happened. Deleting it was silent, and a lost day looked exactly like an
 * idle one to every later reader. The days kept this way are returned so the daily pass can say
 * so; once the archive seals them, the next write removes them as usual.
 *
 * The newest file is never removed by the cap, as before, and is trimmed only when it is the last
 * file left and its day is sealed.
 */
export function planMemoryObservabilityRetention({
  root,
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  memoryDir = null,
  now = new Date(),
  retentionDays = undefined,
  maxBytes = undefined,
} = {}) {
  const outputRoot = observabilityRoot(root, directory);
  const needsConfig = retentionDays === undefined || maxBytes === undefined || !memoryDir;
  const config = needsConfig ? readMemoryObservabilityRetentionConfig({ root, memoryDir }) : null;
  const effectiveRetentionDays = retentionDays ?? config.retention_days;
  const effectiveMaxBytes = maxBytes ?? config.max_bytes;
  if (!Number.isInteger(effectiveRetentionDays) || effectiveRetentionDays < 1) throw new Error('retentionDays must be a positive integer');
  if (!Number.isInteger(effectiveMaxBytes) || effectiveMaxBytes < 1024) throw new Error('maxBytes must be an integer of at least 1024');
  const plan = {
    retention_days: effectiveRetentionDays,
    max_bytes: effectiveMaxBytes,
    bytes: 0,
    removals: [],
    trim: null,
    held: [],
  };
  if (!existsSync(outputRoot)) return plan;
  const isSealed = sealedDayReader({ root, directory, memoryDir: memoryDir || config.memory_dir });
  // A day before the program's first collection day is never archived, so no package will ever
  // protect it and holding it would keep it forever.
  const removable = day => day < MEMORY_TELEMETRY_FIRST_DAY || isSealed(day);
  const holds = new Map();
  const hold = (day, reason) => {
    const reasons = holds.get(day) || new Set();
    reasons.add(reason);
    holds.set(day, reasons);
  };
  const files = eventFiles(outputRoot).map(item => ({ ...item, bytes: statSync(item.file).size }));
  plan.bytes = files.reduce((sum, item) => sum + item.bytes, 0);
  const cutoff = new Date(now.getTime() - effectiveRetentionDays * 86_400_000).toISOString().slice(0, 10);
  const kept = [];
  for (const item of files) {
    if (item.day < cutoff) {
      if (removable(item.day)) {
        plan.removals.push({ name: item.name, file: item.file, day: item.day, reason: 'age' });
        continue;
      }
      hold(item.day, 'age');
    }
    kept.push(item);
  }
  let total = kept.reduce((sum, item) => sum + item.bytes, 0);
  let remaining = kept.length;
  for (const item of kept.slice(0, -1)) {
    if (total <= effectiveMaxBytes) break;
    if (!removable(item.day)) {
      hold(item.day, 'bytes');
      continue;
    }
    plan.removals.push({ name: item.name, file: item.file, day: item.day, reason: 'bytes' });
    total -= item.bytes;
    remaining -= 1;
  }
  const newest = kept[kept.length - 1];
  if (newest && total > effectiveMaxBytes && remaining === 1) {
    if (removable(newest.day)) plan.trim = newest.file;
    else hold(newest.day, 'bytes');
  }
  plan.held = [...holds.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([day, reasons]) => ({ day, reasons: [...reasons].sort() }));
  return plan;
}

export function enforceMemoryObservabilityRetention({
  root,
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  memoryDir = null,
  now = new Date(),
  retentionDays = undefined,
  maxBytes = undefined,
} = {}) {
  const plan = planMemoryObservabilityRetention({ root, directory, memoryDir, now, retentionDays, maxBytes });
  const removed = [];
  let total = plan.bytes;
  for (const removal of plan.removals) {
    try {
      total -= statSync(removal.file).size;
    } catch {
      // Already gone: a concurrent writer removed it first.
    }
    rmSync(removal.file, { force: true });
    removed.push(removal.name);
  }
  if (plan.trim) {
    const before = statSync(plan.trim).size;
    trimCurrentFile(plan.trim, plan.max_bytes);
    total -= before - statSync(plan.trim).size;
  }
  return { removed, bytes: total, held: plan.held };
}

/**
 * The daily finding for days retention is holding back, or null when it holds none.
 *
 * A soft limit that nobody hears about is a disk that fills up quietly, so every held day is named
 * together with the limit it has passed. The days stay until a complete package seals them.
 */
export function formatMemoryObservabilityRetentionFinding(plan) {
  if (!plan?.held?.length) return null;
  const limits = [];
  if (plan.held.some(item => item.reasons.includes('age'))) limits.push(`older than the ${plan.retention_days}-day retention`);
  if (plan.held.some(item => item.reasons.includes('bytes'))) {
    limits.push(`over the ${(plan.max_bytes / (1024 * 1024)).toFixed(1)} MB cap (${(plan.bytes / (1024 * 1024)).toFixed(1)} MB on disk)`);
  }
  const shown = plan.held.slice(0, 5).map(item => item.day);
  const more = plan.held.length - shown.length;
  return `local raw events for ${shown.join(', ')}${more > 0 ? ` and ${more} more day(s)` : ''}`
    + ` are ${limits.join(' and ')} but were kept, because no complete package seals those days yet`;
}

export function recordMemoryObservabilityEvent({
  root,
  event,
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  retentionDays = undefined,
  maxBytes = undefined,
} = {}) {
  try {
    validateMemoryObservabilityEvent(event);
    const outputRoot = observabilityRoot(root, directory);
    mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
    const day = event.recorded_at.slice(0, 10);
    const file = path.join(outputRoot, `events-${day}.jsonl`);
    const separator = endsWithoutNewline(file) ? '\n' : '';
    appendFileSync(file, `${separator}${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    const retention = enforceMemoryObservabilityRetention({
      root,
      directory,
      now: new Date(event.recorded_at),
      retentionDays,
      maxBytes,
    });
    return { written: true, file, retention, error: null };
  } catch (error) {
    return { written: false, file: null, retention: null, error: error.message };
  }
}

export function recordMemoryConsumption({
  root,
  traceId,
  snapshotId = null,
  topics,
  authorityFollowed = false,
  component = 'memory-observe',
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  via = null,
  match = null,
} = {}) {
  const event = createMemoryObservabilityEvent({
    event: 'recall.consumed',
    traceId,
    snapshotId,
    component,
    payload: {
      topics: [...new Set(topics || [])],
      authority_followed: authorityFollowed,
  // via and match identify the reporting surface and pairing strength without later inference.
      ...(via ? { via } : {}),
      ...(match ? { match } : {}),
    },
  });
  const write = recordMemoryObservabilityEvent({ root, directory, event });
  return { event, write };
}

export function recordMemoryDelivery({
  root,
  traceId,
  snapshotId = null,
  topics,
  surface,
  component = 'memory-delivery',
  componentVersion = MEMORY_OBSERVABILITY_VERSION,
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
} = {}) {
  const event = createMemoryObservabilityEvent({
    event: 'recall.delivered',
    traceId,
    snapshotId,
    component,
    componentVersion,
    payload: {
      surface,
      topics: [...new Set(topics || [])],
    },
  });
  const write = recordMemoryObservabilityEvent({ root, directory, event });
  return { event, write };
}

/**
 * Stream 2 of three. The outcome receipt answers "what happened after this memory was used", and
 * only a user or the host may answer it. `self` is rejected here rather than only at the CLI, so a
 * programmatic caller cannot smuggle an agent's own opinion into the one stream that is allowed to
 * speak about actual application.
 *
 * The payload is an allowlist: enums, one digest, one boolean. The confirming sentence itself is
 * hashed by the caller and never reaches this file; a free-form note, when the caller supplies one,
 * stays in the local receipt row and is represented here only by its presence.
 */
export function recordMemoryOutcome({
  root,
  traceId,
  snapshotId = null,
  memoryId,
  outcome,
  confirmedBy,
  confirmationSha256,
  pairing,
  notePresent = false,
  component = 'memory-outcome',
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  now = new Date(),
} = {}) {
  if (confirmedBy !== 'user' && confirmedBy !== 'host') {
    throw new Error('an outcome receipt must be confirmed by user or host; an agent grading its own recall is a self-attribution label, so record it with `ownmem attribute`');
  }
  const event = createMemoryObservabilityEvent({
    event: 'outcome.recorded',
    traceId,
    snapshotId,
    component,
    now,
    payload: {
      memory_id: memoryId,
      outcome,
      confirmed_by: confirmedBy,
      confirmation_sha256: confirmationSha256,
      pairing,
      note_present: Boolean(notePresent),
    },
  });
  const write = recordMemoryObservabilityEvent({ root, directory, event });
  return { event, write };
}

/**
 * Stream 3 of three. A weak, turn-scoped label the agent puts on itself. It is recorded only when a
 * memory clearly helped or clearly misled, so the unlabelled turns are unknown rather than neutral
 * and no rate can ever be computed from it. `basis` is a constant for exactly that reason: it makes
 * a silent promotion into explicit feedback impossible to write by accident.
 */
export function recordMemoryAttribution({
  root,
  traceId,
  snapshotId = null,
  memoryId,
  label,
  pairing,
  component = 'memory-attribution',
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  now = new Date(),
} = {}) {
  const event = createMemoryObservabilityEvent({
    event: 'attribution.recorded',
    traceId,
    snapshotId,
    component,
    now,
    payload: {
      memory_id: memoryId,
      label,
      basis: 'self-attribution',
      scope: 'turn',
      pairing,
    },
  });
  const write = recordMemoryObservabilityEvent({ root, directory, event });
  return { event, write };
}

/**
 * The day range whose files can hold an event inside [fromMs, untilMs].
 *
 * Files are named after `recorded_at.slice(0, 10)`, so the name is the event's own UTC day and the
 * mapping is exact. The one-day pad exists for rows this writer did not produce: a file carried in
 * from another machine, or written by an older build with a different day rule, would otherwise be
 * skipped without a trace. Returns null when there is no lower bound, which is the "read the whole
 * ledger" contract every unwindowed caller depends on.
 */
function windowedDayRange(fromMs, untilMs) {
  if (!Number.isFinite(fromMs)) return null;
  const pad = 86_400_000;
  return {
    first: new Date(fromMs - pad).toISOString().slice(0, 10),
    last: Number.isFinite(untilMs) ? new Date(untilMs + pad).toISOString().slice(0, 10) : null,
  };
}

export function readMemoryObservabilityEvents({
  root,
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  since,
  until = new Date(),
} = {}) {
  const outputRoot = observabilityRoot(root, directory);
  const fromMs = since instanceof Date ? since.getTime() : Number.NEGATIVE_INFINITY;
  const untilMs = until instanceof Date ? until.getTime() : Number.POSITIVE_INFINITY;
  const events = [];
  const errors = [];
  // A windowed read opens only the days that can answer it. Reading every file and discarding the
  // rows afterwards made this call cost grow with the age of the ledger rather than with the size
  // of the question -- the Stop hook asks about one session and was paying for a month of history
  // on every single turn (measured 148ms over 15 day-files; 8940 lines parsed to keep 761).
  // It also finishes a fix that only got half done: error lines were already windowed by timestamp,
  // yet the denominator they landed in still came from the whole disk, so "how much of this window
  // could I read" answered about days the caller never asked about.
  const dayRange = windowedDayRange(fromMs, untilMs);
  const candidates = eventFiles(outputRoot).filter(item => !dayRange
    || (item.day >= dayRange.first && (!dayRange.last || item.day <= dayRange.last)));
  for (const item of candidates) {
    const lines = readFileSync(item.file, 'utf8').split(/\r?\n/).filter(Boolean);
    lines.forEach((line, index) => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        errors.push({ file: item.name, line: index + 1, error: error.message });
        return;
      }
      if (RETIRED_OBSERVABILITY_EVENTS.includes(parsed?.event)) return;
      try {
        const event = validateMemoryObservabilityEvent(parsed);
        const time = Date.parse(event.recorded_at);
        if (time >= fromMs && time <= untilMs) events.push(event);
      } catch (error) {
        // Unreadable lines are windowed the same way readable ones are. They were not, and the
        // consequence was a ratio that compared a seven-day event count against an all-time error
        // count -- a caller asking "how much of this window could I read" got an answer about the
        // whole disk. A line that failed validation usually still parsed as JSON and still carries
        // its own timestamp; one that does not is kept, because dropping an error for having no
        // timestamp would hide exactly the lines that are most broken.
        const time = Date.parse(parsed?.recorded_at);
        if (Number.isFinite(time) && (time < fromMs || time > untilMs)) return;
        const outdated = typeof parsed?.schema === 'string' && parsed.schema !== MEMORY_OBSERVABILITY_SCHEMA;
        errors.push({
          file: item.name,
          line: index + 1,
          error: outdated ? `${error.message}; ${DISCARD_LOCAL_TELEMETRY}` : error.message,
        });
      }
    });
  }
  events.sort((left, right) => left.recorded_at.localeCompare(right.recorded_at, 'en')
    || left.trace_id.localeCompare(right.trace_id, 'en')
    || left.event.localeCompare(right.event, 'en'));
  // `files` lists what this read actually opened, so a windowed caller's file count and its
  // readable-share denominator describe the same window its events came from.
  return { directory: outputRoot, events, errors, files: candidates.map(item => item.name) };
}
