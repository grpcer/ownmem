import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_MEMORY_TOKENIZER,
} from './memory-tokenizer.mjs';

export const MEMORY_FIELD_CONFIG = Object.freeze({
  name: Object.freeze({ weight: 3.5, lengthNormalization: 0, exactBoost: 22 }),
  hooks: Object.freeze({ weight: 2.8, lengthNormalization: 0.25, exactBoost: 16 }),
  description: Object.freeze({ weight: 2.5, lengthNormalization: 0.35, exactBoost: 15 }),
  triggers: Object.freeze({ weight: 3.4, lengthNormalization: 0.1, exactBoost: 25 }),
  codePath: Object.freeze({ weight: 4.8, lengthNormalization: 0.1, exactBoost: 32 }),
  codeSymbol: Object.freeze({ weight: 5.2, lengthNormalization: 0.1, exactBoost: 34 }),
  codeTest: Object.freeze({ weight: 3.4, lengthNormalization: 0.1, exactBoost: 24 }),
  authorityDocs: Object.freeze({ weight: 1.8, lengthNormalization: 0.2, exactBoost: 12 }),
  scopes: Object.freeze({ weight: 0.4, lengthNormalization: 0, exactBoost: 2 }),
  body: Object.freeze({ weight: 1, lengthNormalization: 0.75, exactBoost: 7 }),
});

export const MEMORY_FIELD_NAMES = Object.freeze(Object.keys(MEMORY_FIELD_CONFIG));

export function parseMemoryHookLine(line) {
  const match = line.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\.md\)\s*[—-]\s*(.*)$/);
  if (!match) return null;
  return { label: match[1], memoryName: path.posix.basename(match[2]), summary: match[3] };
}

export function collectMemoryHooks(indexFiles) {
  const hooksByMemory = new Map();
  for (const { file, content, sourcePath = file } of indexFiles) {
    content.split(/\r?\n/).forEach((line, index) => {
      const hook = parseMemoryHookLine(line);
      if (!hook) return;
      const hooks = hooksByMemory.get(hook.memoryName) || [];
      hooks.push({
        ...hook,
        file,
        line: index + 1,
        sourcePath,
        text: line.trim(),
      });
      hooksByMemory.set(hook.memoryName, hooks);
    });
  }
  return hooksByMemory;
}

export function loadMemoryHooks(absoluteMemoryDir) {
  const indexFiles = readdirSync(absoluteMemoryDir)
    .filter((file) => /^MEMORY-.*\.md$/.test(file))
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((file) => ({ file, content: readFileSync(path.join(absoluteMemoryDir, file), 'utf8') }));
  return collectMemoryHooks(indexFiles);
}

export function memoryFieldValues({ name, parsed, hooks, body, sourcePath = null }) {
  return {
    name: [name],
    hooks: hooks.flatMap((hook) => [hook.label, hook.summary, hook.text]),
    description: parsed.description ? [parsed.description] : [],
    triggers: parsed.triggers,
    codePath: sourcePath ? [...parsed.codePaths, sourcePath] : parsed.codePaths,
    codeSymbol: parsed.codeSymbols,
    codeTest: parsed.codeTests,
    authorityDocs: parsed.authorityDocs,
    scopes: parsed.scopes,
    body: [body],
  };
}

export function compileMemoryFields(input, { tokenizer = DEFAULT_MEMORY_TOKENIZER } = {}) {
  const fieldValues = memoryFieldValues(input);
  const fields = Object.fromEntries(
    Object.entries(fieldValues).map(([field, values]) => [field, values.join('\n')]),
  );
  const fieldFrequencies = Object.fromEntries(
    Object.entries(fields).map(([field, value]) => [field, tokenizer.frequency(value)]),
  );
  const fieldLengths = Object.fromEntries(
    Object.entries(fieldFrequencies).map(([field, frequencies]) => [
      field,
      [...frequencies.values()].reduce((sum, frequency) => sum + frequency, 0),
    ]),
  );
  return {
    fields,
    fieldValues,
    normalizedFieldValues: Object.fromEntries(
      Object.entries(fieldValues).map(([field, values]) => [field, values.map(tokenizer.normalize)]),
    ),
    fieldTokens: Object.fromEntries(
      Object.entries(fields).map(([field, value]) => [field, tokenizer.set(value)]),
    ),
    fieldFrequencies,
    fieldLengths,
  };
}
