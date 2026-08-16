#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMemoryCliEntry } from './lib/memory-cli-entry.mjs';
import { initializeMemoryRepository } from './lib/memory-init.mjs';
import { loadMemoryIndex, searchMemory } from './lib/memory-markdown-index.mjs';

async function importLayerModule(specifier, layer, capability) {
  try {
    return await import(specifier);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && String(error.message).includes(specifier.replace('./', ''))) {
      throw new Error(`${capability} requires the optional ${layer} layer`);
    }
    throw error;
  }
}

function takeValue(args, index, option) {
  const value = args[index + 1];
  if (!value) throw new Error(`${option} requires a value`);
  return value;
}

function parseShared(args, defaults = {}) {
  const options = { root: process.cwd(), memoryDir: null, json: false, rest: [], ...defaults };
  let passthrough = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') {
      passthrough = true;
      continue;
    }
    if (!passthrough && argument === '--root') {
      options.root = path.resolve(takeValue(args, index, argument));
      index += 1;
    } else if (!passthrough && argument === '--memory-dir') {
      options.memoryDir = takeValue(args, index, argument);
      index += 1;
    } else if (!passthrough && argument === '--json') options.json = true;
    else options.rest.push(argument);
  }
  if (!options.memoryDir) {
    options.memoryDir = !existsSync(path.join(options.root, '.ownmem')) && existsSync(path.join(options.root, '.memory'))
      ? '.memory'
      : '.ownmem';
  }
  return options;
}

function formatRecall(result) {
  if (result.results.length === 0) return `No trusted memory match (${result.abstain_reason}).\n`;
  return `${result.results.map((item, index) => `${index + 1}. ${item.memory_id} — ${item.excerpt?.text || item.path}`).join('\n')}\n`;
}

