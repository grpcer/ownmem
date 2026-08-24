// Episodes: what happened in one user turn, derived from the local event ledger.
//
// An episode is not stored. It is projected from events that were already written for their own
// reasons, which is what keeps this cheap and keeps the privacy surface unchanged: there is no new
// writer, no new file and no new field to leak through. The only thing that made it possible was
// the host already stamping every tool event with the id of the prompt that caused it.
//
// The shape is deliberately narrow. The plan sketches an episode with a task fingerprint, a repo
// state and a scope list, and none of those have a producer today: writing them as permanent nulls
// would repeat the `valid_for` mistake, where a gate ran on every query for weeks against fields
// nothing ever filled in. Fields appear here when something produces them.

import { findExecutionRecoveries } from './memory-tool-events.mjs';

export const MEMORY_EPISODE_SCHEMA = 'ownmem-episode/v1';

/**
 * Events that belong to a turn. Anything without an episode_id is skipped rather than bucketed
 * together: a command-line recall genuinely has no turn, and collecting all of them under one
 * synthetic episode would invent a task that never happened.
 */
const EPISODE_EVENTS = new Set(['recall.completed', 'command.completed']);

function earlier(left, right) {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

function later(left, right) {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

/**
 * Group the ledger into turns.
 *
 * Ordering is by the ledger's own recorded_at rather than by read order, because a recall is
 * written by the daemon and a command by the hook process: two writers appending to one file can
 * interleave, and a recovery detector that trusted file order would occasionally see a command
 * pass before the failure it recovered from.
 */
export function buildMemoryEpisodes(events, { consumedTraceIds } = {}) {
  const consumed = consumedTraceIds || new Set(
    events.filter(event => event.event === 'recall.consumed').map(event => event.trace_id),
  );
  const ordered = events
    .filter(event => EPISODE_EVENTS.has(event.event) && event.payload?.episode_id)
    .sort((left, right) => (left.recorded_at < right.recorded_at ? -1 : left.recorded_at > right.recorded_at ? 1 : 0));

  const episodes = new Map();
  for (const event of ordered) {
    const id = event.payload.episode_id;
    let episode = episodes.get(id);
    if (!episode) {
      episode = {
        schema: MEMORY_EPISODE_SCHEMA,
        episode_id: id,
        started_at: null,
        ended_at: null,
        host: 'generic',
        recalls: [],
        commands: [],
        recoveries: [],
      };
      episodes.set(id, episode);
    }
    episode.started_at = earlier(episode.started_at, event.recorded_at);
    episode.ended_at = later(episode.ended_at, event.recorded_at);
    if (event.event === 'recall.completed') {
      // The surface is the only thing in the ledger that names a host, and only the hook surface
      // has turns at all, so seeing one is what upgrades the episode's host from the default.
      if (event.payload.surface === 'claude-hook') episode.host = 'claude';
      episode.recalls.push({
        trace_id: event.trace_id,
        recorded_at: event.recorded_at,
        topics: [...(event.payload.returned_topics || [])],
        abstained: Boolean(event.payload.abstained),
        // Whether anyone opened the full text. It is the strongest consumption signal the ledger
        // has, and it is still not evidence the answer used it.
        consumed: consumed.has(event.trace_id),
      });
      continue;
    }
    episode.commands.push({
      command_id: event.payload.command_id,
      program: event.payload.program,
      status: event.payload.status,
      exit_code: event.payload.exit_code,
      recorded_at: event.recorded_at,
    });
  }

  // Recoveries live outside the episode map, in recoveryContext below. Gates -- the kind that
  // actually produces this signal here -- run from lock scripts and belong to no turn, so a
  // per-episode recovery list would silently drop the useful half.
  for (const recovery of findExecutionRecoveries(ordered)) {
    if (recovery.episode_id && episodes.has(recovery.episode_id)) {
      episodes.get(recovery.episode_id).recoveries.push(recovery);
    }
  }

  return [...episodes.values()].sort((left, right) => (left.started_at < right.started_at ? -1 : 1));
}

/**
 * Corrections the user made, paired with the memories that were on screen in the turn they are
 * pushing back on.
 *
 * This is the only signal in the ledger that comes from the user rather than from a machine, which
 * is exactly why it is filtered hard: a correction in a turn where no memory was delivered says
 * nothing about memory, and putting it in a memory review queue would fill that queue with the
 * user's ordinary course corrections. What is kept is the narrow case this system can act on --
 * a memory was on screen, and then the user said it was wrong.
 *
 * The pairing is still `temporal_association`. `corrected_episode_id` is the turn immediately
 * before the correction, taken from the transcript's own order, and a user correcting something
 * from three turns back produces the same shape. Nothing here can tell those apart.
 */
export function correctionContext(events) {
  const deliveredByEpisode = new Map();
  for (const event of events) {
    if (event.event !== 'recall.completed') continue;
    const episodeId = event.payload?.episode_id;
    if (!episodeId) continue;
    const topics = deliveredByEpisode.get(episodeId) || new Set();
    for (const topic of event.payload.returned_topics || []) topics.add(topic);
    deliveredByEpisode.set(episodeId, topics);
  }
  return events
    .filter(event => event.event === 'correction.observed' && event.payload?.corrected_episode_id)
    .map(event => ({
      markers: [...event.payload.markers],
      prompt_length: event.payload.prompt_length,
      observed_at: event.recorded_at,
      episode_id: event.payload.episode_id,
      corrected_episode_id: event.payload.corrected_episode_id,
      session_id: event.payload.session_id || null,
      recalled_topics: [...(deliveredByEpisode.get(event.payload.corrected_episode_id) || [])]
        .sort((left, right) => left.localeCompare(right, 'en')),
    }))
    .filter(correction => correction.recalled_topics.length > 0);
}

/**
 * Every recovery in the ledger, with the memories that were on screen while it was red.
 *
 * It reads the whole event stream rather than the episode map because gates -- the kind that
 * carries this signal on this repository -- have no turn to belong to. Membership is by time
 * window, which is honest here in a way it would not be for episodes: the window is bounded by two
 * observed events, not chosen to make an association appear.
 *
 * The window opens at the FIRST FAILURE. A recall that happened just before it -- often the most
 * relevant one, since an agent recalls before editing and only then runs the thing that goes red --
 * is therefore not included. Widening it means choosing a lead-in interval, and no measurement here
 * says which one; the narrow window under-reports rather than inventing an association.
 *
 * The association is labelled `temporal_association` and nothing stronger. Calling it a
 * contribution would require replaying the fix with the memory withheld, which nothing here does.
 */
export function recoveryContext(events) {
  const recalls = events
    .filter(event => event.event === 'recall.completed')
    .map(event => ({
      recorded_at: event.recorded_at,
      topics: event.payload?.returned_topics || [],
    }));
  return findExecutionRecoveries(
    [...events].sort((left, right) => (left.recorded_at < right.recorded_at ? -1 : left.recorded_at > right.recorded_at ? 1 : 0)),
  ).map(recovery => {
    const topics = new Set();
    for (const recall of recalls) {
      if (recall.recorded_at < recovery.first_failure_at || recall.recorded_at > recovery.recovered_at) continue;
      for (const topic of recall.topics) topics.add(topic);
    }
    return {
      ...recovery,
      recalled_topics: [...topics].sort((left, right) => left.localeCompare(right, 'en')),
      attribution: 'temporal_association',
    };
  });
}
