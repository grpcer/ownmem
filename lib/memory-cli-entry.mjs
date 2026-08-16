import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function canonicalPath(file) {
  let resolved;
  try {
    resolved = realpathSync.native(path.resolve(file));
  } catch {
    resolved = path.resolve(file);
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Return true when an ES module is the process entry point.
 *
 * Node resolves import.meta.url through filesystem symlinks while argv[1]
 * preserves the invoked path. Comparing path.resolve() values therefore makes
 * npm bins and other symlinked launchers silently skip their CLI entry point.
 */
export function isMemoryCliEntry(moduleUrl, entryPath = process.argv[1]) {
  return Boolean(entryPath && canonicalPath(entryPath) === canonicalPath(fileURLToPath(moduleUrl)));
}
