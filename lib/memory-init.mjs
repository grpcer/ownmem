import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { loadMemoryTopics } from './memory-schema.mjs';
import {
  bootstrapReceiptForTopic,
  createMemoryTrustLock,
  memoryGitState,
  writeMemoryTrustLock,
} from './memory-trust-store.mjs';
import { MEMORY_CONFIG_DIRECTORIES, resolveMemoryDir } from './memory-paths.mjs';

export const MEMORY_CONFIG_SCHEMA = 'ownmem.config/v1';
export const MEMORY_ADAPTER_VERSION = 1;
const GENERATED_ID = 'ownmem-agent-instructions-v1';
const START = id => `<!-- ownmem-generated:start ${id} -->`;
const END = id => `<!-- ownmem-generated:end ${id} -->`;
const VALID_LAYERS = new Set(['core', 'gates', 'compiler', 'dashboard']);

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const posix = value => value.split(path.sep).join('/');

function ensureInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`init target escapes repository root: ${target}`);
  return target;
}

function writeIfChanged(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return 'unchanged';
  const action = existsSync(file) ? 'updated' : 'created';
  writeFileSync(file, content, 'utf8');
  return action;
}

// The compiler and telemetry write to .local-test/, which must never be committed in a consumer
// repository, while the memory directory itself travels with git. A user-owned .gitignore is
// touched by exactly one appended line and never rewritten; repositories that do not use git are
// left without a stray .gitignore.
function hasLocalTestIgnore(content) {
  return content.split(/\r?\n/).some((line) => /^\/?\.local-test\/?$/.test(line.trim()));
}

function ensureLocalTestIgnored({ root, check }) {
  if (!existsSync(path.join(root, '.git'))) return null;
  const file = path.join(root, '.gitignore');
  const exists = existsSync(file);
  const current = exists ? readFileSync(file, 'utf8') : '';
  if (hasLocalTestIgnore(current)) return { path: '.gitignore', status: check ? 'valid' : 'preserved', sha256: null };
  if (check) return { path: '.gitignore', status: 'drifted', sha256: null };
  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  writeFileSync(file, `${current}${separator}.local-test/\n`, 'utf8');
  return { path: '.gitignore', status: exists ? 'updated' : 'created', sha256: null };
}

function generatedBlock(id, body) {
  return `${START(id)}\n${body.trim()}\n${END(id)}`;
}

function locateBoundary(content, start, end, id) {
  const starts = [...content.matchAll(new RegExp(start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))];
  const ends = [...content.matchAll(new RegExp(end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))];
  if (starts.length !== ends.length || starts.length > 1) throw new Error(`generated boundary ${id} must be unique and paired`);
  if (starts.length === 0) return null;
  if (starts[0].index >= ends[0].index) throw new Error(`generated boundary ${id} is reversed`);
  return { start: starts[0].index, end: ends[0].index + end.length };
}

function locateBlock(content, id) {
  return locateBoundary(content, START(id), END(id), id);
}

export function upsertGeneratedBlock(content, id, body) {
  const block = generatedBlock(id, body);
  const located = locateBlock(content, id);
  if (!located) return `${content.trimEnd()}${content.trim() ? '\n\n' : ''}${block}\n`;
  return `${content.slice(0, located.start)}${block}${content.slice(located.end)}`;
}

