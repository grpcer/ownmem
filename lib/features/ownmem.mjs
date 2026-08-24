import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { initializeMemoryRepository } from '../memory-init.mjs';
import { memoryIndexDir, resolveMemoryDir } from '../memory-paths.mjs';

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
  const options = { root: process.cwd(), memoryDir: null, json: false, rest: [], separatorIndex: null, ...defaults };
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

async function candidates(args) {
  const options = parseShared(args);
  const module = await importLayerModule('./candidates.mjs', 'compiler', 'candidates');
  return module.runCli(['--root', options.root, ...(options.json ? ['--json'] : []), ...options.rest]);
}

// The observation period and the local switch that stops a memory being injected. It takes the
// memory directory because a retraction is graded against the corpus the promotion changed, and it
// lives in `dashboard` because the signals it reads are the feedback and outcome ledgers.
async function tripwire(args) {
  const options = parseShared(args);
  const module = await importLayerModule('./tripwire.mjs', 'dashboard', 'tripwire');
  return module.runCli(['--root', options.root, '--memory-dir', options.memoryDir,
    ...(options.json ? ['--json'] : []), ...options.rest]);
}

// The memory directory is forwarded only when the caller named one. promote settles the quota over
// the active set and edits a topic inside it, so reading one directory and writing another would be
// balancing the accounts of a corpus it was not changing -- but parseShared cannot tell an explicit
// --memory-dir from its own default, and substituting that default here would override the feature's
// own. Passing it through only when it was actually typed keeps both defaults honest.
async function promote(args) {
  const options = parseShared(args);
  const module = await importLayerModule('./promote.mjs', 'dashboard', 'promote');
  return module.runCli([
    '--root', options.root,
    ...(args.includes('--memory-dir') ? ['--memory-dir', options.memoryDir] : []),
    ...(options.json ? ['--json'] : []),
    ...options.rest,
  ]);
}

