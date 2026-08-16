import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';

const SCRIPT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INDEX_SCHEMA_PATH = path.join(SCRIPT_DIR, 'memory-index.schema.json');
const QUERY_RESULT_SCHEMA_PATH = path.join(SCRIPT_DIR, 'memory-query-result.schema.json');
const STDIO_REQUEST_SCHEMA_PATH = path.join(SCRIPT_DIR, 'memory-stdio-request.schema.json');
const STDIO_RESPONSE_SCHEMA_PATH = path.join(SCRIPT_DIR, 'memory-stdio-response.schema.json');
const HOOK_REQUEST_SCHEMA_PATH = path.join(SCRIPT_DIR, 'memory-hook-request.schema.json');
const HOOK_CONSUME_REQUEST_SCHEMA_PATH = path.join(SCRIPT_DIR, 'memory-hook-consume-request.schema.json');
const HOOK_RESPONSE_SCHEMA_PATH = path.join(SCRIPT_DIR, 'memory-hook-response.schema.json');
const ARTIFACT_SCHEMA_PATHS = {
  documents: path.join(SCRIPT_DIR, 'memory-documents.schema.json'),
  postings: path.join(SCRIPT_DIR, 'memory-postings.schema.json'),
  exact_map: path.join(SCRIPT_DIR, 'memory-exact-map.schema.json'),
  graph: path.join(SCRIPT_DIR, 'memory-graph.schema.json'),
  ranking: path.join(SCRIPT_DIR, 'memory-ranking.schema.json'),
};
// Snapshots written before the interned postings encoding. Kept readable so the previous-snapshot
// fallback still works across the upgrade window; the store upgrades them in memory on read.
const LEGACY_ARTIFACT_SCHEMA_PATHS = {
  'ownmem-index.postings/v1': path.join(SCRIPT_DIR, 'memory-postings-v1.schema.json'),
};

export const MEMORY_INDEX_SCHEMA = 'ownmem-index/v1';
export const MEMORY_QUERY_RESULT_SCHEMA = 'ownmem-query-result/v1';
export const MEMORY_INDEX_READER_VERSION = 4;

const ajv = new Ajv({ allErrors: true, strict: true });

// Compiling all twelve schemas at import cost 76.7 ms, and every entry point paid the whole bill
// regardless of which ones it used. A CLI recall touches seven (manifest + five artifacts + query
// result) and never the stdio or hook contracts; the hook path is the mirror image. Compiling on
// first use bills each caller only for what it validates -- measured 22.4 ms off the recall path.
//
// The wrapper republishes `errors` after every call because validationMessage reads it off the
// validator, and ajv sets it on the compiled function rather than returning it.
function lazyValidator(schemaPath) {
  let compiled = null;
  const validator = (value) => {
    if (!compiled) compiled = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
    const valid = compiled(value);
    validator.errors = compiled.errors;
    return valid;
  };
  return validator;
}

const validateIndexSchema = lazyValidator(INDEX_SCHEMA_PATH);
const validateQueryResultSchema = lazyValidator(QUERY_RESULT_SCHEMA_PATH);
const validateStdioRequestSchema = lazyValidator(STDIO_REQUEST_SCHEMA_PATH);
const validateStdioResponseSchema = lazyValidator(STDIO_RESPONSE_SCHEMA_PATH);
const validateHookRequestSchema = lazyValidator(HOOK_REQUEST_SCHEMA_PATH);
const validateHookConsumeRequestSchema = lazyValidator(HOOK_CONSUME_REQUEST_SCHEMA_PATH);
const validateHookResponseSchema = lazyValidator(HOOK_RESPONSE_SCHEMA_PATH);
const validateArtifactSchemas = Object.fromEntries(
  Object.entries(ARTIFACT_SCHEMA_PATHS).map(([kind, schemaPath]) => [kind, lazyValidator(schemaPath)]),
);

function validationMessage(errors) {
  return (errors || []).map((error) => {
    if (error.keyword === 'additionalProperties') {
      return `${error.instancePath || '/'} contains unknown field "${error.params.additionalProperty}"`;
    }
    return `${error.instancePath || '/'} ${error.message}`;
  }).join('; ');
}

function validate(validator, value, label) {
  if (!validator(value)) throw new Error(`${label} is invalid: ${validationMessage(validator.errors)}`);
  return value;
}

export function validateMemoryIndexManifest(value) {
  return validate(validateIndexSchema, value, 'memory index manifest');
}

const legacyValidators = new Map();
function legacyArtifactValidator(schemaId) {
  const schemaPath = LEGACY_ARTIFACT_SCHEMA_PATHS[schemaId];
  if (!schemaPath) return null;
  let validator = legacyValidators.get(schemaId);
  if (!validator) {
    validator = lazyValidator(schemaPath);
    legacyValidators.set(schemaId, validator);
  }
  return validator;
}

