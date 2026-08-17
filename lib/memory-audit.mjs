import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { auditNearDuplicateMemoryTopics } from './memory-duplicates.mjs';
import { createMemoryObservabilityEvent, recordMemoryObservabilityEvent } from './memory-observability.mjs';
import { formatMemoryIssue, loadMemoryTopics } from './memory-schema.mjs';

const MAX_INDEX_BYTES = 25 * 1024;
const MAX_L1_LINES = 200;
const MAX_L2_LINES = 120;
const MAX_TOPIC_BYTES = 16 * 1024;
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const lines = value => String(value).split(/\r?\n/);

function issue(level, code, message, details = []) {
  return { level, code, message, details };
}

function listFiles(directory, matcher) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && matcher(entry.name))
    .map(entry => path.join(directory, entry.name))
    .sort(compareText);
}

function recursiveMarkdownCount(directory) {
  if (!existsSync(directory)) return 0;
  let count = 0;
  const visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith('.md')) count += 1;
    }
  };
  visit(directory);
  return count;
}

function inspectL2(memoryDirectory, activeTopicFiles) {
  const issues = [];
  const l2Files = listFiles(memoryDirectory, name => /^MEMORY-.*\.md$/.test(name));
  const active = new Set(activeTopicFiles.map(file => path.basename(file)));
  const routed = [];
  for (const file of l2Files) {
    const content = readFileSync(file, 'utf8');
    const fileLines = lines(content);
    const fileName = path.basename(file);
    const bytes = Buffer.byteLength(content);
    if (bytes > MAX_INDEX_BYTES) issues.push(issue('error', 'l2-bytes', `L2 index exceeds ${MAX_INDEX_BYTES}B: ${fileName} (${bytes}B)`));
    if (fileLines.length > MAX_L2_LINES) issues.push(issue('error', 'l2-lines', `L2 index exceeds ${MAX_L2_LINES} lines: ${fileName} (${fileLines.length})`));
    for (const line of fileLines) {
      if (line.startsWith('- [') && line.length > 160) issues.push(issue('error', 'l2-hook-length', 'An L2 hook exceeds 160 characters; shorten it before landing.'));
      for (const match of line.matchAll(/\]\(([^)]+\.md(?:#[^)]+)?)\)/g)) {
        const target = match[1].split('#', 1)[0];
        const resolved = path.resolve(memoryDirectory, target);
        if (!existsSync(resolved)) {
          issues.push(issue('error', 'l2-broken-link', `Broken index link in ${fileName}: ${target}`));
          continue;
        }
        if (target.replaceAll('\\', '/').startsWith('archive/')) {
          issues.push(issue('error', 'l2-archive-link', `L2 index points into archive: ${fileName} -> ${target}`));
          continue;
        }
        const base = path.basename(target);
        if (!target.includes('/') && !target.includes('\\') && base !== 'MEMORY.md' && !base.startsWith('MEMORY-')) routed.push(base);
      }
    }
  }
  const unique = new Set(routed);
  for (const topic of active) if (!unique.has(topic)) issues.push(issue('error', 'l3-unrouted', `Active L3 topic is not routed by an L2 index: ${topic}`));
  for (const topic of unique) if (!active.has(topic)) issues.push(issue('error', 'l2-nonactive', `L2 routes a non-active topic: ${topic}`));
  const counts = new Map();
  routed.forEach(topic => counts.set(topic, (counts.get(topic) || 0) + 1));
  const duplicates = [...counts].filter(([, count]) => count > 1).map(([topic]) => topic).sort(compareText);
  if (duplicates.length > 0) issues.push(issue('warning', 'l2-duplicate-route', `${duplicates.length} topic(s) are routed by multiple L2 indexes.`, duplicates));
  return {
    issues,
    files: l2Files,
    hookCounts: Object.fromEntries(l2Files.map(file => [path.basename(file), lines(readFileSync(file, 'utf8')).filter(line => line.startsWith('- [')).length])),
  };
}

function inspectWikiLinks(topics) {
  const active = new Set(topics.filter(topic => topic.record).map(topic => topic.record.name));
  const broken = [];
  for (const topic of topics) {
    for (const match of topic.body.matchAll(/\[\[([^\]|]+)\]\]/g)) {
      const target = match[1].trim();
      if (!active.has(target)) broken.push(`${topic.fileName} -> [[${target}]]`);
    }
  }
  return broken.length === 0 ? [] : [issue('error', 'wiki-link-broken', `${broken.length} unresolved wiki link(s) in active L3 topics.`, broken.slice(0, 10))];
}

function atomicJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
}

