// Host tool events, reduced to the smallest shape that can answer "did this command stop failing?".
//
// This is the G2 collection surface: "a stable failing command starts passing" is one of the two
// strong signals the plan names, and until now it had no producer at all -- the host's PostToolUse
// matcher only covered Edit|Write, so command outcomes were never observed. The signal is what a
// debug lesson is made of: something was red, a bounded set of actions happened, it went green.
//
// Everything here is subtractive. A command line is the single most likely place for a secret,
// a customer path or a hostname to appear, so no raw command, stdout or stderr is ever written:
// what leaves this module is a program name drawn from a fixed list, a keyed hash that only says
// "the same command as before", an exit code, and a duration. The hash is keyed with the machine's
// local HMAC key, so it does not survive being copied to another machine and cannot be reversed
// into the command by anyone holding the file.

import { createHash } from 'node:crypto';

/**
 * Programs whose names may be recorded in the clear. The list is what makes the field safe: a name
 * outside it becomes `other`, so a one-off binary with a revealing name -- a client's tool, an
 * internal service, a path-like invocation -- never reaches the ledger. Membership is about the
 * name disclosing nothing, not about the program being important.
 */
const PROGRAM_ALLOWLIST = new Set([
  'bash', 'sh', 'zsh', 'node', 'npm', 'npx', 'pnpm', 'yarn', 'deno', 'bun',
  'git', 'gh', 'python3', 'python', 'pip', 'pip3', 'ruby', 'go', 'cargo', 'rustc',
  'swift', 'xcodebuild', 'xcrun', 'gradle', 'gradlew', 'java', 'kotlinc', 'adb',
  'make', 'cmake', 'docker', 'kubectl', 'psql', 'redis-cli', 'sqlite3',
  'curl', 'wget', 'rsync', 'ssh', 'scp', 'pm2', 'systemctl', 'launchctl',
  'grep', 'rg', 'sed', 'awk', 'find', 'ls', 'cat', 'head', 'tail', 'wc', 'diff',
  'cp', 'mv', 'rm', 'mkdir', 'touch', 'chmod', 'chown', 'tar', 'zip', 'unzip',
  'echo', 'printf', 'jq', 'yq', 'open', 'which', 'env', 'sleep', 'kill', 'ps',
]);

/**
 * Words that stand in front of the program the user actually ran. Skipping them is what keeps the
 * field informative: almost every command in this repository starts with `cd <dir> &&`, and taking
 * the first token literally would record `cd` for all of them.
 */
const PREFIX_NOISE = new Set(['cd', 'sudo', 'time', 'nohup', 'exec', 'command', 'nice', 'env', 'then', 'do']);
const SEGMENT_BREAK = new Set(['&&', '||', ';', '|']);

const HEX64 = /^[a-f0-9]{64}$/;

/**
 * One space between tokens, nothing at the ends. Deliberately nothing more: the hash has to mean
 * "the same command", and normalizing paths or arguments away would merge two different commands
 * into one identity, which is precisely the pairing this signal depends on being exact.
 */
export function normalizeToolCommand(command) {
  return String(command ?? '').replace(/\s+/gu, ' ').trim();
}

export function toolCommandProgram(command) {
  const tokens = normalizeToolCommand(command).split(' ').filter(Boolean);
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (SEGMENT_BREAK.has(token)) { index += 1; continue; }
    // `KEY=value node x` and `cd /some/path &&` both hide the real program behind noise.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(token)) { index += 1; continue; }
    if (PREFIX_NOISE.has(token)) {
      index += 1;
      // Consume that word's operand too, or `cd /repo` would report the path as the program.
      while (index < tokens.length && !SEGMENT_BREAK.has(tokens[index]) && tokens[index].startsWith('/')) index += 1;
      continue;
    }
    // A path-qualified invocation keeps only its basename: ./gradlew and /usr/local/bin/node are
    // the same programs as gradlew and node, and the directory is exactly the revealing part.
    const base = token.split('/').pop();
    return PROGRAM_ALLOWLIST.has(base) ? base : 'other';
  }
  return 'other';
}

/**
 * The exit code, when the host puts one where it can be read. Claude Code reports a failed Bash
 * call as an `error` string whose first line is `Exit code N`; there is no numeric field, and a
 * host that reports one differently simply yields null. A null is honest and still leaves the
 * status usable -- `failed` does not depend on knowing which code it failed with.
 */
export function toolExitCode(error) {
  const match = /^Exit code (\d+)/u.exec(String(error ?? ''));
  if (!match) return null;
  const code = Number.parseInt(match[1], 10);
  return Number.isInteger(code) && code >= 0 && code <= 255 ? code : null;
}

function fingerprint(hmac, value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const digest = hmac(value);
  return typeof digest === 'string' && HEX64.test(digest) ? digest : null;
}

/**
 * Tools that bring text from outside the repository into the session.
 *
 * Named by class, never by instance: an MCP server's name is the user's infrastructure, so every
 * one of them records as `mcp` and nothing about which. The point is only that untrusted text
 * entered the session, and a name would add a leak without adding an answer.
 */
export function externalContextClass(toolName) {
  const name = String(toolName ?? '');
  if (name === 'WebFetch') return 'web_fetch';
  if (name === 'WebSearch') return 'web_search';
  return name.startsWith('mcp__') ? 'mcp' : null;
}

