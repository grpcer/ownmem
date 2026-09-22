import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  readLocalDailyPackages,
  runMemoryArchive,
  shiftDay,
  utcDay,
} from './memory-archive.mjs';
import {
  DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  formatMemoryObservabilityRetentionFinding,
  memoryInstallationId,
  planMemoryObservabilityRetention,
} from './memory-observability.mjs';
import { MEMORY_HOOKS_VERSION } from './memory-init.mjs';

/**
 * The unattended daily pass: archive yesterday locally, drop expired raw events, and say only what is wrong.
 *
 * Three facts shape every decision in this file.
 *
 * It runs from session hooks, so it is on the critical path of a person's turn. Nothing here may
 * hang, and nothing here may fail loudly: each step has its own timeout and its own catch, a failed
 * step leaves a trace and the next one still runs, and the process always exits 0. A collection
 * mechanism that can block somebody's turn is a collection mechanism that gets deleted.
 *
 * Its stdout goes straight into a model's context on `SessionStart`, so silence is the normal
 * output. A daily "everything is fine" line costs context on every session forever and trains the
 * reader to skip the one session where it says something else. Findings only, one line each; every
 * other detail -- per-step timing, skip reasons, what was inspected and found ordinary -- goes to
 * the local trace file instead.
 *
 * It writes nothing into the repository. The day it reduces is written beside the raw events under
 * the gitignored local-data directory, so the pass has no way to touch a person's index or HEAD --
 * which is what the version that did commit had to defend against with private-index plumbing and
 * a compare-and-swap.
 */
export const MEMORY_DAILY_RUN_SCHEMA = 'ownmem-daily-run/v1';
export const MEMORY_DAILY_DIRECTORY = '.local-test/memory-hook';
export const MEMORY_DAILY_TRACE_FILE = 'daily.jsonl';
export const MEMORY_DAILY_STAMP_FILE = 'daily.stamp';
/** The layout this project itself uses; every caller that knows better passes its own. */
export const MEMORY_DAILY_DEFAULT_MEMORY_DIRECTORY = '.claude/memory';

/** Set on every git child so a hook that re-enters this program exits instead of recursing. */
export const MEMORY_DAILY_GUARD_ENV = 'OWNMEM_HOOK_GUARD';
export const MEMORY_DAILY_TIMEOUT_MS = 8_000;
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
    return {
      present: false,
      hooks_version: null,
      command: null,
    };
  }
  // telemetry.auto_commit / manage_hooks_path / auto_close_windows may still appear in a 0.6.0
  // consumer config. They are no longer read; encountering them must not throw.
  return {
    present: true,
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
 * Commit whatever the instrument's own paths hold that HEAD does not, and nothing else that happens
 * to be staged.
 *
 * `paths` are the instrument's pathspecs -- its telemetry directory and window registry -- not the
 * files one pass happened to write. A pass that loses the race below, or runs during a merge, leaves
 * its files on disk; committing only "what this pass changed" meant the next pass never picked them
 * up, and an untracked registry left that way made every later `git pull` refuse to run. Removals
 * are never staged: a missing package is not a deletion anybody asked for.
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
  // A pathspec that matches nothing on disk makes `git add` fail outright.
  const present = paths.filter(relative => existsSync(path.join(root, relative)));
  if (present.length === 0) return { committed: false, reason: 'nothing to commit' };
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
    const staged = git(root, ['add', '--ignore-removal', '--', ...present], { env });
    if (!staged.ok) return { committed: false, reason: `add failed: ${staged.stderr || staged.status}` };
    const tree = git(root, ['write-tree'], { env });
    if (!tree.ok) return { committed: false, reason: `write-tree failed: ${tree.stderr || tree.status}` };
    const headTree = git(root, ['rev-parse', `${headCommit}^{tree}`]);
    if (headTree.ok && headTree.stdout === tree.stdout) {
      return { committed: false, reason: 'the packages are already what HEAD records' };
    }
    const diff = git(root, ['diff', '--cached', '--name-only', '-z', headCommit], { env });
    if (!diff.ok) return { committed: false, reason: `diff failed: ${diff.stderr || diff.status}` };
    const changed = diff.stdout.split('\0').filter(Boolean);
    const subject = typeof message === 'function' ? message(changed) : message;
    const commit = git(root, ['commit-tree', tree.stdout, '-p', headCommit, '-m', subject]);
    if (!commit.ok) return { committed: false, reason: `commit-tree failed: ${commit.stderr || commit.status}` };
    const updated = git(root, ['update-ref', '-m', subject, 'HEAD', commit.stdout, headCommit]);
    if (!updated.ok) {
      return { committed: false, reason: 'HEAD moved while the commit was being built; the day stays on disk for the next run' };
    }
    // Only now, and only for these files: the shared index gets the same content the commit has.
    const resync = git(root, ['add', '--', ...changed]);
    return {
      committed: true,
      commit: commit.stdout,
      parent: headCommit,
      message: subject,
      paths: changed,
      index_resynced: resync.ok,
      index_resync_error: resync.ok ? null : (resync.stderr || String(resync.status)),
    };
  } finally {
    rmSync(indexFile, { force: true });
  }
}

