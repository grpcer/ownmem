// Candidates: leads extracted from episodes, quarantined by construction.
//
// A candidate is never a memory. It is a structured fact about something that happened -- "this
// command was red four times across two turns and then went green" -- offered to a person who can
// decide whether any lesson is worth writing. Three properties make that safe, and each is enforced
// here rather than left to the caller remembering:
//
//   1. It is never injectable. `lifecycle: 'candidate'` is not in the injectable set, and the
//      recall path resolves lifecycle from the trust lock, which a candidate has no receipt in.
//      There is no code path from this file to a delivered context, and a test asserts that.
//   2. It states no cause. The extractor is deterministic and writes only what the ledger observed;
//      it never proposes why the command started passing. "The test passed after the last edit" is
//      not "the last edit fixed it", and the plan is explicit that the model must not fill causal
//      gaps.
//   3. Rejecting one is remembered. Without a reject receipt the same bad lead is regenerated every
//      time the extractor runs, and the review queue trains its reader to ignore it.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateMemoryCandidate } from './memory-contracts.mjs';
import { MEMORY_PROPOSAL_PRODUCER, MEMORY_PROPOSAL_PRODUCER_VERSION } from './memory-proposals.mjs';

export const MEMORY_CANDIDATE_SCHEMA = 'ownmem-candidate/v1';
// v2 because a candidate's shape changed under it: `logical_type` moved to the real logical-type
// vocabulary and is now schema-checked. Old rows are refused with a runnable remedy rather than
// migrated -- this directory is discardable local telemetry, and a migration would be permanent
// code carrying a week of history.
export const MEMORY_CANDIDATE_LEDGER_SCHEMA = 'ownmem-candidate-ledger/v2';
export const DEFAULT_MEMORY_CANDIDATE_DIRECTORY = '.local-test/memory-candidates';

/**
 * How many times something must have failed before its recovery is worth a person's attention.
 *
 * One failure is a typo being fixed, which describes most red runs in any session. Failing twice
 * and then passing is the smallest shape that means "it did not go green on the obvious try". The
 * threshold counts failures rather than turns because only one of the two execution kinds knows
 * which turn it happened in: gates run from lock scripts and belong to no turn, and gates are the
 * kind that actually produces this signal here -- measured on the full local ledger, gates gave 9
 * failed -> passed transitions and commands gave 0.
 *
 * Two is the smallest value that expresses "not the obvious try", not a statistically meaningful
 * number, and nothing downstream treats it as one.
 */
export const CANDIDATE_MIN_FAILURES = 2;

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function ledgerFile(root, directory) {
  return path.join(path.resolve(root), directory, 'candidates.json');
}

export function readCandidateLedger({ root, directory = DEFAULT_MEMORY_CANDIDATE_DIRECTORY } = {}) {
  const file = ledgerFile(root, directory);
  if (!existsSync(file)) return { schema: MEMORY_CANDIDATE_LEDGER_SCHEMA, candidates: {}, rejected: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed.schema !== MEMORY_CANDIDATE_LEDGER_SCHEMA) {
      // A clean break, the same rule the rest of 0.3.0 follows: rows written under an older schema
      // are refused rather than migrated, and this directory is discardable local telemetry.
      throw new Error(`candidate ledger schema ${parsed.schema} is not ${MEMORY_CANDIDATE_LEDGER_SCHEMA}; delete ${file} and let it rebuild`);
    }
    return { schema: parsed.schema, candidates: parsed.candidates || {}, rejected: parsed.rejected || {} };
  } catch (error) {
    if (error.message.includes('is not ownmem-candidate-ledger')) throw error;
    throw new Error(`candidate ledger at ${file} is unreadable: ${error.message}`);
  }
}

export function writeCandidateLedger({ root, directory = DEFAULT_MEMORY_CANDIDATE_DIRECTORY, ledger }) {
  // The last gate before anything reaches a reviewer. Validating at extraction alone would leave a
  // producer that builds its object some other way -- a host adapter, a later model extractor --
  // free to write whatever it liked, and the schema's whole promise is that no such path exists.
  for (const candidate of Object.values(ledger.candidates || {})) validateMemoryCandidate(candidate);
  const file = ledgerFile(root, directory);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return file;
}

/**
 * The identity of a lead, which has to be stable across runs or a rejection cannot stick.
 *
 * It is keyed on the execution and its first failure, not on the recovery: re-running the extractor
 * after another failure of the same thing must produce the same candidate with a higher count, not
 * a second one that slips past the rejection.
 */
export function candidateId(recovery) {
  return digest(`recovery ${recovery.identity} ${recovery.first_failure_at}`);
}

/**
 * The identity of a maintenance proposal.
 *
 * Keyed on the kind and the pair, not on the similarity numbers or the run: re-scanning after an
 * unrelated edit must land on the same id, or a rejection would stop sticking the moment either
 * topic was touched -- which is precisely when the pair gets looked at again.
 */
export function proposalId(observation) {
  const discriminator = observation.kind === 'authority-conflict' ? ` ${observation.document}` : '';
  return digest(`proposal ${observation.kind} ${observation.members.join('\0')}${discriminator}`);
}

