import { createHmac, randomBytes, randomUUID } from 'node:crypto';
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

export const MEMORY_OBSERVABILITY_SCHEMA = 'ownmem-observability.event/v1';
export const LEGACY_MEMORY_OBSERVABILITY_SCHEMA = 'oriveo.memory-observability.event/v1';
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
export const DEFAULT_MEMORY_OBSERVABILITY_RETENTION_DAYS = 30;
export const DEFAULT_MEMORY_OBSERVABILITY_MAX_BYTES = 20 * 1024 * 1024;

const EVENT_FILE_PATTERN = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/;

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

export function memoryQueryId({ root, query, directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY }) {
  if (typeof query !== 'string' || query.length === 0) throw new Error('memory query ID requires a non-empty query');
  return createHmac('sha256', hmacKey(root, directory)).update(query, 'utf8').digest('hex');
}

export function createMemoryObservabilityEvent({
  event,
  payload,
  snapshotId = null,
  traceId = randomUUID(),
  component,
  componentVersion = MEMORY_OBSERVABILITY_VERSION,
  now = new Date(),
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

export function enforceMemoryObservabilityRetention({
  root,
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  now = new Date(),
  retentionDays = DEFAULT_MEMORY_OBSERVABILITY_RETENTION_DAYS,
  maxBytes = DEFAULT_MEMORY_OBSERVABILITY_MAX_BYTES,
} = {}) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error('retentionDays must be a positive integer');
  if (!Number.isInteger(maxBytes) || maxBytes < 1024) throw new Error('maxBytes must be an integer of at least 1024');
  const outputRoot = observabilityRoot(root, directory);
  if (!existsSync(outputRoot)) return { removed: [], bytes: 0 };
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString().slice(0, 10);
  const removed = [];
  for (const item of eventFiles(outputRoot)) {
    if (item.day >= cutoff) continue;
    rmSync(item.file, { force: true });
    removed.push(item.name);
  }
  let files = eventFiles(outputRoot);
  let total = files.reduce((sum, item) => sum + statSync(item.file).size, 0);
  while (total > maxBytes && files.length > 1) {
    const oldest = files.shift();
    const bytes = statSync(oldest.file).size;
    rmSync(oldest.file, { force: true });
    removed.push(oldest.name);
    total -= bytes;
  }
  if (total > maxBytes && files.length === 1) {
    trimCurrentFile(files[0].file, maxBytes);
    total = statSync(files[0].file).size;
  }
  return { removed, bytes: total };
}

export function recordMemoryObservabilityEvent({
  root,
  event,
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  retentionDays = DEFAULT_MEMORY_OBSERVABILITY_RETENTION_DAYS,
  maxBytes = DEFAULT_MEMORY_OBSERVABILITY_MAX_BYTES,
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
  for (const item of eventFiles(outputRoot)) {
    const lines = readFileSync(item.file, 'utf8').split(/\r?\n/).filter(Boolean);
    lines.forEach((line, index) => {
      try {
        const parsed = JSON.parse(line);
        const event = validateMemoryObservabilityEvent(parsed.schema === LEGACY_MEMORY_OBSERVABILITY_SCHEMA
          ? { ...parsed, schema: MEMORY_OBSERVABILITY_SCHEMA }
          : parsed);
        const time = Date.parse(event.recorded_at);
        if (time >= fromMs && time <= untilMs) events.push(event);
      } catch (error) {
        errors.push({ file: item.name, line: index + 1, error: error.message });
      }
    });
  }
  events.sort((left, right) => left.recorded_at.localeCompare(right.recorded_at, 'en')
    || left.trace_id.localeCompare(right.trace_id, 'en')
    || left.event.localeCompare(right.event, 'en'));
  return { directory: outputRoot, events, errors, files: eventFiles(outputRoot).map(item => item.name) };
}
