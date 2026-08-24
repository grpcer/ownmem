// Shared symbol-slice code fingerprints.
//
// Both the documentation freshness gate and the memory trust receipts need to answer the same
// question: "is the code this claim points at still the code it was written against?"
//
// A whole-file hash cannot answer it. Measured on this repository (2026-07-29, 165 anchors,
// same time window): whole-file mtime triggers on 55.2% of anchors, a normalized whole-file
// fingerprint on 33.3%, and a fingerprint over the declared symbol's own implementation block on
// 10.8%. Only the last number is low enough for a gate that people keep reading, so the shared
// rule is: slice the symbol, normalize away comments and whitespace, then hash the slice.
//
// Two invariants follow from that calibration and must not be relaxed here:
//   1. An anchor without a declared symbol degrades to a whole-file fingerprint. That is coarse
//      by construction (any unrelated edit in the same file drifts it), so callers must treat it
//      as a warning, never as a hard failure.
//   2. Staleness is decided by literal comparison or symbol fingerprints only, never by file
//      timestamps. Do not add an mtime-based signal to this module.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// A slice never spans more than this many lines: a runaway brace balance must not turn a symbol
// fingerprint back into a whole-file fingerprint.
export const MAX_SLICE_LINES = 500;

const HASH_COMMENT_EXTENSIONS = new Set(['.py', '.sh', '.bash', '.zsh', '.yml', '.yaml', '.toml', '.rb', '.pl']);
const SLASH_COMMENT_EXTENSIONS = new Set([
  '.swift', '.kt', '.kts', '.go', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.java', '.c', '.h', '.cc', '.cpp', '.m', '.mm', '.css', '.scss', '.rs',
]);

const SKIPPED_DIRECTORY_NAMES = new Set([
  '.git', 'node_modules', 'DerivedData', '.build', 'build', 'dist', 'coverage',
]);

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function codeDigest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

