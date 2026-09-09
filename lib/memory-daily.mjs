import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  collectFleetReport,
} from './memory-fleet.mjs';
import {
  memoryTelemetryDir,
  readFleetArchives,
  runMemoryArchive,
  shiftDay,
  utcDay,
} from './memory-archive.mjs';
import {
  DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  memoryInstallationId,
} from './memory-observability.mjs';
import { memoryGitHooksDir, MEMORY_HOOKS_VERSION } from './memory-init.mjs';

/**
 * The unattended daily pass: archive yesterday, commit the package, and say only what is wrong.
 *
 * Three facts shape every decision in this file.
 *
 * It runs from session hooks on three hosts and from `post-commit`, so it is on the critical path
 * of a person's turn and of every commit they make. Nothing here may hang, and nothing here may
 * fail loudly: each step has its own timeout and its own catch, a failed step leaves a trace and
 * the next one still runs, and the process always exits 0. A collection mechanism that can block a
 * commit is a collection mechanism that gets deleted.
 *
 * Its stdout goes straight into a model's context on `SessionStart`, so silence is the normal
 * output. A daily "everything is fine" line costs context on every session forever and trains the
 * reader to skip the one session where it says something else. Findings only, one line each; every
 * other detail -- per-step timing, skip reasons, what was inspected and found ordinary -- goes to
 * the local trace file instead.
 *
 * It commits to the repository it is watching. That is done with plumbing against a private index
 * so it can never pick up another session's staged work, and with a compare-and-swap on HEAD so it
 * loses the race rather than winning it. Losing is cheap: the day is still on disk and tomorrow's
 * run archives it again.
 */
export const MEMORY_DAILY_RUN_SCHEMA = 'ownmem-daily-run/v1';
export const MEMORY_DAILY_DIRECTORY = '.local-test/memory-hook';
export const MEMORY_DAILY_TRACE_FILE = 'daily.jsonl';
export const MEMORY_DAILY_STAMP_FILE = 'daily.stamp';
/**
 * The git hook directory this feature owns, relative to the repository root.
 *
 * It is derived from the installation's memory directory rather than fixed, because a fixed path is
 * a path only one checkout has. A `core.hooksPath` that names a directory which does not exist
 * installs no hooks at all, so getting this wrong stops every hook the repository had -- silently.
 */
/** The layout this project itself uses; every caller that knows better passes its own. */
export const MEMORY_DAILY_DEFAULT_MEMORY_DIRECTORY = '.claude/memory';

export function memoryDailyHooksPath(memoryDir) {
  return memoryGitHooksDir(memoryDir);
}
/** Set on every git child so a hook that re-enters this program exits instead of recursing. */
export const MEMORY_DAILY_GUARD_ENV = 'OWNMEM_HOOK_GUARD';
export const MEMORY_DAILY_TIMEOUT_MS = 8_000;
const FETCH_TIMEOUT_MS = 3_000;
const PUBLIC_SYNC_TIMEOUT_MS = 5_000;
/** Below this there is no point starting the public gate: it spawns bash and a second node process. */
const PUBLIC_SYNC_MINIMUM_MS = 1_500;
/** Left for the counts after the fetch, so a slow network never costs the finding behind it. */
const FETCH_RESERVE_MS = 500;
const GIT_TIMEOUT_MS = 5_000;
/** How far back coverage is inspected. Long enough to see a machine go dark, short enough to stay cheap. */
export const MEMORY_DAILY_INSPECTION_DAYS = 7;
/** An abstain rate that moves more than this between two consecutive complete days is reported. */
export const MEMORY_DAILY_ABSTAIN_JUMP = 0.15;
/**
 * Attributed recalls a day needs before its abstain rate is compared with another day's.
 *
 * Agent attribution started on 2026-09-09, so the attributed denominator is still starting from
 * zero while the unattributed one is in the hundreds. At single-digit denominators a fifteen-point
 * threshold is crossed by one recall going either way, which means the inspection would report a
 * jump nearly every day -- and a check that fires every day is a check people learn to scroll past,
 * which costs more than the check is worth. Twenty is the point where one recall can no longer move
 * the rate past the threshold on its own.
 */
