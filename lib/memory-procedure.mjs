// Procedures: a written-down way of doing something, shown to a reader and never run by this
// system.
//
// Three things about this module are decisions rather than details.
//
//   1. It is advisory by construction. The schema admits one execution mode and it is the advisory
//      playbook, so gaining an executing form means editing the schema and raising its version.
//      That is deliberate: the plan says procedural skills ship first as playbooks that show their
//      steps and preconditions without running them, and a rule that lives in a caller's good
//      intentions is a rule that ends the first time a new caller appears.
//   2. The gate is at the writer, exactly like the candidate queue's. A host adapter or a
//      model-generated playbook will not remember a convention it never read; it will, however,
//      have to go through writeMemoryProcedure.
//   3. Nothing here walks the corpus. There is no producer of procedures in this repository yet,
//      and a gate with no input is the mistake this repository has already made once -- a field and
//      its checks built out in full, then left running against nothing for weeks. So this module
//      answers questions about procedures it is handed and asks none of its own.
//
// The promotion checks at the bottom are the interface the risk matrix reads. They are computed
// from the procedure rather than asserted by whoever proposes it, and each one returns a sentence
// alongside its boolean, because "sandbox_replay_passed was false" is not something a person can
// act on.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { MEMORY_ACTION_RISKS } from './memory-lifecycle.mjs';
import { schemaPath } from './schema-paths.mjs';

export const MEMORY_PROCEDURE_SCHEMA = 'ownmem-procedure/v1';
export const MEMORY_REPLAY_RECORD_SCHEMA = 'ownmem-replay-record/v1';

/**
 * Environments a procedure has to declare as off limits.
 *
 * Both, always. The plan's rule is that a high-risk flow may not be tried out for real in
 * production or in a release, and release is not a synonym for production: a release pipeline can
 * publish artefacts from a machine that serves no traffic at all.
 */
export const PROCEDURE_REQUIRED_FORBIDDEN_ENVIRONMENTS = Object.freeze(['production', 'release']);

/**
 * The promotion evidence checks a procedure can answer.
 *
 * These three names are owned by the promotion policy's closed list and are reproduced here rather
 * than imported, because that module sits a layer above this one. The self-test asserts the two
 * lists agree, which is the only place the two layers can meet.
 */
export const PROCEDURE_PROMOTION_CHECKS = Object.freeze([
  'sandbox_replay_passed',
  'rollback_defined',
  'scope_declared',
]);

/** Where procedures and their replay records live under a memory directory. */
export const MEMORY_PROCEDURE_SUBDIRECTORY = 'procedures';
export const MEMORY_REPLAY_SUBDIRECTORY = 'replays';

/**
 * Version tag mixed into the environment digest.
 *
 * Present so that changing which dimensions the fingerprint covers invalidates old digests loudly
 * rather than letting two different definitions produce colliding sixteen-hex strings.
 */
export const PROCEDURE_ENVIRONMENT_FINGERPRINT_VERSION = 'ownmem-procedure-env/v1';

const ajv = new Ajv({ allErrors: true, strict: true });
let compiledProcedure = null;
let compiledReplayRecord = null;

function validationMessage(errors) {
  return (errors || []).slice(0, 8).map(error => {
    if (error.keyword === 'additionalProperties') {
      return `${error.instancePath || '/'} contains unknown field "${error.params.additionalProperty}"`;
    }
    return `${error.instancePath || '/'} ${error.message}`;
  }).join('; ');
}

function invalid(label, message) {
  throw new Error(`memory ${label} is invalid: ${message}`);
}

/**
 * The environment dimensions a replay is bound to.
 *
 * Two, and the list of what is left out is the substantive part. Evidence in this repository has to
 * survive being moved -- to the other computer, under a different user name, into a different
 * checkout path, after an unrelated commit -- so anything that identifies a machine, a person or a
 * location is excluded: absolute paths, home directory, user name, host name, machine id, cpu
 * count, total memory, architecture, current commit, locale, time zone, and the node patch level.
 * Every one of those would make the fingerprint go stale on a move rather than on a change.
 *
 * What is left are the two dimensions a procedure's steps genuinely stand on. `platform` decides
 * whether a shell step even exists in the same form; `node_major` is the runtime the repository
 * pins a floor for, and a major bump is the one runtime change that routinely alters behaviour.
 * Architecture is the closest call and is out on purpose: where a procedure really is
 * architecture-specific, that belongs in its declared scope, which a reviewer reads, rather than in
 * a digest, which only ever produces an unexplained mismatch.
 *
 * A platform outside the record schema's vocabulary is left as-is rather than folded into an
 * "other" bucket: the comparison still works, and the loud failure lands where a record is written
 * rather than being quietly absorbed.
 */