// Strips comments and collapses whitespace so that reformatting or re-commenting a block does not
// read as a behaviour change.
export function normalizeSource(text, extension) {
  let body = text;
  if (SLASH_COMMENT_EXTENSIONS.has(extension)) {
    body = body.replace(/\/\*[\s\S]*?\*\//g, '');
  }
  return body
    .split('\n')
    .map((line) => {
      if (SLASH_COMMENT_EXTENSIONS.has(extension)) return line.replace(/(^|[^:])\/\/.*$/, '$1');
      if (HASH_COMMENT_EXTENSIONS.has(extension)) return line.replace(/(^|[^$])#.*$/, '$1');
      return line;
    })
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n');
}

// Extracts the symbol's own implementation block instead of the whole file, so that editing an
// unrelated part of the same file does not drift this anchor.
//
// Returns { slice, weak }. `weak` means the slice only matched a suspected call site rather than a
// real definition: the fingerprint is then tracking the wrong block, which is a silent failure the
// caller should surface as a warning.
export function sliceSymbol(text, symbol) {
  const leaf = symbol.split('.').pop().replace(/\(.*$/, '').trim();
  if (!leaf) return { slice: null, weak: false };
  const lines = text.split('\n');
  const word = new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(leaf)}([^A-Za-z0-9_$]|$)`);
  const declaration = /\b(func|fun|def|class|struct|enum|extension|protocol|interface|type|const|let|var|val|object|export|function|actor|typealias)\b|=>|:=/;

  // Match a real definition first: keyword + optional Go receiver + symbol name. This must run
  // before the loose match below, otherwise a Go function that is called before it is defined
  // anchors on the call site -- `ledgerID, err := insertLedger(...)` matches because of `:=`,
  // while `func insertLedger` lives thousands of lines later. Such an anchor neither rots nor
  // errors, it just silently tracks the wrong block.
  // Definition shapes differ a lot per language and all of them must be recognised, otherwise real
  // definitions get reported as call sites (noise that costs more gate credibility than a miss):
  //   Go methods `func (s *Service) Name(`, Kotlin/Swift extensions `fun Context.findActivity(`,
  //   plain declarations `func Name` / `class Name` / `const Name =`, CSS custom properties
  //   `--o-border:`.
  const sym = escapeRegExp(leaf);
  const definition = new RegExp(
    `\\b(func|fun|def|class|struct|enum|extension|protocol|interface|type|const|let|var|val|object|function|actor|typealias)\\s+`
    // The qualifier may have several segments: a Kotlin extension can spell out a fully qualified
    // receiver `fun com.a.b.Type.method()`, and accepting only one segment misreads it as a call site.
    + `(\\([^)]*\\)\\s*)?([A-Za-z0-9_$]+(?:\\s*\\.\\s*[A-Za-z0-9_$]+)*\\s*\\.\\s*)?${sym}([^A-Za-z0-9_$]|$)`,
  );
  // Keyword-free declarative definitions: CSS custom properties, object literal keys, YAML-ish
  // `key:`, shell functions `name() {`. Treated as a definition when they start the line.
  // The shell branch must require `{`: `purge_cdn() {` is a definition while `someCall()` is only a
  // call -- accepting it without the brace would reintroduce exactly the bug this function guards.
  const bareDefinition = new RegExp(`^\\s*${sym}\\s*(?:[:=]|\\(\\s*\\)\\s*\\{)`);

  let weak = false;
  let start = lines.findIndex((line) => definition.test(line) || bareDefinition.test(line));
  if (start === -1) {
    weak = true;
    start = lines.findIndex((line) => word.test(line) && declaration.test(line));
  }
  if (start === -1) start = lines.findIndex((line) => word.test(line));
  if (start === -1) return { slice: null, weak: false };

  const limit = Math.min(lines.length, start + MAX_SLICE_LINES);
  let openedAt = -1;
  for (let index = start; index < Math.min(limit, start + 6); index += 1) {
    if (lines[index].includes('{')) {
      openedAt = index;
      break;
    }
  }

  if (openedAt !== -1) {
    let depth = 0;
    for (let index = openedAt; index < limit; index += 1) {
      for (const character of lines[index]) {
        if (character === '{') depth += 1;
        else if (character === '}') depth -= 1;
      }
      if (depth <= 0 && index >= openedAt) return { slice: lines.slice(start, index + 1).join('\n'), weak };
    }
    return { slice: lines.slice(start, limit).join('\n'), weak };
  }

  // No braces (Python / shell / TOML / single-line declarations): consume until the indentation
  // returns to the declaration level.
  const baseIndent = lines[start].match(/^\s*/)[0].length;
  for (let index = start + 1; index < limit; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (line.match(/^\s*/)[0].length <= baseIndent) return { slice: lines.slice(start, index).join('\n'), weak };
  }
  return { slice: lines.slice(start, limit).join('\n'), weak };
}

function repositoryPath(root, relativePath) {
  return path.join(root, ...relativePath.split('/'));
}

// Default member listing for directory anchors. Callers that track a git working tree should pass
// their own lister so that untracked scratch files never move a fingerprint.
function defaultDirectoryMembers(root, relativePath) {
  const members = [];
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue;
      const member = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path.join(directory, entry.name), member);
      else if (entry.isFile()) members.push(member);
    }
  };
  visit(repositoryPath(root, relativePath), relativePath);
  return members.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

// Fingerprints one anchor: { path, symbol }.
//
// status is 'missing-path' when the anchor no longer resolves, 'missing-symbol' when the declared
// symbol is gone, and 'ok' otherwise. On 'ok' the result carries:
//   fingerprint  the 16-hex digest to compare against the recorded baseline,
//   coarse       true when the fingerprint covers a whole file or a directory listing rather than
//                one symbol, i.e. drift on it is only warning-grade,
//   weakSymbol   true when the slice matched a suspected call site instead of a definition.
export function fingerprintCodeAnchor(root, anchor, { listDirectoryMembers = defaultDirectoryMembers } = {}) {
  const absolutePath = repositoryPath(root, anchor.path);
  if (!existsSync(absolutePath)) return { status: 'missing-path', coarse: false, weakSymbol: false, fingerprint: null };

  // Directory anchors are an existing spelling in this repository. Without a symbol only the
  // "which files live here" structure is fingerprinted (coarse, hence warning-grade); with a
  // symbol the directory members are scanned for that symbol.
  if (statSync(absolutePath).isDirectory()) {
    const members = listDirectoryMembers(root, anchor.path);
    if (!anchor.symbol) {
      return { status: 'ok', coarse: true, weakSymbol: false, fingerprint: codeDigest(members.join('\n')) };
    }
    for (const member of members) {
      const text = readFileSync(repositoryPath(root, member), 'utf8');
      const { slice, weak } = sliceSymbol(text, anchor.symbol);
      if (slice !== null) {
        return {
          status: 'ok',
          coarse: false,
          weakSymbol: weak,
          fingerprint: codeDigest(normalizeSource(slice, path.extname(member))),
        };
      }
    }
    return { status: 'missing-symbol', coarse: false, weakSymbol: false, fingerprint: null };
  }

  const text = readFileSync(absolutePath, 'utf8');
  const extension = path.extname(anchor.path);
  const sliced = anchor.symbol ? sliceSymbol(text, anchor.symbol) : { slice: text, weak: false };
  if (anchor.symbol && sliced.slice === null) {
    return { status: 'missing-symbol', coarse: false, weakSymbol: false, fingerprint: null };
  }
  // A symbol-less file anchor is a whole-file fingerprint: any unrelated edit in the same file
  // drifts it, so it is coarse and only ever warning-grade.
  return {
    status: 'ok',
    coarse: !anchor.symbol,
    weakSymbol: Boolean(anchor.symbol) && sliced.weak,
    fingerprint: codeDigest(normalizeSource(sliced.slice, extension)),
  };
}
