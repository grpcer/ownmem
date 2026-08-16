import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { parseMemoryContent } from './memory-schema.mjs';
import {
  readPublishedMemorySnapshot,
  sha256,
  stableJson,
} from './memory-index-store.mjs';
import {
  DEFAULT_MEMORY_EMBEDDING_DIRECTORY,
  memoryEmbeddingPaths,
  validateMemoryEmbeddingConfig,
} from './memory-embedding-provider.mjs';

export const MEMORY_EMBEDDING_VECTORS_SCHEMA = 'ownmem-embedding-vectors/v1';
export const MEMORY_EMBEDDING_TEXT_RECIPE = 'v1';
export const MEMORY_EMBEDDING_BODY_CHAR_LIMIT = 1500;

const SCRIPT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VECTOR_SCHEMA_PATH = path.join(SCRIPT_DIR, 'memory-embedding-vectors.schema.json');
const vectorSchema = JSON.parse(readFileSync(VECTOR_SCHEMA_PATH, 'utf8'));
const validateVectorSchema = new Ajv({ allErrors: true, strict: true }).compile(vectorSchema);

function schemaErrorMessage(error) {
  const pointer = error.instancePath || '/';
  if (error.keyword === 'additionalProperties') {
    return `${pointer} contains unknown field "${error.params.additionalProperty}"`;
  }
  if (error.keyword === 'required') {
    return `${pointer} is missing required field "${error.params.missingProperty}"`;
  }
  return `${pointer} ${error.message}`;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalBase64(value) {
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
}

export function encodeFloat32Vector(vector) {
  if (!(vector instanceof Float32Array) && !Array.isArray(vector)) {
    throw new Error('memory embedding vector must be a Float32Array or number array');
  }
  const values = vector instanceof Float32Array ? vector : Float32Array.from(vector);
  if (values.length === 0) throw new Error('memory embedding vector must not be empty');
  const buffer = Buffer.allocUnsafe(values.length * 4);
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) throw new Error('memory embedding vector contains a non-finite value');
    buffer.writeFloatLE(values[index], index * 4);
  }
  return buffer.toString('base64');
}

export function decodeFloat32Vector(value, dimensions) {
  const buffer = canonicalBase64(value);
  if (!buffer || buffer.byteLength !== dimensions * 4) {
    throw new Error(`memory embedding vector must contain exactly ${dimensions} float32 values`);
  }
  const vector = new Float32Array(dimensions);
  for (let index = 0; index < dimensions; index += 1) {
    vector[index] = buffer.readFloatLE(index * 4);
    if (!Number.isFinite(vector[index])) throw new Error('memory embedding vector contains a non-finite value');
  }
  return vector;
}

export function validateMemoryEmbeddingArtifact(value) {
  if (!validateVectorSchema(value)) {
    const details = (validateVectorSchema.errors || []).slice(0, 5).map(schemaErrorMessage).join('; ');
    throw new Error(`memory embedding artifact is invalid: ${details}`);
  }
  if (!Number.isFinite(Date.parse(value.built_at))) {
    throw new Error('memory embedding artifact built_at must be a real ISO timestamp');
  }
  for (const [documentId, entry] of Object.entries(value.entries)) {
    try {
      decodeFloat32Vector(entry.vector_b64, value.dimensions);
    } catch (error) {
      throw new Error(`memory embedding artifact entry ${documentId} is invalid: ${error.message}`);
    }
  }
  return value;
}

function modelSlug(config) {
  const readable = `${config.provider}-${config.model}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'embedding';
  return `${readable}-${sha256(`${config.provider}\0${config.base_url}\0${config.model}`).slice(0, 12)}`;
}

export function memoryEmbeddingArtifactPath({
  root,
  directory = DEFAULT_MEMORY_EMBEDDING_DIRECTORY,
  config,
} = {}) {
  validateMemoryEmbeddingConfig(config);
  return path.join(memoryEmbeddingPaths({ root, directory }).vectors, `${modelSlug(config)}.json`);
}

function atomicJson(file, value) {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.tmp-${process.pid}-${randomBytes(8).toString('hex')}`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, stableJson(value), 'utf8');
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function readMemoryEmbeddingArtifact(options = {}) {
  const file = memoryEmbeddingArtifactPath(options);
  if (!existsSync(file)) return null;
  let value;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`memory embedding artifact is unreadable: ${error.message}`);
  }
  return validateMemoryEmbeddingArtifact(value);
}

