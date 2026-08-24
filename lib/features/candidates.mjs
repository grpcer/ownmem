#!/usr/bin/env node

// The review queue: what the ledger noticed, offered for review, and nothing more.
//
// Everything this command surfaces is quarantined by construction -- a candidate has no trust
// receipt, its lifecycle is not injectable, and no code path leads from this file to a delivered
// context. It is a queue a human reads, not an input to recall.
//
// The end-of-turn coordinator scans it off the interaction path, and the CLI exposes the same
// producer explicitly. Filling the queue is automatic; promotion out of this quarantined queue is
// still governed separately by risk and evidence.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';
import {
  DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  readMemoryObservabilityEvents,
} from '../memory-observability.mjs';
import { buildMemoryEpisodes, correctionContext, recoveryContext } from '../memory-episodes.mjs';
import {
  buildCorrectionCandidates,
  buildMaintenanceCandidates,
  externalContextTaint,
  withoutExternallyTaintedCandidates,
  CANDIDATE_MIN_FAILURES,
  DEFAULT_MEMORY_CANDIDATE_DIRECTORY,
  extractMemoryCandidates,
  mergeMemoryCandidates,
  readCandidateLedger,
  rejectMemoryCandidate,
  writeCandidateLedger,
} from '../memory-candidates.mjs';
import { findMemoryMaintenanceObservations } from '../memory-proposals.mjs';

const USAGE = `Usage: ownmem candidates <scan|list|episodes|reject> [options]

  scan                      Derive candidates from the local event ledger and merge them in
  list                      Show the current review queue
  episodes                  Show the turns the ledger can reconstruct
  reject <id> --reason <r>  Record that a candidate was reviewed and declined

Options:
  --root <path>             Repository root (default: cwd)
  --memory-dir <path>       Memory directory the maintenance proposals read (default: .claude/memory)
  --json                    Emit JSON instead of text
  --min-failures <n>        How many failures must precede a recovery to be worth review (default: ${CANDIDATE_MIN_FAILURES})
  --external-context        Untrusted external content was in this session; extract nothing`;

function takeValue(args, index, option) {
  const value = args[index + 1];
  if (value === undefined) throw new Error(`${option} requires a value`);
  return value;
}

export function parseCandidateOptions(rawArgs = []) {
  const options = {
    command: null,
    root: process.env.OWNMEM_ROOT || process.cwd(),
    observabilityDirectory: DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
    directory: DEFAULT_MEMORY_CANDIDATE_DIRECTORY,
    memoryDir: '.claude/memory',
    json: false,
    minFailures: CANDIDATE_MIN_FAILURES,
    externalContextPresent: false,
    candidateId: null,
    reason: null,
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];
    if (argument === '--json') options.json = true;
    else if (argument === '--external-context') options.externalContextPresent = true;
    else if (argument.startsWith('--')) {
      const value = takeValue(rawArgs, index, argument);
      index += 1;
      if (argument === '--root') options.root = path.resolve(value);
      else if (argument === '--observability-dir') options.observabilityDirectory = value;
      else if (argument === '--memory-dir') options.memoryDir = value;
      else if (argument === '--candidates-dir') options.directory = value;
      else if (argument === '--reason') options.reason = value;
      else if (argument === '--min-failures') {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--min-failures requires a positive integer');
        options.minFailures = parsed;
      } else throw new Error(`unknown candidates option: ${argument}`);
    } else if (!options.command) options.command = argument;
    else if (!options.candidateId) options.candidateId = argument;
    else throw new Error(`unexpected argument: ${argument}`);
  }
  if (!options.command) throw new Error(`candidates requires a subcommand.\n\n${USAGE}`);
  if (!['scan', 'list', 'episodes', 'reject'].includes(options.command)) {
    throw new Error(`unknown candidates subcommand: ${options.command}`);
  }
  return options;
}

