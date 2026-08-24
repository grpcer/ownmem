// The one signal the user produces directly: pushing back on what just happened.
//
// This is the G1 surface, and it does not need a new hook. The host already writes every turn to a
// transcript, and every user row in it carries the id of the prompt that caused the turn -- the same
// id the tool events are stamped with. So the turn that just ended can be read at Stop, from a file
// that already exists, with no per-prompt cost and with exact episode attribution rather than an
// inference from timestamps.
//
// What is recorded is the classification, never the words. A prompt is the single most sensitive
// thing in a session -- it is where the user's business, their customers and their reasoning live --
// so nothing here writes text: the payload is a fixed set of marker names, a length bucket, and two
// keyed episode ids.
//
// The lexicon and the length cut are both measured, not guessed. Over 601 real human-typed turns in
// one repository's local transcripts (99 sessions), the markers below fired on 17 turns. Reading
// them: above ~200 characters every single hit was a long task assignment that happened to contain
// one of these words as an instruction rather than as pushback -- "revert this file when done" is a
// job, not a complaint. At or below 200 characters there were 7 hits and all 7 were genuine
// pushback. So the cut is not a style choice: it is the boundary the measurement drew, and above it
// this detector has no precision at all.

const CORRECTION_MARKERS = Object.freeze([
  ['negation', /不对|不是这样|错了|搞错|弄错|不应该|别这样|不要这样|你理解错|理解有误|说反了|报错了/u],
  ['still_broken', /还是不行|仍然不行|还是有问题|依然报错|还是报错|没修好|又坏了/u],
  ['undo', /回滚|撤销|退回去|改回来|恢复原样|重来|重新做/u],
  ['negation_en', /\b(?:that'?s wrong|not right|incorrect|you misunderstood|wrong again)\b/iu],
  ['still_broken_en', /\b(?:still (?:broken|failing|fails|not working)|same error|didn'?t work)\b/iu],
  ['undo_en', /\b(?:revert|undo that|roll ?back|start over)\b/iu],
]);

/**
 * The length above which this detector is not used.
 *
 * See the measurement in the header: past this point the markers only ever matched instructions.
 * Raising it does not find more corrections, it finds task descriptions that contain the word.
 */
export const CORRECTION_MAX_PROMPT_CHARS = 200;

/** Coarse enough that the number says nothing about the content, fine enough to spot a drift. */
function lengthBucket(length) {
  if (length <= 40) return 'xs';
  if (length <= 80) return 's';
  if (length <= 200) return 'm';
  return 'l';
}

function rowText(row) {
  const content = row?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const text = content.find(part => part && part.type === 'text');
  return typeof text?.text === 'string' ? text.text : null;
}

/**
 * The human-typed prompts in a transcript, oldest first.
 *
 * `promptSource` is the host's own distinction and the only reliable one: a transcript's user rows
 * also carry tool results, task notifications and compaction notices, and every heuristic that tried
 * to tell those apart by looking at the text got some of them wrong. Rows without the field are
 * skipped rather than guessed at -- a host that does not provide it simply yields no corrections,
 * which is honest, where guessing would quietly classify tool output as something the user said.
 */
export function humanTypedTurns(rows) {
  return rows.filter(row => (
    row?.type === 'user'
    && !row.isMeta
    && (row.promptSource === 'typed' || row.promptSource === 'queued')
    && typeof row.promptId === 'string'
    && row.promptId.length > 0
    && typeof rowText(row) === 'string'
  ));
}

export function correctionMarkers(text) {
  if (typeof text !== 'string') return [];
  if (text.length > CORRECTION_MAX_PROMPT_CHARS) return [];
  return CORRECTION_MARKERS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

/**
 * Reduce a transcript to the correction payload for the turn that just ended, or null.
 *
 * Null is the ordinary case: most turns are not corrections. It is also what a transcript with no
 * usable rows produces, and what a host that stamps no prompt id produces -- all three are "nothing
 * to record" rather than errors, because this runs on a hook that must never fail a turn.
 *
 * `hmac` is injected so the caller owns the key material and a test can run the whole reduction
 * without touching the machine's key file.
 */
export function reduceTurnCorrection(rows, { hmac } = {}) {
  const turns = humanTypedTurns(rows);
  const current = turns.at(-1);
  if (!current) return null;
  const markers = correctionMarkers(rowText(current));
  if (markers.length === 0) return null;
  const digest = value => (typeof hmac === 'function' ? hmac(value) : null);
  const episodeId = digest(current.promptId);
  if (!episodeId) return null;
  // The turn this one is pushing back on. Taken from the transcript's own order rather than from a
  // time window, so it is a fact about the session and not a guess -- but it is still only the turn
  // that came before, which is why the candidate built from it is a temporal association and says
  // so. A user correcting something from three turns ago produces the same shape and would be
  // attributed to the wrong turn; nothing here can tell the difference, and pretending otherwise is
  // the failure this whole surface is supposed to avoid.
  const previous = turns.at(-2);
  return {
    markers,
    prompt_length: lengthBucket(rowText(current).length),
    episode_id: episodeId,
    corrected_episode_id: previous ? digest(previous.promptId) : null,
    session_id: typeof current.sessionId === 'string' ? digest(current.sessionId) : null,
  };
}