export function procedureEnvironmentComponents() {
  return {
    platform: process.platform,
    node_major: Number.parseInt(process.versions.node.split('.')[0], 10),
  };
}

export function procedureEnvironmentFingerprint(components = procedureEnvironmentComponents()) {
  const digest = createHash('sha256')
    .update(`${PROCEDURE_ENVIRONMENT_FINGERPRINT_VERSION}\n${components.platform}\n${components.node_major}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
  return { platform: components.platform, node_major: components.node_major, fingerprint: digest };
}

function conditionIds(conditions) {
  return conditions.map(condition => condition.id);
}

/**
 * Every declared identifier in one procedure, grouped by where it was declared.
 *
 * A replay record names postconditions by id, so "was this postcondition actually declared" has to
 * be answerable without re-walking the object at each caller.
 */
export function memoryProcedureConditionIds(procedure) {
  return {
    preconditions: conditionIds(procedure.preconditions),
    postconditions: conditionIds(procedure.postconditions),
    rollback_verification: conditionIds(procedure.rollback.verification),
    failure_samples: procedure.replay.failure_samples.map(sample => sample.id),
  };
}

function assertOrderedSteps(steps, label) {
  steps.forEach((step, index) => {
    if (step.index !== index + 1) {
      invalid('procedure', `${label} step at position ${index + 1} declares index ${step.index}; ordered steps must run 1..n with no gap`);
    }
  });
}

function assertToolsAllowed(steps, allowed, label) {
  for (const step of steps) {
    if (!allowed.includes(step.tool)) {
      invalid('procedure', `${label} step ${step.index} uses the ${step.tool} tool, which is not in allowed_tools`);
    }
  }
}

/**
 * Schema first, then the constraints JSON Schema cannot express.
 *
 * The cross-object rules are here rather than duplicated into every producer for the same reason
 * the schema is: a rule that has to be remembered is a rule that holds until someone new writes the
 * next producer. Two of them compare sibling arrays (a step's tool against allowed_tools, an
 * idempotency guard against the declared preconditions) and one compares a number against a list
 * length (a budget that cannot afford its own playbook), none of which a schema can see.
 */
export function validateMemoryProcedure(procedure) {
  if (!compiledProcedure) {
    compiledProcedure = ajv.compile(JSON.parse(readFileSync(schemaPath('procedure', 'procedure.schema.json'), 'utf8')));
  }
  if (!compiledProcedure(procedure)) invalid('procedure', validationMessage(compiledProcedure.errors));

  if (!MEMORY_ACTION_RISKS.includes(procedure.risk)) {
    invalid('procedure', `risk ${procedure.risk} is not one of ${MEMORY_ACTION_RISKS.join(', ')}`);
  }

  assertOrderedSteps(procedure.steps, 'procedure');
  assertToolsAllowed(procedure.steps, procedure.allowed_tools, 'procedure');
  assertOrderedSteps(procedure.rollback.steps, 'rollback');
  assertToolsAllowed(procedure.rollback.steps, procedure.allowed_tools, 'rollback');

  const ids = memoryProcedureConditionIds(procedure);
  const declared = [...ids.preconditions, ...ids.postconditions, ...ids.rollback_verification];
  const duplicates = declared.filter((id, index) => declared.indexOf(id) !== index);
  if (duplicates.length > 0) {
    // Ids are global within a procedure because a replay record names them without saying which
    // list they came from. Two conditions sharing one id would make that reference ambiguous, and
    // the ambiguity would resolve silently in whichever direction the lookup happened to be written.
    invalid('procedure', `condition id ${[...new Set(duplicates)].join(', ')} is declared more than once; ids are referenced by replay records and have to be unique across the procedure`);
  }
  const duplicateSamples = ids.failure_samples.filter((id, index) => ids.failure_samples.indexOf(id) !== index);
  if (duplicateSamples.length > 0) {
    invalid('procedure', `failure sample id ${[...new Set(duplicateSamples)].join(', ')} is declared more than once`);
  }

  if (procedure.idempotency.kind === 'guarded') {
    if (!procedure.idempotency.guard) {
      invalid('procedure', 'a guarded procedure has to name the precondition that stops the second run');
    }
    if (!ids.preconditions.includes(procedure.idempotency.guard)) {
      invalid('procedure', `idempotency guard ${procedure.idempotency.guard} is not a declared precondition`);
    }
  } else if (procedure.idempotency.guard !== null) {
    invalid('procedure', `idempotency kind ${procedure.idempotency.kind} carries a guard; only a guarded procedure has one`);
  }

  if (procedure.rollback.strategy === 'steps') {
    if (procedure.rollback.steps.length === 0) invalid('procedure', 'a rollback strategy of steps has to declare at least one step');
    if (procedure.rollback.verification.length === 0) {
      invalid('procedure', 'rollback steps nobody checks are the same as no rollback: declare at least one verification');
    }
  } else if (procedure.rollback.steps.length > 0 || procedure.rollback.verification.length > 0) {
    invalid('procedure', 'an irreversible rollback cannot carry steps or verification');
  }

  if (procedure.budget.max_steps < procedure.steps.length) {
    invalid('procedure', `budget.max_steps is ${procedure.budget.max_steps} but the playbook declares ${procedure.steps.length} steps`);
  }

  const overlap = procedure.allowed_environments.filter(name => procedure.forbidden_environments.includes(name));
  if (overlap.length > 0) {
    invalid('procedure', `environment ${overlap.join(', ')} is both allowed and forbidden`);
  }

  if (procedure.supersedes.some(entry => entry.procedure_id === procedure.procedure_id && entry.version >= procedure.version)) {
    invalid('procedure', 'a procedure cannot supersede itself or a later version of itself');
  }
  return procedure;
}

export function validateMemoryReplayRecord(record) {
  if (!compiledReplayRecord) {
    compiledReplayRecord = ajv.compile(JSON.parse(readFileSync(schemaPath('procedure', 'replay-record.schema.json'), 'utf8')));
  }
  if (!compiledReplayRecord(record)) invalid('replay record', validationMessage(compiledReplayRecord.errors));
  const ids = record.postconditions_checked.map(entry => entry.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    invalid('replay record', `postcondition ${[...new Set(duplicates)].join(', ')} is reported more than once`);
  }
  return record;
}

/**
 * Where a procedure file lives, derived rather than supplied.
 *
 * The caller never hands over a path. `procedure_id` is pattern-bound to lower-case words, so it
 * cannot contain a separator or a dot segment, and the write below therefore has no path to escape
 * the memory directory -- the safety check is the id's pattern, enforced by the schema, instead of
 * a second sanitizer that each caller has to remember to run.
 */
export function memoryProcedureRelativePath(memoryDir, procedureId) {
  return path.posix.join(memoryDir, MEMORY_PROCEDURE_SUBDIRECTORY, `${procedureId}.json`);
}

export function memoryProcedureFile({ root, memoryDir = '.ownmem', procedureId }) {
  return path.resolve(root, memoryDir, MEMORY_PROCEDURE_SUBDIRECTORY, `${procedureId}.json`);
}

/**
 * The one door a procedure gets written through.
 *
 * Procedures are committed files, not local telemetry: a replay is evidence, and evidence that
 * lives only in one machine's scratch directory is evidence nobody else can re-check. So this
 * writes with ordinary permissions and returns the path, and the caller commits it.
 */
export function writeMemoryProcedure({ root, memoryDir = '.ownmem', procedure }) {
  validateMemoryProcedure(procedure);
  const file = memoryProcedureFile({ root, memoryDir, procedureId: procedure.procedure_id });
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(procedure, null, 2)}\n`, 'utf8');
  return file;
}

