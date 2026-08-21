import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { initializeMemoryRepository } from '../memory-init.mjs';
import { loadMemoryIndex, searchMemory } from '../memory-markdown-index.mjs';
import { memoryIndexDir, resolveMemoryDir } from '../memory-paths.mjs';

// Node names the module it could not resolve in error.url, and repeats the *importing* file in the
// message text. Matching the message therefore fired the friendly layer notice for any transitive gap
// inside a layer that is in fact installed -- deleting an unrelated internal module made `ownmem
// audit` claim the gates layer was missing. Compare the unresolved URL with this exact specifier, and
// let every other failure, including one thrown by the layer's own code, surface unchanged.
function unresolvedModuleUrl(error) {
  if (typeof error?.url === 'string') return error.url;
  const quoted = String(error?.message || '').match(/Cannot find module '([^']+)'/)?.[1];
  if (!quoted) return null;
  return quoted.startsWith('file:') ? quoted : pathToFileURL(quoted).href;
}

async function importLayerModule(specifier, unavailable) {
  try {
    return await import(specifier);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && unresolvedModuleUrl(error) === new URL(specifier, import.meta.url).href) {
      throw new Error(unavailable);
    }
    throw error;
  }
}

function takeValue(args, index, option) {
  const value = args[index + 1];
  if (!value) throw new Error(`${option} requires a value`);
  return value;
}

// `rest` holds the tokens before `--` that the shared options did not claim; `query` holds everything
// after it. Keeping the boundary lets a command reject an unknown flag without turning a query that
// merely looks like one into a search term.
function parseShared(args, defaults = {}) {
  const options = { root: process.cwd(), memoryDir: null, json: false, rest: [], query: [], ...defaults };
  let passthrough = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (passthrough) {
      options.query.push(argument);
      continue;
    }
    if (argument === '--') {
      passthrough = true;
      continue;
    }
    if (argument === '--root') {
      options.root = path.resolve(takeValue(args, index, argument));
      index += 1;
    } else if (argument === '--memory-dir') {
      options.memoryDir = takeValue(args, index, argument);
      index += 1;
    } else if (argument === '--json') options.json = true;
    else options.rest.push(argument);
  }
  options.memoryDir = resolveMemoryDir(options.root, options.memoryDir);
  return options;
}

// `ownmem recall` answers from Markdown by default. The snapshot runtime in recall.mjs is a second
// lane with its own options, and 0.2.0 shipped no entry point for it at all after the root
// memory-recall.mjs was deleted -- recall.mjs kept documenting flags that `ownmem recall` rejected,
// and --stdio, the resident JSON-Lines mode the hook daemon runs on, was unreachable by hand. Any of
// these options selects that lane; --runtime selects it with no other option.
const RUNTIME_RECALL_FLAGS = new Set([
  '--runtime',
  '--stdio',
  '--index-dir',
  '--embedding-dir',
  '--tier',
  '--exclude-memory-id',
  '--surface',
  '--observability-dir',
  '--feedback-file',
  '--usage-file',
  '--no-usage-log',
]);

async function runtimeRecall(args) {
  const module = await importLayerModule('./recall.mjs', 'recall requires the core runtime layer');
  const separator = args.indexOf('--');
  // --runtime is the dispatcher's lane selector; the runtime itself never defined it.
  const flags = commandFlags(args).filter(argument => argument !== '--runtime');
  const query = separator === -1 ? [] : args.slice(separator);
  const { root, memoryDir } = projectPaths(flags);
  if (!flags.includes('--root')) flags.push('--root', root);
  if (!flags.includes('--memory-dir')) flags.push('--memory-dir', memoryDir);
  if (!flags.includes('--index-dir')) flags.push('--index-dir', memoryIndexDir(memoryDir));
  return module.runCli([...flags, ...query]);
}

function formatRecall(result) {
  if (result.results.length === 0) return `No trusted memory match (${result.abstain_reason}).\n`;
  return `${result.results.map((item, index) => `${index + 1}. ${item.memory_id} — ${item.excerpt?.text || item.path}`).join('\n')}\n`;
}