function recall(args) {
  const options = parseShared(args, { limit: 3, multi: false, feedback: null, expected: null });
  const queries = [];
  for (let index = 0; index < options.rest.length; index += 1) {
    const argument = options.rest[index];
    if (argument === '--limit') {
      options.limit = Number(takeValue(options.rest, index, argument));
      index += 1;
    } else if (argument === '--multi') options.multi = true;
    else if (argument === '--feedback' || argument === '--expected') {
      const value = takeValue(options.rest, index, argument);
      index += 1;
      if (argument === '--feedback') options.feedback = value;
      else options.expected = value;
    }
    else queries.push(argument);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10) throw new Error('--limit must be an integer from 1 to 10');
  if (options.feedback && !['correct', 'wrong', 'miss'].includes(options.feedback)) throw new Error('--feedback must be correct, wrong, or miss');
  if (!options.multi && queries.length > 1) queries.splice(0, queries.length, queries.join(' '));
  if (options.multi && (queries.length < 2 || queries.length > 3)) throw new Error('--multi requires 2-3 separately quoted query phrasings');
  if (options.feedback && (options.multi || queries.length !== 1)) throw new Error('--feedback requires exactly one non-multi query');
  if (['wrong', 'miss'].includes(options.feedback) && !options.expected) throw new Error(`--feedback ${options.feedback} requires --expected <memory-name>`);
  if (queries.length === 0 || queries.some(query => !query.trim())) throw new Error('recall requires a non-empty query');
  const index = loadMemoryIndex({ root: options.root, memoryDir: options.memoryDir });
  const aggregate = new Map();
  queries.forEach((query) => {
    searchMemory(index, query, { limit: Math.max(options.limit, 5) }).forEach((candidate, rank) => {
      const current = aggregate.get(candidate.document.name) || { candidate, rrf: 0, best_rank: Infinity, queries: 0 };
      const isBetter = rank + 1 < current.best_rank;
      current.rrf += 1 / (10 + rank + 1);
      current.best_rank = Math.min(current.best_rank, rank + 1);
      current.queries += 1;
      if (isBetter) current.candidate = candidate;
      aggregate.set(candidate.document.name, current);
    });
  });
  const ranked = [...aggregate.values()].sort((left, right) => right.rrf - left.rrf
    || left.best_rank - right.best_rank
    || left.candidate.document.name.localeCompare(right.candidate.document.name, 'en'));
  const results = ranked.slice(0, options.limit).map(item => ({
    memory_id: item.candidate.document.name,
    path: item.candidate.document.relativePath,
    score: Number(item.rrf.toFixed(6)),
    matched_queries: item.queries,
    matched_fields: item.candidate.fields,
    excerpt: item.candidate.excerpt,
  }));
  const output = {
    schema: 'ownmem-core-recall/v1',
    trace_id: randomUUID(),
    query_count: queries.length,
    results,
    abstained: results.length === 0,
    abstain_reason: results.length === 0 ? 'no-trusted-match' : null,
    model_calls: 0,
    network_calls: 0,
  };
  if (options.feedback) {
    if (options.feedback === 'correct' && results.length === 0) {
      throw new Error('--feedback correct requires a trusted top result; use miss with --expected when recall returned nothing');
    }
    if (options.expected && !index.documents.some(document => document.name === options.expected)) {
      throw new Error(`--expected must name an active memory: ${options.expected}`);
    }
    const file = path.join(options.root, '.local-test', 'memory-recall-feedback.jsonl');
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify({
      schema: 'ownmem-recall-feedback/v1',
      recordedAt: new Date().toISOString(),
      query: queries[0],
      verdict: options.feedback,
      expected: options.expected || results[0]?.memory_id || null,
      returned: results.map(result => result.memory_id),
    })}\n`, { encoding: 'utf8', mode: 0o600 });
  }
  process.stdout.write(options.json ? `${JSON.stringify(output, null, 2)}\n` : formatRecall(output));
  return 0;
}

function init(args) {
  const options = parseShared(args, { layers: null, locale: null, command: null, check: false, hook: null, hosts: null });
  for (let index = 0; index < options.rest.length; index += 1) {
    const argument = options.rest[index];
    if (argument === '--update') continue;
    if (argument === '--check') options.check = true;
    else if (argument === '--hook') options.hook = true;
    else if (['--layers', '--locale', '--command', '--hosts'].includes(argument)) {
      const value = takeValue(options.rest, index, argument);
      index += 1;
      if (argument === '--layers') options.layers = value.split(',').map(item => item.trim()).filter(Boolean);
      else if (argument === '--locale') options.locale = value;
      else if (argument === '--command') options.command = value;
      else options.hosts = value.split(',').map(item => item.trim()).filter(Boolean);
    } else throw new Error(`unknown init option: ${argument}`);
  }
  const result = initializeMemoryRepository(options);
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    process.stdout.write(`ownmem init: ${result.healthy ? 'ready' : 'drift detected'} (${result.hosts.join(', ')})\n`);
    result.results.forEach(item => process.stdout.write(`  ${item.status.padEnd(9)} ${item.path}\n`));
  }
  return result.healthy ? 0 : 1;
}

// init records memory_dir in .ownmem/config.json, so a consumer who runs `ownmem audit` inside an
// installed project must not have to repeat the directory on every invocation. Before this, audit fell
// back to the built-in .claude/memory default and reported "Missing L1 memory index" on a perfectly
// healthy installation. An explicit --memory-dir still wins, and a project with no config keeps the
// command default.
// Both the root and the memory directory have to be pinned to the caller's project.
//
// The delegated scripts default their root to `path.resolve(SCRIPT_DIR, '..')`, which is the repo
// root when running from a checkout and `node_modules/` once the package is installed. This function
// used to inject only --memory-dir, so `ownmem audit` and `ownmem review` resolved the right
// directory name under the wrong parent and reported the corpus as missing on every real install.
// report/dashboard already pinned both; these two were the outliers.
function withProjectPaths(args) {
  const rootIndex = args.indexOf('--root');
  const root = rootIndex >= 0 && args[rootIndex + 1] ? args[rootIndex + 1] : process.cwd();
  const withRoot = rootIndex >= 0 ? args : [...args, '--root', root];
  if (withRoot.includes('--memory-dir')) return withRoot;
  try {
    const config = JSON.parse(readFileSync(path.join(root, '.ownmem', 'config.json'), 'utf8'));
    if (typeof config.memory_dir === 'string' && config.memory_dir) {
      return [...withRoot, '--memory-dir', config.memory_dir];
    }
  } catch { /* not installed here, or the config is unreadable: keep the command default */ }
  return withRoot;
}

async function audit(args) {
  const module = await importLayerModule('./memory-audit.mjs', 'gates', 'audit');
  return module.runCli(withProjectPaths(args));
}

async function compile(args) {
  const module = await importLayerModule('./memory-compiler-public.mjs', 'compiler', 'compile');
  return module.runPublicCompiler(args);
}

async function review(args) {
  const module = await importLayerModule('./memory-review.mjs', 'gates', 'review');
  // Was hardcoded to .ownmem, which is wrong for an installation that kept a legacy .memory layout.
  return module.runReviewCli(withProjectPaths(args));
}

export function analyzeEngineeringMemoryIntent(text) {
  const normalized = String(text || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[’‘]/gu, "'").trim();
  const decide = (action, reasonCode) => ({ action, reason_code: reasonCode });
  const memoryReport = /^(?:report|health|status)$|(?:记忆(?:系统)?|memory).{0,20}(?:最近|效果|运行|健康|指标|报告|统计|status|health|report|effectiveness)|(?:最近|效果|运行|健康|指标|统计|status|health|effectiveness).{0,20}(?:记忆(?:系统)?|memory)/u;
  if (memoryReport.test(normalized)) return decide('report', 'report-request');
  if (/(复核|review|confirm)/u.test(normalized)) return decide('review-workflow', 'review-request');

  // A remember keyword may express persistence, recall, negation, or acknowledgment. Classify the
  // speech act before keywords so recall questions and acknowledgments never enter a write workflow.
  if (/(?:他说|她说|别人说|如果(?:用户|别人)说|翻译|解释).{0,30}(?:记住|记得|remember)|(?:(?:he|she|they) said|if (?:a )?user says|translate|explain).{0,40}\bremember\b|[“"].{0,80}(?:记住|remember).{0,80}[”"]/u.test(normalized)) {
    return decide('no-memory-action', 'quoted-or-meta');
  }
  if (/(你(?:还)?记得|还记得吗|记不记得|do you remember|what do you remember|can you recall)/u.test(normalized)) {
    return decide('recall', 'recall-question');
  }
  if (/^(?:i\s+(?:already\s+)?remember(?:ed)?\b|i\s+(?:do not|don't|dont)\s+remember\b|我记得(?:他|她|他们|为什么|这|那)|(?:(?:我|好的?|嗯|知道了)[，,\s]*)?记住了[。.!！]?$|(?:got it|noted)[.!]?$)/u.test(normalized)) {
    return decide('no-memory-action', 'acknowledgement-or-self-report');
  }
  if (/(?:呵呵|反话|讽刺).{0,12}记住|you(?:'d)? better remember[.!]?$/u.test(normalized)) {
    return decide('durability-clarification', 'ambiguous-tone');
  }

  const explicitPersist = /(?:请|麻烦|帮我|务必)?\s*(?:记住(?!了)|记一下|记下来)|(?:保存|存下)\s*\S+|(?:please\s+)?\b(?:remember|memorize)\b\s+\S|(?:save|store).{0,20}(?:memory|for later|preference|rule)|(?:please\s+)?do not forget\b|别忘了/u;
  const sensitiveText = normalized.replace(/密码管理器|password manager/gu, '');
  const sensitive = /(?:密码|口令|验证码|银行卡|信用卡|卡号|身份证|护照).{0,24}|\b(?:api\s*key|access[_\s-]*token|secret|password|passcode|otp|credit card|social security)\b.{0,24}|\bsk-[a-z0-9_-]{8,}\b/u;
  if (explicitPersist.test(normalized) && sensitive.test(sensitiveText)) {
    return decide('sensitive-rejection', 'sensitive-persistence-request');
  }
  if (/(?:please\s+)?do not forget\b|别忘了/u.test(normalized)) {
    return decide('durability-review', 'positive-persist-double-negative');
  }
  if (/(?:别|不要|不用).{0,6}(?:记住|记下来|保存)|(?:忘掉|忘记|删掉|删除).{0,24}(?:这|那|之前|以前|我说|记忆|memory)|(?:do not|don't|dont|never)\s+(?:remember|memorize|save)|(?:forget|delete|remove)\s+(?:this|that|what i said|the\s+memory|memory)/u.test(normalized)) {
    return decide('delete-workflow', 'delete-or-supersede-request');
  }

  const transient = /(?:这次|本轮|当前任务|今天)(?:先|只|暂时)?|(?:this time|for this task only|for now|today only)/u;
  const durableChinese = /(?:以后|今后|往后|从现在起|下次|每次|一直|总是|永远|别再|不再).{0,40}(?:这样|照这个|默认|保持|用|别|不要|不再|回答|回复|写|做|提醒|叫我|称呼)/u;
  const durableEnglish = /(?:from now on|in the future|next time|every time|always|never|don't .{0,24} again|do not .{0,24} anymore|default to)/u;
  const stablePreference = /(?:我|本人).{0,8}(?:一直|总是|更喜欢|偏好|不喜欢|习惯)|\bi\s+(?:always|prefer|dislike)\b/u;
  const hasDurableSignal = durableChinese.test(normalized) || durableEnglish.test(normalized) || stablePreference.test(normalized);
  if (transient.test(normalized) && hasDurableSignal) {
    return decide('durability-clarification', 'compound-duration');
  }
  if (transient.test(normalized)) return decide('transient-context', 'transient-scope');

  const deicticWrite = /^(?:请|麻烦|帮我)?\s*(?:记住|记一下|记下来)\s*(?:这|那|这个|那个)[。.!！]?$|^(?:please\s+)?(?:remember|memorize)\s+(?:this|that|it)[.!]?$/u.test(normalized);
  if (deicticWrite) return decide('durability-clarification', 'ambiguous-reference');
  const bareWrite = /^(?:请|麻烦|帮我)?\s*(?:记住|记一下|记下来)[。.!！]?$|^(?:please\s+)?(?:remember|memorize)[.!]?$/u.test(normalized);
  if (bareWrite) return decide('durability-clarification', 'missing-proposition');
  if (explicitPersist.test(normalized)) {
    return decide('durability-review', 'explicit-persist');
  }

  // Durable intent does not require the product term "memory". This only routes the request to
  // ownership review; it does not promise an L3 write when a task or document is the proper owner.
  if (hasDurableSignal) {
    return /(?:这样|照这个|this|that)\s*[。.!！]?$/u.test(normalized)
      ? decide('durability-clarification', 'ambiguous-reference')
      : decide('durability-review', 'implicit-persist');
  }
  return decide('recall', 'recall-fallback');
}

export function classifyIntent(text) {
  return analyzeEngineeringMemoryIntent(text).action;
}

function intent(args) {
  const options = parseShared(args);
  const text = options.rest.join(' ').trim();
  if (!text) throw new Error('intent requires natural-language text');
  const analysis = analyzeEngineeringMemoryIntent(text);
  const { action } = analysis;
  const commands = {
    report: 'ownmem report --since 7d',
    'durability-review': 'The user may want future behavior or knowledge to persist. Apply the five-step ownership test; this classification is not permission to write L3. Prefer merge or supersede before creating a topic, then run the owning audit.',
    'durability-clarification': 'The user may want persistence, but the proposition, referent, or scope is ambiguous. Ask at most one concise question; do not write memory until resolved.',
    'sensitive-rejection': 'Refuse to persist the sensitive value. Do not echo it, hash it into telemetry, or create a candidate; suggest a credential manager or the owning secure store.',
    'delete-workflow': 'Resolve the exact existing memory target; do not create a replacement topic. Remove, supersede, or archive it through the owning layer and run the relevant audit.',
    'no-memory-action': 'Do not read or write memory. Treat this as an acknowledgment unless an explicit pending memory confirmation in the current conversation proves otherwise.',
    'transient-context': 'Apply this only to the current turn or task. Do not create long-term memory; use working context or the task owner instead.',
    'review-workflow': 'Review the referenced topic against current code/docs, then use the review receipt command and run memory audit.',
    recall: `ownmem recall -- ${JSON.stringify(text)}`,
  };
  const output = { schema: 'ownmem-intent/v2', action, reason_code: analysis.reason_code, next: commands[action], model_calls: 0, network_calls: 0 };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return 0;
}

async function report(args) {
  try {
    const module = await import('./memory-report.mjs');
    const normalized = args.includes('--root') ? args : [...args, '--root', process.cwd()];
    const configured = normalized.includes('--memory-dir') ? normalized : [...normalized, '--memory-dir', '.ownmem'];
    return module.runCli(configured);
  } catch (error) {
    if (!String(error.message).includes('Cannot find module')) throw error;
    throw new Error('runtime report is an optional host integration; run ownmem audit for static health');
  }
}

async function dashboard(args) {
  const module = await importLayerModule('./memory-dashboard.mjs', 'dashboard', 'dashboard');
  const normalized = args.includes('--root') ? args : [...args, '--root', process.cwd()];
  const configured = normalized.includes('--memory-dir') ? normalized : [...normalized, '--memory-dir', '.ownmem'];
  return module.runCli(configured);
}

async function hook(args) {
  const module = await importLayerModule('./memory-hook.mjs', 'compiler', 'hook');
  return module.runMemoryHookCli(['hook', ...args]);
}

function usage() {
  return `Usage: ownmem <command> [options]

Human entry point:
  ownmem init [--layers core,gates,compiler,dashboard] [--locale BCP47|auto] [--hook]
  ownmem init --update
  ownmem init --check
  ownmem dashboard [--open|--status|--stop]

Agent-facing commands:
  ownmem recall [--multi] [--json] [--feedback correct|wrong|miss] [--expected NAME] -- <query>
  ownmem intent -- <natural-language intent>
  ownmem audit
  ownmem review check|bootstrap|confirm
  ownmem compile
  ownmem report --since 7d

All default retrieval is local, deterministic, zero-model, and zero-network.`;
}

// Per-command help. Everything a person needs on day one is the first line of each entry; the flags
// below it exist for the cases that come up later. `ownmem init` on its own is the whole install.
const COMMAND_HELP = {
  init: `Usage: ownmem init [options]

  ownmem init                 Install into the current repository. This is the whole setup.

Options:
  --layers core,gates,compiler,dashboard   Install a subset instead of everything
  --locale BCP47|auto                      Language for the generated entry file
  --hook                                   Also register the recall hook
  --hosts claude,codex                     Which agent hosts to write entry files for
  --update                                 Refresh an existing install in place
  --check                                  Report what an install would change, write nothing`,
  recall: `Usage: ownmem recall [options] -- <query>

  ownmem recall -- "why did the cursor reset"    Retrieve from local memory. No model, no network.

Options:
  --multi                          Fuse 2-3 phrasings of one question into a single envelope
  --json                           Emit the machine envelope instead of the human summary
  --feedback correct|wrong|miss    Record an explicit verdict on the previous recall
  --expected NAME                  The topic that should have been returned (with --feedback)`,
  dashboard: 'Usage: ownmem dashboard [--open|--status|--stop]\n\n  Local console on 127.0.0.1. Nothing is served off this machine.',
  report: 'Usage: ownmem report [--since 7d]\n\n  Summarise local recall telemetry. Reads .local-test/ only.',
  review: 'Usage: ownmem review check|bootstrap|confirm\n\n  Manage review-by dates on memories that carry them.',
  audit: 'Usage: ownmem audit\n\n  Run the schema, quota, and evidence gates over the memory corpus.',
  compile: 'Usage: ownmem compile [--force]\n\n  Rebuild the local retrieval index from the memory corpus.',
  intent: 'Usage: ownmem intent -- <natural-language intent>\n\n  Ask where a piece of knowledge belongs before writing it down.',
};

const HELP_FLAGS = new Set(['--help', '-h', 'help']);

export async function runMemoryCli(args = process.argv.slice(2)) {
  const [command = 'help', ...rest] = args;
  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  // Handled before dispatch: every subcommand parses its own flags, so without this each one
  // rejects --help as an unknown option. `ownmem init --help` -- the most likely second command
  // anyone types -- printed "unknown init option: --help" and still exited 0.
  //
  // Only the flags before `--` count. After it comes the query, and `ownmem recall -- "what does
  // --help do"` is a question about the tool, not a request for its usage text.
  const separator = rest.indexOf('--');
  const flags = separator === -1 ? rest : rest.slice(0, separator);
  if (flags.some(argument => HELP_FLAGS.has(argument))) {
    process.stdout.write(`${COMMAND_HELP[command] || usage()}\n`);
    return 0;
  }
  if (command === 'init') return init(rest);
  if (command === 'recall') return recall(rest);
  if (command === 'intent') return intent(rest);
  if (command === 'audit') return audit(rest);
  if (command === 'review') return review(rest);
  if (command === 'compile') return compile(rest);
  if (command === 'report') return report(rest);
  if (command === 'dashboard') return dashboard(rest);
  if (command === 'hook') return hook(rest);
  throw new Error(`unknown memory command: ${command}`);
}

if (isMemoryCliEntry(import.meta.url)) {
  runMemoryCli().then(code => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`memory: ${error.message}\n`);
    process.exitCode = 1;
  });
}