/**
 * Turn recovery contexts into candidates. Deterministic, and it is the whole extractor: the plan
 * allows a host-assisted or opt-in model extractor later, but nothing here needs one, and adding a
 * model to summarize a fact the ledger already states exactly would only add a way to be wrong.
 */
export function extractMemoryCandidates(recoveries, {
  minFailures = CANDIDATE_MIN_FAILURES,
  externalContextPresent = false,
} = {}) {
  // A session that has read untrusted external content must not produce candidates at all. It is
  // the cheapest poisoning defence available: an attacker who can get text into the session cannot
  // reach the review queue if the queue was never written that session.
  if (externalContextPresent) return [];
  return recoveries
    .filter(recovery => recovery.failures >= minFailures)
    .map(recovery => validateMemoryCandidate({
      schema: MEMORY_CANDIDATE_SCHEMA,
      candidate_id: candidateId(recovery),
      // Not `observed`: observed is a lifecycle a memory can be recalled at. `candidate` is the one
      // state with no path into a delivered context.
      lifecycle: 'candidate',
      // `diagnostic` is the logical-type vocabulary; `debug` is the front-matter `type` that maps
      // onto it. Writing the wrong one here was invisible until the schema below started checking.
      logical_type: 'diagnostic',
      // What the ledger saw, in the ledger's own terms. No cause, no advice, no prose that could be
      // mistaken for a lesson someone wrote.
      observation: {
        kind: `${recovery.kind}-recovery`,
        label: recovery.label,
        identity: recovery.identity,
        failures: recovery.failures,
        // Null for gates, which belong to no turn. Not zero and not omitted: a reader has to be
        // able to tell "fixed within one turn" from "we cannot know".
        episodes: recovery.episodes,
        first_failure_at: recovery.first_failure_at,
        recovered_at: recovery.recovered_at,
      },
      // Which memories were on screen during the red streak. Association only, and labelled so.
      recalled_topics: [...recovery.recalled_topics],
      attribution: recovery.attribution,
      provenance: {
        episode_id: recovery.episode_id || null,
        // Null for gates, which run outside any session. That null is what forces the coarser
        // time-window check in withoutExternallyTaintedCandidates rather than a silent pass.
        session_id: recovery.session_id || null,
        producer: 'deterministic-recovery-extractor',
        producer_version: 1,
      },
      // Nothing about a candidate may authorize anything. Stated in the object because the object
      // is what a reviewer reads, and because a future caller must not have to infer it.
      policy: {
        injectable: false,
        can_authorize_actions: false,
        requires_human_review: true,
      },
    }));
}

/**
 * Which sessions and which stretches of time read untrusted external text.
 *
 * Two shapes because the producers have two shapes. A command or a correction knows which session
 * it belonged to, so it can be excluded exactly. A gate runs from a lock script and belongs to no
 * session, so the only thing that can be said about it is whether untrusted text arrived while it
 * was red -- which is coarser, and deliberately errs toward refusing.
 */
export function externalContextTaint(events) {
  const sessions = new Set();
  const moments = [];
  for (const event of events) {
    if (event.event !== 'external.context.observed') continue;
    if (event.payload?.session_id) sessions.add(event.payload.session_id);
    moments.push(event.recorded_at);
  }
  return { sessions, moments: moments.sort() };
}

function taintedByWindow(taint, from, to) {
  return taint.moments.some(moment => moment >= from && moment <= to);
}

/**
 * Drop leads that came out of a session which had read untrusted external text.
 *
 * The rule is the cheapest poisoning defence there is: an attacker who can get text into a session
 * cannot reach the review queue if nothing from that session was allowed into it. It runs over
 * extracted candidates rather than inside each producer so that a producer added later is covered
 * without having to remember, and it returns what it dropped so the refusal is visible instead of
 * looking like a quiet day.
 */
export function withoutExternallyTaintedCandidates(candidates, taint) {
  if (taint.sessions.size === 0 && taint.moments.length === 0) return { kept: candidates, dropped: [] };
  const kept = [];
  const dropped = [];
  for (const candidate of candidates) {
    const session = candidate.provenance.session_id || null;
    const window = candidate.observation.kind.endsWith('-recovery')
      ? [candidate.observation.first_failure_at, candidate.observation.recovered_at]
      : null;
    const tainted = session
      ? taint.sessions.has(session)
      : Boolean(window) && taintedByWindow(taint, window[0], window[1]);
    (tainted ? dropped : kept).push(candidate);
  }
  return { kept, dropped };
}

/**
 * The identity of a correction lead: the turn that was corrected, and nothing else.
 *
 * Not keyed on the markers or on when it was observed, so a second push-back in the same turn
 * updates one lead rather than minting another -- and so a rejection survives the user saying it
 * again in different words.
 */
export function correctionId(correction) {
  return digest(`correction ${correction.corrected_episode_id}`);
}

/**
 * Leads built from the user saying something was wrong.
 *
 * There is no failure threshold here, unlike recoveries. One red run is usually a typo, so counting
 * matters there; one correction from the user is already the strongest evidence this system ever
 * receives, and asking for a second would mean waiting for the same mistake twice on purpose.
 */