async function evolve(args) {
  const options = parseShared(args);
  const module = await importLayerModule('./evolve.mjs', 'dashboard', 'evolve');
  return module.runCli([
    '--root', options.root,
    '--memory-dir', options.memoryDir,
    ...(options.json ? ['--json'] : []),
    ...options.rest,
  ]);
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
// Delegated feature modules default to the caller's working directory. Pin both values anyway so
// programmatic callers and future worker boundaries cannot accidentally inspect the package itself.
// report/dashboard already pinned both; these two were the outliers.
function withProjectPaths(args, { indexDir = false } = {}) {
  const rootIndex = args.indexOf('--root');
  const root = rootIndex >= 0 && args[rootIndex + 1] ? path.resolve(args[rootIndex + 1]) : process.cwd();
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
  ownmem init [--layers core,gates,compiler,dashboard] [--locale BCP47|auto] [--hook]
  ownmem init --update
  ownmem init --check
  ownmem dashboard [--open|--status|--stop]
  ownmem embed config|test|build|status|ab [options]

Agent-facing commands:
  ownmem recall [--multi] [--json] [--feedback correct|wrong|retrieval_miss] [--expected NAME] -- <query>
  ownmem outcome --memory NAME --outcome applied|helpful_but_not_used|harmful --confirmed-by user|host --confirmation TEXT
  ownmem attribute --memory NAME --label useful|misleading
  ownmem intent -- <natural-language intent>
  ownmem audit
  ownmem review check|bootstrap|confirm
  ownmem trust check|issue|bootstrap [--strict-working-tree]
  ownmem compile
  ownmem report --since 7d [--governance]
  ownmem candidates scan|list|episodes|reject <id> --reason TEXT
  ownmem tripwire status|apply|list|quarantine|release|rollback [options]
  ownmem promote triggers [--apply]
  ownmem evolve [run|status|enable|disable] [--dry-run|--force]

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
  --feedback VERDICT               Record an explicit verdict on the previous recall: correct,
                                   wrong, retrieval_miss, coverage_gap, stale or conflict. This
                                   judges retrieval only -- what happened after a memory was used
                                   belongs to \`ownmem outcome\`
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
  report: 'Usage: ownmem report [--since 7d] [--governance]\n\n  Summarise local recall telemetry. Reads .local-test/ only.\n  --governance prints the review material waiting for a person instead of the summary; it reads and prints, and every item it prints still needs somebody to merge it.',
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
  candidates: `Usage: ownmem candidates <scan|list|episodes|reject> [options]

  Review queue for leads the local event ledger noticed. A candidate is never a memory and is never
  injectable: it states what was observed, claims no cause, and waits for a person.

  scan                      Derive candidates from the ledger and merge them into the queue
  list                      Show the queue
  episodes                  Show the turns the ledger can reconstruct
  reject <id> --reason <r>  Decline a candidate so a later scan does not regenerate it

  --min-episodes <n>        How many turns a red streak must span to be worth review (default: 2)
  --external-context        Untrusted external content was in this session; extract nothing`,
  tripwire: `Usage: ownmem tripwire <status|apply|list|quarantine|release|rollback> [options]

  The observation period a newly promoted memory is watched in, and the local switch that stops one
  being injected. Nothing here changes a tracked file except \`rollback --apply\`.

  status                    What is under observation and which degrade signals landed; writes nothing
  apply                     Act on the signals: stop injecting, write the retraction for review
  list                      The local quarantine ledger as it stands
  quarantine <memory>       Stop injecting one memory now (--signal required)
  release <memory>          Lift a quarantine (--released-by user|host; the system cannot do this)
  rollback <promotion-id>   Undo one promotion; --apply restores the file and appends the receipt

  --apply                   Carry out the action instead of previewing it
  --signal <name>           The degrade signal being recorded
  --released-by <who>       user or host
  --observations <n>        Deliveries before an observation period may close (default 3)
  --settle-hours <h>        Minimum life of an observation period (default 24)`,
  promote: `Usage: ownmem promote triggers [options]

  triggers                  Grade every recorded retrieval miss that wants a trigger and, with
                            --apply, write the ones every gate admits.

  A backfill is applied only when the risk matrix grades it R0, the missed query is replayed and
  comes back only because of the trigger, the evaluation corpus loses no case it used to pass, and
  the zero-net-growth quota admits the bytes. Any one of those refusing is reported with what it
  would take to proceed, which for the quota means named swap candidates a person still approves.

Options:
  --apply                   Write the approved changes. Without it nothing is written
  --cases-file <path>       Evaluation corpus the regression gate replays
  --limit <n>               Results a replay asks for (default: 3)`,
  evolve: `Usage: ownmem evolve [run|status|enable|disable] [options]

  Run the repository's unattended low-risk evolution loop. R0 retrieval metadata may apply only
  after differential replay, regression, quota, trust and audit gates; harmful automatic changes
  are quarantined and rolled back. Higher-risk or conflicted work remains review material.

Options:
  --dry-run                 Compute without writing
  --force                   Ignore the one-minute debounce
  --source <id>             Host surface that triggered the pass
  --quiet                   Print nothing unless the pass fails`,
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
  if (command === 'outcome') return outcome(rest);
  if (command === 'attribute') return attribute(rest);
  if (command === 'intent') return intent(rest);
  if (command === 'audit') return audit(rest);
  if (command === 'review') return review(rest);
  if (command === 'trust') return trust(rest);
  if (command === 'compile') return compile(rest);
  if (command === 'report') return report(rest);
  if (command === 'dashboard') return dashboard(rest);
  if (command === 'embed') return embed(rest);
  if (command === 'hook') return hook(rest);
  if (command === 'candidates') return candidates(rest);
  if (command === 'tripwire') return tripwire(rest);
  if (command === 'promote') return promote(rest);
  if (command === 'evolve') return evolve(rest);
  throw new Error(`unknown memory command: ${command}`);
}