export function reduceExternalContextEvent(input, { hmac } = {}) {
  if (!input || typeof input !== 'object') return null;
  const event = input.hook_event_name;
  if (event !== 'PostToolUse' && event !== 'PostToolUseFailure') return null;
  const source = externalContextClass(input.tool_name);
  if (!source) return null;
  const digest = value => (typeof hmac === 'function' ? hmac(value) : createHash('sha256').update(String(value), 'utf8').digest('hex'));
  return {
    source,
    episode_id: typeof input.prompt_id === 'string' ? fingerprint(digest, input.prompt_id) : null,
    session_id: typeof input.session_id === 'string' ? fingerprint(digest, input.session_id) : null,
  };
}

/**
 * Reduce one host tool event to the command outcome payload, or null when there is nothing to
 * record. Null is the common case and is not an error: every non-Bash tool, every event without a
 * command, and every host whose payload this adapter does not recognize lands here.
 *
 * `hmac` is injected rather than imported so the caller owns the key material and a test can run
 * the whole reduction without touching the machine's key file.
 */
export function reduceHostToolEvent(input, { hmac } = {}) {
  if (!input || typeof input !== 'object') return null;
  if (input.tool_name !== 'Bash') return null;
  const command = normalizeToolCommand(input.tool_input?.command);
  if (!command) return null;
  const event = input.hook_event_name;
  if (event !== 'PostToolUse' && event !== 'PostToolUseFailure') return null;
  const failed = event === 'PostToolUseFailure';
  // An interrupt is the user changing their mind, not the command being wrong. Counting it as a
  // failure would manufacture failed -> passed transitions out of every cancelled long-running
  // build, and those are the transitions this signal exists to find.
  const interrupted = failed && (input.is_interrupt === true || toolInterrupted(input));
  const digest = value => (typeof hmac === 'function' ? hmac(value) : createHash('sha256').update(value, 'utf8').digest('hex'));
  return {
    program: toolCommandProgram(command),
    command_id: fingerprint(digest, command),
    status: interrupted ? 'interrupted' : failed ? 'failed' : 'passed',
    exit_code: failed ? toolExitCode(input.error) : 0,
    duration_ms: Number.isFinite(input.duration_ms) ? Math.max(0, input.duration_ms) : 0,
    episode_id: fingerprint(digest, input.prompt_id),
    session_id: fingerprint(digest, input.session_id),
  };
}

function toolInterrupted(input) {
  return input.tool_response && typeof input.tool_response === 'object' && input.tool_response.interrupted === true;
}

/**
 * A repeatable execution the ledger can follow across runs, or null when the event is not one.
 *
 * Two kinds qualify, and they are here together because they answer the same question with very
 * different yields on this repository. Measured over the full local ledger: 397 command rows
 * produced 397 distinct fingerprints and zero repeats -- an agent's shell lines differ every time
 * (a new log path, a narrower grep), so the same command is essentially never run twice and no
 * transition can form. The 177 gate rows produced 15 distinct names and 9 failed -> passed
 * transitions, because a gate's name is generated by the lock script and stays stable.
 *
 * So gates carry this signal and commands mostly do not. Both are kept: commands cost nothing extra
 * now that they are collected, they are the only kind that knows which turn it happened in, and a
 * person's workflow repeats commands even when an agent's does not.
 */
export function executionIdentity(event) {
  const payload = event?.payload;
  if (!payload) return null;
  if (event.event === 'command.completed' && payload.command_id) {
    return {
      kind: 'command',
      identity: `command:${payload.command_id}`,
      label: payload.program,
      status: payload.status,
      episodeId: payload.episode_id || null,
      sessionId: payload.session_id || null,
    };
  }
  if (event.event === 'gate.completed' && payload.gate) {
    return {
      kind: 'gate',
      identity: `gate:${payload.gate}`,
      label: payload.gate,
      status: payload.status,
      // A gate runs from a lock script, outside any tool call, so there is no turn to attribute it
      // to. Null is the honest answer, and it is why the review threshold counts failures rather
      // than turns: only one of the two kinds can count turns at all. The same is true of the
      // session, which is why a gate recovery has to be checked for untrusted context by time
      // window rather than by which session it belonged to.
      episodeId: null,
      sessionId: null,
    };
  }
  return null;
}

/**
 * The transition this surface exists for: the same execution going from failed to passed, with the
 * failures that preceded it.
 *
 * Only consecutive runs of one identity count, and a run that never failed produces nothing --
 * "it passed again" carries no information. `interrupted` runs are skipped rather than treated as
 * either outcome, so cancelling a build in the middle of a red streak neither breaks the streak
 * nor counts as one more failure.
 */
export function findExecutionRecoveries(events) {
  const streaks = new Map();
  const recoveries = [];
  for (const event of events) {
    const execution = executionIdentity(event);
    if (!execution || execution.status === 'interrupted') continue;
    const streak = streaks.get(execution.identity)
      || { failures: 0, firstFailureAt: null, episodes: new Set() };
    if (execution.status === 'failed') {
      streak.failures += 1;
      streak.firstFailureAt ||= event.recorded_at;
      if (execution.episodeId) streak.episodes.add(execution.episodeId);
      streaks.set(execution.identity, streak);
      continue;
    }
    if (streak.failures > 0) {
      if (execution.episodeId) streak.episodes.add(execution.episodeId);
      recoveries.push({
        kind: execution.kind,
        identity: execution.identity,
        label: execution.label,
        failures: streak.failures,
        first_failure_at: streak.firstFailureAt,
        recovered_at: event.recorded_at,
        // How many separate user turns the red streak spanned, or null for a kind with no turn.
        // Null is not zero: one means "fixed inside the turn that broke it", null means unknowable.
        episodes: execution.kind === 'command' ? streak.episodes.size : null,
        episode_id: execution.episodeId,
        session_id: execution.sessionId,
      });
    }
    streaks.delete(execution.identity);
  }
  return recoveries;
}
