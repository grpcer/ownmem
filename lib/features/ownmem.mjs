import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { initializeMemoryRepository } from '../memory-init.mjs';
import { memoryIndexDir, resolveMemoryDir, resolveRepositoryRoot } from '../memory-paths.mjs';

function unresolvedModuleUrl(error) {
  if (typeof error?.url === 'string') return error.url;
  const quoted = String(error?.message || '').match(/Cannot find module '([^']+)'/)?.[1];
  if (!quoted) return null;
  return quoted.startsWith('file:') ? quoted : pathToFileURL(quoted).href;
}

async function importLayerModule(specifier, layer, capability) {
  try {
    return await import(specifier);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND'
      && unresolvedModuleUrl(error) === new URL(specifier, import.meta.url).href) {
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
  const options = { root: resolveRepositoryRoot(), memoryDir: null, json: false, rest: [], separatorIndex: null, ...defaults };
  let passthrough = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') {
      passthrough = true;
      options.separatorIndex = options.rest.length;
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
  options.memoryDir = resolveMemoryDir(options.root, options.memoryDir);
  return options;
}

async function recall(args) {
  const options = parseShared(args);
  const module = await importLayerModule('./recall.mjs', 'compiler', 'recall');
  const forwarded = ['--root', options.root, '--memory-dir', options.memoryDir];
  if (options.json) forwarded.push('--json');
  if (options.separatorIndex === null) forwarded.push(...options.rest);
  else forwarded.push(
    ...options.rest.slice(0, options.separatorIndex),
    '--',
    ...options.rest.slice(options.separatorIndex),
  );
  return module.runCli(forwarded);
}

// The three feedback streams stay separate all the way down to the command line: `recall
// --feedback` judges retrieval, `outcome` records what a user or the host confirmed happened after
// a memory was used, and `attribute` is the agent's own weak turn-end label. One command that took
// all three would be the first step toward one file that mixes them.
async function outcome(args) {
  const options = parseShared(args);
  const module = await importLayerModule('./outcome.mjs', 'compiler', 'outcome');
  return module.runCli(['--root', options.root, ...(options.json ? ['--json'] : []), ...options.rest]);
}

async function attribute(args) {
  const options = parseShared(args);
  const module = await importLayerModule('./attribution.mjs', 'compiler', 'attribute');
  return module.runCli(['--root', options.root, ...(options.json ? ['--json'] : []), ...options.rest]);
}

async function mcp(args) {
  const options = parseShared(args, {});
  if (options.rest.length > 0) throw new Error(`unknown mcp option: ${options.rest[0]}`);
  const { createMcpContext, serveMcp } = await importLayerModule('../memory-mcp.mjs', 'compiler', 'MCP server');
  const context = await createMcpContext({
    root: options.root,
    memoryDir: resolveMemoryDir(options.root),
    indexDirectory: memoryIndexDir(resolveMemoryDir(options.root)),
  });
  // stdout is the protocol channel and nothing else may be written to it -- one stray log line makes
  // every response unparseable for the client.
  await serveMcp({ input: process.stdin, output: process.stdout, context });
  return 0;
}

async function scaffold(args) {
  const options = parseShared(args, { type: 'lesson', area: 'general', scopes: null, description: null });
  const positional = [];
  for (let index = 0; index < options.rest.length; index += 1) {
    const argument = options.rest[index];
    if (['--type', '--area', '--scopes', '--description'].includes(argument)) {
      const value = takeValue(options.rest, index, argument);
      index += 1;
      if (argument === '--type') options.type = value;
      else if (argument === '--area') options.area = value;
      else if (argument === '--scopes') options.scopes = value.split(',').map(item => item.trim()).filter(Boolean);
      else options.description = value;
    } else if (argument.startsWith('--')) throw new Error(`unknown new option: ${argument}`);
    else positional.push(argument);
  }
  if (positional.length !== 1) throw new Error('ownmem new takes exactly one name: ownmem new sheet_detent_lazy_container');
  const { scaffoldMemory } = await import('../memory-scaffold.mjs');
  const memoryDir = resolveMemoryDir(options.root);
  // The quota is read here so the refusal happens before the file exists, not after the audit.
  let quota = null;
  let activeCount = null;
  try {
    const lockFile = path.join(options.root, memoryDir, 'quota.lock.json');
    if (existsSync(lockFile)) {
      const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
      if (Number.isInteger(lock.max_active_l3)) {
        quota = lock.max_active_l3;
        activeCount = readdirSync(path.join(options.root, memoryDir))
          .filter(entry => entry.endsWith('.md') && !entry.startsWith('MEMORY')).length;
      }
    }
  } catch {
    // An unreadable lock must not block scaffolding; the audit reports it separately.
  }
  const result = scaffoldMemory({
    root: options.root,
    memoryDir,
    name: positional[0],
    type: options.type,
    area: options.area,
    scopes: options.scopes,
    description: options.description,
    quota,
    activeCount,
  });
  // Sign it in the same call. Without a receipt the topic is `receipt-missing`, which the audit
  // reports as a hard error -- so a scaffold that stopped at writing the file would hand a new user
  // a red corpus and a rule they had not been told about yet. Signing is a gates-layer capability,
  // so a core-only install is told what is missing rather than failing.
  let signed = null;
  try {
    const { issueMemoryTrustReceipts } = await importLayerModule('../memory-trust-migration.mjs', 'gates', 'trust receipts');
    const issued = issueMemoryTrustReceipts({
      root: options.root, memoryDir, memoryIds: [result.name], now: new Date(),
    });
    signed = issued.issued.length > 0;
  } catch (error) {
    signed = false;
    result.trust_error = error.message;
  }
  if (options.json) process.stdout.write(`${JSON.stringify({ ...result, signed }, null, 2)}\n`);
  else {
    process.stdout.write(`ownmem new: ${path.relative(options.root, result.file)}\n`);
    if (result.index?.added) {
      process.stdout.write(`  routed from ${path.relative(options.root, result.index.file)}${result.index.created ? ' (created)' : ''}\n`);
    }
    if (signed) {
      process.stdout.write('  signed a trust receipt; it already passes schema, trust and audit\n');
      process.stdout.write('  replace the placeholder prose, then run `ownmem trust issue ' + result.name + '` and `ownmem audit`\n');
    } else {
      process.stdout.write(`  not signed (${result.trust_error || 'no receipt was issued'}): run \`ownmem trust issue ${result.name}\` before the audit\n`);
    }
  }
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
  // Read before the call, which in write mode creates the file. `--update` re-applies the recorded
  // config, so it is only the right remedy for an existing installation: on a repository with none,
  // it installs the core layer without hooks, which is not what the previewed command would have done.
  const installed = existsSync(path.join(options.root, options.memoryDir, 'config.json'));
  const result = initializeMemoryRepository(options);
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    process.stdout.write(`ownmem init: ${result.healthy ? 'ready' : 'drift detected'} (${result.hosts.join(', ')})\n`);
    result.results.forEach(item => process.stdout.write(`  ${item.status.padEnd(9)} ${item.path}\n`));
    // A drift report that does not say how to clear it leaves the reader to guess, and the guess
    // matters here: an upgraded 0.6.0 install shows `.claude/settings.json` as drifted because it
    // still carries hook entries whose command was retired, and every one of those entries fires a
    // failing command until somebody runs the fix. Measured 2026-09-20 on a real upgrade, --check
    // listed the drift and named no remedy. Printed only in --check, because the other modes have
    // already done the writing.
    if (options.check && !result.healthy && installed) {
      process.stdout.write('  fix       run `ownmem init --update` to bring these files back in line'
        + ' (it preserves your own hooks and anything it did not write)\n');
    } else if (options.check && !result.healthy) {
      const same = args.filter(argument => argument !== '--check')
        .map(argument => (/\s/.test(argument) ? JSON.stringify(argument) : argument)).join(' ');
      process.stdout.write(`  fix       nothing is installed yet: run \`ownmem init${same ? ` ${same}` : ''}\``
        + ' (this command without --check) to install what it previewed\n');
    }
    // Below the file list, because it is about behaviour rather than about a file: what the hooks
    // this install just registered will do to the repository, and how to turn each part off.
    result.notes.forEach(note => process.stdout.write(`  note      ${note}\n`));
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
// Delegated feature modules default to the caller's working directory. Pin both values anyway so
// programmatic callers and future worker boundaries cannot accidentally inspect the package itself.
// report/dashboard already pinned both; these two were the outliers.
function withProjectPaths(args, { indexDir = false } = {}) {
  const rootIndex = args.indexOf('--root');
  // A hook command carries no path to the checkout, and Codex injects no environment variable a
  // hook process could read one from, so the working directory has to be walked up to the
  // repository it belongs to rather than used as-is.
  const root = rootIndex >= 0 && args[rootIndex + 1] ? path.resolve(args[rootIndex + 1]) : resolveRepositoryRoot();
  const memoryDirIndex = args.indexOf('--memory-dir');
  const memoryDir = resolveMemoryDir(root, memoryDirIndex >= 0 ? args[memoryDirIndex + 1] : null);
  const pinned = [...args];
  if (rootIndex < 0) pinned.push('--root', root);
  if (memoryDirIndex < 0) pinned.push('--memory-dir', memoryDir);
  if (indexDir && !args.includes('--index-dir')) pinned.push('--index-dir', memoryIndexDir(memoryDir));
  return pinned;
}

async function audit(args) {
  const module = await importLayerModule('./audit.mjs', 'gates', 'audit');
  return module.runCli(withProjectPaths(args));
}

async function compile(args) {
  const module = await importLayerModule('./compiler.mjs', 'compiler', 'compile');
  return module.runPublicCompiler(withProjectPaths(args, { indexDir: true }));
}

async function review(args) {
  const module = await importLayerModule('./review.mjs', 'gates', 'review');
  // Was hardcoded to .ownmem, which is wrong for an install whose config names another directory.
  return module.runReviewCli(withProjectPaths(args));
}

async function trust(args) {
  const module = await importLayerModule('./trust.mjs', 'gates', 'trust');
  return module.runTrustCli(withProjectPaths(args.length > 0 ? args : ['check']));
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
  const module = await importLayerModule('./report.mjs', 'dashboard', 'runtime report');
  return module.runCli(withProjectPaths(args));
}

async function archive(args) {
  const module = await importLayerModule('./archive.mjs', 'dashboard', 'telemetry archive');
  return module.runCli(withProjectPaths(args));
}

async function daily(args) {
  const module = await importLayerModule('./daily.mjs', 'dashboard', 'daily pass');
  return module.runCli(withProjectPaths(args));
}

async function dashboard(args) {
  const module = await importLayerModule('./dashboard.mjs', 'dashboard', 'dashboard');
  return module.runCli(withProjectPaths(args));
}

async function embed(args) {
  const module = await importLayerModule('./embedding.mjs', 'embedding', 'embed');
  if (args.length === 0 || args[0].startsWith('--')) return module.runCli([]);
  return module.runCli(withProjectPaths(args, { indexDir: true }));
}

async function hook(args) {
  const module = await importLayerModule('./hook.mjs', 'compiler', 'hook');
  return module.runMemoryHookCli(args);
}

function usage() {
  return `Usage: ownmem <command> [options]

Human entry point:
  ownmem new NAME                        scaffold one memory that already passes every gate
  ownmem mcp                             serve recall and read over MCP on stdio
  ownmem init [--hosts claude,codex,gemini,cursor,grok,generic] [--layers core,gates,compiler,dashboard]
              [--locale BCP47|auto] [--hook]
  ownmem init --update
  ownmem init --check
  ownmem dashboard [--open|--status|--stop]
  ownmem embed config|test|build|status|ab [options]

Agent-facing commands:
  ownmem recall [--multi] [--json] [--feedback VERDICT] [--expected NAME] -- <query>
  ownmem outcome --memory NAME --outcome applied|helpful_but_not_used|harmful --confirmed-by user|host --confirmation TEXT
  ownmem attribute --memory NAME --label useful|misleading
  ownmem intent -- <natural-language intent>
  ownmem audit
  ownmem review check|bootstrap|confirm
  ownmem trust check|issue|bootstrap [--strict-working-tree]
  ownmem compile
  ownmem report [--since 7d] [--full]
  ownmem archive [--day YYYY-MM-DD] [--backfill]
  ownmem daily [--host claude|grok|codex] [--source NAME] [--force]

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
  --hosts claude,codex                     Which agent hosts to write entry files for. Omitted, the
                                           hosts already present in the repository are detected
  --update                                 Refresh an existing install in place
  --check                                  Report what an install would change, write nothing`,
  recall: `Usage: ownmem recall [options] -- <query>

  ownmem recall -- "why did the cursor reset"    Retrieve from local memory. No model, no network.

Options:
  --multi                          Fuse 2-3 phrasings of one question into a single envelope
  --json                           Emit an ownmem-query-result/v6 envelope instead of the human summary
  --feedback VERDICT               Record an explicit verdict on the previous recall: correct,
                                   correct_abstain, wrong, retrieval_miss, coverage_gap, stale or
                                   conflict. This judges retrieval only -- what happened after a
                                   memory was used belongs to \`ownmem outcome\`
  --expected NAME                  The topic that should have been returned (with --feedback)`,
  outcome: `Usage: ownmem outcome --memory NAME --outcome OUTCOME --confirmed-by user|host --confirmation TEXT

  Record what happened after a memory was used. The only stream that may speak about actual
  application, which is why only a user or the host can confirm it.

Options:
  --memory NAME          The memory the outcome is about
  --outcome OUTCOME      applied, helpful_but_not_used or harmful
  --confirmed-by WHO     user or host. \`self\` is refused: that is \`ownmem attribute\`
  --confirmation TEXT    The confirming statement. Only its SHA-256 is stored, never the text
  --note TEXT            Optional, at most 200 characters, supplied explicitly by the caller
  --session ID           Host session id, for the strongest pairing to the delivering recall`,
  attribute: `Usage: ownmem attribute --memory NAME --label useful|misleading

  Record a weak turn-end label when a memory clearly helped or clearly misled you. Record nothing
  when the turn was neutral. Self-reported and self-selected, so these are counts and never a rate.

Options:
  --memory NAME          The memory the label is about
  --label LABEL          useful or misleading
  --session ID           Host session id, for the strongest pairing to the delivering recall`,
  dashboard: 'Usage: ownmem dashboard [--open|--status|--stop]\n\n  Local console on 127.0.0.1. Nothing is served off this machine.',
  embed: 'Usage: ownmem embed config|test|build|status|ab [options]\n\n  Manage the optional local embedding lane.',
  archive: 'Usage: ownmem archive [--day YYYY-MM-DD] [--backfill]\n\n  Reduce a UTC day of local telemetry to a counted package under the gitignored observability tree.\n  Event files expire after thirty days; the package is the rolling local record. Counts only. Idempotent.',
  daily: `Usage: ownmem daily [options]

  The unattended daily pass, wired to session start and session stop. Archives every finished day
  locally, drops expired raw events, inspects the local packages, and prints only what is wrong.
  Silence is the success case. Runs real work at most once per UTC day and always exits 0.

Options:
  --host NAME        Which agent is running it: claude, grok or codex
  --source NAME      What triggered it, recorded in the local trace
  --force            Run again even though today has been handled
  --timeout-ms N     Budget for the whole pass
  --json             Emit the whole run record instead of the findings`,
  report: 'Usage: ownmem report [--since 7d]\n\n  Summarise local recall telemetry. Reads .local-test/ only.',
  review: 'Usage: ownmem review check|bootstrap|confirm\n\n  Manage review-by dates on memories that carry them.',
  trust: `Usage: ownmem trust check|issue|bootstrap [options]

  ownmem trust check                 Verify content-bound authority, evidence, lifecycle, and
                                     applicability receipts.
  ownmem trust issue <memory-id>     Sign a receipt for a new or edited memory. A new topic gets an
                                     import receipt; an edited one gets a delta chained to its
                                     predecessor. Unchanged topics report up-to-date.
  ownmem trust issue --all           Do that for every topic that needs it.

Options:
  --refresh-evidence       (issue) Re-sign memories whose body is unchanged but whose evidence
                           drifted, asserting they still hold against the files as they are now.
                           Never happens on its own: drift downgrades a memory to advisory and
                           this is the only way back. Topics with no drift stay up-to-date.
  --dry-run                Print what would be signed and write nothing
  --json                   Emit the structured result
  --strict-working-tree    (check) Reject uncommitted memory topic sources`,
  audit: 'Usage: ownmem audit\n\n  Run the schema, quota, and evidence gates over the memory corpus.',
  compile: 'Usage: ownmem compile [--force|--rollback-previous]\n\n  Rebuild the local retrieval index or atomically restore the previous trusted snapshot.',
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
  if (command === 'new') return scaffold(rest);
  if (command === 'mcp') return mcp(rest);
  if (command === 'recall') return recall(rest);
  if (command === 'outcome') return outcome(rest);
  if (command === 'attribute') return attribute(rest);
  if (command === 'intent') return intent(rest);
  if (command === 'audit') return audit(rest);
  if (command === 'review') return review(rest);
  if (command === 'trust') return trust(rest);
  if (command === 'compile') return compile(rest);
  if (command === 'report') return report(rest);
  if (command === 'archive') return archive(rest);
  if (command === 'daily') return daily(rest);
  if (command === 'dashboard') return dashboard(rest);
  if (command === 'embed') return embed(rest);
  if (command === 'hook') return hook(rest);
  throw new Error(`unknown memory command: ${command}`);
}