export function buildCorrectionCandidates(corrections, { externalContextPresent = false } = {}) {
  if (externalContextPresent) return [];
  return corrections.map(correction => validateMemoryCandidate({
    schema: MEMORY_CANDIDATE_SCHEMA,
    candidate_id: correctionId(correction),
    lifecycle: 'candidate',
    // Null: this is a lead about memories that already exist being wrong, not a proposal to write a
    // new one of some type. What a reviewer does with it is retire, correct or narrow the scope.
    logical_type: null,
    observation: {
      kind: 'user-correction',
      label: correction.markers.join('+'),
      markers: [...correction.markers],
      prompt_length: correction.prompt_length,
      observed_at: correction.observed_at,
    },
    recalled_topics: [...correction.recalled_topics],
    attribution: 'temporal_association',
    provenance: {
      episode_id: correction.corrected_episode_id,
      session_id: correction.session_id || null,
      producer: 'deterministic-correction-extractor',
      producer_version: 1,
    },
    policy: {
      injectable: false,
      can_authorize_actions: false,
      requires_human_review: true,
    },
  }));
}

/**
 * Wrap maintenance observations in the same quarantine every candidate wears.
 *
 * Separate from the recovery extractor because the two see different worlds -- one reads the event
 * ledger, the other reads the corpus -- but deliberately not a separate candidate type: a reviewer
 * has one queue, one rejection command and one guarantee about what a lead may do. Union-Find style
 * automatic merging is what this function exists instead of: nothing here touches a memory file.
 */
export function buildMaintenanceCandidates(observations, { externalContextPresent = false } = {}) {
  // The corpus is not untrusted input the way a session transcript is, but the rule is about the
  // session, not the source: a session that read untrusted text must not be able to put anything in
  // front of a reviewer, whichever producer it went through.
  if (externalContextPresent) return [];
  return observations.map(observation => validateMemoryCandidate({
    schema: MEMORY_CANDIDATE_SCHEMA,
    candidate_id: proposalId(observation),
    lifecycle: 'candidate',
    // Null on purpose. A duplicate pair is not a proposal to write a memory of some type, it is a
    // proposal to do maintenance on two that already exist; naming a type here would be wrong in a
    // way that reads as informative.
    logical_type: null,
    observation,
    // The pair itself is in `observation.members`. This field means "memories that were on screen
    // while something was happening", and for a structural finding nothing was happening.
    recalled_topics: [],
    // Not temporal: this is what the front matter says, today, with no window and no timing.
    attribution: 'structural',
    provenance: {
      episode_id: null,
      // A corpus proposal comes from files on disk, not from a session, so no session can taint it
      // and no window applies. The declared `--external-context` scan still suppresses it.
      session_id: null,
      producer: MEMORY_PROPOSAL_PRODUCER,
      producer_version: MEMORY_PROPOSAL_PRODUCER_VERSION,
    },
    policy: {
      injectable: false,
      can_authorize_actions: false,
      requires_human_review: true,
    },
  }));
}

/**
 * Merge freshly extracted candidates into the ledger, dropping ones a person already rejected.
 *
 * The dedup key is the candidate id, so re-running the extractor is idempotent: an existing
 * candidate keeps its first_seen and takes the newer observation, which is how a growing failure
 * count reaches the reviewer without spawning a second entry.
 */
export function mergeMemoryCandidates(ledger, candidates, { now = new Date() } = {}) {
  const merged = { ...ledger, candidates: { ...ledger.candidates }, rejected: { ...ledger.rejected } };
  const accepted = [];
  const suppressed = [];
  for (const candidate of candidates) {
    if (merged.rejected[candidate.candidate_id]) {
      suppressed.push(candidate.candidate_id);
      continue;
    }
    const existing = merged.candidates[candidate.candidate_id];
    merged.candidates[candidate.candidate_id] = {
      ...candidate,
      first_seen_at: existing?.first_seen_at || now.toISOString(),
      last_seen_at: now.toISOString(),
    };
    accepted.push(candidate.candidate_id);
  }
  return { ledger: merged, accepted, suppressed };
}

/**
 * Record that a person looked at a candidate and said no.
 *
 * The reason is required and the summary is kept, because a rejection with no record of what was
 * rejected is indistinguishable from a candidate that was never generated, and the next reader
 * cannot tell whether the extractor is quiet or the queue is being silently drained.
 */
export function rejectMemoryCandidate(ledger, candidateId, { reason, now = new Date() } = {}) {
  if (!reason || !String(reason).trim()) throw new Error('rejecting a candidate requires a reason');
  const candidate = ledger.candidates[candidateId];
  if (!candidate && !ledger.rejected[candidateId]) throw new Error(`unknown candidate ${candidateId}`);
  const merged = { ...ledger, candidates: { ...ledger.candidates }, rejected: { ...ledger.rejected } };
  delete merged.candidates[candidateId];
  merged.rejected[candidateId] = {
    rejected_at: now.toISOString(),
    reason: String(reason).slice(0, 300),
    observation: candidate?.observation || ledger.rejected[candidateId]?.observation || null,
  };
  return merged;
}
