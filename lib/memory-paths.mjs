import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// These are the repository-owned layouts OwnMem has shipped or dogfooded. Keeping the list in one
// module prevents each command from inventing a different default and makes legacy repositories
// discoverable without creating a competing empty directory.
const MEMORY_CONFIG_SCHEMAS = new Set(['ownmem.config/v1', 'oriveo.memory.config/v1']);
export const MEMORY_CONFIG_DIRECTORIES = Object.freeze(['.ownmem', '.memory', '.claude/memory']);
export const DEFAULT_PUBLIC_MEMORY_DIRECTORY = '.ownmem';

function configuredMemoryDir(root, directory) {
  const file = path.resolve(root, directory, 'config.json');
  if (!existsSync(file)) return null;
  try {
    const config = JSON.parse(readFileSync(file, 'utf8'));
    return MEMORY_CONFIG_SCHEMAS.has(config.schema)
      && typeof config.memory_dir === 'string'
      && config.memory_dir.trim()
      ? config.memory_dir.trim()
      : null;
  } catch {
    return null;
  }
}

function containsMemoryMarkdown(root, directory) {
  try {
    return readdirSync(path.resolve(root, directory), { withFileTypes: true })
      .some(entry => entry.isFile() && entry.name.endsWith('.md'));
  } catch {
    return false;
  }
}

export function resolveMemoryDir(root, explicit = null) {
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const absoluteRoot = path.resolve(root || process.cwd());
  for (const directory of MEMORY_CONFIG_DIRECTORIES) {
    const configured = configuredMemoryDir(absoluteRoot, directory);
    if (configured) return configured;
  }
  for (const directory of MEMORY_CONFIG_DIRECTORIES) {
    if (containsMemoryMarkdown(absoluteRoot, directory)) return directory;
  }
  for (const directory of MEMORY_CONFIG_DIRECTORIES) {
    if (existsSync(path.join(absoluteRoot, directory))) return directory;
  }
  return DEFAULT_PUBLIC_MEMORY_DIRECTORY;
}

/**
 * The repository a bare command is being run against, found by walking up from a directory.
 *
 * Hook configurations name `npx ownmem` with no path to the checkout. Claude Code exports
 * CLAUDE_PROJECT_DIR, but Codex documents that it injects nothing into a hook process, so for that
 * host the working directory is the only evidence there is -- and a hook that fires while the agent
 * sits in a subdirectory would otherwise resolve the memory directory against the subdirectory,
 * find nothing, and write its events somewhere nobody reads.
 *
 * The walk remembers the nearest installation it passes rather than stopping at it, and decides at
 * the first `.git` entry it reaches:
 *
 * 1. that checkout root carries an installation -- it wins, even over a nearer one;
 * 2. it does not, but a nearer installation was passed on the way up -- that one wins, so a
 *    monorepo package that installed its own memory still answers commands typed inside it;
 * 3. neither -- the checkout root, which is what a hook firing in a subdirectory needs.
 *
 * The checkout root comes first because memory is a repository-level artifact and `.git` is where
 * a repository begins. A memory directory below a `.git` that has no `.git` of its own is a copy
 * living inside that repository -- a fixture, an exported tree, a vendored checkout -- and a copy
 * is not a separate installation. Letting one claim the root points a command at a directory
 * nobody reads and writes that repository's local data inside it.
 *
 * `.git` is tested as an entry rather than a directory: a worktree or a submodule records it as a
 * file. With no `.git` anywhere the nearest installation still answers, and a walk that passed
 * neither returns where it started, so nothing is ever found outside the tree it began in.
 */
export function resolveRepositoryRoot(start = process.cwd()) {
  let current = path.resolve(start);
  let nearestInstallation = null;
  for (;;) {
    const installed = MEMORY_CONFIG_DIRECTORIES.some(directory => existsSync(path.join(current, directory)));
    if (existsSync(path.join(current, '.git'))) {
      if (installed) return current;
      return nearestInstallation || current;
    }
    if (installed && !nearestInstallation) nearestInstallation = current;
    const parent = path.dirname(current);
    if (parent === current) return nearestInstallation || path.resolve(start);
    current = parent;
  }
}

export function memoryIndexDir(memoryDir) {
  const normalized = String(memoryDir).split(path.sep).join('/').replace(/\/+$/, '');
  // The legacy host layout predates the public package and deliberately keeps generated snapshots
  // outside the Git-synchronized corpus. Public `.ownmem` and `.memory` installations keep the
  // snapshot beside their memory directory.
  return normalized === '.claude/memory' ? '.local-test/memory-index' : path.posix.join(normalized, 'index');
}

export function memoryRecallCasesFile(memoryDir) {
  return path.posix.join(String(memoryDir).split(path.sep).join('/'), 'recall-cases.json');
}

function posixDir(value) {
  return String(value).split(path.sep).join('/').replace(/\/+$/, '');
}

/**
 * Local daily packages live beside the event files, not in the Git-synchronized memory directory.
 * The path is under `.local-test/` in this repository and under the same observability tree a
 * consumer already gitignores, so neither layout commits counts into the corpus.
 */
export function memoryLocalDailyDir(observabilityDirectory) {
  return `${posixDir(observabilityDirectory)}/daily`;
}

export function memoryLocalDailyFile(observabilityDirectory, installationId, day) {
  return `${memoryLocalDailyDir(observabilityDirectory)}/${installationId}/${day}.json`;
}
