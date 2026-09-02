#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...options });
}

function isRepositoryCheckout() {
  try {
    const top = git(['rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return realpathSync(top) === realpathSync(ROOT);
  } catch {
    return false;
  }
}

function trackedFiles() {
  return git(['ls-files', '--cached', '-z']).split('\0').filter(Boolean);
}

function walkFiles(directory = '') {
  const files = [];
  for (const entry of readdirSync(path.join(ROOT, directory || '.'), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const relative = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walkFiles(relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
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

function checkPackageManifest(withGitIndex) {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(manifest.bin?.ownmem === 'bin/ownmem.mjs', 'package bin must point at bin/ownmem.mjs');
  if (withGitIndex) {
    assert(trackedMode(manifest.bin.ownmem) === '100755',
      'bin/ownmem.mjs must be tracked by Git as executable (mode 100755)');
  }
  assert(manifest.exports?.['.'] === './lib/index.mjs', 'package root export must point at lib/index.mjs');
  assert(manifest.exports?.['./schemas/*'] === './schemas/*', 'schema subpaths must remain exported');
  const expectedFiles = ['benchmarks/', 'bin/', 'lib/', 'schemas/', 'test/', 'README.md', 'LICENSE', 'NOTICE', 'CHANGELOG.md'];
  assert(JSON.stringify(manifest.files) === JSON.stringify(expectedFiles),
    `npm files allowlist drifted: ${JSON.stringify(manifest.files)}`);
  assert(manifest.engines?.node === '>=20.6.0', 'Node.js floor must match the import.meta.resolve runtime requirement');
  const packedRoots = new Set(manifest.files.map(entry => entry.replace(/\/$/, '')));
  for (const [name, script] of Object.entries(manifest.scripts ?? {})) {
    for (const [, referenced] of script.matchAll(/\.\/([\w.-]+)\//g)) {
      assert(packedRoots.has(referenced),
        `script "${name}" runs ./${referenced}/ which the npm files allowlist does not ship`);
    }
  }
}

function stripCodeFences(content) {
  let fence = null;
  return content.split('\n').map(line => {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (match) {
      if (!fence) {
        fence = match[1][0];
        return '';
      }
      if (fence === match[1][0]) {
        fence = null;
        return '';
      }
    }
    return fence ? '' : line;
  }).join('\n');
}

function markdownTargets(content) {
  const targets = [];
  for (let index = content.indexOf(']('); index !== -1; index = content.indexOf('](', index + 1)) {
    let cursor = index + 2;
    let depth = 1;
    while (cursor < content.length && depth > 0) {
      const character = content[cursor];
      if (character === '\\') {
        cursor += 2;
        continue;
      }
      if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;
      cursor += 1;
    }
    if (depth === 0) targets.push(content.slice(index + 2, cursor - 1));
  }
  targets.push(...[...content.matchAll(/\b(?:src|srcset)="([^"]+)"/g)].map(match => match[1]));
  return targets;
}

function localTarget(source, rawTarget) {
  const target = rawTarget.trim().replace(/^<|>$/g, '').split(/\s+["']/)[0];
  if (!target || /^(?:[a-z]+:|#)/i.test(target)) return null;
  const withoutFragment = target.split('#')[0].split('?')[0];
  if (!withoutFragment) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    decoded = withoutFragment;
  }
  return decoded.startsWith('/')
    ? path.join(ROOT, decoded.slice(1))
    : path.resolve(path.dirname(path.join(ROOT, source)), decoded);
}

function checkMarkdownLinks(files) {
  const broken = [];
  for (const file of files.filter(file => file.endsWith('.md'))) {
    const content = stripCodeFences(readFileSync(path.join(ROOT, file), 'utf8'));
    for (const target of markdownTargets(content)) {
      const resolved = localTarget(file, target);
      if (resolved && !existsSync(resolved)) broken.push(`${file} -> ${target}`);
    }
  }
  assert(broken.length === 0, `broken local Markdown links:\n${broken.join('\n')}`);
}

const RELATIVE_SPECIFIER = /(?:\bfrom\s+|\bimport\s+|\bimport[A-Za-z0-9_$]*\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

function checkModuleImports(files) {
  const broken = [];
  for (const file of files.filter(file => file.endsWith('.mjs'))) {
    const content = readFileSync(path.join(ROOT, file), 'utf8');
    for (const [, specifier] of content.matchAll(RELATIVE_SPECIFIER)) {
      const resolved = path.resolve(path.dirname(path.join(ROOT, file)), specifier);
      if (!existsSync(resolved)) broken.push(`${file} -> ${specifier}`);
    }
  }
  assert(broken.length === 0, `broken relative module imports:\n${broken.join('\n')}`);
}

function normalizedSkill(file) {
  return readFileSync(path.join(ROOT, file), 'utf8').replace(/^name: .*$/m, 'name: <host-specific>');
}

function skillManifests(files, directory) {
  return files.filter(file => file.startsWith(`${directory}/`) && file.endsWith('/SKILL.md')).sort();
}

function checkPluginSkillHygiene(files) {
  const skills = files.filter(file => file.endsWith('/SKILL.md')
    && (file.startsWith('plugins/') || file.startsWith('skills/')));
  for (const file of skills) {
    const content = readFileSync(path.join(ROOT, file), 'utf8');
    assert(!content.includes('/tmp/'),
      `${file} must not write dashboard tokens or other secrets under /tmp`);
    assert(!/--feedback\s+\S+/.test(content),
      `${file} must not hard-code recall feedback flags; route to CLI help`);
  }
}

function checkSkillMirrors(files) {
  const extensionSkills = skillManifests(files, 'skills');
  const pluginSkills = skillManifests(files, 'plugins/ownmem/skills');
  assert(extensionSkills.length > 0, 'no skill manifests were found under skills/');
  assert(extensionSkills.length === pluginSkills.length,
    `skill mirrors drifted: ${extensionSkills.length} under skills/, ${pluginSkills.length} under plugins/ownmem/skills/`);
  const unmatched = [...pluginSkills];
  for (const extensionSkill of extensionSkills) {
    const index = unmatched.findIndex(pluginSkill => normalizedSkill(pluginSkill) === normalizedSkill(extensionSkill));
    assert(index !== -1, `${extensionSkill} has no matching plugin skill mirror`);
    unmatched.splice(index, 1);
  }
}

function checkCanonicalSchemaIds(files) {
  const schemas = files.filter(file => file.startsWith('schemas/') && file.endsWith('.json'));
  assert(schemas.length > 0, 'no schemas were found under schemas/');
  for (const file of schemas) {
    const schema = JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));
    assert(schema.$id, `${file} has no $id`);
    if (/^https?:\/\//.test(schema.$id)) {
      assert(schema.$id.endsWith(`/${file}`), `${file} has a stale canonical $id: ${schema.$id}`);
    }
  }
}

function checkReleaseVersions() {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lockfile = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const claudePlugin = JSON.parse(readFileSync(
    path.join(ROOT, 'plugins/ownmem/.claude-plugin/plugin.json'),
    'utf8',
  ));
  const codexPlugin = JSON.parse(readFileSync(
    path.join(ROOT, 'plugins/ownmem/.codex-plugin/plugin.json'),
    'utf8',
  ));
  const geminiExtension = JSON.parse(readFileSync(path.join(ROOT, 'gemini-extension.json'), 'utf8'));
  const marketplace = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'));
  const versions = [
    ['package-lock.json', lockfile.version],
    ['package-lock.json packages[""]', lockfile.packages?.['']?.version],
    ['Claude plugin', claudePlugin.version],
    ['Codex plugin', codexPlugin.version],
    ['Gemini extension', geminiExtension.version],
    ['Claude marketplace', marketplace.plugins?.find(plugin => plugin.name === 'ownmem')?.version],
  ];
  for (const [surface, version] of versions) {
    assert(version === manifest.version,
      `${surface} version ${version ?? '<missing>'} does not match package version ${manifest.version}`);
  }

  const citation = readFileSync(path.join(ROOT, 'CITATION.cff'), 'utf8');
  assert(citation.match(/^version:\s*(\S+)\s*$/m)?.[1] === manifest.version,
    `CITATION.cff version does not match package version ${manifest.version}`);
  const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert(changelog.includes(`## [${manifest.version}] - `),
    `CHANGELOG.md has no release heading for ${manifest.version}`);
}

const repositoryTree = existsSync(path.join(ROOT, 'docs')) && existsSync(path.join(ROOT, 'skills'));
const checkout = isRepositoryCheckout();
assert(repositoryTree || !checkout, 'Git checkout is missing the repository tree (docs/, skills/)');
const files = checkout ? trackedFiles() : walkFiles();
if (checkout) checkRootLayout(files);
checkPackageManifest(checkout);
if (repositoryTree) {
  checkMarkdownLinks(files);
  checkSkillMirrors(files);
  checkPluginSkillHygiene(files);
  checkReleaseVersions();
}
checkModuleImports(files);
checkCanonicalSchemaIds(files);
process.stdout.write('repository structure self-test: passed\n');