function quotaCap(lock, name) {
  const target = Number(lock.target_hooks_per_l2 ?? 40);
  return Math.max(target, Number(lock.l2_baseline?.[name] ?? target));
}

function inspectQuota({ file, activeTopicFiles, hookCounts, writeLock }) {
  if (!existsSync(file)) return [issue(writeLock ? 'error' : 'warning', 'quota-missing', 'Memory quota lock is missing.')];
  let lock;
  try {
    lock = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return [issue('error', 'quota-json', `Cannot parse memory quota lock: ${error.message}`)];
  }
  if (!['ownmem.quota/v2', 'ownmem.quota/v3', 'oriveo.memory.quota/v2'].includes(lock.schema)) return [issue('error', 'quota-schema', 'Memory quota lock uses an unsupported schema.')];
  const output = [];
  const activeCount = activeTopicFiles.length;
  const activeBytes = activeTopicFiles.reduce((sum, topic) => sum + statSync(topic).size, 0);
  const today = new Date().toISOString().slice(0, 10);
  if (lock.schema === 'ownmem.quota/v3' && lock.mode === 'growth') {
    const threshold = Number(lock.growth_threshold ?? 50);
    if (activeCount < threshold) return output;
    lock.mode = 'ratchet';
    lock.transitioned_at = today;
    lock.updated_at = today;
    lock.max_active_l3 = activeCount;
    lock.max_active_bytes = activeBytes;
    lock.l2_baseline = Object.fromEntries(Object.entries(hookCounts).sort(([left], [right]) => compareText(left, right)));
    atomicJson(file, lock);
    output.push(issue('info', 'quota-transition', `Growth quota transitioned to a ratchet at ${activeCount} active topic(s).`));
  }
  const maxActive = Number(lock.max_active_l3 ?? activeCount);
  const maxBytes = Number(lock.max_active_bytes ?? activeBytes);
  if (writeLock) {
    if (activeCount > maxActive || activeBytes > maxBytes) return [issue('error', 'quota-ratchet-raise', 'Ratchet update would raise a locked quota; merge or archive first.')];
    lock.max_active_l3 = activeCount;
    lock.max_active_bytes = activeBytes;
    lock.l2_baseline = Object.fromEntries(Object.entries(hookCounts).map(([name, count]) => [name, Math.min(count, Number(lock.l2_baseline?.[name] ?? count))]));
    lock.updated_at = today;
    atomicJson(file, lock);
    return [issue('info', 'quota-tightened', `Quota lock tightened to ${activeCount} active topic(s).`)];
  }
  if (activeCount > maxActive) output.push(issue('error', 'quota-topic-count', `Active L3 count ${activeCount} exceeds the quota of ${maxActive}; merge or archive in the same change.`));
  if (activeBytes > maxBytes) output.push(issue('error', 'quota-topic-bytes', `Active L3 bytes ${activeBytes} exceed the quota of ${maxBytes}; shrink or archive in the same change.`));
  for (const [name, count] of Object.entries(hookCounts)) if (count > quotaCap(lock, name)) output.push(issue('error', 'quota-l2-count', `${name} has ${count} hooks, above its cap of ${quotaCap(lock, name)}.`));
  return output;
}