async function recall(args) {
  if (commandFlags(args).some(argument => RUNTIME_RECALL_FLAGS.has(argument))) return runtimeRecall(args);
  const options = parseShared(args, { limit: 3, multi: false, feedback: null, expected: null, observability: true });
  const queries = [];
  for (let index = 0; index < options.rest.length; index += 1) {
    const argument = options.rest[index];
    if (argument === '--limit') {
      options.limit = Number(takeValue(options.rest, index, argument));
      index += 1;
    } else if (argument === '--multi') options.multi = true;
    else if (argument === '--no-observability') options.observability = false;
    else if (argument === '--feedback' || argument === '--expected') {
      const value = takeValue(options.rest, index, argument);
      index += 1;
      if (argument === '--feedback') options.feedback = value;
      else options.expected = value;
    }
    // An unrecognised flag used to become search text: `ownmem recall --stdio` exited 0 after
    // BM25F-searching the literal string "--stdio". Only the tokens after `--` are a query.
    else if (argument.startsWith('--')) throw new Error(`unknown recall option: ${argument}; put the query after --`);
    else queries.push(argument);
  }
  queries.push(...options.query);
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10) throw new Error('--limit must be an integer from 1 to 10');
  if (options.feedback && !['correct', 'wrong', 'miss'].includes(options.feedback)) throw new Error('--feedback must be correct, wrong, or miss');
  if (!options.multi && queries.length > 1) queries.splice(0, queries.length, queries.join(' '));
  if (options.multi && (queries.length < 2 || queries.length > 3)) throw new Error('--multi requires 2-3 separately quoted query phrasings');
  if (options.feedback && (options.multi || queries.length !== 1)) throw new Error('--feedback requires exactly one non-multi query');
  if (['wrong', 'miss'].includes(options.feedback) && !options.expected) throw new Error(`--feedback ${options.feedback} requires --expected <memory-name>`);
  if (queries.length === 0 || queries.some(query => !query.trim())) throw new Error('recall requires a non-empty query');
  const loadStarted = performance.now();
  const index = loadMemoryIndex({ root: options.root, memoryDir: options.memoryDir });
  const loadMs = performance.now() - loadStarted;
  const rankStarted = performance.now();
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
  const rankMs = performance.now() - rankStarted;
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
  // Delivery follows a successful stdout write, mirroring the runtime CLI's ordering.
  if (options.observability) {
    await recordCoreRecallEvents({ options, queries, output, loadMs, rankMs, rrfCandidates: aggregate.size });
  }
  return 0;
}

// Core recall ranks Markdown directly, so it reports its own recall/delivery/feedback events; the
// adapters are optional and a failed local write only costs telemetry, never the recall itself.
async function recordCoreRecallEvents({ options, queries, output, loadMs, rankMs, rrfCandidates }) {
  const warnings = [];
  let recorder;
  try {
    recorder = await import('../memory-runtime-observability.mjs');
  } catch {
    return;
  }
  let classifications = null;
  try {
    const { classifyMemoryQuery } = await import('../memory-query-classifier.mjs');
    classifications = [...new Set(queries.flatMap(query => classifyMemoryQuery(query)))];
  } catch {
    classifications = null;
  }
  const returned = output.results.map(result => result.memory_id);
  const expected = options.feedback
    ? options.expected || output.results[0]?.memory_id || null
    : null;
  const recorded = recorder.recordCoreCliRecall({
    root: options.root,
    traceId: output.trace_id,
    query: queries.join('␞'),
    classifications,
    returnedTopics: returned,
    abstained: output.abstained,
    rrfCandidates,
    loadMs,
    rankMs,
    totalMs: loadMs + rankMs,
    feedback: options.feedback,
    expectedInTopK: options.feedback ? (expected ? returned.includes(expected) : null) : null,
  });
  warnings.push(...(recorded.warnings || []));
  if (recorded.written && returned.length > 0) {
    try {
      const { rememberMemoryRecall } = await import('../memory-recall-ledger.mjs');
      const remembered = rememberMemoryRecall({
        root: options.root,
        traceId: output.trace_id,
        returnedTopics: returned,
        source: 'cli',
      });
      if (!remembered.written && remembered.reason) warnings.push(remembered.reason);
    } catch {
      // Without the ledger a later full-text open simply cannot pair with this recall.
    }
  }
  if (warnings.length > 0) {
    process.stderr.write(`ownmem recall: local observability skipped: ${[...new Set(warnings)].join('; ')}\n`);
  }
}