/**
 * The subject of a telemetry commit, named after what it actually carries.
 *
 * The days come from the committed package paths rather than from this pass's archive result, so a
 * commit that also picks up an earlier pass's leftovers says which days it holds.
 */
export function telemetryCommitSubject({ changed, memoryDir, closedWindowId = null }) {
  const telemetryDir = memoryTelemetryDir(memoryDir);
  const days = new Set();
  const installations = new Set();
  for (const file of changed) {
    if (!file.startsWith(`${telemetryDir}/`)) continue;
    const match = /^(local-[0-9a-f]{12})\/(\d{4}-\d{2}-\d{2})\.json$/.exec(file.slice(telemetryDir.length + 1));
    if (!match) continue;
    installations.add(match[1]);
    days.add(match[2]);
  }
  if (days.size > 0) {
    const subject = `chore(ownmem): archive telemetry ${[...days].sort().join(', ')} (${[...installations].sort().join(', ')})`;
    return closedWindowId ? `${subject}, close window ${closedWindowId}` : subject;
  }
  if (closedWindowId) return `chore(ownmem): close observation window ${closedWindowId}`;
  return 'chore(ownmem): commit telemetry an earlier pass left uncommitted';
}


function completePackagesFor(root, directory, installationId) {
  return readLocalDailyPackages({ root, directory, installationId })
    .filter(item => item.partial_day === false);
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
  directory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  installationId,
  now = new Date(),
}) {
  const findings = [];
  const observations = [];
  const packages = installationId ? completePackagesFor(root, directory, installationId) : [];
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
  }

  return {
    findings,
    observations,
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
      // A step may attach what it learned before failing; the archive step's failed_days is the only
      // place the full list of failed days survives, since the finding names them compactly.
      steps.push({
        step: name, status: 'failed', ms: Date.now() - began, error: String(error?.message || error), detail: error?.detail ?? null,
      });
      return null;
    }
  };

  let archiveDetail = null;
  const archived = step('archive', () => {
    const result = runMemoryArchive({ root: absoluteRoot, memoryDir, directory, now });
    archiveDetail = {
      installation_id: result.installation_id,
      changed_days: result.days.filter(item => item.changed).map(item => item.day),
      changed_files: result.days.filter(item => item.changed).map(item => item.file),
      days_seen: result.days.length,
      failed_days: result.failed_days,
    };
    // The days that did archive are on disk and are committed below; the step still fails, so the
    // day is not stamped as handled and the failure is not mistaken for a quiet day.
    if (result.failed_days.length > 0) {
      // Name the days compactly and keep the first reason whole: a run that failed on twelve days used
      // to list all twelve dates and lose the reason to the finding's length limit. The trace keeps the
      // full list in failed_days.
      const days = result.failed_days.map(item => item.day);
      const [first] = result.failed_days;
      const named = days.length === 1 ? days[0]
        : days.length <= 3 ? days.join(', ')
          : `${days.length} days (${days[0]}..${days[days.length - 1]})`;
      const failure = new Error(`could not archive ${named}: ${first.error}`);
      failure.detail = archiveDetail;
      throw failure;
    }
    return archiveDetail;
  });

  // Right after the archive, so a day it just sealed no longer counts as held. Retention itself runs
  // on every event write; this only reads what it would do and says which days it cannot remove.
  step('raw-retention', () => {
    const plan = planMemoryObservabilityRetention({ root: absoluteRoot, directory, memoryDir, now });
    const finding = formatMemoryObservabilityRetentionFinding(plan);
    if (finding) findings.push(finding);
    return {
      retention_days: plan.retention_days,
      max_bytes: plan.max_bytes,
      bytes: plan.bytes,
      removable_days: plan.removals.map(item => item.day),
      held: plan.held,
    };
  });

  step('inspect', () => {
    const installationId = (archived || archiveDetail)?.installation_id
      || memoryInstallationId({ root: absoluteRoot, directory });
    const result = inspectMemoryDaily({ root: absoluteRoot, directory, installationId, now });
    findings.push(...result.findings);
    return result;
  });

  // The stamp says "today has been handled", so only a run that actually archived may set it. A pass
  // that timed out before its first step did nothing, and stamping it would silently hand the day to
  // tomorrow's run -- which would find the same day already archived and never notice the hole.
  const archivedOk = steps.find(item => item.step === 'archive')?.status === 'ok';
  if (archivedOk) writeMemoryDailyStamp(absoluteRoot, day);

  // A step that failed or never ran is the one outcome silence must not cover: the trace records it,
  // but nobody reads the trace, and a window that cannot close or a day that cannot be archived
  // would otherwise fail the same way every session with nothing said.
  for (const item of steps.filter(each => each.status === 'failed')) {
    const error = String(item.error || 'no error message').replace(/\s+/gu, ' ');
    findings.push(`the ${item.step} step failed: ${error.length > 200 ? `${error.slice(0, 200)}…` : error}`);
  }
  const skipped = steps.filter(each => each.status === 'skipped' && each.reason === 'timeout').map(each => each.step);
  if (skipped.length > 0) {
    findings.push(`the ${timeoutMs}ms budget ran out before these steps ran: ${skipped.join(', ')}`);
  }

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