/**
 * Reading validates too.
 *
 * A file on disk is not a trusted producer: it can be edited by hand, by a merge, or by a process
 * that never went through the writer. Validating on the way in means a malformed procedure is a
 * loud failure at the reader rather than an object with a missing rollback flowing into a
 * promotion check that reads the absence as "false" and blocks for the wrong reason.
 */
export function readMemoryProcedure({ root, memoryDir = '.ownmem', procedureId }) {
  const file = memoryProcedureFile({ root, memoryDir, procedureId });
  if (!existsSync(file)) throw new Error(`memory procedure ${procedureId} was not found at ${file}`);
  return validateMemoryProcedure(JSON.parse(readFileSync(file, 'utf8')));
}

export function memoryReplayRecordRelativePath(memoryDir, replayId) {
  return path.posix.join(memoryDir, MEMORY_REPLAY_SUBDIRECTORY, `${replayId}.json`);
}

export function memoryReplayRecordFile({ root, memoryDir = '.ownmem', replayId }) {
  return path.resolve(root, memoryDir, MEMORY_REPLAY_SUBDIRECTORY, `${replayId}.json`);
}

/**
 * The one door a replay record gets written through, for the same reason procedures have one.
 *
 * The location comes from `replay_id`, which the schema pins to sixty-four hex characters, so no
 * caller-supplied string ever reaches the filesystem. A record is committed alongside the procedure
 * it covers: an evidence anchor that only resolves on the machine that produced it is not evidence
 * anyone else can re-check, and this repository's rule is that evidence stays portable across
 * machines.
 */
