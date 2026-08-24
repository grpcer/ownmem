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
