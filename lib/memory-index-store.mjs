import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  validateMemoryIndexArtifact,
  validateMemoryIndexManifest,
} from './memory-contracts.mjs';

export const MEMORY_ARTIFACT_SPECS = Object.freeze({
  documents: Object.freeze({ file: 'documents.json', schema: 'ownmem-index.documents/v2' }),
  // Exactly one readable encoding per artifact. A snapshot written by an older build is refused
  // here, which lands on the existing schema-incompatible rebuild path: the index is derived from
  // the Markdown corpus, so recompiling it is cheap and always correct, whereas a second reader for
  // an older encoding is a parser that has no producer and never goes away.
  postings: Object.freeze({ file: 'postings.json', schema: 'ownmem-index.postings/v2' }),
  exact_map: Object.freeze({ file: 'exact-map.json', schema: 'ownmem-index.exact-map/v1' }),
  graph: Object.freeze({ file: 'graph.json', schema: 'ownmem-index.graph/v2' }),
  ranking: Object.freeze({ file: 'ranking.json', schema: 'ownmem-index.ranking/v3' }),
});

const sleepArray = new Int32Array(new SharedArrayBuffer(4));

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort((left, right) => left.localeCompare(right, 'en'))
      .map((key) => [key, stableValue(value[key])]),
  );
}

export function stableJson(value, { space = 2 } = {}) {
  return `${JSON.stringify(stableValue(value), null, space)}\n`;
}

export function artifactRecordCount(kind, artifact) {
  if (kind === 'documents') return artifact.documents.length;
  if (kind === 'postings') return artifact.terms.length;
  if (kind === 'exact_map') return artifact.entries.length;
  if (kind === 'graph') return artifact.edges.length;
  if (kind === 'ranking') return Object.keys(artifact.field_weights).length;
  throw new Error(`unknown memory index artifact kind: ${kind}`);
}

export function snapshotContentSha256(artifactMetadata) {
  return sha256(stableJson(Object.fromEntries(
    Object.entries(artifactMetadata).map(([kind, metadata]) => [kind, {
      file: metadata.file,
      schema: metadata.schema,
      sha256: metadata.sha256,
      bytes: metadata.bytes,
      records: metadata.records,
    }]),
  )));
}

export function snapshotId({ compilerVersion, sourceSha256, contentSha256 }) {
  return sha256(`ownmem-index/v1\0ownmem-compiler\0${compilerVersion}\0${sourceSha256}\0${contentSha256}`);
}

