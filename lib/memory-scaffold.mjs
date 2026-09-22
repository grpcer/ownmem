/**
 * `ownmem new` -- scaffold one memory that already passes every gate.
 *
 * The first memory a consumer writes is where this system loses people. The schema has eighteen
 * frontmatter fields, four of them with rules that only exist in prose (a `review_by` that is
 * required for exactly two types, triggers that must not be only identifiers, a `last_verified`
 * that has to be today, an L2 hook line whose shape the audit checks), and the way you discover any
 * of them is by writing a file and being told it is wrong. That is the wrong order: a generator can
 * know every one of those rules, and the person can then spend their attention on the lesson.
 *
 * So this writes a topic that is already green, and leaves exactly one job behind: replace the
 * placeholder prose. Three properties make that honest rather than convenient:
 *
 *   - It refuses to write a memory that would be dishonest to keep. `authority: observed` and an
 *     empty `code_evidence` are the truthful values for a topic nobody has verified yet, and they
 *     are not configurable here -- a scaffold that let you declare `normative` up front would be
 *     handing out authority for prose that does not exist yet.
 *   - It registers the L2 hook line in the same call, because a topic the index does not route to
 *     is invisible to a reader walking the layers, and the audit calls that out later anyway.
 *   - It refuses when the corpus is at its quota, and says which command names the swap-out. The
 *     alternative is writing the file and letting `memory-audit` fail afterwards, which teaches the
 *     lesson at the worst possible moment.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const MEMORY_TYPES = Object.freeze(['lesson', 'debug', 'decision-pointer', 'preference', 'feedback']);

// The two types whose claim is about a person rather than about code, and which therefore expire in
// a way code does not: preferences change, and the only way to know is to ask again.
const REVIEW_REQUIRED_TYPES = new Set(['preference', 'feedback']);
const DEFAULT_REVIEW_MONTHS = 6;

export function memoryTopicName(value) {
  const name = String(value || '').trim().toLowerCase().replace(/[\s-]+/gu, '_').replace(/[^a-z0-9_]/gu, '');
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(name)) {
    throw new Error(`"${value}" cannot be a topic name: use lowercase words joined by underscores, for example sheet_detent_lazy_container`);
  }
  return name;
}

/**
 * A review date that is not the same day for every memory written this week.
 *
 * Batch-assigned dates are how `last_verified` stopped meaning anything here: 254 topics ended up
 * on one day, and a review queue that all comes due at once gets renewed in bulk without being read.
 * The offset is derived from the name so it is deterministic -- the same name always scaffolds the
 * same file -- but spread across a quarter.
 */
export function reviewDateFor(name, today) {
  const base = new Date(`${today}T00:00:00.000Z`);
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.codePointAt(0)) % 90;
  base.setUTCMonth(base.getUTCMonth() + DEFAULT_REVIEW_MONTHS);
  base.setUTCDate(base.getUTCDate() + hash);
  return base.toISOString().slice(0, 10);
}

export function scaffoldTopic({ name, type, scopes, description, today, triggers }) {
  if (!MEMORY_TYPES.includes(type)) throw new Error(`unknown memory type: ${type} (one of ${MEMORY_TYPES.join(', ')})`);
  const review = REVIEW_REQUIRED_TYPES.has(type) ? `\n  review_by: ${reviewDateFor(name, today)}` : '';
  // A trigger list that is only identifiers is the shape that fails to be recalled by the query a
  // person actually types, so the placeholder carries both spellings and says why.
  const triggerList = triggers.map((item) => JSON.stringify(item)).join(', ');
  return `---
name: ${name}
description: ${JSON.stringify(description)}
metadata:
  node_type: memory
  type: ${type}
  status: active
  scopes: [${scopes.join(', ')}]
  applies_to: [all]
  triggers: [${triggerList}]
  last_verified: ${today}
  expires_at: null${review}
  authority: observed
  authority_docs: []
  history_docs: []
  supersedes: []
  code_evidence: []
  evidence: []
---

${description}

**Why**: replace this with the reason the obvious approach fails. A memory that only states the
conclusion gets re-derived and re-doubted; the reason is what makes it usable by someone who has
only the symptom.

**How to apply**: replace this with what to do differently, concretely enough to act on.

<!--
Before you delete this comment, three things worth doing while the file is open:

  triggers      Keep the exact identifiers, but add the words you would actually type when you hit
                this again -- the symptom in plain language. A trigger list made only of symbols is
                reachable only by someone who already knows the answer.
  code_evidence Add { path, symbols, tests } if this is about code. A path alone is a whole-file
                anchor that drifts on any unrelated edit; naming the symbol is what makes the drift
                signal mean something. Without it, the Edit/Write hook can never surface this topic.
  authority     Leave it at "observed" until a person confirms it. Only a human decision earns
                "user-confirmed", and only a written rule earns "normative".
-->
`;
}

function l2Path(memoryDirectory, area) {
  return path.join(memoryDirectory, `MEMORY-${area}.md`);
}

/**
 * Add the routing line, or say it is already there. The index is what a reader walks, so a topic
 * missing from it is only reachable by search.
 */
export function registerIndexHook({ memoryDirectory, area, name, description }) {
  const file = l2Path(memoryDirectory, area);
  const line = `- [${name}](${name}.md) - ${description}\n`;
  if (!existsSync(file)) {
    writeFileSync(file, `# ${area}\n\n${line}`, 'utf8');
    return { file, created: true, added: true };
  }
  const current = readFileSync(file, 'utf8');
  if (current.includes(`](${name}.md)`)) return { file, created: false, added: false };
  const body = current.endsWith('\n') ? current : `${current}\n`;
  writeFileSync(file, `${body}${line}`, 'utf8');
  return { file, created: false, added: true };
}

export function scaffoldMemory({
  root,
  memoryDir,
  name: rawName,
  type = 'lesson',
  area = 'general',
  scopes = null,
  description = null,
  today = new Date().toISOString().slice(0, 10),
  quota = null,
  activeCount = null,
  write = true,
}) {
  const name = memoryTopicName(rawName);
  const memoryDirectory = path.resolve(root, memoryDir);
  const file = path.join(memoryDirectory, `${name}.md`);
  if (existsSync(file)) throw new Error(`${path.relative(root, file)} already exists; edit it instead of scaffolding over it`);
  // Refused here rather than discovered by the audit afterwards: the corpus is net-zero growth, so
  // at quota the next memory costs an existing one, and that is a decision to make before writing.
  if (Number.isInteger(quota) && Number.isInteger(activeCount) && activeCount >= quota) {
    throw new Error(`the corpus is at its quota (${activeCount}/${quota} active topics): memory is net-zero growth, so archive or merge one first. \`ownmem audit\` names the ceiling, and the swap-out nominees are listed by the health report`);
  }
  const resolvedScopes = scopes && scopes.length > 0 ? scopes : [area];
  const resolvedDescription = description
    || `Replace this one line with what a reader needs to know, in the words they would search for`;
  const content = scaffoldTopic({
    name,
    type,
    scopes: resolvedScopes,
    description: resolvedDescription,
    today,
    triggers: [name.split('_').join(' '), 'replace with the symptom in plain language'],
  });
  if (!write) return { name, file, content, index: null, written: false };
  mkdirSync(memoryDirectory, { recursive: true });
  writeFileSync(file, content, 'utf8');
  const index = registerIndexHook({ memoryDirectory, area, name, description: resolvedDescription });
  return { name, file, content, index, written: true };
}
