import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// One project, one answer about where its memory lives. `ownmem init` records the chosen directory in
// a config.json written *inside* that directory, so the layout on disk alone cannot be trusted: the
// moment any command creates an empty `.ownmem/`, an existsSync probe flips a legacy `.memory/`
// installation over to a directory that holds nothing. Every surface that needs the memory directory
// -- the CLI dispatcher, the delegated feature modules, the hook daemon, init itself -- resolves it
// here, because this class of bug has recurred once per independent copy of the rule.
const MEMORY_CONFIG_SCHEMAS = new Set(['ownmem.config/v1', 'oriveo.memory.config/v1']);
// Exported so init can refuse a directory the probe below would never find again.
export const CONFIG_DIRECTORIES = ['.ownmem', '.memory'];
const DEFAULT_MEMORY_DIR = '.ownmem';
const LEGACY_MEMORY_DIR = '.memory';

export function readConfiguredMemoryDir(root) {
  for (const directory of CONFIG_DIRECTORIES) {
    try {
      const config = JSON.parse(readFileSync(path.join(root, directory, 'config.json'), 'utf8'));
      if (MEMORY_CONFIG_SCHEMAS.has(config.schema) && typeof config.memory_dir === 'string' && config.memory_dir) {
        return config.memory_dir;
      }
    } catch {
      // Absent, unreadable, or foreign config: try the next candidate, then the layout on disk.
    }
  }
  return null;
}

/**
 * Resolve the memory directory of a project, relative to its root.
 *
 * An explicit value always wins, then the directory declared by the installed config, and only a
 * project with neither falls back to the layout on disk.
 */
export function resolveMemoryDir(root, memoryDir = null) {
  if (memoryDir) return memoryDir;
  const configured = readConfiguredMemoryDir(root);
  if (configured) return configured;
  return !existsSync(path.join(root, DEFAULT_MEMORY_DIR)) && existsSync(path.join(root, LEGACY_MEMORY_DIR))
    ? LEGACY_MEMORY_DIR
    : DEFAULT_MEMORY_DIR;
}

// The compiled snapshot travels with the memory it was built from. Deriving it anywhere else lets the
// compiler publish into one directory while recall reads another, and lets a compile create the very
// directory whose absence the resolution rule depends on.
export function memoryIndexDir(memoryDir) {
  return `${memoryDir.replace(/[\\/]+$/, '')}/index`;
}

// The offline evaluation corpus describes the project's own memories, so it lives beside them. The
// historical defaults pointed at this repository's private toolbox and at a file inside the installed
// package, which turned `ownmem embed ab` into a raw ENOENT printing the npm install path.
export function memoryRecallCasesFile(memoryDir) {
  return `${memoryDir.replace(/[\\/]+$/, '')}/recall-cases.json`;
}