function loadEvents(options) {
  return readMemoryObservabilityEvents({
    root: options.root,
    directory: options.observabilityDirectory,
  }).events;
}

function describeCandidate(candidate) {
  const observed = candidate.observation;
  const header = `${candidate.candidate_id.slice(0, 12)}  ${observed.kind}  ${observed.label}`;
  if (observed.kind === 'user-correction') {
    return [
      header,
      `    the user pushed back at ${observed.observed_at}, right after these were on screen:`,
      `    ${candidate.recalled_topics.join(', ')}`,
      '    temporal_association only: this is the turn before the correction, not a turn the user named.',
      '    Only the classification of what they typed is recorded; the words are not.',
    ].join('\n');
  }
  if (candidate.attribution === 'structural') {
    const detail = observed.kind === 'duplicate-pair'
      ? `    simhash ${observed.simhash_similarity} · minhash ${observed.minhash_similarity}`
      : observed.kind === 'authority-conflict'
        ? `    one calls ${observed.document} current authority, the other calls it history`
        : `    ${observed.members[0]} declares supersedes: [${observed.members[1]}], and that one is still active`;
    return [
      header,
      detail,
      '    structural: this is what the front matter says today, not something inferred from behaviour.',
      '    A proposal only. Nothing merges, archives or edits a memory on its own.',
    ].join('\n');
  }
  const topics = candidate.recalled_topics.length > 0
    ? candidate.recalled_topics.join(', ')
    : '(none recalled during the streak)';
  return [
    header,
    `    failed ${observed.failures}x${observed.episodes === null ? '' : ` across ${observed.episodes} turn(s)`}, then passed`,
    `    ${observed.first_failure_at} -> ${observed.recovered_at}`,
    `    memories on screen: ${topics}`,
    `    ${candidate.attribution} only; no cause is claimed. Review before writing anything down.`,
  ].join('\n');
}

/**
 * Derive the local review queue without coupling the operation to terminal output.
 *
 * Host automation uses the same producer as the explicit CLI. `write: false` is a true preview:
 * it computes the merged ledger but leaves the ignored local queue untouched.
 */
export function scanCandidateQueue(options, { now = new Date(), write = true } = {}) {
  const events = loadEvents(options);
  const episodes = buildMemoryEpisodes(events);
  const context = recoveryContext(events);
  const extracted = extractMemoryCandidates(context, {
    minFailures: options.minFailures,
    externalContextPresent: options.externalContextPresent,
  });
  const corrections = buildCorrectionCandidates(correctionContext(events), {
    externalContextPresent: options.externalContextPresent,
  });
  const memoryDirPresent = existsSync(path.resolve(options.root, options.memoryDir));
  const proposals = buildMaintenanceCandidates(
    findMemoryMaintenanceObservations({ root: options.root, memoryDir: options.memoryDir }),
    { externalContextPresent: options.externalContextPresent },
  );
  const taint = externalContextTaint(events);
  const filtered = withoutExternallyTaintedCandidates([...extracted, ...corrections, ...proposals], taint);
  const ledger = readCandidateLedger({ root: options.root, directory: options.directory });
  const merged = mergeMemoryCandidates(ledger, filtered.kept, { now });
  if (write) writeCandidateLedger({ root: options.root, directory: options.directory, ledger: merged.ledger });
  return {
    schema: 'ownmem-candidate-scan/v1',
    episodes: episodes.length,
    recoveries: context.length,
    extracted: extracted.length,
    corrections: corrections.length,
    proposals: proposals.length,
    memory_dir_present: memoryDirPresent,
    accepted: merged.accepted.length,
    suppressed_by_rejection: merged.suppressed.length,
    suppressed_by_external_context: filtered.dropped.length,
    external_context_sessions: taint.sessions.size,
    queue: Object.keys(merged.ledger.candidates).length,
    external_context_present: options.externalContextPresent,
    wrote: write,
  };
}