function ensureInside(parent, child, label) {
  if (existsSync(parent) && existsSync(child)) {
    const canonicalRelative = path.relative(realpathSync(parent), realpathSync(child));
    if (canonicalRelative === '' || (!canonicalRelative.startsWith('..') && !path.isAbsolute(canonicalRelative))) return child;
    throw new Error(`${label} escapes memory index root: ${child}`);
  }
  const lexicalRelative = path.relative(path.resolve(parent), path.resolve(child));
  const lexicallyInside = lexicalRelative === ''
    || (!lexicalRelative.startsWith('..') && !path.isAbsolute(lexicalRelative));
  if (lexicallyInside) return child;
  throw new Error(`${label} escapes memory index root: ${child}`);
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is unreadable: ${error.message}`);
  }
}

export function validateSnapshotDirectory(directory) {
  const manifest = readJson(path.join(directory, 'manifest.json'), 'memory index manifest');
  validateMemoryIndexManifest(manifest);
  const declaredSourceSha256 = sha256(stableJson(manifest.source.files));
  if (manifest.source.source_sha256 !== declaredSourceSha256) {
    throw new Error('memory index source checksum mismatch');
  }
  const artifacts = {};
  const artifactMetadata = {};

  for (const [kind, spec] of Object.entries(MEMORY_ARTIFACT_SPECS)) {
    const declared = manifest.artifacts[kind];
    if (declared.file !== spec.file || declared.schema !== spec.schema) {
      throw new Error(`memory index ${kind} artifact contract does not match the current reader: declared ${declared.schema}, this build reads ${spec.schema}; the snapshot will be rebuilt from the memory sources`);
    }
    const artifactPath = path.join(directory, spec.file);
    const bytes = readFileSync(artifactPath);
    if (bytes.byteLength !== declared.bytes) {
      throw new Error(`memory index ${kind} artifact byte count mismatch`);
    }
    if (sha256(bytes) !== declared.sha256) {
      throw new Error(`memory index ${kind} artifact checksum mismatch`);
    }
    const artifact = readJson(artifactPath, `memory index ${kind} artifact`);
    validateMemoryIndexArtifact(kind, artifact);
    if (artifactRecordCount(kind, artifact) !== declared.records) {
      throw new Error(`memory index ${kind} artifact record count mismatch`);
    }
    artifacts[kind] = artifact;
    artifactMetadata[kind] = declared;
  }

  const contentSha256 = snapshotContentSha256(artifactMetadata);
  if (manifest.snapshot.content_sha256 !== contentSha256) {
    throw new Error('memory index snapshot content checksum mismatch');
  }
  const expectedId = snapshotId({
    compilerVersion: manifest.compiler.version,
    sourceSha256: manifest.source.source_sha256,
    contentSha256,
  });
  if (manifest.snapshot.id !== expectedId) throw new Error('memory index snapshot id mismatch');
  return { directory, manifest, artifacts };
}

function resolvePointer(indexRoot, pointer) {
  const pointerPath = path.join(indexRoot, pointer);
  if (!existsSync(pointerPath)) throw new Error(`${pointer} pointer is missing`);
  const resolved = realpathSync(pointerPath);
  ensureInside(path.join(indexRoot, 'snapshots'), resolved, pointer);
  return resolved;
}

export function readPublishedMemorySnapshot({ indexRoot, allowPrevious = true } = {}) {
  let currentError;
  try {
    return { ...validateSnapshotDirectory(resolvePointer(indexRoot, 'v1')), selected: 'current', currentError: null };
  } catch (error) {
    currentError = error;
  }
  if (!allowPrevious) throw currentError;
  try {
    return {
      ...validateSnapshotDirectory(resolvePointer(indexRoot, 'previous-v1')),
      selected: 'previous',
      currentError,
    };
  } catch (previousError) {
    throw new AggregateError([currentError, previousError], 'no valid memory index snapshot is available');
  }
}

export function rollbackMemorySnapshot({ indexRoot } = {}) {
  if (!indexRoot) throw new Error('memory snapshot rollback requires an index root');
  const currentTarget = pointerTarget(indexRoot, 'v1');
  const previousTarget = pointerTarget(indexRoot, 'previous-v1');
  if (!currentTarget || !previousTarget) throw new Error('memory snapshot rollback requires current and previous pointers');
  const current = validateSnapshotDirectory(resolvePointer(indexRoot, 'v1'));
  const previous = validateSnapshotDirectory(resolvePointer(indexRoot, 'previous-v1'));
  replaceSymlink(indexRoot, 'v1', previousTarget);
  replaceSymlink(indexRoot, 'previous-v1', currentTarget);
  return {
    schema: 'ownmem-snapshot-rollback/v1',
    active_snapshot_id: previous.manifest.snapshot.id,
    previous_snapshot_id: current.manifest.snapshot.id,
  };
}

function pointerTarget(indexRoot, pointer) {
  const pointerPath = path.join(indexRoot, pointer);
  if (!existsSync(pointerPath)) return null;
  if (!lstatSync(pointerPath).isSymbolicLink()) {
    throw new Error(`${pointer} must be an atomic symlink pointer`);
  }
  return readlinkSync(pointerPath);
}

function replaceSymlink(indexRoot, pointer, target) {
  const temporary = path.join(indexRoot, `.${pointer}.${process.pid}.${randomBytes(6).toString('hex')}`);
  symlinkSync(target, temporary);
  try {
    renameSync(temporary, path.join(indexRoot, pointer));
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function publishSnapshotDirectory({ indexRoot, temporaryDirectory, snapshot }) {
  mkdirSync(path.join(indexRoot, 'snapshots'), { recursive: true });
  const finalDirectory = path.join(indexRoot, 'snapshots', snapshot.manifest.snapshot.id);
  ensureInside(path.join(indexRoot, 'snapshots'), finalDirectory, 'snapshot');
  let publishedSnapshot;
  let repaired = false;

  if (existsSync(finalDirectory)) {
    try {
      publishedSnapshot = validateSnapshotDirectory(finalDirectory);
      rmSync(temporaryDirectory, { recursive: true, force: true });
    } catch {
      const corruptRoot = path.join(indexRoot, 'corrupt');
      mkdirSync(corruptRoot, { recursive: true });
      const quarantine = path.join(
        corruptRoot,
        `${snapshot.manifest.snapshot.id}-${Date.now()}-${randomBytes(4).toString('hex')}`,
      );
      renameSync(finalDirectory, quarantine);
      renameSync(temporaryDirectory, finalDirectory);
      publishedSnapshot = validateSnapshotDirectory(finalDirectory);
      repaired = true;
    }
  } else {
    renameSync(temporaryDirectory, finalDirectory);
    publishedSnapshot = { ...snapshot, directory: finalDirectory };
  }

  const nextTarget = path.relative(indexRoot, finalDirectory);
  const currentTarget = pointerTarget(indexRoot, 'v1');
  if (currentTarget === nextTarget) {
    return {
      published: repaired,
      repaired,
      directory: finalDirectory,
      snapshot: publishedSnapshot,
      collected: collectUnreferencedSnapshots(indexRoot),
    };
  }
  if (currentTarget) replaceSymlink(indexRoot, 'previous-v1', currentTarget);
  replaceSymlink(indexRoot, 'v1', nextTarget);
  return {
    published: true,
    repaired,
    directory: finalDirectory,
    snapshot: publishedSnapshot,
    collected: collectUnreferencedSnapshots(indexRoot),
  };
}

// Every compile published a new snapshot directory and nothing ever removed the old one. The reader
// only ever resolves two pointers, so the rest were unreachable: this machine accumulated 76
// directories totalling 1.56 GB (74 of them orphans at ~20 MB each) before anyone noticed, because
// nothing about a growing directory is visible from the recall path.
//
// Runs after the pointers have been moved, so "referenced" is read from the pointers themselves
// rather than from what this call happens to know. That ordering is what makes it safe: a pointer
// that failed to move still protects its target.
export function collectUnreferencedSnapshots(indexRoot) {
  const snapshotsRoot = path.join(indexRoot, 'snapshots');
  if (!existsSync(snapshotsRoot)) return { removed: [], kept: [] };

  const referenced = new Set();
  for (const pointer of ['v1', 'previous-v1']) {
    const target = pointerTarget(indexRoot, pointer);
    if (target) referenced.add(path.basename(target));
  }
  // A missing or broken pointer means the reference set is not trustworthy. Deleting on an
  // incomplete set is how a garbage collector eats the live snapshot, so do nothing instead.
  if (referenced.size === 0) return { removed: [], kept: [] };

  const removed = [];
  const kept = [];
  for (const entry of readdirSync(snapshotsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (referenced.has(entry.name)) {
      kept.push(entry.name);
      continue;
    }
    const directory = path.join(snapshotsRoot, entry.name);
    ensureInside(snapshotsRoot, directory, 'snapshot');
    try {
      rmSync(directory, { recursive: true, force: true });
      removed.push(entry.name);
    } catch {
      // A snapshot another process still holds open is left for the next compile. Reclaiming disk
      // is never worth failing a publish that has already succeeded.
    }
  }
  return { removed, kept };
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function recoverStaleLock(lockPath, staleMs) {
  let owner = null;
  try {
    owner = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    // An invalid lock is only removed after its filesystem age crosses the stale threshold.
  }
  let age;
  try {
    age = Date.now() - statSync(lockPath).mtimeMs;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
  if (age < staleMs || processIsAlive(owner?.pid)) return false;
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return true;
}

export function withMemoryIndexLock(indexRoot, callback, {
  timeoutMs = 30_000,
  pollMs = 25,
  staleMs = 10 * 60_000,
} = {}) {
  mkdirSync(indexRoot, { recursive: true });
  const lockPath = path.join(indexRoot, '.compiler.lock');
  const nonce = randomBytes(12).toString('hex');
  const started = Date.now();
  let descriptor;

  while (descriptor === undefined) {
    try {
      const candidate = openSync(lockPath, 'wx');
      try {
        writeFileSync(candidate, stableJson({ pid: process.pid, nonce, created_at: new Date().toISOString() }));
        descriptor = candidate;
      } catch (error) {
        closeSync(candidate);
        try {
          unlinkSync(lockPath);
        } catch {
          // Preserve the original write failure.
        }
        throw error;
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (recoverStaleLock(lockPath, staleMs)) continue;
      if (Date.now() - started >= timeoutMs) throw new Error(`timed out waiting for memory compiler lock: ${lockPath}`);
      Atomics.wait(sleepArray, 0, 0, pollMs);
    }
  }

  try {
    return callback();
  } finally {
    closeSync(descriptor);
    try {
      const owner = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (owner.nonce === nonce) unlinkSync(lockPath);
    } catch {
      // Never remove a lock that no longer proves ownership by this process.
    }
  }
}