export function writeMemoryReplayRecord({ root, memoryDir = '.ownmem', record }) {
  validateMemoryReplayRecord(record);
  const file = memoryReplayRecordFile({ root, memoryDir, replayId: record.replay_id });
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return file;
}

function scopeIsUniversal(scope) {
  const only = (list, value) => list.length === 1 && list[0] === value;
  return only(scope.applies_to, 'any') && only(scope.platforms, 'any');
}

/**
 * What a procedure contributes to a promotion decision.
 *
 * Three booleans, each with the sentence behind it, because the promotion policy's own contract is
 * that "why was this not automatic" never requires reading a module. Two notes on where the lines
 * fall:
 *
 *   - `sandbox_replay_passed` demands a *clean* replay verification, so a fixture that drifted
 *     fails it even though the same drift is only advisory during recall. The two answer different
 *     questions. Recall asks whether a lesson is still worth showing, and hiding it for a moved
 *     anchor costs more than showing it; promotion asks whether to grant something new on the
 *     strength of that anchor, and there the answer to "the input has changed since" is no.
 *   - `scope_declared` is false for a procedure whose scope is `any` everywhere. A schema can force
 *     the field to be present but not to say anything, and a scope of everything is the exact
 *     reading the check exists to prevent: that "it worked" may not be read as "it works anywhere".
 */
export function promotionEvidenceFromProcedure(procedure, { replay = null } = {}) {
  validateMemoryProcedure(procedure);
  const checks = {};
  const reasons = {};
  const record = (name, value, reason) => {
    checks[name] = value;
    reasons[name] = reason;
  };

  const detail = replay?.replay || null;
  if (!replay) {
    record('sandbox_replay_passed', false,
      'No replay verification was supplied: declaring a fixture is not the same as having replayed against it.');
  } else if (!detail) {
    record('sandbox_replay_passed', false,
      'The supplied verification is not a replay check, so it cannot say whether this procedure was replayed.');
  } else if (detail.procedure_id !== procedure.procedure_id || detail.procedure_version !== procedure.version) {
    record('sandbox_replay_passed', false,
      `The replay covered ${detail.procedure_id} version ${detail.procedure_version}, not ${procedure.procedure_id} version ${procedure.version}.`);
  } else if (replay.valid !== true) {
    record('sandbox_replay_passed', false,
      `The replay evidence did not verify cleanly: ${replay.reason} (${replay.severity}).`);
  } else {
    const held = new Set((detail.postconditions_checked || [])
      .filter(entry => entry.outcome === 'held')
      .map(entry => entry.id));
    const missing = memoryProcedureConditionIds(procedure).postconditions.filter(id => !held.has(id));
    if (missing.length > 0) {
      record('sandbox_replay_passed', false,
        `The replay left ${missing.join(', ')} undecided; every declared postcondition has to hold before a replay counts as passed.`);
    } else {
      record('sandbox_replay_passed', true,
        `Replay ${detail.replay_id.slice(0, 12)} ran in the ${detail.environment_recorded.name} environment and every declared postcondition held.`);
    }
  }

  if (procedure.rollback.strategy === 'steps') {
    record('rollback_defined', true,
      `Rollback declares ${procedure.rollback.steps.length} step(s) and ${procedure.rollback.verification.length} verification(s).`);
  } else {
    record('rollback_defined', false,
      `Rollback is declared irreversible: ${procedure.rollback.reason}. There is nothing to undo this with, so it cannot be promoted.`);
  }

  if (scopeIsUniversal(procedure.scope)) {
    record('scope_declared', false,
      'The scope is any on every platform, which declares nothing: a replay that worked here would then read as working everywhere.');
  } else {
    record('scope_declared', true,
      `Scope is ${procedure.scope.applies_to.join(', ')} on ${procedure.scope.platforms.join(', ')}.`);
  }

  return { checks, reasons };
}