/**
 * Local vectors are a rebuildable derived cache, not a source of truth. A file written under a
 * retired schema name, or truncated mid-write, must not make reads fail hard: the build reads the
 * existing artifact first, so a hard failure there means the bad file can never be overwritten and
 * only a manual delete recovers.
 *
 * An unreadable file is therefore reported as "never built" so the build heals it with a full
 * rebuild. The reason travels back in `unusable` for the caller to surface — it is never swallowed.
 * The recall hot path still uses readMemoryEmbeddingArtifact, which keeps artifact-invalid and
 * artifact-missing as distinct degradation reasons.
 */
export function readUsableMemoryEmbeddingArtifact(options = {}) {
  const file = memoryEmbeddingArtifactPath(options);
  if (!existsSync(file)) return { artifact: null, unusable: null };
  try {
    return { artifact: readMemoryEmbeddingArtifact(options), unusable: null };
  } catch (error) {
    return { artifact: null, unusable: String(error?.message || error) };
  }
}

export function writeMemoryEmbeddingArtifact(options = {}, value) {
  validateMemoryEmbeddingArtifact(value);
  const file = memoryEmbeddingArtifactPath(options);
  atomicJson(file, value);
  return file;
}

function readHookLines(root, hooks) {
  const linesByPath = new Map();
  return hooks.map((hook) => {
    let lines = linesByPath.get(hook.path);
    if (!lines) {
      lines = readFileSync(path.resolve(root, hook.path), 'utf8').split(/\r?\n/);
      linesByPath.set(hook.path, lines);
    }
    const line = lines[hook.line - 1];
    if (!line || sha256(line.trim()) !== hook.sha256) {
      throw new Error(`memory embedding L2 hook changed since snapshot: ${hook.path}:${hook.line}`);
    }
    return line.trim();
  });
}

function firstCodePoints(value, limit) {
  return [...String(value || '')].slice(0, limit).join('');
}

export function createMemoryEmbeddingText({
  description,
  triggers,
  hooks,
  body,
  bodyCharLimit = MEMORY_EMBEDDING_BODY_CHAR_LIMIT,
} = {}) {
  if (!Number.isInteger(bodyCharLimit) || bodyCharLimit < 1) {
    throw new Error('memory embedding body character limit must be a positive integer');
  }
  return [
    `description:\n${String(description || '').trim()}`,
    `triggers:\n${(triggers || []).map((item) => `- ${String(item).trim()}`).join('\n')}`,
    `l2_hooks:\n${(hooks || []).map((item) => String(item).trim()).join('\n')}`,
    `body:\n${firstCodePoints(String(body || '').trim(), bodyCharLimit)}`,
  ].join('\n\n');
}

export function loadMemoryEmbeddingCorpus({
  root,
  indexDirectory = '.local-test/memory-index',
  bodyCharLimit = MEMORY_EMBEDDING_BODY_CHAR_LIMIT,
} = {}) {
  if (!root) throw new Error('memory embedding corpus requires a repository root');
  const absoluteRoot = path.resolve(root);
  const snapshot = readPublishedMemorySnapshot({
    indexRoot: path.resolve(absoluteRoot, indexDirectory),
    allowPrevious: false,
  });
  const documents = snapshot.artifacts.documents.documents.map((document) => {
    const sourcePath = path.resolve(absoluteRoot, document.path);
    const source = readFileSync(sourcePath);
    if (sha256(source) !== document.source_sha256) {
      throw new Error(`memory embedding topic changed since snapshot: ${document.path}`);
    }
    const parsed = parseMemoryContent(source.toString('utf8'), {
      source: document.path,
      fileName: path.basename(document.path),
      active: true,
    });
    if (!parsed.record || parsed.issues.some((issue) => issue.level === 'error')) {
      throw new Error(`memory embedding topic no longer matches schema: ${document.path}`);
    }
    const text = createMemoryEmbeddingText({
      description: parsed.record.description,
      triggers: parsed.record.metadata.triggers,
      hooks: readHookLines(absoluteRoot, document.provenance.l2_hooks),
      body: parsed.body,
      bodyCharLimit,
    });
    return {
      document_id: document.id,
      path: document.path,
      content_sha256: sha256(text),
      text,
    };
  }).sort((left, right) => compareText(left.document_id, right.document_id));
  return {
    schema: 'ownmem-embedding-corpus/v1',
    snapshot_id: snapshot.manifest.snapshot.id,
    text_recipe: MEMORY_EMBEDDING_TEXT_RECIPE,
    documents,
  };
}

