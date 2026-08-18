import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SCHEMA_ROOT = path.join(PACKAGE_ROOT, 'schemas');

export function schemaPath(...segments) {
  return path.join(SCHEMA_ROOT, ...segments);
}