function instructionBody({ command, memoryDir, locale }) {
  const language = new Intl.Locale(locale).language;
  const localized = {
    zh: ['工程记忆入口', '改代码或文档前运行', '问题、路径或符号', '用户说“记住”时，先判断应由机器门禁、项目规则、权威文档、临时开发包或回归测试承载；只有都不适合时才写长期记忆。', '写入后运行', '不要绕过 schema、配额或近重复告警。', '用户问近期效果时运行', '没有消费/反馈样本时不得声称准确率。', '不调用外部模型，不把多个召回结果重复注入上下文。'],
    es: ['Punto de entrada de memoria de ingeniería', 'Antes de cambiar código o documentación, ejecuta', 'problema, ruta o símbolo', 'Si piden recordar algo, decide primero si corresponde a una regla automática, una regla del proyecto, documentación canónica, un paquete temporal o una prueba de regresión. Crea memoria duradera solo si nada de eso aplica.', 'Después de escribir, ejecuta', 'No omitas el esquema, la cuota ni los avisos de casi duplicado.', 'Para evaluar el uso reciente, ejecuta', 'No afirmes precisión sin evidencia de consumo o comentarios.', 'No llames modelos externos ni inyectes sobres de recuperación duplicados.'],
    fr: ["Point d’entrée de la mémoire d’ingénierie", 'Avant de modifier le code ou la documentation, exécutez', 'problème, chemin ou symbole', 'Si on vous demande de mémoriser un élément, vérifiez d’abord s’il relève d’une règle automatique, des règles du projet, de la documentation canonique, d’un dossier temporaire ou d’un test de régression. Ne créez une mémoire durable que si aucun ne convient.', 'Après une écriture, exécutez', 'Ne contournez jamais le schéma, le quota ni les alertes de quasi-duplication.', 'Pour évaluer l’usage récent, exécutez', 'N’affirmez aucune précision sans preuve de consommation ou de retour explicite.', 'N’appelez aucun modèle externe et n’injectez pas plusieurs fois le même résultat de rappel.'],
    de: ['Einstiegspunkt für Engineering-Memory', 'Vor Änderungen an Code oder Dokumentation ausführen', 'Problem, Pfad oder Symbol', 'Wenn etwas gemerkt werden soll, zuerst prüfen, ob ein automatisches Gate, eine Projektregel, kanonische Dokumentation, ein temporäres Arbeitspaket oder ein Regressionstest zuständig ist. Langzeitwissen nur anlegen, wenn nichts davon passt.', 'Nach einem Schreibvorgang ausführen', 'Schema, Kontingent und Warnungen vor Beinahe-Duplikaten niemals umgehen.', 'Für die jüngste Wirksamkeit ausführen', 'Ohne Nutzungs- oder Feedbackdaten keine Genauigkeit behaupten.', 'Keine externen Modelle aufrufen und keine doppelten Recall-Ergebnisse in den Kontext einfügen.'],
    ja: ['エンジニアリングメモリの入口', 'コードや文書を変更する前に実行', '問題・パス・シンボル', '「覚えて」と依頼されたら、まず機械的ゲート、プロジェクト規則、正規文書、一時作業パッケージ、回帰テストのどれが保持すべきか判断します。どれにも該当しない場合だけ長期メモリを作成します。', '書き込み後に実行', 'スキーマ、容量制限、近似重複の警告を回避しないでください。', '最近の効果を確認するには実行', '利用・フィードバックの証拠なしに精度を主張しないでください。', '外部モデルを呼び出さず、同じ召回結果を重複してコンテキストへ注入しないでください。'],
    ko: ['엔지니어링 메모리 진입점', '코드나 문서를 변경하기 전에 실행', '문제, 경로 또는 심볼', '무언가를 기억해 달라는 요청을 받으면 먼저 자동 게이트, 프로젝트 규칙, 기준 문서, 임시 작업 패키지 또는 회귀 테스트가 담당해야 하는지 판단합니다. 어느 것도 맞지 않을 때만 장기 메모리를 만듭니다.', '작성 후 실행', '스키마, 할당량 또는 유사 중복 경고를 우회하지 마세요.', '최근 효과를 확인하려면 실행', '사용 또는 피드백 증거 없이 정확도를 주장하지 마세요.', '외부 모델을 호출하지 말고 같은 회상 결과를 중복 주입하지 마세요.'],
    pt: ['Ponto de entrada da memória de engenharia', 'Antes de alterar código ou documentação, execute', 'problema, caminho ou símbolo', 'Quando pedirem para lembrar algo, decida primeiro se isso pertence a uma regra automática, regra do projeto, documentação canônica, pacote temporário ou teste de regressão. Crie memória duradoura apenas se nenhuma opção servir.', 'Depois de escrever, execute', 'Nunca ignore o schema, a cota ou os alertas de quase duplicidade.', 'Para avaliar o uso recente, execute', 'Não afirme precisão sem evidência de consumo ou feedback.', 'Não chame modelos externos nem injete resultados de recuperação duplicados.'],
  }[language];
  const text = localized || ['Engineering memory entry point', 'Before changing code or docs, run', 'problem, path, or symbol', 'When asked to remember something, first decide whether a machine gate, project rule, canonical doc, temporary work package, or regression test owns it. Create long-term memory only if none fits.', 'After a write, run', 'Never bypass schema, quota, or near-duplicate findings.', 'For recent effectiveness, run', 'Never claim accuracy without consumption or feedback evidence.', 'Do not call external models and do not inject duplicate recall envelopes.'];
  return `## ${text[0]}

- ${text[1]}: \`${command} recall --memory-dir ${memoryDir} -- <${text[2]}>\`.
- ${text[3]}
- ${text[4]}: \`${command} audit --memory-dir ${memoryDir}\`. ${text[5]}
- ${text[6]}: \`${command} report --since 7d\`; ${text[7]}
- At the end of a task, run \`${command} evolve run --quiet --source host-turn\`. It applies only replay-proven R0 retrieval metadata; higher-risk work stays in review.
- Launch the local dashboard with \`${command} dashboard --open\` when the dashboard layer is installed.
- ${text[8]}`;
}

