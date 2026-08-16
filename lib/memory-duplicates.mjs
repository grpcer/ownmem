import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadMemoryTopics } from './memory-schema.mjs';
import { normalizeMemoryText, tokenizeMemoryText } from './memory-tokenizer.mjs';

export const MEMORY_DUPLICATE_POLICY = Object.freeze({
  schema: 'ownmem-duplicate-policy/v1',
  simhash_threshold: 0.84,
  minhash_threshold: 0.72,
  min_features: 16,
  minhash_size: 64,
});

const MASK_64 = (1n << 64n) - 1n;
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function fingerprintText(topic) {
  return [
    topic.record.description,
    ...topic.record.metadata.triggers,
    topic.body,
  ].join('\n').replace(/```[\s\S]*?```/g, ' ');
}

function featureSequence(text) {
  const tokens = tokenizeMemoryText(text);
  const features = [...tokens];
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    features.push(`t3:${tokens[index]}\0${tokens[index + 1]}\0${tokens[index + 2]}`);
  }
  const compact = normalizeMemoryText(text).replace(/[\p{P}\p{S}\s]+/gu, '');
  for (let index = 0; index + 11 < compact.length; index += 4) {
    features.push(`c12:${compact.slice(index, index + 12)}`);
  }
  return features;
}

export function createMemoryFingerprint(topic, policy = MEMORY_DUPLICATE_POLICY) {
  const frequencies = new Map();
  for (const feature of featureSequence(fingerprintText(topic))) {
    frequencies.set(feature, (frequencies.get(feature) || 0) + 1);
  }
  const features = [...frequencies.keys()].sort(compareText);
  if (features.length < policy.min_features) return null;

  const bitWeights = Array(64).fill(0);
  const signature = Array(policy.minhash_size).fill(MASK_64);
  for (const feature of features) {
    const hash = createHash('sha256').update(feature).digest();
    const simhashValue = hash.readBigUInt64BE(0);
    const weight = 1 + Math.log2(frequencies.get(feature));
    for (let bit = 0; bit < 64; bit += 1) {
      bitWeights[bit] += ((simhashValue >> BigInt(bit)) & 1n) === 1n ? weight : -weight;
    }
    const first = hash.readBigUInt64BE(8);
    const step = hash.readBigUInt64BE(16) | 1n;
    for (let index = 0; index < signature.length; index += 1) {
      const permuted = (first + (BigInt(index) * step)) & MASK_64;
      if (permuted < signature[index]) signature[index] = permuted;
    }
  }
  let simhash = 0n;
  for (let bit = 0; bit < 64; bit += 1) {
    if (bitWeights[bit] >= 0) simhash |= 1n << BigInt(bit);
  }
  return { simhash, minhash: signature, feature_count: features.length };
}

function hammingDistance(left, right) {
  let value = left ^ right;
  let distance = 0;
  while (value !== 0n) {
    value &= value - 1n;
    distance += 1;
  }
  return distance;
}

export function compareMemoryFingerprints(left, right) {
  const simhash = 1 - (hammingDistance(left.simhash, right.simhash) / 64);
  let equal = 0;
  for (let index = 0; index < left.minhash.length; index += 1) {
    if (left.minhash[index] === right.minhash[index]) equal += 1;
  }
  return {
    simhash_similarity: simhash,
    minhash_similarity: equal / left.minhash.length,
  };
}

function normalizedCandidatePaths(candidatePaths) {
  return new Set([...candidatePaths].map((value) => value.replaceAll('\\', '/')));
}

export function detectNearDuplicateMemoryTopics({
  topics,
  candidatePaths,
  policy = MEMORY_DUPLICATE_POLICY,
} = {}) {
  const candidates = normalizedCandidatePaths(candidatePaths || []);
  if (candidates.size === 0) return [];
  const valid = topics.filter((topic) => topic.active && topic.record);
  const fingerprints = new Map(valid.map((topic) => [topic.relativePath, createMemoryFingerprint(topic, policy)]));
  const findings = [];
  const compared = new Set();

  for (const candidate of valid) {
    if (!candidates.has(candidate.relativePath.replaceAll('\\', '/'))) continue;
    const candidateFingerprint = fingerprints.get(candidate.relativePath);
    if (!candidateFingerprint) continue;
    for (const other of valid) {
      if (other.relativePath === candidate.relativePath) continue;
      const pair = [candidate.relativePath, other.relativePath].sort(compareText);
      const pairKey = pair.join('\0');
      if (compared.has(pairKey)) continue;
      compared.add(pairKey);
      const otherFingerprint = fingerprints.get(other.relativePath);
      if (!otherFingerprint) continue;
      const similarity = compareMemoryFingerprints(candidateFingerprint, otherFingerprint);
      if (similarity.simhash_similarity < policy.simhash_threshold
          || similarity.minhash_similarity < policy.minhash_threshold) continue;
      findings.push({
        candidate: candidate.relativePath.replaceAll('\\', '/'),
        duplicate_of: other.relativePath.replaceAll('\\', '/'),
        simhash_similarity: Number(similarity.simhash_similarity.toFixed(4)),
        minhash_similarity: Number(similarity.minhash_similarity.toFixed(4)),
      });
    }
  }
  return findings.sort((left, right) => compareText(
    `${left.candidate}\0${left.duplicate_of}`,
    `${right.candidate}\0${right.duplicate_of}`,
  ));
}

function nulList(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean).map((value) => value.replaceAll('\\', '/'));
}

export function changedMemoryTopicPaths({ root, memoryDir = '.claude/memory' } = {}) {
  const options = { cwd: root, encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'] };
  try {
    const tracked = nulList(execFileSync('git', [
      'diff', '--name-only', '--diff-filter=AM', '-z', 'HEAD', '--', memoryDir,
    ], options));
    const untracked = nulList(execFileSync('git', [
      'ls-files', '--others', '--exclude-standard', '-z', '--', memoryDir,
    ], options));
    return new Set([...tracked, ...untracked].filter((relativePath) => {
      const base = path.posix.basename(relativePath);
      return base.endsWith('.md') && base !== 'MEMORY.md' && !base.startsWith('MEMORY-');
    }));
  } catch {
    return new Set(loadMemoryTopics({ root, memoryDir })
      .filter((topic) => topic.active)
      .map((topic) => topic.relativePath.replaceAll('\\', '/')));
  }
}

export function auditNearDuplicateMemoryTopics({
  root,
  memoryDir = '.claude/memory',
  candidatePaths = null,
  policy = MEMORY_DUPLICATE_POLICY,
} = {}) {
  const topics = loadMemoryTopics({ root, memoryDir });
  const candidates = candidatePaths === null
    ? changedMemoryTopicPaths({ root, memoryDir })
    : normalizedCandidatePaths(candidatePaths);
  return detectNearDuplicateMemoryTopics({ topics, candidatePaths: candidates, policy });
}
