import { normalizeMemoryText } from './memory-tokenizer.mjs';

export const MEMORY_LIFECYCLE_STATES = Object.freeze([
  'observed',
  'candidate',
  'shadow',
  'advisory',
  'active',
  'stale',
  'deprecated',
  'rejected',
  'superseded',
]);

export const MEMORY_LOGICAL_TYPES = Object.freeze([
  'normative',
  'procedural',
  'factual',
  'diagnostic',
  'preference',
  'feedback',
]);

// R0 is reserved and has no producer here on purpose, which reads as a dead enum member until you
// know what the two things classify. memoryContentActionRisk below grades what a *memory* is about,
// and no memory is metadata-only; R0 grades a *promotion candidate* whose blast radius is metadata alone
// (a suggested trigger, a duplicate hint), and the policy that emits those does not exist yet.
// Removing it would delete the one level the promotion design starts from.
export const MEMORY_ACTION_RISKS = Object.freeze(['R0', 'R1', 'R2', 'R3', 'R4', 'R5']);

const TERMINAL_STATES = new Set(['deprecated', 'rejected', 'superseded']);
const TRANSITIONS = Object.freeze({
  observed: new Set(['candidate', 'rejected']),
  candidate: new Set(['shadow', 'advisory', 'rejected']),
  shadow: new Set(['advisory', 'rejected']),
  advisory: new Set(['active', 'stale', 'deprecated', 'rejected', 'superseded']),
  active: new Set(['stale', 'deprecated', 'superseded']),
  stale: new Set(['advisory', 'active', 'deprecated', 'rejected', 'superseded']),
  deprecated: new Set(),
  rejected: new Set(),
  superseded: new Set(),
});

const DESTRUCTIVE_ACTION = /\b(?:drop|delete|erase|purge|destroy|force[- ]?remove)\b|删除|清空|销毁|强删/iu;
const EXTERNAL_ACTION = /\b(?:publish|deploy|push|release|send|upload|charge|bill|purchase)\b|发布|部署|推送|发送|上传|付费|购买|扣费|上线/iu;
const SECURITY_ACTION = /\b(?:credential|secret|token|password|permission|entitlement|auth(?:entication|orization)?)\b|凭据|密钥|密码|权限|鉴权|授权/iu;
const PROCEDURE_TEXT = /\b(?:step|first|then|finally|run|execute|command|workflow|procedure)\b|步骤|先.*再|运行|执行|流程|命令/iu;
// Prompt-injection detection, deliberately narrow.
//
// The signal is an imperative aimed at the host instruction layer -- "ignore the system prompt" --
// not the mere co-occurrence of two common words. The previous pattern accepted any one of
// `system|developer|instruction|policy|safety`, and its Chinese branch accepted the standalone
// words for "rule" and "safety". Both are everyday vocabulary in engineering prose, so measured on
// this corpus the pattern permanently blocked 4 memories out of 356 and caught no real attack:
// the memory describing this very defence, a note that a JSON decoder ignores unknown keys, and
// two ordinary uses of the verb "overwrite".
//
// So both halves now require all three parts adjacent: the verb, the addressed layer
// (system/developer/user), and the artefact it names (instruction/prompt/message). Precision is
// bought here, in the matcher, rather than by softening the consequence: unlike evidence drift, a
// memory that instructs the host is a possible poisoning, whose blast radius is privilege
// escalation rather than outdated advice, so it stays a hard block.
//
// The same matcher now also reads the query, through memoryTextOverridesInstructions: a memory
// body was never the only place an override can arrive, and until it was applied to both surfaces
// an injection typed straight into the query was scored as ordinary natural language. Being narrow
// is what makes that reuse safe, so widening it would cost twice.
const INSTRUCTION_OVERRIDE = /\b(?:ignore|override|bypass|disregard)\b.{0,24}?\b(?:system|developer|user)\b[\s-]{0,3}(?:instructions?|prompts?|messages?)\b|(?:忽略|无视|绕过|覆盖).{0,6}?(?:系统|开发者|用户).{0,4}?(?:指令|提示词|消息)/iu;

export function memoryLifecycleTransitionAllowed(from, to) {
  // A content-bound import receipt may establish the first active state for an existing corpus.
  // Later changes still have to follow the normal graph and preserve the rollback predecessor.
  if (from === null) return ['observed', 'candidate', 'advisory', 'active'].includes(to);
  if (!MEMORY_LIFECYCLE_STATES.includes(from) || !MEMORY_LIFECYCLE_STATES.includes(to)) return false;
  if (from === to) return true;
  return TRANSITIONS[from].has(to);
}

export function assertMemoryLifecycleTransition(from, to) {
  if (!memoryLifecycleTransitionAllowed(from, to)) {
    throw new Error(`memory lifecycle transition is not allowed: ${from ?? 'null'} -> ${to}`);
  }
}

export function memoryLogicalType(record) {
  const type = record.metadata.type;
  if (type === 'preference') return 'preference';
  if (type === 'feedback') return 'feedback';
  if (type === 'decision-pointer') return 'normative';
  if (type === 'debug') return 'diagnostic';
  return PROCEDURE_TEXT.test(`${record.description}\n${record.body}`) ? 'procedural' : 'factual';
}

export function memoryContentActionRisk(record) {
  const text = normalizeMemoryText(`${record.description}\n${record.body}`);
  if (DESTRUCTIVE_ACTION.test(text) && SECURITY_ACTION.test(text)) return 'R5';
  if (DESTRUCTIVE_ACTION.test(text) || EXTERNAL_ACTION.test(text)) return 'R4';
  if (SECURITY_ACTION.test(text)) return 'R3';
  if (record.metadata.type === 'preference' || record.metadata.type === 'feedback') return 'R2';
  return 'R1';
}

/**
 * The override matcher on a bare string, for surfaces that have no record to hand -- the query
 * being the one that matters. Exported so the query gate and the memory gate cannot drift into two
 * different definitions of the same attack.
 */
export function memoryTextOverridesInstructions(text) {
  return INSTRUCTION_OVERRIDE.test(text);
}

export function memoryContainsInstructionOverride(record) {
  return memoryTextOverridesInstructions(`${record.description}\n${record.body}`);
}

export function memoryLifecycleInjectable(state) {
  return state === 'advisory' || state === 'active';
}

export function memoryLifecycleTerminal(state) {
  return TERMINAL_STATES.has(state);
}