// With no front matter, Claude Code takes the first line of the file as the command's description.
// Wrapping this in the generated block put `<!-- ownmem-generated:start -->` on line 1, so that
// marker became the description shown in the slash menu. Same family as the Cursor rule, the Codex
// skill, and the Gemini command; mildest symptom, because the command itself still ran.
// The description is deliberately English on every host: it is read by a model as a trigger, and
// it is the public package's outward identity.
function slashBody(command) {
  return `---
description: Route one natural-language memory intent through the deterministic memory CLI
---

Pass the user's natural-language intent to the single memory CLI dispatcher. Do not implement memory logic in this adapter.

Run:

\`\`\`bash
${command} intent -- "$ARGUMENTS"
\`\`\``;
}

// Repository-level `.agents/skills/<name>/SKILL.md` is the shared discovery path: Codex (0.147+),
// Cursor, and Grok CLI all read it directly from the working tree, so one generated file covers
// every AGENTS.md-family tool with no linking step. Codex users can also invoke it explicitly as
// `$ownmem`. The pre-0.147 `~/.codex/skills` symlink workaround is retired; the old in-memory-dir
// copy migrates through legacyPath.
function agentsSkillBody(command, memoryDir) {
  return `---
name: ownmem
description: Use before editing code or documentation in this repository, and whenever the user asks what is already known about a symbol, path, error, or past decision. Retrieves curated engineering memory from ${memoryDir} through a local, deterministic, zero-network CLI.
---

# OwnMem engineering memory

## When to use

- Before changing code or docs: recall first, so a prior decision or a known trap is not rediscovered the hard way.
- When the user asks "why is it like this", "have we hit this before", or names a symbol, path, or error code.
- Before writing anything down as a memory: ask where it belongs first.

## How to use

Recall (local, no model, no network):

\`\`\`bash
${command} recall -- "<question, symbol, path, or error>"
\`\`\`

Decide where a new piece of knowledge belongs instead of guessing:

\`\`\`bash
${command} intent -- "<what you just learned>"
\`\`\`

## Rules

- Retrieval abstains when nothing is trusted enough. An empty answer means "nothing recorded", not "look harder".
- Never paste a recalled excerpt as fact without opening the topic it came from.
- Do not implement memory logic here. This skill only routes to the CLI.
- At the end of a task, run \`${command} evolve run --quiet --source host-turn\`. It is the default low-risk maintenance path; do not replace it with manual promotion steps.`;
}

function geminiCommand(command) {
  return `description = "Route one natural-language memory intent through the deterministic memory CLI"
prompt = """
Run \`${command} intent -- {{args}}\`, then follow its structured action. Do not duplicate memory logic in this command.
"""`;
}