export const MEMORY_DAILY_ABSTAIN_MIN_ATTEMPTS = 20;
const FINDING_PREFIX = '[ownmem daily]';
const PUBLIC_SYNC_SCRIPT = 'scripts/memory-public-sync.sh';

/**
 * A git operation that already cannot be trusted to finish.
 *
 * Nothing here uses `execFileSync`'s throwing form: a non-zero exit is an answer ("there is no
 * upstream", "the ref moved") far more often than it is a defect, and the caller decides which.
 */
function git(root, args, { timeoutMs = GIT_TIMEOUT_MS, env = {} } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, [MEMORY_DAILY_GUARD_ENV]: '1', ...env },
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    timedOut: result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM',
  };
}

/**
 * The installation's own switches, read fresh on every pass.
 *
 * Read here rather than passed in because the pass runs from hook configurations that were written
 * once and are never rewritten: a switch that could only be changed by reinstalling the hooks would
 * not be a switch. An installation with no config -- everything before 0.6.0 -- gets the defaults,
 * which are the behaviour it already had, except for the hook version, which it is missing because
 * its hooks predate the field.
 */
export function readMemoryTelemetryConfig(root, memoryDir) {
  const file = path.join(path.resolve(root), memoryDir, 'config.json');
  let config = null;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { present: false, auto_commit: true, manage_hooks_path: true, hooks_version: null, command: null };
  }
  return {
    present: true,
    auto_commit: config?.telemetry?.auto_commit !== false,
    manage_hooks_path: config?.telemetry?.manage_hooks_path !== false,
    hooks_version: Number.isInteger(config?.hooks_version) ? config.hooks_version : 1,
    command: typeof config?.command === 'string' && config.command.trim() ? config.command.trim() : null,
  };
}

export function memoryDailyDirectory(root) {
  return path.join(path.resolve(root), MEMORY_DAILY_DIRECTORY);
}

export function memoryDailyTraceFile(root) {
  return path.join(memoryDailyDirectory(root), MEMORY_DAILY_TRACE_FILE);
}

export function memoryDailyStampFile(root) {
  return path.join(memoryDailyDirectory(root), MEMORY_DAILY_STAMP_FILE);
}

