import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { parseDocument } from 'yaml';

const SCRIPT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCHEMA_PATH = path.join(SCRIPT_DIR, 'memory.schema.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

const DOC_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WORK_ID_PATTERN = /\bWORK-\d{8}-[a-z0-9-]+\b/g;
const IDENTIFIER_TRIGGER_PATTERN = /^[A-Za-z0-9_.:/\\-]+$/;

function issue(level, code, source, message, pointer = '') {
  return { level, code, source, pointer, message };
}

function isRealDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function splitFrontmatter(content) {
  const normalized = String(content || '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { frontmatter: '', body: normalized, error: 'frontmatter must start on the first line' };
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return { frontmatter: normalized.slice(4), body: '', error: 'frontmatter closing delimiter is missing' };
  }
  return {
    frontmatter: normalized.slice(4, end),
    body: normalized.slice(end + 5),
    error: null,
  };
}

function schemaErrorMessage(error) {
  const pointer = error.instancePath || '/';
  if (error.keyword === 'additionalProperties') {
    return `${pointer} contains unknown field "${error.params.additionalProperty}"`;
  }
  if (error.keyword === 'required') {
    return `${pointer} is missing required field "${error.params.missingProperty}"`;
  }
  return `${pointer} ${error.message}`;
}

function validateSemantics(record, { source, fileName, active, today }) {
  const issues = [];
  const metadata = record.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return issues;

  const stem = fileName ? path.basename(fileName, '.md') : '';
  if (stem && record.name !== stem) {
    issues.push(issue('error', 'name-file-mismatch', source, `name "${record.name}" must equal filename stem "${stem}"`, '/name'));
  }

  for (const key of ['last_verified', 'expires_at', 'review_by']) {
    const value = metadata[key];
    if (value !== undefined && value !== null && !isRealDate(value)) {
      issues.push(issue('error', 'invalid-date', source, `${key} is not a real ISO date: ${value}`, `/metadata/${key}`));
    }
  }

  if (active && metadata.expires_at && metadata.expires_at < today) {
    issues.push(issue('error', 'expired-topic', source, `expires_at ${metadata.expires_at} has passed; archive or rewrite this topic`, '/metadata/expires_at'));
  }
  if (['preference', 'feedback'].includes(metadata.type) && metadata.review_by && metadata.review_by < today) {
    issues.push(issue('error', 'review-overdue', source, `review_by ${metadata.review_by} has passed; confirm, archive, or promote this topic`, '/metadata/review_by'));
  }
  if (!['preference', 'feedback'].includes(metadata.type) && metadata.review_by) {
    issues.push(issue('warning', 'unneeded-review-date', source, `type=${metadata.type} should not declare review_by`, '/metadata/review_by'));
  }
  if (active && metadata.retired_by) {
    issues.push(issue('error', 'retired-active', source, `retired_by=${metadata.retired_by} cannot remain in the active recall surface`, '/metadata/retired_by'));
  }
  if (metadata.type === 'decision-pointer'
      && metadata.authority_docs?.length === 0
      && metadata.history_docs?.length === 0) {
    issues.push(issue('error', 'decision-without-document', source, 'decision-pointer requires authority_docs or history_docs', '/metadata/type'));
  }

  if (active && metadata.triggers.length < 2) {
    issues.push(issue(
      'warning',
      'natural-triggers-too-few',
      source,
      'triggers has fewer than 2 future query phrasings; add a user-visible symptom or colloquial wording',
      '/metadata/triggers',
    ));
  }
  if (active && metadata.triggers.length > 0
      && metadata.triggers.every((trigger) => IDENTIFIER_TRIGGER_PATTERN.test(trigger))) {
    issues.push(issue(
      'warning',
      'natural-triggers-identifiers-only',
      source,
      'triggers are all English identifiers; add a natural-language symptom without removing exact anchors',
      '/metadata/triggers',
    ));
  }

  for (const [field, ids] of [
    ['authority_docs', metadata.authority_docs || []],
    ['history_docs', metadata.history_docs || []],
  ]) {
    for (const id of ids) {
      if (id.startsWith('legacy:') || !DOC_ID_PATTERN.test(id)) {
        issues.push(issue('error', 'invalid-doc-id', source, `${field} contains invalid doc_id: ${id}`, `/metadata/${field}`));
      }
    }
  }

  const authorityIds = new Set(metadata.authority_docs || []);
  for (const id of metadata.history_docs || []) {
    if (authorityIds.has(id)) {
      issues.push(issue('error', 'conflicting-doc-role', source, `${id} cannot be both authority_docs and history_docs`, '/metadata/history_docs'));
    }
  }

  for (const [index, evidence] of (metadata.code_evidence || []).entries()) {
    const evidencePath = evidence.path;
    if (path.isAbsolute(evidencePath) || evidencePath.split(/[\\/]+/).includes('..')) {
      issues.push(issue('error', 'unsafe-evidence-path', source, `code_evidence path must be repository-relative: ${evidencePath}`, `/metadata/code_evidence/${index}/path`));
    }
  }

  if (active) {
    const workIds = [...new Set(record.body.match(WORK_ID_PATTERN) || [])];
    for (const workId of workIds) {
      issues.push(issue('error', 'work-package-reference', source, `active L3 body must not depend on temporary work package ${workId}`, '/body'));
    }
  }
  return issues;
}

export function parseMemoryContent(content, {
  source = '<memory>',
  fileName = '',
  active = true,
  today = new Date().toISOString().slice(0, 10),
} = {}) {
  const split = splitFrontmatter(content);
  const issues = [];
  if (split.error) {
    issues.push(issue('error', 'frontmatter-delimiter', source, split.error));
    return { record: null, body: split.body, issues };
  }

  const document = parseDocument(split.frontmatter, {
    maxAliasCount: 0,
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
    version: '1.2',
  });
  for (const error of document.errors) {
    issues.push(issue('error', 'yaml-parse', source, error.message));
  }
  for (const warning of document.warnings) {
    issues.push(issue('warning', 'yaml-warning', source, warning.message));
  }
  if (document.errors.length > 0) return { record: null, body: split.body, issues };

  const frontmatter = document.toJS({ maxAliasCount: 0 });
  const candidate = frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter)
    ? { ...frontmatter, body: split.body }
    : frontmatter;
  const valid = validateSchema(frontmatter);
  if (!valid) {
    for (const error of validateSchema.errors || []) {
      issues.push(issue('error', 'schema', source, schemaErrorMessage(error), error.instancePath || '/'));
    }
  }
  if (valid) issues.push(...validateSemantics(candidate, { source, fileName, active, today }));
  return { record: valid ? candidate : null, body: split.body, issues };
}

