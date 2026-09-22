/**
 * Which memories are candidates for the swap-out the quota requires.
 *
 * The corpus is net-zero growth: adding a topic means retiring one in the same change. That rule
 * used to be enforced by two ceilings, a topic count and a byte total, and the byte one was raised
 * by hand six times in seven weeks -- every time because a specific memory had to be written. A
 * ceiling that moves whenever it binds measures nothing, so it is gone and the count is the ratchet.
 * What was missing was the other half: when the count binds, somebody has to decide what leaves,
 * and doing that by reading 354 files is why the answer was always "raise the ceiling".
 *
 * This nominates; it never retires. The decision stays with the user, which is why the output is a
 * short ranked list with the reason attached rather than a score.
 *
 * Three rules, in order of how much they matter:
 *
 *   1. A hub is never nominated. A memory that two or more active memories link to with [[name]] is
 *      load-bearing for the knowledge graph even when it is rarely delivered on its own; archiving
 *      it fragments everything pointing at it. This mirrors MEMORY.md rule 10.
 *   2. "Not delivered" is only ever a statement about the telemetry window, and the window is
 *      published beside the count. Telemetry is local, capped and rotated, so "never delivered"
 *      means "not in the last N days of retained events", never "never used". Rendering the first
 *      as the second is exactly the kind of false precision this system is supposed to refuse.
 *   3. Evidence is reported, not scored. A topic with no code evidence is cheaper to lose than one
 *      anchored to live code, but drift belongs to `memory-audit`, which already resolves receipts;
 *      recomputing it here would double the cost of a health check to restate its answer.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const LINK_PATTERN = /\[\[([a-z0-9]+(?:_[a-z0-9]+)*)\]\]/g;
const EVENT_FILE_PATTERN = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const DELIVERY_EVENTS = new Set(['recall.completed', 'recall.delivered', 'recall.consumed']);

/**
 * Every topic name each memory file links to with [[name]].
 *
 * Every .md in the directory is read, L2 indexes included, so that an index which starts carrying
 * [[name]] links is counted without this having to be revisited. Today none of them do -- the L2
 * rows are ordinary markdown links -- so in practice every inbound edge comes from another L3.
 */