export function runCli(rawArgs = process.argv.slice(2), { now = new Date() } = {}) {
  const options = parseCandidateOptions(rawArgs);

  if (options.command === 'episodes') {
    const episodes = buildMemoryEpisodes(loadEvents(options));
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ schema: 'ownmem-episodes-result/v1', episodes }, null, 2)}\n`);
      return 0;
    }
    if (episodes.length === 0) {
      process.stdout.write('No turns to reconstruct. Only host tool events carry a turn id; command-line recalls have none.\n');
      return 0;
    }
    for (const episode of episodes) {
      const recalled = new Set(episode.recalls.flatMap(recall => recall.topics));
      process.stdout.write(`${episode.episode_id.slice(0, 12)}  ${episode.started_at} -> ${episode.ended_at}  host=${episode.host}\n`);
      process.stdout.write(`    recalls ${episode.recalls.length} (${recalled.size} topic(s)) · commands ${episode.commands.length} · recoveries ${episode.recoveries.length}\n`);
    }
    process.stdout.write(`${episodes.length} turn(s).\n`);
    return 0;
  }

  if (options.command === 'scan') {
    const summary = scanCandidateQueue(options, { now, write: true });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return 0;
    }
    if (options.externalContextPresent) {
      process.stdout.write('Untrusted external content was declared for this session; no candidates were extracted.\n');
      return 0;
    }
    process.stdout.write(`Scanned ${summary.episodes} turn(s): ${summary.recoveries} recovery(ies), `
      + `${summary.extracted} candidate(s) at >=${options.minFailures} failure(s), `
      + `${summary.corrections} user correction(s), `
      + `${summary.proposals} maintenance proposal(s)${summary.memory_dir_present ? '' : ' (no memory directory to read)'}, `
      + `${summary.suppressed_by_rejection} suppressed by an earlier rejection, `
      + `${summary.suppressed_by_external_context} suppressed by untrusted external context `
      + `(${summary.external_context_sessions} tainted session(s)). Queue: ${summary.queue}.\n`);
    return 0;
  }

  if (options.command === 'list') {
    const ledger = readCandidateLedger({ root: options.root, directory: options.directory });
    const candidates = Object.values(ledger.candidates);
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ schema: 'ownmem-candidate-list/v1', candidates, rejected: ledger.rejected }, null, 2)}\n`);
      return 0;
    }
    if (candidates.length === 0) {
      process.stdout.write('Review queue empty. Run `ownmem candidates scan` after some work has happened.\n');
      return 0;
    }
    for (const candidate of candidates) process.stdout.write(`${describeCandidate(candidate)}\n`);
    process.stdout.write(`${candidates.length} candidate(s) awaiting review; `
      + `${Object.keys(ledger.rejected).length} previously rejected and not regenerated.\n`);
    return 0;
  }

  if (!options.candidateId) throw new Error('reject requires a candidate id');
  if (!options.reason) throw new Error('reject requires --reason');
  const ledger = readCandidateLedger({ root: options.root, directory: options.directory });
  const matches = Object.keys(ledger.candidates).filter(id => id.startsWith(options.candidateId));
  if (matches.length === 0) throw new Error(`unknown candidate ${options.candidateId}`);
  if (matches.length > 1) throw new Error(`candidate id ${options.candidateId} is ambiguous (${matches.length} matches)`);
  const updated = rejectMemoryCandidate(ledger, matches[0], { reason: options.reason, now });
  writeCandidateLedger({ root: options.root, directory: options.directory, ledger: updated });
  process.stdout.write(options.json
    ? `${JSON.stringify({ schema: 'ownmem-candidate-reject/v1', candidate_id: matches[0], reason: options.reason }, null, 2)}\n`
    : `Rejected ${matches[0].slice(0, 12)}. It will not be regenerated by a later scan.\n`);
  return 0;
}

if (isMemoryCliEntry(import.meta.url)) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