function adapterSpecs({ root, command, memoryDir, locale, hosts }) {
  const instructions = instructionBody({ command, memoryDir, locale });
  const specs = [];
  if (hosts.includes('claude')) {
    specs.push({ host: 'claude', kind: 'block', path: 'CLAUDE.md', id: GENERATED_ID, body: instructions });
    specs.push({ host: 'claude', kind: 'whole', path: '.claude/commands/ownmem.md', id: 'ownmem-slash-v1', body: slashBody(command) });
  }
  if (hosts.includes('codex')) {
    specs.push({ host: 'codex', kind: 'block', path: 'AGENTS.md', id: GENERATED_ID, body: instructions });
  }
  // The shared skill is emitted once even when several of its readers are selected as hosts.
  if (hosts.includes('codex') || hosts.includes('cursor')) {
    specs.push({
      host: hosts.includes('codex') ? 'codex' : 'cursor',
      kind: 'whole',
      path: '.agents/skills/ownmem/SKILL.md',
      legacyPath: `${memoryDir}/codex-skill/SKILL.md`,
      id: 'ownmem-agents-skill-v1',
      body: agentsSkillBody(command, memoryDir),
    });
  }
  if (hosts.includes('gemini')) {
    specs.push({ host: 'gemini', kind: 'block', path: 'GEMINI.md', id: GENERATED_ID, body: instructions });
    // TOML has no HTML comments. Wrapping this file in the generated block put `<!-- ... -->` on
    // line 1, so every parse failed at column 1 and the Gemini command never loaded -- the same
    // silent failure the Cursor rule and the Codex skill already hit, just one host later. Like
    // them, it is generated end to end, so ownership lives in adapters.json instead of a marker.
    specs.push({ host: 'gemini', kind: 'whole', path: '.gemini/commands/ownmem.toml', id: 'ownmem-slash-v1', body: geminiCommand(command) });
  }
  if (hosts.includes('cursor')) specs.push({
    host: 'cursor',
    kind: 'whole',
    path: '.cursor/rules/ownmem.mdc',
    id: GENERATED_ID,
    body: `---\ndescription: Deterministic engineering memory discipline\nalwaysApply: true\n---\n\n${instructions}`,
  });
  if (hosts.includes('generic')) specs.push({ host: 'generic', kind: 'block', path: 'MEMORY_INSTRUCTIONS.md', id: GENERATED_ID, body: instructions });
  return specs.map(spec => ({ ...spec, absolutePath: ensureInside(root, path.join(root, spec.path)) }));
}

export function detectMemoryHosts(root) {
  const hosts = [];
  if (existsSync(path.join(root, '.claude'))) hosts.push('claude');
  if (existsSync(path.join(root, 'AGENTS.md'))) hosts.push('codex');
  if (existsSync(path.join(root, '.gemini'))) hosts.push('gemini');
  if (existsSync(path.join(root, '.cursor'))) hosts.push('cursor');
  if (hosts.length === 0) hosts.push('generic');
  return hosts;
}