export function collectInboundLinks(memoryDirectory) {
  const inbound = new Map();
  const add = (target, source) => {
    if (!inbound.has(target)) inbound.set(target, new Set());
    inbound.get(target).add(source);
  };
  let entries;
  try {
    entries = readdirSync(memoryDirectory, { withFileTypes: true });
  } catch {
    return inbound;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const source = entry.name.replace(/\.md$/, '');
    let text;
    try {
      text = readFileSync(path.join(memoryDirectory, entry.name), 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(LINK_PATTERN)) {
      if (match[1] !== source) add(match[1], source);
    }
  }
  return inbound;
}

/**
 * The last time each topic was handed to a reader, and the window that answer is true of.
 *
 * All three recall events count. `recall.completed` is the widest and the one that matters most: it
 * fires for every recall including the CLI pulls that are most of this system's value, and since
 * the delivery tiers landed its `returned_topics` covers pointers as well as quoted prose. Reading
 * only `recall.delivered` would score the corpus on hook injections alone and nominate memories the
 * user pulled up yesterday; `recall.consumed` is the narrowest but is the strongest evidence of use,
 * so it is in there too.
 */
export function collectDeliveryRecency(observabilityDirectory) {
  const lastSeen = new Map();
  const days = [];
  let files;
  try {
    files = readdirSync(observabilityDirectory, { withFileTypes: true });
  } catch {
    return { lastSeen, window: null };
  }
  for (const file of files) {
    const match = file.isFile() ? EVENT_FILE_PATTERN.exec(file.name) : null;
    if (!match) continue;
    days.push(match[1]);
    let text;
    try {
      text = readFileSync(path.join(observabilityDirectory, file.name), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.startsWith('{')) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (!DELIVERY_EVENTS.has(event.event)) continue;
      const payload = event.payload || {};
      const topics = [...(payload.returned_topics || []), ...(payload.topics || [])];
      const at = typeof event.recorded_at === 'string' ? event.recorded_at : '';
      for (const topic of topics) {
        if (!lastSeen.has(topic) || at > lastSeen.get(topic)) lastSeen.set(topic, at);
      }
    }
  }
  days.sort();
  return {
    lastSeen,
    window: days.length === 0 ? null : { from: days[0], to: days[days.length - 1], days: days.length },
  };
}

function daysBetween(from, to) {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/**
 * Rank swap-out candidates. `topics` are the parsed active memories; `limit` caps what is rendered,
 * never what is counted.
 */
export function nominateSwapOut({ memoryDirectory, observabilityDirectory, topics, now = new Date(), limit = 8 }) {
  const inbound = collectInboundLinks(memoryDirectory);
  const { lastSeen, window } = existsSync(observabilityDirectory)
    ? collectDeliveryRecency(observabilityDirectory)
    : { lastSeen: new Map(), window: null };
  const today = now.toISOString().slice(0, 10);

  const candidates = [];
  let hubs = 0;
  for (const topic of topics) {
    const name = topic.record.name;
    const inboundCount = (inbound.get(name) || new Set()).size;
    // Rule 1: a hub is out of scope before anything else is measured.
    if (inboundCount >= 2) {
      hubs += 1;
      continue;
    }
    const seenAt = lastSeen.get(name) || null;
    candidates.push({
      name,
      type: topic.record.metadata.type,
      bytes: Buffer.byteLength(topic.content),
      inbound: inboundCount,
      last_delivered_at: seenAt,
      days_since_delivered: seenAt ? daysBetween(seenAt.slice(0, 10), today) : null,
      code_evidence: topic.record.metadata.code_evidence.length,
    });
  }

  // Never-delivered first, then longest-unseen, then no-evidence, then largest. Size is last on
  // purpose: it is the one criterion that has nothing to do with whether the memory is still worth
  // keeping, and leading with it would nominate the most detailed lessons in the corpus.
  candidates.sort((left, right) => (
    Number(right.last_delivered_at === null) - Number(left.last_delivered_at === null)
    || (right.days_since_delivered ?? 0) - (left.days_since_delivered ?? 0)
    || left.code_evidence - right.code_evidence
    || right.bytes - left.bytes
    || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  ));

  return {
    window,
    hubs_excluded: hubs,
    candidates_total: candidates.length,
    never_delivered_in_window: candidates.filter((item) => item.last_delivered_at === null).length,
    nominees: candidates.slice(0, limit),
  };
}

export function formatSwapNomination(nomination) {
  if (!nomination) return '';
  const { window } = nomination;
  // No window means no retained telemetry at all, and then there is no delivery claim to make.
  // Printing "N not delivered" against zero events reads as evidence of disuse when it is evidence
  // of nothing, and the number would be the whole corpus every time.
  if (!window) {
    return `Swap-out nominees: no retained telemetry — delivery is unknown, not zero`
      + ` (${nomination.hubs_excluded} hub(s) excluded, ${nomination.candidates_total} eligible)\n`;
  }
  const lines = [
    `Swap-out nominees (${window.days}d telemetry window ${window.from}..${window.to}): `
    + `${nomination.never_delivered_in_window} not delivered in window`
    + `, ${nomination.hubs_excluded} hub(s) excluded, ${nomination.candidates_total} eligible\n`,
  ];
  for (const item of nomination.nominees) {
    const seen = item.last_delivered_at === null
      ? 'not in window'
      : `${item.days_since_delivered}d ago`;
    lines.push(`  ${item.name} — ${seen}, ${item.inbound} inbound, `
      + `${item.code_evidence} code anchor(s), ${item.bytes}B, ${item.type}\n`);
  }
  return lines.join('');
}