function init(args) {
  const options = parseShared(args, { layers: null, locale: null, command: null, check: false, hook: null, hosts: null });
  // init takes no query, so a stray token after `--` is still an error rather than silent input.
  const rest = [...options.rest, ...options.query];
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--update') continue;
    if (argument === '--check') options.check = true;
    else if (argument === '--hook') options.hook = true;
    else if (['--layers', '--locale', '--command', '--hosts'].includes(argument)) {
      const value = takeValue(rest, index, argument);
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

// Only the tokens before `--` are options; after it comes a query that may legitimately look like one.
function commandFlags(args) {
  const separator = args.indexOf('--');
  return separator === -1 ? args : args.slice(0, separator);
}

// Every delegated feature module carries its own historical default -- .claude/memory, .ownmem,
// .local-test/memory-index -- and each one that a command reaches is a directory the project does not
// use: audit reported a missing L1 index on a healthy install, report saw no corpus, and compile
// published a snapshot into a directory it had just created, which flipped every later probe. So the
// project paths are resolved once, through the single resolver in memory-paths.mjs, and pinned onto
// the delegated argv. An explicit flag always survives; --root is pinned as well so a programmatic
// caller or a future worker boundary can never inspect the package instead of the project.
function projectPaths(flags) {
  const rootIndex = flags.indexOf('--root');
  const root = rootIndex >= 0 && flags[rootIndex + 1] ? path.resolve(flags[rootIndex + 1]) : process.cwd();
  const memoryDirIndex = flags.indexOf('--memory-dir');
  const memoryDir = resolveMemoryDir(root, memoryDirIndex >= 0 ? flags[memoryDirIndex + 1] : null);
  return { root, memoryDir };
}

function withProjectPaths(args, { indexDir = false } = {}) {
  const { root, memoryDir } = projectPaths(args);
  const pinned = [...args];
  if (!args.includes('--root')) pinned.push('--root', root);
  if (!args.includes('--memory-dir')) pinned.push('--memory-dir', memoryDir);
  if (indexDir && !args.includes('--index-dir')) pinned.push('--index-dir', memoryIndexDir(memoryDir));
  return pinned;
}

async function audit(args) {
  const module = await importLayerModule('./audit.mjs', 'audit requires the optional gates layer');
  return module.runCli(withProjectPaths(args));
}

async function compile(args) {
  const module = await importLayerModule('./compiler.mjs', 'compile requires the optional compiler layer');
  // The snapshot has to be published beside the memory it was compiled from. Left to its own default
  // the compiler wrote .ownmem/index on a .memory repository, and creating that directory alone was
  // enough to make every later command resolve an empty .ownmem.
  return module.runPublicCompiler(withProjectPaths(args, { indexDir: true }));
}

async function review(args) {
  const module = await importLayerModule('./review.mjs', 'review requires the optional gates layer');
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
  const text = [...options.rest, ...options.query].join(' ').trim();
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
  // Catching "Cannot find module" around runCli as well rewrapped every transitive and runtime
  // failure as a missing optional integration, so a real report bug looked like a packaging choice.
  const module = await importLayerModule('./report.mjs', 'runtime report is an optional host integration; run ownmem audit for static health');
  return module.runCli(withProjectPaths(args));
}

async function dashboard(args) {
  const module = await importLayerModule('./dashboard.mjs', 'dashboard requires the optional dashboard layer');
  return module.runCli(withProjectPaths(args));
}

async function embed(args) {
  const module = await importLayerModule('./embedding.mjs', 'embed requires the optional embedding layer');
  // embedding.mjs reads its subcommand from the first token, so a bare `ownmem embed` has to reach it
  // unpinned: pinning first turned the usage request into "unknown memory-embed command: --root".
  if (args.length === 0 || args[0].startsWith('--')) return module.runCli(args);
  return module.runCli(withProjectPaths(args, { indexDir: true }));
}

async function hook(args) {
  const module = await importLayerModule('./hook.mjs', 'hook requires the optional compiler layer');
  // parseCommand already defaults to the PreToolUse path when the first token is absent or an option,
  // so prepending 'hook' here only pushed the real subcommand into the option loop, where every one of
  // status/enable/disable/serve died as "unknown option".
  return module.runMemoryHookCli(args);
}

function usage() {
  return `Usage: ownmem <command> [options]

Human entry point:
  ownmem init [--layers core,gates,compiler,dashboard] [--locale BCP47|auto] [--hook]
  ownmem init --update
  ownmem init --check
  ownmem dashboard [--open|--status|--stop]
  ownmem embed config|test|build|status|ab [options]

Agent-facing commands:
  ownmem recall [--multi] [--json] [--feedback correct|wrong|miss] [--expected NAME] -- <query>
  ownmem recall --runtime [options] -- <query>   (snapshot runtime lane; see ownmem recall --help)
  ownmem recall --stdio
  ownmem intent -- <natural-language intent>
  ownmem audit
  ownmem review check|bootstrap|confirm
  ownmem compile
  ownmem report --since 7d
  ownmem hook status|enable|disable|serve

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
  --limit N                        Return at most N topics (1-10 here; the runtime lane caps at 3)
  --feedback correct|wrong|miss    Record an explicit verdict on the previous recall
  --expected NAME                  The topic that should have been returned (with --feedback)
  --root PATH                      Repository root (default: the working directory)
  --memory-dir PATH                Memory directory (default: the one this project installed)
  --no-observability               Skip writing local run events this time

Snapshot runtime lane. Any of the options below -- or --runtime on its own -- answers from the
compiled snapshot instead of Markdown, with the project's root, memory and index directories pinned
for you. Run \`ownmem recall --runtime\` with no query for its full option list:
  --runtime                        Select the lane without changing anything else
  --stdio                          Resident JSON Lines mode: load once, answer many requests
  --limit N                        In this lane at most 3 topics (1-3, default 3)
  --index-dir PATH                 Compiled snapshot directory (default: <memory-dir>/index)
  --embedding-dir PATH             Local embedding config and artifact
  --tier default|expanded          Token budget of the first pass
  --exclude-memory-id ID           Exclude an already loaded memory; repeatable
  --surface cli|claude-hook        Which surface the request is attributed to
  --observability-dir PATH         Local run-event directory
  --feedback-file PATH             Where an explicit verdict is appended
  --usage-file PATH                Compatibility SHA-256 usage file
  --no-usage-log                   Do not write the compatibility usage file (default)`,
  dashboard: 'Usage: ownmem dashboard [--open|--status|--stop]\n\n  Local console on 127.0.0.1. Nothing is served off this machine.',
  embed: 'Usage: ownmem embed config|test|build|status|ab [options]\n\n  Manage the optional local embedding lane.',
  report: 'Usage: ownmem report [--since 7d]\n\n  Summarise local recall telemetry from .local-test/ and the memory corpus. Nothing leaves this machine.',
  review: 'Usage: ownmem review check|bootstrap|confirm\n\n  Manage review-by dates on memories that carry them.',
  audit: 'Usage: ownmem audit\n\n  Run the schema, quota, and evidence gates over the memory corpus.',
  compile: 'Usage: ownmem compile [--force]\n\n  Rebuild the local retrieval index from the memory corpus.',
  intent: 'Usage: ownmem intent -- <natural-language intent>\n\n  Ask where a piece of knowledge belongs before writing it down.',
  hook: `Usage: ownmem hook [status|enable|disable|serve] [--root PATH]

  ownmem hook                 Claude Code PreToolUse entry: reads one hook payload on stdin.

Commands:
  status                      Print whether the hook is enabled and whether its daemon is running
  enable                      Re-enable the recall hook for this repository
  disable                     Disable the recall hook without uninstalling it
  serve                       Run the resident recall daemon in the foreground`,
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
  if (command === 'embed') return embed(rest);
  if (command === 'hook') return hook(rest);
  throw new Error(`unknown memory command: ${command}`);
}
