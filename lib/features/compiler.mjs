#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMemoryIndex } from '../memory-compiler.mjs';
import { isMemoryCliEntry } from '../memory-cli-entry.mjs';

export function runPublicCompiler(args = process.argv.slice(2)) {
  let root = process.cwd();
  let memoryDir = '.ownmem';
  let indexDirectory = '.ownmem/index';
  let force = false;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (['--root', '--memory-dir', '--index-dir'].includes(argument)) {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === '--root') root = path.resolve(value);
      else if (argument === '--memory-dir') memoryDir = value;
      else indexDirectory = value;
    } else if (argument === '--force') force = true;
    else if (argument === '--json') json = true;
    else throw new Error(`unknown compile option: ${argument}`);
  }
  const result = compileMemoryIndex({ root, memoryDir, indexDirectory, force });
  const output = {
    schema: 'ownmem-compile-result/v1',
    snapshot_id: result.manifest.snapshot.id,
    published: result.published,
    unchanged: result.unchanged,
    stats: result.stats,
  };
  process.stdout.write(json ? `${JSON.stringify(output, null, 2)}\n` : `memory compiler: ${result.unchanged ? 'unchanged' : 'published'} ${output.snapshot_id}\n`);
  return 0;
}

if (isMemoryCliEntry(import.meta.url)) {
  try {
    process.exitCode = runPublicCompiler();
  } catch (error) {
    process.stderr.write(`ownmem compile: ${error.message}\n`);
    process.exitCode = 1;
  }
}
