#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
}

function trackedMode(file) {
  const entry = execFileSync('git', ['ls-files', '--stage', '--', file], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  return entry.match(/^(\d{6})\s/)?.[1] ?? null;
}

function checkRootLayout(files) {
  const actual = [...new Set(files.map(file => file.split('/')[0]))].sort();
  const expected = [
    '.agents',
    '.claude-plugin',
    '.github',
    '.gitignore',
    '.ownmem',
    'CHANGELOG.md',
    'CITATION.cff',
    'LICENSE',
    'NOTICE',
    'README.md',
    'benchmarks',
    'bin',
    'commands',
    'docs',
    'gemini-extension.json',
    'lib',
    'package-lock.json',
    'package.json',
    'plugins',
    'schemas',
    'skills',
    'test',
  ];
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    `root layout drifted:\nexpected ${expected.join(', ')}\nactual   ${actual.join(', ')}`);
  assert(actual.length <= 24, `repository root has ${actual.length} entries; keep it at or below 24`);
}

function checkPackageManifest() {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(manifest.bin?.ownmem === 'bin/ownmem.mjs', 'package bin must point at bin/ownmem.mjs');
  assert(trackedMode(manifest.bin.ownmem) === '100755',
    'bin/ownmem.mjs must be tracked by Git as executable (mode 100755)');
  assert(manifest.exports?.['.'] === './lib/index.mjs', 'package root export must point at lib/index.mjs');
  assert(manifest.exports?.['./schemas/*'] === './schemas/*', 'schema subpaths must remain exported');
  const expectedFiles = ['bin/', 'lib/', 'schemas/', 'README.md', 'LICENSE', 'NOTICE', 'CHANGELOG.md'];
  assert(JSON.stringify(manifest.files) === JSON.stringify(expectedFiles),
    `npm files allowlist drifted: ${JSON.stringify(manifest.files)}`);
}

function localTarget(source, rawTarget) {
  const target = rawTarget.trim().replace(/^<|>$/g, '').split(/\s+["']/)[0];
  if (!target || /^(?:[a-z]+:|#)/i.test(target)) return null;
  const withoutFragment = target.split('#')[0].split('?')[0];
  if (!withoutFragment) return null;
  const decoded = decodeURIComponent(withoutFragment);
  return decoded.startsWith('/')
    ? path.join(ROOT, decoded.slice(1))
    : path.resolve(path.dirname(path.join(ROOT, source)), decoded);
}

function checkMarkdownLinks(files) {
  const broken = [];
  for (const file of files.filter(file => file.endsWith('.md'))) {
    const content = readFileSync(path.join(ROOT, file), 'utf8');
    const targets = [
      ...[...content.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]),
      ...[...content.matchAll(/\b(?:src|srcset)="([^"]+)"/g)].map(match => match[1]),
    ];
    for (const target of targets) {
      const resolved = localTarget(file, target);
      if (resolved && !existsSync(resolved)) broken.push(`${file} -> ${target}`);
    }
  }
  assert(broken.length === 0, `broken local Markdown links:\n${broken.join('\n')}`);
}

function checkModuleImports(files) {
  const broken = [];
  for (const file of files.filter(file => file.endsWith('.mjs'))) {
    const content = readFileSync(path.join(ROOT, file), 'utf8');
    const imports = [...content.matchAll(/(?:from\s+|import\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)]
      .map(match => match[1]);
    for (const specifier of imports) {
      const resolved = path.resolve(path.dirname(path.join(ROOT, file)), specifier);
      if (!existsSync(resolved)) broken.push(`${file} -> ${specifier}`);
    }
  }
  assert(broken.length === 0, `broken relative module imports:\n${broken.join('\n')}`);
}

function normalizedSkill(file) {
  return readFileSync(path.join(ROOT, file), 'utf8').replace(/^name: .*$/m, 'name: <host-specific>');
}

function checkSkillMirrors() {
  const pairs = [
    ['skills/ownmem/SKILL.md', 'plugins/ownmem/skills/recall/SKILL.md'],
    ['skills/ownmem-init/SKILL.md', 'plugins/ownmem/skills/init/SKILL.md'],
    ['skills/ownmem-dashboard/SKILL.md', 'plugins/ownmem/skills/dashboard/SKILL.md'],
  ];
  for (const [extensionSkill, pluginSkill] of pairs) {
    assert(normalizedSkill(extensionSkill) === normalizedSkill(pluginSkill),
      `${extensionSkill} and ${pluginSkill} drifted beyond their host-specific names`);
  }
}

function checkCanonicalSchemaIds() {
  const schemas = [
    ['schemas/memory.schema.json', '/schemas/memory.schema.json'],
    ['schemas/observability/events.schema.json', '/schemas/observability/events.schema.json'],
    ['schemas/observability/report.schema.json', '/schemas/observability/report.schema.json'],
  ];
  for (const [file, suffix] of schemas) {
    const schema = JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));
    assert(schema.$id?.endsWith(suffix), `${file} has a stale canonical $id: ${schema.$id}`);
  }
}

const files = trackedFiles();
checkRootLayout(files);
checkPackageManifest();
checkMarkdownLinks(files);
checkModuleImports(files);
checkSkillMirrors();
checkCanonicalSchemaIds();
process.stdout.write('repository structure self-test: passed\n');