export function readMemoryDailyStamp(root) {
  try {
    return readFileSync(memoryDailyStampFile(root), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export function writeMemoryDailyStamp(root, day) {
  const file = memoryDailyStampFile(root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${day}\n`, 'utf8');
  return file;
}

/**
 * The trace is written even when the run found nothing, because "it ran and had nothing to say" and
 * "it never ran" are the two states this whole mechanism exists to tell apart, and stdout can no
 * longer distinguish them once silence is the success case.
 */
function appendTrace(root, record) {
  const file = memoryDailyTraceFile(root);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
    return file;
  } catch {
    return null;
  }
}

/**
 * Whether an in-progress git operation makes it unsafe to move HEAD.
 *
 * Advancing the branch under a rebase or a merge resolution rewrites what the person is in the
 * middle of doing, and the cost of skipping is one day of latency on a package that is still on
 * disk. There is no version of this trade worth taking.
 */
export function gitOperationInProgress(root) {
  const gitDir = git(root, ['rev-parse', '--absolute-git-dir']);
  if (!gitDir.ok) return 'not a git repository';
  const markers = [
    ['rebase-merge', 'an interactive rebase'],
    ['rebase-apply', 'a rebase or am'],
    ['MERGE_HEAD', 'an unresolved merge'],
    ['CHERRY_PICK_HEAD', 'a cherry-pick'],
    ['REVERT_HEAD', 'a revert'],
    ['BISECT_LOG', 'a bisect'],
  ];
  for (const [entry, description] of markers) {
    if (existsSync(path.join(gitDir.stdout, entry))) return description;
  }
  if (!git(root, ['symbolic-ref', '--quiet', 'HEAD']).ok) return 'a detached HEAD';
  return null;
}

/**
 * Commit exactly the telemetry files this run wrote, and nothing else that happens to be staged.
 *
 * Two independent guards, because the failure they prevent is silently committing another session's
 * work and it has happened in this repository before:
 *
 *  - a private `GIT_INDEX_FILE` seeded from HEAD. The shared index is never read and never written
 *    while the commit is built, so a file another session staged a millisecond ago cannot be in the
 *    tree that gets committed. This is stronger than checking the index first and committing after:
 *    between those two moments is a real window, and it has been lost twice.
 *  - a compare-and-swap on HEAD. `update-ref` is given the commit HEAD was at when the tree was
 *    built, so a branch that moved in between rejects the update instead of quietly rewriting it
 *    into an unrelated parent. A rejection is not retried: retrying until it works is how an
 *    unattended process wins a race it should lose.
 *
 * The shared index is touched exactly once, after the commit lands, to re-stage the same paths.
 * Without that the committed content and the index disagree and `git status` shows the telemetry
 * files as reverted -- a self-inflicted dirty tree in every session that follows.
 */
export function commitTelemetryPaths({ root, paths, message, headCommit: pinnedHead = null }) {
  if (paths.length === 0) return { committed: false, reason: 'nothing to commit' };
  const blocked = gitOperationInProgress(root);
  if (blocked) return { committed: false, reason: `${blocked} is in progress` };
  const head = git(root, ['rev-parse', 'HEAD']);
  if (!head.ok) return { committed: false, reason: 'HEAD does not resolve to a commit' };
  // `pinnedHead` exists so a test can hand this a commit HEAD has already moved past and watch the
  // compare-and-swap refuse. Nothing in production passes it: production reads HEAD here, and the
  // race it has to survive opens after that read, not before it.
  const headCommit = pinnedHead || head.stdout;

  const indexFile = path.join(os.tmpdir(), `ownmem-daily-index-${randomUUID()}`);
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    const seeded = git(root, ['read-tree', headCommit], { env });
    if (!seeded.ok) return { committed: false, reason: `read-tree failed: ${seeded.stderr || seeded.status}` };
    const staged = git(root, ['add', '--', ...paths], { env });
    if (!staged.ok) return { committed: false, reason: `add failed: ${staged.stderr || staged.status}` };
    const tree = git(root, ['write-tree'], { env });
    if (!tree.ok) return { committed: false, reason: `write-tree failed: ${tree.stderr || tree.status}` };
    const headTree = git(root, ['rev-parse', `${headCommit}^{tree}`]);
    if (headTree.ok && headTree.stdout === tree.stdout) {
      return { committed: false, reason: 'the packages are already what HEAD records' };
    }
    const commit = git(root, ['commit-tree', tree.stdout, '-p', headCommit, '-m', message]);
    if (!commit.ok) return { committed: false, reason: `commit-tree failed: ${commit.stderr || commit.status}` };
    const updated = git(root, ['update-ref', '-m', message, 'HEAD', commit.stdout, headCommit]);
    if (!updated.ok) {
      return { committed: false, reason: 'HEAD moved while the commit was being built; the day stays on disk for the next run' };
    }
    // Only now, and only for these paths: the shared index gets the same content the commit has.
    const resync = git(root, ['add', '--', ...paths]);
    return {
      committed: true,
      commit: commit.stdout,
      parent: headCommit,
      paths,
      index_resynced: resync.ok,
      index_resync_error: resync.ok ? null : (resync.stderr || String(resync.status)),
    };
  } finally {
    rmSync(indexFile, { force: true });
  }
}

/**
 * Point git at the hook directory this feature ships, but never over the top of someone else's.
 *
 * A configured `core.hooksPath` falls into one of three states, and only the middle one takes any
 * judgement:
 *
 * - *unset* -- nothing to displace, so it is claimed.
 * - *vacant* -- set, but running nothing. A repository may pin `core.hooksPath` to its own
 *   `.git/hooks` precisely to opt out of a global hook directory, and that pin is equivalent to
 *   unset as long as the directory holds nothing but git's `.sample` files. So is any path that
 *   does not exist on disk: git installs no hook from a directory that is not there, and says
 *   nothing about it. Both are claimed, because claiming them loses no behaviour.
 * - *foreign* -- set to a directory that exists and holds something other than samples. That is
 *   somebody's configuration; it is reported and left alone, because a hook directory silently
 *   swapped out is the kind of change that gets found weeks later.
 */
export function ensureHooksPath(root, { memoryDir = MEMORY_DAILY_DEFAULT_MEMORY_DIRECTORY, desired = memoryDailyHooksPath(memoryDir) } = {}) {
  const current = git(root, ['config', '--get', 'core.hooksPath']);
  const value = current.ok ? current.stdout : '';
  if (value === desired) return { changed: false, value, reason: 'already set' };
  if (value !== '' && !isVacantHookDirectory(root, value)) {
    return { changed: false, value, reason: 'foreign', conflict: value };
  }
  const set = git(root, ['config', 'core.hooksPath', desired]);
  if (!set.ok) return { changed: false, value, reason: `could not set: ${set.stderr || set.status}` };
  return { changed: true, value: desired, previous: value };
}

function isVacantHookDirectory(root, value) {
  const absolute = path.resolve(root, value);
  let entries;
  try {
    entries = readdirSync(absolute);
  } catch {
    // A configured directory that does not exist installs no hooks at all, wherever it points, so
    // nothing is displaced by claiming it. This is the state a checkout is left in when the
    // directory a previous configuration named is later removed: every hook the repository had
    // stops running, and git reports nothing.
    return true;
  }
  const gitDir = git(root, ['rev-parse', '--absolute-git-dir']);
  if (!gitDir.ok) return false;
  if (absolute !== path.join(gitDir.stdout, 'hooks')) return false;
  return entries.every(name => name.endsWith('.sample'));
}

/**
 * How this checkout stands against its remote. Reported, never acted on.
 *
 * Telemetry only reaches the other machine through origin, so an archive that is committed and
 * never pushed is an archive the fleet view cannot see. Pushing automatically is out of the
 * question -- an unattended process must not publish commits it did not read -- so the honest
 * mechanism is to say the number out loud until a person acts on it.
 */
export function readSyncStatus(root, { fetch = true, fetchTimeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const status = { fetched: false, fetch_error: null, upstream: null, ahead: null, behind: null, error: null };
  // The counts come from the refs already on disk, so they are produced whether or not the fetch
  // happens or succeeds. Making them wait on the network is how the single most useful finding here
  // -- "these commits exist on no other machine" -- got dropped on the one kind of day it matters,
  // the day the network is slow.
  if (fetch && fetchTimeoutMs > 0) {
    const fetched = git(root, ['fetch', '--quiet'], { timeoutMs: fetchTimeoutMs });
    status.fetched = fetched.ok;
    // Offline is the common case for a laptop, not a defect. It is noted and the counts are then
    // computed against whatever the last fetch left behind.
    if (!fetched.ok) status.fetch_error = fetched.timedOut ? 'timed out' : (fetched.stderr || 'failed');
  } else if (fetch) {
    status.fetch_error = 'skipped: no budget left to reach the network';
  }
  const upstream = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (!upstream.ok) {
    status.error = 'this branch has no upstream';
    return status;
  }
  status.upstream = upstream.stdout;
  const counts = git(root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
  if (!counts.ok) {
    status.error = counts.stderr || 'could not count commits against the upstream';
    return status;
  }
  const [behind, ahead] = counts.stdout.split(/\s+/).map(value => Number.parseInt(value, 10));
  status.behind = Number.isFinite(behind) ? behind : null;
  status.ahead = Number.isFinite(ahead) ? ahead : null;
  return status;
}

/**
 * The two states of the public checkout that stop a release, read by running the gate that owns
 * them rather than by re-deriving them here.
 *
 * Behind origin is deliberately not one of them: on a two-machine workflow that is the ordinary
 * state of whichever machine has not pulled yet, and reporting it would make the common case look
 * like a fault.
 */
export function readPublicSyncStatus(root, { timeoutMs = PUBLIC_SYNC_TIMEOUT_MS } = {}) {
  const script = path.join(root, PUBLIC_SYNC_SCRIPT);
  if (!existsSync(script)) return { available: false, blockers: [] };
  const result = spawnSync('bash', [script, '--check'], {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, [MEMORY_DAILY_GUARD_ENV]: '1' },
  });
  if (result.error) {
    return { available: true, blockers: [], error: result.error.code === 'ETIMEDOUT' ? 'timed out' : result.error.message };
  }
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const blockers = [];
  const ahead = output.match(/public checkout is (\d+) commit\(s\) ahead of origin\/main/);
  if (ahead) blockers.push(`the public checkout has ${ahead[1]} commit(s) origin has never seen`);
  if (/public checkout worktree is not clean/.test(output)) blockers.push('the public checkout worktree is not clean');
  return { available: true, blockers, exit_status: result.status };
}

function completePackagesFor(root, memoryDir, installationId) {
  const fleet = readFleetArchives({ root, memoryDir });
  const entry = fleet.installations.find(item => item.installation_id === installationId);
  return (entry?.packages || []).filter(item => item.partial_day === false);
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * A day's abstain rate over attributed recalls only.
 *
 * The package's `attempts` and `abstained` are totals: they include the legacy rows written before
 * the agent field existed and the nested rows whose environment showed markers for more than one
 * host. Both are unattributable and both are excluded from every agent's numerator and denominator
 * everywhere else, so a rate computed off the totals here would be a different metric wearing the
 * same name. On this repository it was also simply wrong: 2026-09-07 and 2026-09-08 were 30/30 and
 * 64/64 legacy, so there were no attributed recalls at all on either day, and the totals still
 * produced a confident "+57.4pt" finding out of them.
 */
export function attributedAbstain(day) {
  const attempts = day.retrieval.attempts - day.retrieval.legacy_attempts - day.retrieval.nested_attempts;
  const abstained = day.retrieval.abstained - day.retrieval.legacy_abstained - day.retrieval.nested_abstained;
  return { attempts, abstained, rate: ratio(abstained, attempts) };
}

function percentPoints(value) {
  return `${(value * 100).toFixed(1)}pt`;
}

/**
 * Runs of consecutive days a machine archived nothing while work was landing.
 *
 * One missing day is a laptop that stayed shut. Two in a row with commits on them is the failure
 * this whole programme exists to catch: telemetry split across machines with nothing saying so, and
 * a report run on the other one speaking confidently about a week it never saw.
 */
export function coverageGaps(report, { minimumRun = 2 } = {}) {
  const gaps = [];
  for (const installation of report.installations) {
    const missing = report.missing
      .filter(item => item.installation_id === installation.installation_id && (item.commits || 0) > 0)
      .sort((left, right) => left.day.localeCompare(right.day, 'en'));
    let run = [];
    const flush = () => {
      if (run.length >= minimumRun) {
        gaps.push({
          installation_id: installation.installation_id,
          alias: installation.alias,
          days: run.map(item => item.day),
          commits: run.reduce((sum, item) => sum + item.commits, 0),
        });
      }
      run = [];
    };
    for (const item of missing) {
      if (run.length > 0 && shiftDay(run[run.length - 1].day, 1) !== item.day) flush();
      run.push(item);
    }
    flush();
  }
  return gaps;
}

/**
 * Everything the inspection can say, computed from packages already in Git plus the two status
 * reads above. It never re-runs the golden set or the benchmark: those are minutes of work and this
 * is on the critical path of a person's session.
 */
export function inspectMemoryDaily({
  root,
  memoryDir,
  installationId,
  now = new Date(),
  windowDays = MEMORY_DAILY_INSPECTION_DAYS,
}) {
  const findings = [];
  const observations = [];
  const today = utcDay(now);
  const fromDay = shiftDay(today, -windowDays);
  const toDay = shiftDay(today, -1);
  const report = collectFleetReport({ root, memoryDir, fromDay, toDay, requested: `${windowDays}d` });
  for (const gap of coverageGaps(report)) {
    const name = gap.alias || gap.installation_id;
    findings.push(`${name} archived nothing on ${gap.days.join(', ')} while ${gap.commits} commit(s) landed`);
  }

  const packages = installationId ? completePackagesFor(root, memoryDir, installationId) : [];
  const latest = packages[packages.length - 1] || null;
  const previous = packages[packages.length - 2] || null;
  if (latest && previous) {
    const latestAbstain = attributedAbstain(latest);
    const previousAbstain = attributedAbstain(previous);
    if (latestAbstain.attempts < MEMORY_DAILY_ABSTAIN_MIN_ATTEMPTS
      || previousAbstain.attempts < MEMORY_DAILY_ABSTAIN_MIN_ATTEMPTS) {
      // Recorded rather than reported. "Not enough attributed recalls to say" is a fact about the
      // collection surface and belongs in the trace; putting it on stdout would be a daily line
      // about an absence, which is exactly the noise the silent-by-default rule exists to prevent.
      observations.push({
        'abstain-jump': `insufficient attributed samples (${previousAbstain.attempts} vs ${latestAbstain.attempts})`,
      });
    } else {
      const delta = latestAbstain.rate - previousAbstain.rate;
      if (Math.abs(delta) > MEMORY_DAILY_ABSTAIN_JUMP) {
        findings.push(`abstain rate moved ${delta > 0 ? '+' : '-'}${percentPoints(Math.abs(delta))}`
          + ` between ${previous.day} (${percentPoints(previousAbstain.rate)}, ${previousAbstain.attempts} attributed)`
          + ` and ${latest.day} (${percentPoints(latestAbstain.rate)}, ${latestAbstain.attempts} attributed)`);
      }
    }
    if (latest.quota_lock_sha256 && previous.quota_lock_sha256
      && latest.quota_lock_sha256 !== previous.quota_lock_sha256) {
      findings.push(`the quota ratchet changed between ${previous.day} and ${latest.day}; confirm it tightened rather than loosened`);
    }
    if (latest.scripts_tree_hash && previous.scripts_tree_hash
      && latest.scripts_tree_hash !== previous.scripts_tree_hash) {
      observations.push({ scripts_tree_changed: [previous.day, latest.day] });
      // Only a change *inside* a frozen window invalidates a comparison, and windows do not exist
      // yet: `window_id` is null in every v1 package, so surfacing this now would fire on every
      // commit that touches scripts/ and say nothing. The rule is written against the field that
      // will carry the answer, so it starts reporting the day windows are frozen rather than
      // needing to be remembered and rewritten then.
      if (latest.window_id !== null && latest.window_id === previous.window_id) {
        findings.push(`the collecting tree changed inside window ${latest.window_id}`
          + ` (${previous.day} -> ${latest.day}); freeze a new window before comparing across it`);
      }
    }
  }

  return {
    findings,
    observations,
    window: { from_day: fromDay, to_day: toDay },
    installations: report.installations.length,
    complete_packages: packages.length,
  };
}

/**
 * One unattended pass.
 *
 * Steps run in order, each inside its own catch and against a shared deadline. A step that throws
 * is recorded and the next one still runs, because the steps answer independent questions: a failed
 * `git fetch` says nothing about whether yesterday was archived. A step that starts past the
 * deadline is recorded as skipped rather than started, so a slow machine degrades into a shorter
 * report instead of a hung hook.
 */
export function runMemoryDaily({
  root,
  memoryDir = MEMORY_DAILY_DEFAULT_MEMORY_DIRECTORY,
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  now = new Date(),
  timeoutMs = MEMORY_DAILY_TIMEOUT_MS,
  force = false,
  source = 'manual',
  agent = 'unknown',
  fetch = true,
  commit = true,
  trace = true,
} = {}) {
  const absoluteRoot = path.resolve(root);
  const day = utcDay(now);
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  const stamp = readMemoryDailyStamp(absoluteRoot);
  if (!force && stamp === day) {
    // No trace line: this branch fires on every session start and every commit for the rest of the
    // day, and a file whose rows are almost all "did nothing" is one nobody reads. The stamp itself
    // already records that today has been handled.
    return {
      schema: MEMORY_DAILY_RUN_SCHEMA, day, source, agent, skipped: 'stamp', findings: [], steps: [], duration_ms: 0,
    };
  }

  const steps = [];
  const findings = [];
  const telemetry = readMemoryTelemetryConfig(absoluteRoot, memoryDir);
  // Once a day, on the surface an upgraded installation actually reads. The installer says the same
  // thing on `init --check`, but nobody runs a check on a schedule; this pass is already wired to
  // session start, which is where a reader is.
  if (telemetry.present && telemetry.hooks_version < MEMORY_HOOKS_VERSION) {
    findings.push(`the hook configuration is v${telemetry.hooks_version} and this ownmem writes`
      + ` v${MEMORY_HOOKS_VERSION}; run: ${telemetry.command || 'npx ownmem'} init --update`);
  }
  const remaining = () => deadline - Date.now();
  let timedOut = false;
  const step = (name, callback) => {
    if (Date.now() >= deadline) {
      timedOut = true;
      steps.push({ step: name, status: 'skipped', reason: 'timeout', ms: 0 });
      return null;
    }
    const began = Date.now();
    try {
      const detail = callback();
      steps.push({ step: name, status: 'ok', ms: Date.now() - began, detail: detail ?? null });
      return detail;
    } catch (error) {
      steps.push({ step: name, status: 'failed', ms: Date.now() - began, error: String(error?.message || error) });
      return null;
    }
  };

  const archived = step('archive', () => {
    const result = runMemoryArchive({ root: absoluteRoot, memoryDir, directory, now });
    return {
      installation_id: result.installation_id,
      changed_days: result.days.filter(item => item.changed).map(item => item.day),
      changed_files: result.days.filter(item => item.changed).map(item => item.file),
      installations_changed: result.installations_changed,
      installations_file: result.installations_file,
      days_seen: result.days.length,
    };
  });

  step('self-commit', () => {
    // The archive itself is unconditional: the day would otherwise expire off this machine with the
    // events it was reduced from. Only publishing it into a commit is optional.
    if (!commit) return { committed: false, reason: 'skipped: --no-commit' };
    if (!telemetry.auto_commit) return { committed: false, reason: 'skipped: auto_commit disabled' };
    if (!archived) return { committed: false, reason: 'the archive step produced nothing to commit' };
    const paths = [...archived.changed_files];
    if (archived.installations_changed) paths.push(archived.installations_file);
    if (paths.length === 0) return { committed: false, reason: 'no package changed' };
    const days = archived.changed_days.join(', ');
    const result = commitTelemetryPaths({
      root: absoluteRoot,
      paths,
      message: `chore(ownmem): archive telemetry ${days} (${archived.installation_id})`,
    });
    if (result.committed) {
      const dirty = git(absoluteRoot, ['status', '--short', '--', memoryTelemetryDir(memoryDir)]);
      if (dirty.ok && dirty.stdout) {
        findings.push(`the telemetry directory is still dirty after committing ${days}: ${dirty.stdout.split('\n')[0]}`);
      }
    }
    return result;
  });

  step('hooks-path', () => {
    if (!telemetry.manage_hooks_path) return { changed: false, reason: 'skipped: manage_hooks_path disabled' };
    // The directory has to hold the hook before git is sent to it. A configured `core.hooksPath`
    // replaces the repository's hook directory wholesale, so naming one that is empty or absent
    // disables every hook the repository had and reports nothing -- worse than not being installed.
    const desired = memoryDailyHooksPath(memoryDir);
    if (!existsSync(path.join(absoluteRoot, ...desired.split('/'), 'post-commit'))) {
      findings.push(`${desired}/post-commit is missing, so core.hooksPath was left alone;`
        + ` run: ${telemetry.command || 'npx ownmem'} init --update`);
      return { changed: false, reason: 'no hook to point at' };
    }
    const result = ensureHooksPath(absoluteRoot, { memoryDir });
    if (result.reason === 'foreign') {
      findings.push(`core.hooksPath points at ${result.conflict}, so the post-commit fallback is not installed; it was left alone`);
    }
    // A takeover is silent everywhere else, and the value it replaced is the only record that the
    // repository used to be configured differently -- say it once, here, while it is still known.
    if (result.changed && result.previous) {
      findings.push(`core.hooksPath was ${result.previous}, which installed no hooks; it now points at ${desired}`);
    }
    return result;
  });

  // Order from here down is by value per millisecond, because the deadline truncates the tail and
  // whatever is last is what a slow machine loses. The ahead/behind counts are milliseconds and are
  // the finding that says telemetry is stranded on one machine, so they come before the inspection;
  // the public checkout gate spawns bash and a second node process and comes last.
  step('sync-status', () => {
    const status = readSyncStatus(absoluteRoot, {
      fetch,
      fetchTimeoutMs: Math.min(FETCH_TIMEOUT_MS, remaining() - FETCH_RESERVE_MS),
    });
    if (status.ahead) findings.push(`this checkout is ${status.ahead} commit(s) ahead of ${status.upstream}; the other machine cannot see them until they are pushed`);
    if (status.behind) findings.push(`this checkout is ${status.behind} commit(s) behind ${status.upstream}; pull before trusting the fleet view`);
    return status;
  });

  step('inspect', () => {
    const installationId = archived?.installation_id
      || memoryInstallationId({ root: absoluteRoot, directory });
    const result = inspectMemoryDaily({ root: absoluteRoot, memoryDir, installationId, now });
    findings.push(...result.findings);
    return result;
  });

  step('public-sync', () => {
    const budget = remaining();
    if (budget < PUBLIC_SYNC_MINIMUM_MS) return { available: null, blockers: [], error: 'skipped: no budget left' };
    const status = readPublicSyncStatus(absoluteRoot, { timeoutMs: Math.min(PUBLIC_SYNC_TIMEOUT_MS, budget) });
    findings.push(...status.blockers);
    return status;
  });

  // The stamp says "today has been handled", so only a run that actually archived may set it. A pass
  // that timed out before its first step did nothing, and stamping it would silently hand the day to
  // tomorrow's run -- which would find the same day already archived and never notice the hole.
  const archivedOk = steps.find(item => item.step === 'archive')?.status === 'ok';
  if (archivedOk) writeMemoryDailyStamp(absoluteRoot, day);

  const record = {
    schema: MEMORY_DAILY_RUN_SCHEMA,
    at: new Date(startedAt).toISOString(),
    day,
    source,
    agent,
    force,
    timeout_ms: timeoutMs,
    timed_out: timedOut,
    duration_ms: Date.now() - startedAt,
    stamped: archivedOk,
    steps,
    findings,
  };
  if (trace) appendTrace(absoluteRoot, record);
  return record;
}

/** Findings only, one per line, prefixed so a reader can tell who is speaking into their session. */
export function formatMemoryDailyFindings(record) {
  if (!record.findings || record.findings.length === 0) return '';
  return `${record.findings.map(finding => `${FINDING_PREFIX} ${finding}`).join('\n')}\n`;
}
