// Maintenance proposals: things the corpus itself says about the corpus.
//
// These answer a different question from a recovery candidate. A recovery says "something was red
// and then it was not"; a proposal says "these two memories are near-identical", "these two
// disagree about which document is current", "this one says it retired that one, and that one is
// still active". None of it is inferred from behaviour, so none of it is a causal claim: the
// relationships are literally written in the front matter and in the text.
//
// Three rules make them safe, and all three are structural rather than remembered by a caller:
//
//   1. Nothing here writes to the memory directory. There is no merge, no archive, no Union-Find
//      that quietly collapses two active memories into one. Every finding leaves as a candidate
//      whose lifecycle has no path into a delivered context, and a person decides.
//   2. Nothing here writes prose. A proposal carries names, a doc id and two similarity numbers.
//   3. Rejecting one sticks, through the same ledger the recovery candidates use, because the same
//      bad pair would otherwise reappear on every scan until the queue trains its reader to skip it.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadMemoryTopics } from './memory-schema.mjs';
import { detectNearDuplicateMemoryTopics, MEMORY_DUPLICATE_POLICY } from './memory-duplicates.mjs';

export const MEMORY_PROPOSAL_PRODUCER = 'deterministic-corpus-proposer';
export const MEMORY_PROPOSAL_PRODUCER_VERSION = 1;

const byName = (left, right) => left.localeCompare(right, 'en');

function topicName(topic) {
  return topic.record.name;
}

/**
 * Near-identical pairs across the whole active set.
 *
 * The audit entry point in memory-duplicates only compares what changed in the working tree, which
 * is right for a pre-commit gate and wrong here: the review queue is asking "what does this corpus
 * contain", and a pair that has been sitting there since before the last commit is exactly the pair
 * nobody has noticed.
 */
function duplicatePairs(topics, policy) {
  const active = topics.filter(topic => topic.active && topic.record);
  return detectNearDuplicateMemoryTopics({
    topics: active,
    candidatePaths: active.map(topic => topic.relativePath),
    policy,
  });
}

/**
 * Pairs where one topic's current authority is another topic's history.
 *
 * The same criterion the ranker applies at query time, run over the corpus instead of over one
 * query's candidates. At query time it costs a small ranking penalty and only when both happen to
 * match; here it surfaces the pair whether or not any query ever retrieves both, which is the only
 * way the disagreement gets resolved rather than repeatedly discounted.
 */
function authorityConflicts(topics) {
  const active = topics.filter(topic => topic.active && topic.record);
  const findings = [];
  for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < active.length; rightIndex += 1) {
      const left = active[leftIndex];
      const right = active[rightIndex];
      const documents = new Set([
        ...left.record.metadata.authority_docs.filter(id => right.record.metadata.history_docs.includes(id)),
        ...right.record.metadata.authority_docs.filter(id => left.record.metadata.history_docs.includes(id)),
      ]);
      for (const document of [...documents].sort(byName)) {
        findings.push({ members: [topicName(left), topicName(right)].sort(byName), document });
      }
    }
  }
  return findings;
}

/**
 * A topic that declares it retired another, where the other is still in the active set.
 *
 * The declaration is the corpus stating its own intent, and an active supersedee means the intent
 * was never carried out. Query time already penalizes the superseded one, which is why this can sit
 * unnoticed indefinitely: results stay correct while the active set slowly fills with records their
 * own replacements say are obsolete.
 */
function unarchivedSupersedes(topics) {
  const active = topics.filter(topic => topic.active && topic.record);
  const activeNames = new Set(active.map(topicName));
  const findings = [];
  for (const topic of active) {
    for (const superseded of topic.record.metadata.supersedes) {
      if (!activeNames.has(superseded)) continue;
      findings.push({ members: [topicName(topic), superseded] });
    }
  }
  return findings.sort((left, right) => byName(left.members.join('\0'), right.members.join('\0')));
}

/**
 * Every maintenance observation the corpus supports, in one deterministic pass.
 *
 * Returns observations rather than candidates: identity, policy and the quarantine wrapper belong
 * to one place (memory-candidates), so that a second producer cannot ship a lead that skips them.
 */
export function findMemoryMaintenanceObservations({
  root,
  memoryDir = '.claude/memory',
  topics = null,
  policy = MEMORY_DUPLICATE_POLICY,
} = {}) {
  // No memory directory is an ordinary state -- a fresh checkout, an installation that keeps its
  // memories elsewhere -- and a review scan must not fail because of it. The caller is told the
  // directory was absent so that "no proposals" and "nothing to read" stay distinguishable.
  const loaded = topics || (existsSync(path.resolve(root, memoryDir))
    ? loadMemoryTopics({ root, memoryDir })
    : null);
  if (loaded === null) return [];
  const observations = [];
  for (const pair of duplicatePairs(loaded, policy)) {
    const members = [
      pair.candidate.split('/').pop().replace(/\.md$/u, ''),
      pair.duplicate_of.split('/').pop().replace(/\.md$/u, ''),
    ].sort(byName);
    observations.push({
      kind: 'duplicate-pair',
      label: members.join(' ~ '),
      members,
      simhash_similarity: pair.simhash_similarity,
      minhash_similarity: pair.minhash_similarity,
    });
  }
  for (const finding of authorityConflicts(loaded)) {
    observations.push({
      kind: 'authority-conflict',
      label: `${finding.members.join(' vs ')} on ${finding.document}`,
      members: finding.members,
      document: finding.document,
    });
  }
  for (const finding of unarchivedSupersedes(loaded)) {
    observations.push({
      kind: 'supersede-unarchived',
      label: `${finding.members[0]} retired ${finding.members[1]}, which is still active`,
      members: finding.members,
    });
  }
  return observations;
}