export function reconcileMemoryEmbeddingArtifact({ config, corpus, artifact }) {
  validateMemoryEmbeddingConfig(config);
  if (!corpus || corpus.schema !== 'ownmem-embedding-corpus/v1' || !Array.isArray(corpus.documents)) {
    throw new Error('memory embedding corpus is invalid');
  }
  if (artifact) validateMemoryEmbeddingArtifact(artifact);
  const requiresFullRebuild = !artifact
    || artifact.provider !== config.provider
    || artifact.model !== config.model
    || artifact.text_recipe !== corpus.text_recipe
    || (config.dimensions !== null && artifact.dimensions !== config.dimensions);
  const currentIds = new Set(corpus.documents.map((document) => document.document_id));
  const pending = requiresFullRebuild
    ? [...corpus.documents]
    : corpus.documents.filter((document) => (
      artifact.entries[document.document_id]?.content_sha256 !== document.content_sha256
    ));
  const deleted = requiresFullRebuild
    ? []
    : Object.keys(artifact.entries).filter((documentId) => !currentIds.has(documentId)).sort(compareText);
  return {
    mode: requiresFullRebuild ? 'full' : pending.length || deleted.length ? 'incremental' : 'unchanged',
    requires_full_rebuild: requiresFullRebuild,
    snapshot_changed: Boolean(artifact && artifact.corpus_snapshot_id !== corpus.snapshot_id),
    total: corpus.documents.length,
    fresh: corpus.documents.length - pending.length,
    stale: pending.length,
    deleted: deleted.length,
    pending,
    deleted_document_ids: deleted,
  };
}

export function createMemoryEmbeddingArtifact({
  config,
  corpus,
  dimensions,
  entries,
  builtAt = new Date(),
} = {}) {
  validateMemoryEmbeddingConfig(config);
  const artifact = {
    schema: MEMORY_EMBEDDING_VECTORS_SCHEMA,
    provider: config.provider,
    model: config.model,
    dimensions,
    text_recipe: corpus.text_recipe,
    built_at: builtAt.toISOString(),
    corpus_snapshot_id: corpus.snapshot_id,
    entries: Object.fromEntries(Object.entries(entries).sort(([left], [right]) => compareText(left, right))),
  };
  return validateMemoryEmbeddingArtifact(artifact);
}

export function cosineSimilarity(left, right) {
  if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length || left.length === 0) {
    throw new Error('cosine similarity requires equal non-empty Float32Array vectors');
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function topKMemoryEmbeddingMatches(artifact, queryVector, {
  limit = 50,
  allowedDocumentIds = null,
} = {}) {
  validateMemoryEmbeddingArtifact(artifact);
  if (!(queryVector instanceof Float32Array) || queryVector.length !== artifact.dimensions) {
    throw new Error(`memory embedding query vector must have ${artifact.dimensions} dimensions`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('memory embedding Top-K limit must be between 1 and 100');
  }
  if (allowedDocumentIds !== null && !(allowedDocumentIds instanceof Set)) {
    throw new Error('memory embedding allowedDocumentIds must be a Set or null');
  }
  return Object.entries(artifact.entries)
    .filter(([documentId]) => allowedDocumentIds === null || allowedDocumentIds.has(documentId))
    .map(([documentId, entry]) => {
      const similarity = cosineSimilarity(queryVector, decodeFloat32Vector(entry.vector_b64, artifact.dimensions));
      return {
        document_id: documentId,
        score: Math.max(0, Math.min(1, (similarity + 1) / 2)),
      };
    }).sort((left, right) => right.score - left.score || compareText(left.document_id, right.document_id)).slice(0, limit);
}