export function parsedRecallFields(record) {
  const metadata = record.metadata;
  return {
    name: record.name,
    description: record.description,
    scopes: metadata.scopes,
    triggers: metadata.triggers,
    authorityDocs: metadata.authority_docs,
    codePaths: metadata.code_evidence.map((entry) => entry.path),
    codeSymbols: metadata.code_evidence.flatMap((entry) => entry.symbols),
    codeTests: metadata.code_evidence.flatMap((entry) => entry.tests),
  };
}

export function loadMemoryTopics({ root, memoryDir = '.claude/memory', includeArchive = false } = {}) {
  const absoluteMemoryDir = path.resolve(root, memoryDir);
  const files = readdirSync(absoluteMemoryDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('MEMORY'))
    .map((entry) => ({ path: path.join(absoluteMemoryDir, entry.name), fileName: entry.name, active: true }));

  if (includeArchive) {
    const archiveRoot = path.join(absoluteMemoryDir, 'archive');
    try {
      for (const dateEntry of readdirSync(archiveRoot, { withFileTypes: true })) {
        if (!dateEntry.isDirectory()) continue;
        const dateDir = path.join(archiveRoot, dateEntry.name);
        for (const entry of readdirSync(dateDir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push({ path: path.join(dateDir, entry.name), fileName: entry.name, active: false });
          }
        }
      }
    } catch {
      // Archive is optional for a newly bootstrapped repository.
    }
  }

  return files.map((file) => {
    const content = readFileSync(file.path, 'utf8');
    const relativePath = path.relative(root, file.path);
    return {
      ...file,
      relativePath,
      content,
      ...parseMemoryContent(content, {
        source: relativePath,
        fileName: file.fileName,
        active: file.active,
      }),
    };
  });
}

export function formatMemoryIssue(item) {
  const location = item.pointer ? ` (${item.pointer})` : '';
  return `${item.source}${location}: ${item.message}`;
}