export function collectMemoryAudit({ root, memoryDir = '.ownmem', writeLock = false } = {}) {
  if (!root) throw new Error('collectMemoryAudit requires a repository root');
  const started = Date.now();
  const memoryDirectory = path.resolve(root, memoryDir);
  const l1 = path.join(memoryDirectory, 'MEMORY.md');
  const output = [];
  if (!existsSync(l1)) {
    output.push(issue('error', 'l1-missing', `Missing L1 memory index: ${l1}`));
    return { schema: 'ownmem-audit/v1', duration_ms: Date.now() - started, issues: output, messages: [], summary: { l1: 0, l2: 0, active_l3: 0, archived: 0 } };
  }
  const l1Content = readFileSync(l1, 'utf8');
  if (Buffer.byteLength(l1Content) > MAX_INDEX_BYTES) output.push(issue('error', 'l1-bytes', `L1 index exceeds ${MAX_INDEX_BYTES}B.`));
  if (lines(l1Content).length > MAX_L1_LINES) output.push(issue('error', 'l1-lines', `L1 index exceeds ${MAX_L1_LINES} lines.`));
  const activeTopicFiles = listFiles(memoryDirectory, name => name.endsWith('.md') && name !== 'MEMORY.md' && !name.startsWith('MEMORY-'));
  for (const topic of activeTopicFiles) {
    const base = path.basename(topic);
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*\.md$/.test(base)) output.push(issue('error', 'topic-filename', `L3 filename must use snake_case: ${base}`));
    if (statSync(topic).size > MAX_TOPIC_BYTES) output.push(issue('error', 'topic-bytes', `Active L3 topic exceeds ${MAX_TOPIC_BYTES}B: ${base}`));
  }
  const topics = loadMemoryTopics({ root, memoryDir });
  for (const topic of topics) {
    for (const item of topic.issues) output.push(issue(item.level, item.code, `[${item.code}] ${formatMemoryIssue(item)}`));
    if (!topic.record) continue;
    for (const evidence of topic.record.metadata.code_evidence) if (!existsSync(path.join(root, evidence.path))) output.push(issue('error', 'code-evidence-missing', `${topic.fileName} code evidence does not exist: ${evidence.path}`));
  }
  for (const finding of auditNearDuplicateMemoryTopics({ root, memoryDir })) {
    output.push(issue('warning', 'near-duplicate', `${finding.candidate} may duplicate ${finding.duplicate_of} (SimHash=${finding.simhash_similarity.toFixed(4)}, MinHash=${finding.minhash_similarity.toFixed(4)}).`));
  }
  const l2 = inspectL2(memoryDirectory, activeTopicFiles);
  output.push(...l2.issues, ...inspectWikiLinks(topics), ...inspectQuota({ file: path.join(memoryDirectory, 'quota.lock.json'), activeTopicFiles, hookCounts: l2.hookCounts, writeLock }));
  return {
    schema: 'ownmem-audit/v1',
    duration_ms: Date.now() - started,
    issues: output,
    messages: [],
    summary: { l1: 1, l2: l2.files.length, active_l3: activeTopicFiles.length, archived: recursiveMarkdownCount(path.join(memoryDirectory, 'archive')) },
  };
}

export function recordMemoryAuditObservability({ root, report, durationMs = 0 } = {}) {
  if (!root || !report) return { written: false, error: 'missing-audit-report' };
  try {
    const errors = report.issues.filter((item) => item.level === 'error').length;
    const warnings = report.issues.filter((item) => item.level === 'warning').length;
    const event = createMemoryObservabilityEvent({
      event: 'gate.completed',
      component: 'memory-audit',
      payload: {
        gate: 'memory-audit',
        status: errors > 0 ? 'failed' : 'passed',
        errors,
        warnings,
        duration_ms: Number(Math.max(0, durationMs).toFixed(3)),
      },
    });
    return recordMemoryObservabilityEvent({ root, event });
  } catch (error) {
    return { written: false, error: error.message };
  }
}

export function formatMemoryAudit(report) {
  const output = [];
  for (const item of report.issues) {
    if (item.level === 'info') output.push(`INFO: ${item.message}`);
    else output.push(`${item.level === 'error' ? 'ERROR' : 'WARN'}: ${item.message}`);
    item.details.forEach(detail => output.push(`  ${detail}`));
  }
  const warnings = report.issues.filter(item => item.level === 'warning').length;
  output.push(`Memory audit: L1=${report.summary.l1}, L2=${report.summary.l2}, active L3=${report.summary.active_l3}, archived=${report.summary.archived}, warnings=${warnings}`);
  const failures = report.issues.filter(item => item.level === 'error').length;
  output.push(failures > 0 ? `Memory audit failed with ${failures} error(s).` : 'Memory audit passed.');
  return `${output.join('\n')}\n`;
}

export function auditPlatformContract(platform) {
  if (!['darwin', 'linux', 'win32'].includes(platform)) throw new Error(`unsupported platform contract: ${platform}`);
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const sampleRoot = platform === 'win32' ? 'C:\\Users\\Memory User\\repo' : '/home/memory user/repo';
  return {
    platform,
    executable: process.execPath,
    shell_required: false,
    path_separator: platformPath.sep,
    sample_memory_path: platformPath.join(sampleRoot, '.ownmem', 'MEMORY.md'),
    unicode_argument: 'Unicode sync badge',
    command: [process.execPath, 'memory-audit.mjs'],
  };
}
