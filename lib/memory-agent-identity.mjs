/**
 * Which coding agent produced this event.
 *
 * `surface` and `agent` are two independent questions and are kept as two fields. The surface is
 * the entry point -- a hook that fires on every tool call, a command line someone typed, an MCP
 * call -- and it decides how an abstain rate should be read. The agent is who was asking. Folding
 * them into one enum (`claude-hook`, `grok-hook`, `codex-hook`, ...) was the original mistake: the
 * value count multiplies, and no consumer can then aggregate "all hook recalls" or "everything
 * Codex did" without string surgery.
 *
 * Detection is three layers, and a declaration outranks a guess:
 *
 *   1. Declaration. Every host's hook configuration passes `--host <name>`, which lands here as
 *      `declaredHost`. Codex documents that it injects no `CODEX_*` variable into hook processes,
 *      so for that host the declaration is the only thing that exists.
 *   2. Host-specific hook markers override the declaration. grok reads the Claude hook
 *      configuration through a compatibility layer, so it arrives carrying `--host claude` that it
 *      never wrote; the `GROK_*` variables it sets on each hook process are the truth.
 *   3. Environment sniffing, innermost host first, for command-line calls that carry no
 *      declaration. Order matters: launching `codex` from inside a Claude session produces a child
 *      that has both `CODEX_SESSION_ID` and `CLAUDECODE=1`, so checking `CLAUDE*` first would file
 *      every nested Codex and grok run under Claude.
 *
 * When markers for more than one host are present the result is still decided by the order above,
 * but `nested` records that the environment was ambiguous. Analysis can then drop those rows
 * instead of trusting a coin flip -- the point of this module is that nothing is ever guessed
 * silently.
 */

/** Every agent this build can name. `unknown` is a bare shell, not a placeholder for a new host. */
export const MEMORY_AGENTS = Object.freeze(['claude', 'grok', 'codex', 'unknown']);

/** Hosts a `--host` declaration may name. `unknown` cannot be declared; it is only ever inferred. */
export const MEMORY_DECLARABLE_AGENTS = Object.freeze(['claude', 'grok', 'codex']);

/**
 * Carries a resolved declaration to child processes. The hook daemon and the resident recall
 * process it spawns are started by one host but outlive that single hook invocation, and neither
 * of them can see the `--host` flag the parent parsed.
 */
export const MEMORY_AGENT_ENV = 'OWNMEM_AGENT';

function hasGrokMarker(env) {
  return Boolean(env.GROK_HOOK_EVENT || env.GROK_SESSION_ID);
}

function hasCodexMarker(env) {
  return Boolean(env.CODEX_SESSION_ID || env.CODEX_THREAD_ID);
}

// `CLAUDE_PROJECT_DIR` is deliberately absent: grok sets it as a compatibility alias, so treating
// it as a Claude marker would file every grok run as an ambiguous Claude/grok environment.
function hasClaudeMarker(env) {
  return env.CLAUDECODE === '1' || String(env.AI_AGENT || '').startsWith('claude-code');
}

function normalizeDeclaration(value) {
  const name = String(value || '').trim().toLowerCase();
  return MEMORY_DECLARABLE_AGENTS.includes(name) ? name : null;
}

/**
 * Resolve who is asking. Pure: everything it reads arrives as an argument, so a test can describe
 * any host combination without touching the real environment.
 *
 * @param {{ declaredHost?: string|null, env?: Record<string, string|undefined> }} [options]
 * @returns {{ agent: string, source: 'declared'|'hook-marker'|'env'|'none', nested: boolean, markers: string[] }}
 */
export function resolveAgentIdentity({ declaredHost = null, env = process.env } = {}) {
  const environment = env || {};
  const markers = [];
  if (hasGrokMarker(environment)) markers.push('grok');
  if (hasCodexMarker(environment)) markers.push('codex');
  if (hasClaudeMarker(environment)) markers.push('claude');
  const nested = markers.length >= 2;
  const declared = normalizeDeclaration(declaredHost) || normalizeDeclaration(environment[MEMORY_AGENT_ENV]);

  // Layer 2 first: a grok marker is written by grok itself and outranks a declaration it inherited.
  if (markers.includes('grok')) return { agent: 'grok', source: 'hook-marker', nested, markers };
  if (declared) return { agent: declared, source: 'declared', nested, markers };
  if (markers.includes('codex')) return { agent: 'codex', source: 'env', nested, markers };
  if (markers.includes('claude')) return { agent: 'claude', source: 'env', nested, markers };
  return { agent: 'unknown', source: 'none', nested, markers };
}

let processIdentity = null;

/**
 * The identity of this process, resolved once. Cached because every observability event asks for
 * it and the answer cannot change after the entry point has parsed its arguments.
 */
export function currentAgentIdentity(env = process.env) {
  if (!processIdentity) processIdentity = resolveAgentIdentity({ env });
  return processIdentity;
}

/**
 * Pin this process to a resolved identity and publish it to future children. Entry points call
 * this after parsing `--host`, before anything can emit an event.
 */
export function setProcessAgentIdentity(identity) {
  if (!identity || !MEMORY_AGENTS.includes(identity.agent)) {
    throw new Error(`agent identity must name one of: ${MEMORY_AGENTS.join(', ')}`);
  }
  processIdentity = identity;
  if (identity.agent !== 'unknown') process.env[MEMORY_AGENT_ENV] = identity.agent;
  return identity;
}

/** Drop the cache. Only tests need this; a real process resolves its identity exactly once. */
export function resetProcessAgentIdentity() {
  processIdentity = null;
}