function normalizedLayers(layers) {
  const requested = [...new Set(layers || ['core'])];
  for (const layer of requested) if (!VALID_LAYERS.has(layer)) throw new Error(`unknown memory layer: ${layer}`);
  if (requested.includes('dashboard')) requested.push('compiler');
  if (requested.includes('compiler')) requested.push('gates');
  if (requested.includes('gates')) requested.push('core');
  const order = ['core', 'gates', 'compiler', 'dashboard'];
  return [...new Set(requested)].sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

function skeleton({ locale }) {
  const zh = locale === 'zh-CN';
  const description = zh
    ? '示例：修改文件前先召回与目标路径相关的工程约束'
    : 'Example: recall repository constraints before changing a target file';
  const exampleTrigger = zh ? '修改文件前先查约束' : 'check constraints before editing a file';
  return {
    l1: '# OwnMem\n\n- [General](MEMORY-general.md)\n',
    l2: `# General\n\n- [Example](example_repository_memory.md) - ${description}\n`,
    topic: `---
name: example_repository_memory
description: ${JSON.stringify(description)}
metadata:
  node_type: memory
  type: lesson
  status: active
  scopes: [general]
  applies_to: [all]
  triggers: ["repository constraint", ${JSON.stringify(exampleTrigger)}]
  last_verified: ${new Date().toISOString().slice(0, 10)}
  expires_at: null
  authority: observed
  authority_docs: []
  history_docs: []
  supersedes: []
  code_evidence: []
  evidence: [synthetic-example]
---

# Example repository memory

Replace this synthetic topic with a verified, reusable lesson from your repository. Keep symptoms and exact identifiers in triggers; never store secrets or private conversation text.
`,
  };
}

/**
 * Every host integration the package has, as one list.
 *
 * It used to be only the two recall matchers, and the drift consequence was invisible: an
 * installation was reported healthy while producing none of the collection this system's own
 * reports are computed from -- command outcomes, turn corrections, full-text opens. Whatever this
 * table holds is what "installed" means; anything missing from it is a surface a consumer silently
 * does not have.
 */
const CLAUDE_HOOKS = Object.freeze([
  // Recall, and the consumption receipt that pairs with it.
  { event: 'PreToolUse', matcher: 'Edit|Write', argument: 'hook' },
  { event: 'PreToolUse', matcher: 'Read', argument: 'hook' },
  // Command outcomes: the failed -> passed transition a debug lesson is made of. The matcher also
  // covers the tools that bring outside text in, because the same hook records that a session was
  // exposed to it -- keeping that on a separate matcher would mean an installation could end up
  // collecting candidates while blind to the one thing that must stop them.
  { event: 'PostToolUse', matcher: 'Bash|WebFetch|WebSearch|mcp__.*', argument: 'posttool' },
  { event: 'PostToolUseFailure', matcher: 'Bash|WebFetch|WebSearch|mcp__.*', argument: 'posttool' },
  // The turn that just ended, read from the transcript the host already wrote. No matcher: Stop is
  // not a tool event.
  { event: 'Stop', matcher: null, argument: 'stop' },
]);

function hookEntryPresent(settings, { event, matcher, argument }, command) {
  const hookCommand = `${command} ${argument}`;
  return (settings.hooks?.[event] || []).some(entry => (entry.matcher ?? null) === matcher
    && Array.isArray(entry.hooks)
    && entry.hooks.some(hook => hook.type === 'command' && hook.command === hookCommand));
}

function ensureClaudeHook({ root, command, check }) {
  const relative = '.claude/settings.json';
  const file = ensureInside(root, path.join(root, relative));
  let settings = {};
  if (existsSync(file)) settings = JSON.parse(readFileSync(file, 'utf8'));
  settings.hooks ||= {};
  const fingerprint = sha256(CLAUDE_HOOKS.map(entry => `${entry.event}:${entry.matcher ?? ''}:${command} ${entry.argument}`).join('\n'));
  const present = CLAUDE_HOOKS.every(entry => hookEntryPresent(settings, entry, command));
  if (check) return { path: relative, status: present ? 'valid' : 'drifted', sha256: present ? fingerprint : null };
  for (const entry of CLAUDE_HOOKS) {
    settings.hooks[entry.event] ||= [];
    if (hookEntryPresent(settings, entry, command)) continue;
    const hook = { type: 'command', command: `${command} ${entry.argument}`, timeout: 5 };
    settings.hooks[entry.event].push(entry.matcher === null ? { hooks: [hook] } : { matcher: entry.matcher, hooks: [hook] });
  }
  const content = `${JSON.stringify(settings, null, 2)}\n`;
  return { path: relative, status: writeIfChanged(file, content), sha256: fingerprint };
}

export function initializeMemoryRepository({
  root,
  memoryDir = null,
  command = null,
  locale = null,
  layers = null,
  check = false,
  hook = null,
  hosts: suppliedHosts = null,
} = {}) {
  if (!root) throw new Error('memory init requires a repository root');
  const absoluteRoot = path.resolve(root);
  const selectedMemoryDir = resolveMemoryDir(absoluteRoot, memoryDir);
  if (!MEMORY_CONFIG_DIRECTORIES.includes(selectedMemoryDir)) {
    throw new Error(`memory init supports ${MEMORY_CONFIG_DIRECTORIES.join(' or ')} as the memory directory; '${selectedMemoryDir}' would be invisible to bare commands`);
  }
  const absoluteMemory = ensureInside(absoluteRoot, path.join(absoluteRoot, selectedMemoryDir));
  const existingConfigPath = path.join(absoluteMemory, 'config.json');
  let existingConfig = null;
  if (existsSync(existingConfigPath)) {
    try {
      existingConfig = JSON.parse(readFileSync(existingConfigPath, 'utf8'));
    } catch {
      // The expected config comparison below reports drift; update replaces invalid generated config.
    }
  }
  const selectedCommand = command || existingConfig?.command || 'npx ownmem';
  const requestedLocale = locale || existingConfig?.locale || 'en';
  const selectedLayers = normalizedLayers(layers || existingConfig?.layers || ['core']);
  const hosts = [...new Set(suppliedHosts || detectMemoryHosts(absoluteRoot))].sort(compareText);
  let selectedLocale;
  try {
    selectedLocale = new Intl.Locale(requestedLocale === 'auto' ? Intl.DateTimeFormat().resolvedOptions().locale : requestedLocale).toString();
  } catch {
    throw new Error(`--locale must be a valid BCP 47 language tag or auto: ${requestedLocale}`);
  }
  const config = {
    schema: MEMORY_CONFIG_SCHEMA,
    version: 1,
    memory_dir: posix(selectedMemoryDir),
    locale: selectedLocale,
    layers: selectedLayers,
    command: selectedCommand,
    adapters: hosts,
    hook_enabled: Boolean((hook ?? existingConfig?.hook_enabled ?? false) && hosts.includes('claude') && selectedLayers.includes('compiler')),
  };
  const configPath = path.join(absoluteMemory, 'config.json');
  const expectedConfig = `${JSON.stringify(config, null, 2)}\n`;
  const results = [];
  if (check) {
    results.push({ path: posix(path.relative(absoluteRoot, configPath)), status: existsSync(configPath) && readFileSync(configPath, 'utf8') === expectedConfig ? 'valid' : 'drifted', sha256: sha256(expectedConfig) });
  } else {
    results.push({ path: posix(path.relative(absoluteRoot, configPath)), status: writeIfChanged(configPath, expectedConfig), sha256: sha256(expectedConfig) });
  }

  const files = skeleton({ locale: selectedLocale });
  const skeletonSpecs = [
    ['MEMORY.md', files.l1],
    ['MEMORY-general.md', files.l2],
    ['example_repository_memory.md', files.topic],
    ['quota.lock.json', `${JSON.stringify({
      schema: 'ownmem.quota/v3',
      mode: 'growth',
      updated_at: new Date().toISOString().slice(0, 10),
      transitioned_at: null,
      growth_threshold: 50,
      target_hooks_per_l2: 40,
      max_active_l3: 50,
      max_active_bytes: 262144,
      l2_baseline: {},
    }, null, 2)}\n`],
  ];
  for (const [relative, content] of skeletonSpecs) {
    const file = path.join(absoluteMemory, relative);
    if (check) results.push({ path: posix(path.relative(absoluteRoot, file)), status: existsSync(file) ? 'valid' : 'missing', sha256: existsSync(file) ? sha256(readFileSync(file)) : null });
    else if (!existsSync(file)) results.push({ path: posix(path.relative(absoluteRoot, file)), status: writeIfChanged(file, content), sha256: sha256(content) });
    else results.push({ path: posix(path.relative(absoluteRoot, file)), status: 'preserved', sha256: sha256(readFileSync(file)) });
  }

  const trustFile = path.join(absoluteMemory, 'trust.lock.json');
  if (check) {
    results.push({
      path: posix(path.relative(absoluteRoot, trustFile)),
      status: existsSync(trustFile) ? 'valid' : 'missing',
      sha256: existsSync(trustFile) ? sha256(readFileSync(trustFile)) : null,
    });
  } else if (existsSync(trustFile)) {
    results.push({ path: posix(path.relative(absoluteRoot, trustFile)), status: 'preserved', sha256: sha256(readFileSync(trustFile)) });
  } else {
    const now = new Date();
    const git = memoryGitState(absoluteRoot, selectedMemoryDir);
    const receipts = loadMemoryTopics({ root: absoluteRoot, memoryDir: selectedMemoryDir })
      .filter(topic => topic.record)
      .map(topic => {
        const topicPath = posix(path.join(selectedMemoryDir, topic.fileName));
        return bootstrapReceiptForTopic({
          root: absoluteRoot,
          memoryDir: selectedMemoryDir,
          topic,
          evidence: [{ kind: 'topic', locator: topicPath, path: topicPath, sha256: sha256(topic.content), symbol: null }],
          issuedAt: now.toISOString(),
          sourceCommit: git.repository_head,
        });
      });
    writeMemoryTrustLock({
      root: absoluteRoot,
      memoryDir: selectedMemoryDir,
      lock: createMemoryTrustLock({ receipts, now, source: { repository_head: git.repository_head, working_tree: git.working_tree } }),
    });
    results.push({ path: posix(path.relative(absoluteRoot, trustFile)), status: 'created', sha256: sha256(readFileSync(trustFile)) });
  }

  const gitignore = ensureLocalTestIgnored({ root: absoluteRoot, check });
  if (gitignore) results.push(gitignore);

  const adapters = adapterSpecs({ root: absoluteRoot, command: selectedCommand, memoryDir: posix(selectedMemoryDir), locale: selectedLocale, hosts });
  for (const adapter of adapters) {
    const legacyAbsolutePath = adapter.legacyPath ? ensureInside(absoluteRoot, path.join(absoluteRoot, adapter.legacyPath)) : null;
    const migrateLegacyFile = legacyAbsolutePath && !existsSync(adapter.absolutePath) && existsSync(legacyAbsolutePath);
    const sourcePath = migrateLegacyFile ? legacyAbsolutePath : adapter.absolutePath;
    const current = existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8') : '';
    // `whole` files carry front matter that its reader requires on line 1. Wrapping them in the
    // generated-block comment pushed the `---` to line 2, and both Cursor and Codex then saw a plain
    // Markdown file with no metadata: the .mdc rule never applied, and the skill was never
    // discoverable. Those files are generated end to end anyway, so ownership is tracked in
    // adapters.json instead of by an inline marker.
    const wholeFile = adapter.kind === 'whole';
    const expected = wholeFile ? `${adapter.body.trim()}\n` : upsertGeneratedBlock(current, adapter.id, adapter.body);
    const located = wholeFile ? null : locateBlock(current, adapter.id);
    const currentBlock = wholeFile ? current : (located ? current.slice(located.start, located.end) : '');
    const expectedBlock = wholeFile ? expected : generatedBlock(adapter.id, adapter.body);
    if (check) {
      results.push({ path: adapter.path, host: adapter.host, status: currentBlock === expectedBlock ? 'valid' : 'drifted', sha256: sha256(expectedBlock) });
    } else {
      results.push({ path: adapter.path, host: adapter.host, status: writeIfChanged(adapter.absolutePath, expected), sha256: sha256(expectedBlock) });
      if (migrateLegacyFile) {
        // The only relocation still supported is the 0.2.x in-memory-dir Codex skill moving to
        // .agents/skills/. A marker-less whole file is removable only because it sits inside the
        // memory directory, which is generated end to end, so ownership is certain without a marker.
        const ownedWholeLegacy = wholeFile
          && posix(path.relative(absoluteRoot, legacyAbsolutePath)).startsWith(`${posix(selectedMemoryDir)}/`);
        if (ownedWholeLegacy) {
          rmSync(legacyAbsolutePath);
          const legacyParent = path.dirname(legacyAbsolutePath);
          if (existsSync(legacyParent) && readdirSync(legacyParent).length === 0) rmSync(legacyParent, { recursive: true });
          results.push({ path: adapter.legacyPath, host: adapter.host, status: 'removed', sha256: null });
        }
      }
    }
  }
  if (config.hook_enabled) results.push(ensureClaudeHook({ root: absoluteRoot, command: selectedCommand, check }));

  const manifest = {
    schema: 'ownmem.adapters/v1',
    version: MEMORY_ADAPTER_VERSION,
    hosts,
    files: results.filter(result => result.host).map(({ path: filePath, host, sha256: digest }) => ({ path: filePath, host, sha256: digest })),
  };
  const manifestPath = path.join(absoluteMemory, 'adapters.json');
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  if (check) results.push({ path: posix(path.relative(absoluteRoot, manifestPath)), status: existsSync(manifestPath) && readFileSync(manifestPath, 'utf8') === manifestContent ? 'valid' : 'drifted', sha256: sha256(manifestContent) });
  else results.push({ path: posix(path.relative(absoluteRoot, manifestPath)), status: writeIfChanged(manifestPath, manifestContent), sha256: sha256(manifestContent) });
  return {
    schema: 'ownmem.init-result/v1',
    mode: check ? 'check' : 'update',
    root: absoluteRoot,
    config,
    hosts,
    results,
    healthy: results.every(result => ['valid', 'unchanged', 'created', 'updated', 'preserved', 'removed'].includes(result.status)),
  };
}