export function validateMemoryIndexArtifact(kind, value, { schemaId = null } = {}) {
  const legacy = schemaId ? legacyArtifactValidator(schemaId) : null;
  const validator = legacy || validateArtifactSchemas[kind];
  if (!validator) throw new Error(`unknown memory index artifact kind: ${kind}`);
  validate(validator, value, `memory index ${kind} artifact`);
  if (legacy) return value;
  if (kind === 'graph') {
    const forward = new Set(value.edges.map((edge) => `${edge.from}\0${edge.to}\0${edge.kind}`));
    const reverse = new Set();
    for (const target of value.reverse_dependencies) {
      for (const reference of target.references) {
        reverse.add(`${reference.from}\0${target.id}\0${reference.kind}`);
      }
    }
    if (forward.size !== value.edges.length || reverse.size !== value.edges.length
        || [...forward].some((edge) => !reverse.has(edge))) {
      throw new Error('memory index graph artifact is invalid: reverse_dependencies must exactly invert edges');
    }
  }
  return value;
}

export function validateMemoryIndexArtifacts(value) {
  for (const kind of Object.keys(validateArtifactSchemas)) {
    if (!Object.hasOwn(value || {}, kind)) throw new Error(`memory index artifacts are missing ${kind}`);
    validateMemoryIndexArtifact(kind, value[kind]);
  }
  return value;
}

export function validateMemoryQueryResult(value) {
  validate(validateQueryResultSchema, value, 'memory query result');
  if (value.budget.estimated_tokens > value.budget.max_tokens) {
    throw new Error('memory query result is invalid: /budget/estimated_tokens exceeds max_tokens');
  }
  const memoryIds = new Set();
  value.results.forEach((result, index) => {
    if (result.rank !== index + 1) {
      throw new Error(`memory query result is invalid: /results/${index}/rank must equal ${index + 1}`);
    }
    if (memoryIds.has(result.memory_id)) {
      throw new Error(`memory query result is invalid: duplicate memory_id ${result.memory_id}`);
    }
    memoryIds.add(result.memory_id);
  });
  return value;
}

export function validateMemoryStdioRequest(value) {
  return validate(validateStdioRequestSchema, value, 'memory stdio request');
}

export function validateMemoryStdioResponse(value) {
  validate(validateStdioResponseSchema, value, 'memory stdio response');
  if (value.ok) validateMemoryQueryResult(value.result);
  return value;
}

export function validateMemoryHookRequest(value) {
  return validate(validateHookRequestSchema, value, 'memory hook request');
}

export function validateMemoryHookConsumeRequest(value) {
  return validate(validateHookConsumeRequestSchema, value, 'memory hook consumption request');
}

export function validateMemoryHookResponse(value) {
  validate(validateHookResponseSchema, value, 'memory hook response');
  if (value.ok && value.result) validateMemoryQueryResult(value.result);
  return value;
}

function invalidManifestTrigger(manifest) {
  if (manifest === null || manifest === undefined) return 'missing';
  if (manifest.schema !== MEMORY_INDEX_SCHEMA) return 'schema-incompatible';
  if (!validateIndexSchema(manifest)) return 'manifest-invalid';
  if (manifest.compatibility.minimum_reader_version > MEMORY_INDEX_READER_VERSION) {
    return 'schema-incompatible';
  }
  return null;
}

function snapshotSource(manifest, status, rebuildTrigger) {
  return {
    mode: 'snapshot',
    status,
    snapshot_id: manifest.snapshot.id,
    snapshot_schema: manifest.schema,
    degraded: false,
    rebuild_trigger: rebuildTrigger,
    fallback_reason: null,
  };
}

export function decideMemoryIndexRead({
  manifest,
  checksumsValid = true,
  rebuildOutcome = 'not-attempted',
  rebuiltManifest = null,
} = {}) {
  let trigger = invalidManifestTrigger(manifest);
  if (!trigger && !checksumsValid) trigger = 'checksum-mismatch';

  if (!trigger) {
    return { action: 'use-snapshot', trigger: null, source: snapshotSource(manifest, 'ready', null) };
  }
  if (rebuildOutcome === 'not-attempted') return { action: 'rebuild', trigger, source: null };
  if (rebuildOutcome === 'succeeded') {
    validateMemoryIndexManifest(rebuiltManifest);
    if (rebuiltManifest.compatibility.minimum_reader_version > MEMORY_INDEX_READER_VERSION) {
      throw new Error('rebuilt memory index requires a newer reader');
    }
    return {
      action: 'use-snapshot',
      trigger,
      source: snapshotSource(rebuiltManifest, 'rebuilt', trigger),
    };
  }
  if (rebuildOutcome !== 'failed') throw new Error(`unknown rebuild outcome: ${rebuildOutcome}`);
  return {
    action: 'markdown-fallback',
    trigger,
    source: {
      mode: 'markdown-fallback',
      status: 'fallback',
      snapshot_id: manifest?.snapshot?.id || null,
      snapshot_schema: manifest?.schema === MEMORY_INDEX_SCHEMA ? manifest.schema : null,
      degraded: true,
      rebuild_trigger: trigger,
      fallback_reason: 'rebuild-failed',
    },
  };
}
