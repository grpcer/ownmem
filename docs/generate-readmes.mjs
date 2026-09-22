#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(DOCS);

const LANGUAGES = [
  ['en', 'English', 'README.md'],
  ['zh-CN', '简体中文', 'docs/i18n/README.zh-CN.md'],
  ['zh-TW', '繁體中文', 'docs/i18n/README.zh-TW.md'],
  ['ja', '日本語', 'docs/i18n/README.ja.md'],
  ['ko', '한국어', 'docs/i18n/README.ko.md'],
  ['es', 'Español', 'docs/i18n/README.es.md'],
  ['fr', 'Français', 'docs/i18n/README.fr.md'],
  ['de', 'Deutsch', 'docs/i18n/README.de.md'],
  ['pt-BR', 'Português (BR)', 'docs/i18n/README.pt-BR.md'],
];

const COMMON = {
  install: `\`\`\`bash
npm install --save-dev ownmem
npx ownmem init --hook --hosts claude,codex
\`\`\``,
  // The hit block of a real `ownmem recall` run on a one-topic example corpus, with the two footer
  // lines the CLI always prints left off. Re-capture it from a real run when the human renderer
  // changes rather than editing it by hand.
  demo: [
    '```console',
    '$ npx ownmem recall -- "staging deploy timed out again, should I add more workers?"',
    '== staging deploy timed out again, should I add more workers? ==',
    '  staging_timeout_pool_cap  [score=0.875 lanes=exact,bm25f,ngram fields=body,codePath,description,hooks,name,triggers]',
    '      matched deploy,more,out,staging,staging deploy timed out,timed',
    '      trust advisory authority · lifecycle advisory (not fully verified)',
    '        Treat it as a lead to re-check against the code, not as an established fact.',
    '      excerpt(body) **Why**: `DB_POOL_MAX` is 10 on staging. Adding workers only queues more requests behind the same ten connections, so the deploy health check times out sooner, not later.',
    '      file .ownmem/staging_timeout_pool_cap.md',
    '```',
  ].join('\n'),
  commands: `\`\`\`bash
npx ownmem new staging_timeout_pool_cap   # scaffold one memory that already passes every gate
npx ownmem report --since 7d              # used? fast enough? right? what to do next
npx ownmem dashboard --open               # open the local console
npx ownmem mcp                            # serve recall and read to any MCP host over stdio
\`\`\``,
  links: {
    agentPoison: '[AgentPoison (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html)',
    poisonedRag: '[PoisonedRAG (USENIX Security 2025)](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)',
    camel: '[CaMeL: Defeating Prompt Injections by Design (2025)](https://arxiv.org/abs/2503.18813)',
    intoto: '[in-toto (USENIX Security 2019)](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)',
    selective: '[Selective Classification (JMLR 2010)](https://jmlr.org/papers/v11/el-yaniv10a.html)',
    metamorphic: '[Metamorphic Testing (1998)](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf)',
    ares: '[ARES (NAACL 2024)](https://aclanthology.org/2024.naacl-long.20/)',
    ragchecker: '[RAGChecker (2024)](https://arxiv.org/abs/2408.08067)',
    memgpt: '[MemGPT (2023)](https://arxiv.org/abs/2310.08560)',
    reflexion: '[Reflexion (NeurIPS 2023)](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html)',
  },
};

const COPY = {
  en: {
    subtitle: 'Git-native memory for AI coding agents',
    tagline: 'Open-source project memory for Claude Code, Codex, Cursor, Gemini CLI, and other AI coding agents — local, deterministic, reviewable, and never written behind your back.',
    headings: ['Why OwnMem', 'How it compares', 'Quick start', 'Daily use', 'How it works', 'Privacy and boundaries', 'When to use it', 'Documentation'],
    whyIntro: 'Most AI agent memory systems optimize for remembering more. OwnMem starts with a different question: **who owns project knowledge, who may change it, and how can a bad memory be stopped before it changes a coding agent\'s actions?**',
    whyHeader: ['Advantage', 'What it means in practice'],
    benchmarkAlt: 'OwnMem public benchmark: Recall@1 of 100% on 128 queries in 40 languages, against 3.9% for grep -F on the same corpus; recall latency of 0.46 ms at P50 and 1.05 ms at P95 over 4,200 samples, under a 5 ms release gate; MRR 1.000, all 40 unrelated queries abstained, no model or network calls, two runtime dependencies.',
    benchmarkCaption: 'Measured on the locked CC0 corpus in this repository. Reproduce it in a clone with `npm run benchmark`.',
    whyRows: [
      ['**The repository owns memory**', 'Readable Markdown in `.ownmem/` travels through clone, review, and rollback with the code, and every agent in the repository reads the same source.'],
      ['**Deterministic local recall**', 'Default recall makes no model or network call; the same query, config, and snapshot produce the same ranking.'],
      ['**Evidence before authority**', 'Content cannot declare itself trusted. Independent receipts and live evidence checks decide delivery.'],
      ['**It tells you when it does not know**', 'Delivery is graded: the memory quoted, up to three pointers, or an abstention that names the gate that refused.'],
      ['**Net-zero growth**', 'A hard entry count that only ratchets down, so adding to a full corpus means retiring something in the same change.'],
    ],
    differsIntro: 'OwnMem does not replace `CLAUDE.md` or `AGENTS.md`. Those files say how to work here, and they are read in full every turn. OwnMem answers a different question — which of the things this project learned the hard way are worth putting in front of the model *for this task* — and it is allowed to answer “none of them”.',
    differsHeader: ['', 'Instruction files', 'Built-in agent memory', 'OwnMem'],
    differsRows: [
      ['Who writes it', 'you, by hand', 'the agent, from your conversations', 'you, reviewed like code'],
      ['Where it lives', 'one file in the repository', 'the vendor\'s account', 'Markdown in your repository'],
      ['What reaches the model', 'all of it, every turn', 'whatever its own recall picked', 'one of three tiers, under a token budget'],
      ['When an entry is wrong', 'you edit the file', 'you may never see the entry', 'evidence drift downgrades it and names what moved'],
      ['Cost per turn', 'the whole file in tokens', 'a retrieval call', 'no model call, no network call'],
    ],
    quickIntro: 'Requires Node.js 20.6 or newer. Run this inside the repository that should own the memory:',
    quickAfter: 'Reopen the agent afterwards. Name the hosts you use in `--hosts` (`claude`, `codex`, `cursor`, `gemini`, `grok`); the list is recorded, and passing it again later is how a host is added or removed. `init` creates `.ownmem/` and the host adapters, edits instruction files such as `CLAUDE.md` only inside managed blocks, and prints any one-time step a host still needs. Add `--check` to the same command to preview it, and `--locale auto` to write the generated instructions in your system language.',
    hostsHeader: [
      'Host',
      'How recall happens',
      'Setup',
    ],
    hostsRows: [
      ['Claude Code', 'A hook before every Edit and Write, and on request', '`claude`'],
      ['Codex', 'A hook before every patch it applies, and on request', '`codex`; the hooks need three one-time trust steps, which `init` prints'],
      ['Grok CLI', 'Reads Claude Code\'s hook configuration through its compatibility layer', '`grok`, alongside `claude` if you use both; trust the folder once with `/hooks-trust`'],
      ['Cursor', 'An always-applied rule, or the MCP server', '`cursor`; the MCP server takes one manual step, see [Plugins](%PLUGINS%)'],
      ['Gemini CLI', 'Instructions, or the MCP server', '`gemini`; the MCP server takes one manual step, see [Plugins](%PLUGINS%)'],
    ],
    upgradeNote: '> **⚠️ Upgrading from 0.6.0?** Update the package with `npm install --save-dev ownmem@latest`, then run `npx ownmem init --update` before anything else. 0.6.0 installed hooks whose subcommands no longer exist, so an installation that keeps them runs a failing command on every Bash call. The update removes them and never touches hooks you wrote yourself. [Updating](%UPDATING%) covers the rest, including the `core.hooksPath` cleanup.',
    dailyIntro: 'Keep working in plain language. Your agent drafts a memory when you ask for one, and you review it like code:',
    rememberQuote: '> “Remember this: staging deployment timeouts come from the pool cap, not too few workers. Check both together next time.”',
    recallQuote: '> “Before changing this, check whether the project memory has seen the same failure.”',
    demoIntro: 'Recall answers in one of three tiers: the memory quoted, up to three pointers to go and read, or an abstention. A real run:',
    demoAfter: 'Trust is stated, not implied. Nothing backs this entry yet — no review has confirmed it, and it cites no authority document or code anchor — so it arrives as a lead to re-check rather than as an established fact.',
    commandsIntro: 'The commands you will reach for yourself:',
    consoleAlt: 'The OwnMem local console: the known false-delivery residual as the headline figure, the lookup funnel beside it, corpus and evidence health below, and navigation for performance, quality, governance, and semantic retrieval.',
    mcpNote: '`ownmem mcp` exists for hosts without hooks. It exposes exactly two tools, `recall` and `read`, and neither can change a memory; the gate commands (`audit`, `trust`, `compile`) and every memory write stay off that surface. [Plugins](%PLUGINS%) shows how to register it so it runs the project\'s own copy.',
    architectureAlt: 'OwnMem architecture: repository-owned Markdown and independent trust receipts compile into immutable snapshots; deterministic local recall passes four delivery gates and arrives in one of three tiers — the memory quoted, up to three pointers, or an abstention that names its reason — while local feedback ledgers, an evaluation harness and a net-zero quota bound what the corpus becomes.',
    architectureItems: [
      '**Repository source of truth.** L1 routing, L2 area indexes, and L3 topics remain reviewable Markdown; trust receipts live outside the text they authorize.',
      '**Compile, then recall.** Schema, graph, lifecycle, and evidence gates produce a content-addressed immutable snapshot. Five deterministic lanes — exact, BM25F, n-gram, fuzzy, and graph — are fused locally; embeddings are an optional sixth lane at weight 0 until local A/B evidence passes.',
      '**Four gates, three tiers.** Relevance, epistemic validity, task applicability, and action risk each refuse on their own grounds. Above a threshold read off an ablation curve the memory is quoted; below it come up to three pointers that are explicitly not answers; with nothing qualified, an abstention that names the gate that refused.',
      '**No unattended writes.** There is no coordinator, no promotion, and no candidate queue. The package measures, proposes, and refuses; every change to memory is a commit somebody makes, and no ranking change lands without the evaluation harness.',
    ],
    technicalLink: 'Mechanisms, threat model, and research mapping: [Technical design](%TECHNICAL%).',
    boundaryItems: [
      '**Local by default.** Ranking reads repository files and local snapshots only: no LLM call, no network request, no retrieval API bill. Delivered excerpts still use the agent\'s context window, capped by the configured budget.',
      '**Telemetry stays on the machine.** Runtime events live in a Git-ignored directory and expire after thirty days. The daily pass (`ownmem daily`) reduces each finished day to a counted package with no query text, topic bodies, or file paths. Missing samples show as unavailable, never as 0%.',
      '**Retrieved text is data.** It cannot override host instructions or authorize a tool, and an agent\'s self-attribution never counts as user confirmation.',
      '**Failures are visible.** An entry with unsigned content or an unverifiable evidence target is withheld; evidence drift downgrades it to advisory and names what moved.',
      '**Keep secrets out.** Secrets and personal or production data that do not belong in Git do not belong in memory.',
    ],
    fitHeader: ['Good fit', 'Choose another system when'],
    fitRows: [
      ['A team wants project knowledge reviewed and migrated with code.', 'You need a cross-repository personal profile or global user memory.'],
      ['Several coding agents rotate through one repository.', 'You need to capture every conversation automatically with no evidence or risk boundary.'],
      ['Local, reproducible recall with no retrieval API bill matters.', 'You need large-scale cloud vector search or a real-time global knowledge graph.'],
      ['Bad memory must be attributable, rejectable, and reversible.', 'Maximum recall volume matters more than governance.'],
    ],
    researchSummary: 'Research lineage',
    researchIntro: 'OwnMem does not claim these foundations as inventions. Its contribution is their composition into an executable protocol for repository memory:',
    researchItems: [
      `**Agent memory and reflection:** ${COMMON.links.reflexion}, ${COMMON.links.memgpt}`,
      `**Memory and knowledge-base poisoning:** ${COMMON.links.agentPoison}, ${COMMON.links.poisonedRag}`,
      `**Untrusted data separated from authority:** ${COMMON.links.camel}`,
      `**Independent provenance:** ${COMMON.links.intoto}`,
      `**Selective prediction and abstention:** ${COMMON.links.selective}`,
      `**Ablation-based validation:** ${COMMON.links.metamorphic}`,
      `**Decomposed retrieval evaluation:** ${COMMON.links.ares}, ${COMMON.links.ragchecker}`,
    ],
    researchAfter: 'These citations describe the research lineage; they do not imply that the papers implement OwnMem or that OwnMem reproduces their experiments.',
    docsHeader: ['Document', 'Purpose'],
    docsRows: [['architecture', 'Package boundaries, snapshots, trust, and delivery'], ['technical', 'Mechanisms, threat model, and research mapping'], ['plugins', 'Per-host setup, plugins, and trust steps'], ['updating', 'Safe repository updates and version migrations'], ['privacy', 'Local data and optional channel boundaries'], ['changelog', 'Version history'], ['contributing', 'Reporting issues and sending changes'], ['security', 'Reporting a vulnerability'], ['license', 'Apache-2.0']],
    closing: 'OwnMem is open source. Reproducible issues and pull requests are welcome.',
  },
  'zh-CN': {
    subtitle: '面向 AI 编程 Agent 的 Git 原生记忆',
    tagline: '把 AI 编程 Agent 的项目记忆留在仓库里：本地、确定、可审阅，而且没有你提交就不会被写入。',
    headings: ['为什么是 OwnMem', '与同类方案对比', '快速开始', '日常使用', '工作原理', '隐私与边界', '适用场景', '文档'],
    whyIntro: '大多数记忆方案先解决“记得更多”。OwnMem 先问另一件事：**项目知识由谁拥有，谁有权改变它，错误记忆怎样在影响 Agent 行动前被拦住？**',
    whyHeader: ['优势', '对实际开发意味着什么'],
    benchmarkAlt: 'OwnMem 公开基准：40 种语言、128 条查询的 Recall@1 为 100%，同一语料上 grep -F 为 3.9%；4200 个样本的召回延迟 P50 0.46 ms、P95 1.05 ms，低于 5 ms 的发布门槛；MRR 1.000，对 40 条无关查询全部弃权，不调用模型、不请求网络，两个运行时依赖。',
    benchmarkCaption: '在本仓库锁定的 CC0 语料上实测。克隆本仓库后运行 `npm run benchmark` 即可复现。',
    whyRows: [
      ['**记忆归仓库所有**', '记忆是 `.ownmem/` 中可读的 Markdown，随 Git 克隆、评审和回滚；仓库里的每个 Agent 读的都是同一份。'],
      ['**默认召回确定且本地**', '不调用模型、不请求网络；相同查询、配置和快照得到相同排序。'],
      ['**先验证证据，再授予 authority**', '正文不能自证可信；独立收据和活体证据核验决定是否交付。'],
      ['**不知道就说不知道**', '交付分档：引用记忆正文、给最多三条指针、或说明是哪道门拒的之后弃权。'],
      ['**净零增长**', '条目数上限只降不升；往一个满了的语料里加一条，就得在同一次改动里退役一条。'],
    ],
    differsIntro: 'OwnMem 不替代 `CLAUDE.md` 或 `AGENTS.md`。那两个文件说的是“在这里该怎么干活”，每一轮都整份读进去。OwnMem 回答的是另一个问题——这个项目踩过的坑里，哪几条值得**为当前这个任务**放到模型眼前——而且它有权回答“一条都不值得”。',
    differsHeader: ['', '项目指令文件', '平台自带 memory', 'OwnMem'],
    differsRows: [
      ['谁来写', '你，手写', 'Agent，从你和它的对话里提取', '你写，像代码一样被审阅'],
      ['存在哪', '仓库里的一个文件', '厂商的账号里', '你仓库里的 Markdown'],
      ['每轮进模型的是什么', '整份，每一轮', '它自己的召回挑中的那些', '三档之一，且受 token 预算约束'],
      ['某条写错了会怎样', '你去改那个文件', '你可能永远看不到那一条', '证据漂移把它降级，并说明变的是什么'],
      ['每轮成本', '整份文件的 token', '一次检索调用', '零模型调用、零网络请求'],
    ],
    quickIntro: '需要 Node.js 20.6 或更新版本。在希望拥有项目记忆的仓库里执行：',
    quickAfter: '装好后重新打开 Agent。用 `--hosts` 列出你在用的宿主（`claude`、`codex`、`cursor`、`gemini`、`grok`）；这份列表会被记录下来，以后增减宿主就是带着新列表再跑一次。`init` 会创建 `.ownmem/` 和各宿主的适配文件，对 `CLAUDE.md` 这类指令文件只改托管区块，并把各宿主仍需完成的一次性步骤直接打印出来。在同一条命令后加 `--check` 可以先预览；加 `--locale auto`，生成的指令文件会使用系统语言。',
    hostsHeader: [
      '宿主',
      '怎么召回',
      '接入方式',
    ],
    hostsRows: [
      ['Claude Code', '每次 Edit、Write 前由 hook 召回，也可以随时要求', '`claude`'],
      ['Codex', '每次应用补丁前由 hook 召回，也可以随时要求', '`codex`；hook 需要三步一次性信任设置，`init` 会逐条提示'],
      ['Grok CLI', '通过兼容层读取 Claude Code 的 hook 配置', '`grok`，若同时使用 Claude Code，一并写上 `claude`；在 grok 里执行一次 `/hooks-trust` 信任本目录'],
      ['Cursor', '始终生效的规则文件，或 MCP server', '`cursor`；MCP server 需要一步手动配置，见[插件与宿主](%PLUGINS%)'],
      ['Gemini CLI', '指令文件，或 MCP server', '`gemini`；MCP server 需要一步手动配置，见[插件与宿主](%PLUGINS%)'],
    ],
    upgradeNote: '> **⚠️ 从 0.6.0 升级？** 先用 `npm install --save-dev ownmem@latest` 升级依赖，再跑一次 `npx ownmem init --update`，其他都往后放。0.6.0 装的 hook 指向的子命令已经不存在了，留着它们，Agent 每跑一条 Bash 都会触发一个失败的命令。更新会把它们移除，你自己写的 hook 不会被动到。其余事项（包括清理 `core.hooksPath`）见[升级指南](%UPDATING%)。',
    dailyIntro: '接下来照常用自然语言工作。你让 Agent 记下什么，它就起草一条记忆，你像审代码一样审它：',
    rememberQuote: '> “记住：staging 部署超时来自连接池上限，不是 worker 太少。下次两者一起检查。”',
    recallQuote: '> “改之前先看看项目记忆里有没有遇到同一种故障。”',
    demoIntro: '召回按三档之一作答：引用记忆正文、给最多三条指针让你去读，或者弃权。一次真实运行：',
    demoAfter: '信任程度会明确标出，而不是隐含的。这条记忆目前没有任何背书——没人复核确认过，也没引用权威文档或代码锚点——所以它作为“需要回头核对的线索”交付，而不是既定事实。',
    commandsIntro: '你自己会用到的几条命令：',
    consoleAlt: 'OwnMem 本地控制台：以已知误交付残留率为主指标，旁边是查找漏斗，下方是语料与证据健康度，侧栏可切换性能、质量、治理与语义检索。',
    mcpNote: '`ownmem mcp` 是给没有 hook 的宿主准备的。它只暴露 `recall` 和 `read` 两个工具，两者都不能改动记忆；门禁命令（`audit`、`trust`、`compile`）和所有记忆写入都不在这个接口上。怎样注册才能确保运行的是项目自己安装的那一份，见[插件与宿主](%PLUGINS%)。',
    architectureAlt: 'OwnMem 总架构：仓库拥有的 Markdown 与独立信任收据编译成不可变快照；本地确定性召回经过四道交付门，并按三档之一交付——引用记忆正文、给最多三条指针、或说明原因后弃权；本地反馈账本、评测台与净零增长配额约束语料的走向。',
    architectureItems: [
      '**仓库是唯一事实来源。** L1 路由、L2 领域索引和 L3 topic 是可审阅 Markdown；信任收据独立于它所授权的正文。',
      '**编译后再召回。** 经 schema、图关系、生命周期与证据校验后，生成内容寻址的不可变快照。exact、BM25F、n-gram、fuzzy、graph 五路检索通道在本地融合；embedding 是可选的第六路，本地 A/B 证据通过之前权重为 0。',
      '**四道门，三档交付。** 相关性、认知有效性、任务适用性和动作风险各自按自己的理由拒绝。分数高于阈值（取自消融曲线）就引用记忆正文；低于阈值给最多三条**明确不是答案**的指针；一条合格的都没有则弃权，并报出是哪道门拒的。',
      '**没有无人值守写入。** 没有协调器、没有晋升、没有候选队列。这个包只负责度量、提议和拒绝；记忆的每一次改动都是某个人的一次提交，任何排序改动都要先过评测台。',
    ],
    technicalLink: '机制、威胁模型与研究对应见[技术设计](%TECHNICAL%)。',
    boundaryItems: [
      '**默认本地。** 排序只读仓库文件和本地快照：零 LLM 调用、零网络请求、没有检索 API 账单。交付给 Agent 的摘录仍会占用上下文窗口，并受配置的预算限制。',
      '**遥测不出本机。** 运行事件存放在被 Git 忽略的目录中，30 天后过期。每日封存（`ownmem daily`）把每个已结束的自然日归并为计数包，不含查询原文、topic 正文和文件路径。没有样本就显示“暂无”，不会伪装成 0%。',
      '**召回的文本只是数据。** 它不能覆盖宿主指令，也不能授权工具；Agent 的自归因永远不算用户确认。',
      '**失败看得见。** 正文未签名或证据目标无法核验的条目会被扣住；证据漂移会把条目降为 advisory，并说明变的是什么。',
      '**秘密不进记忆。** 不该进入 Git 的密钥、个人信息和生产数据，也不该进入记忆。',
    ],
    fitHeader: ['适合 OwnMem', '这些情况更适合其他系统'],
    fitRows: [
      ['团队希望项目知识和代码一起评审、迁移。', '需要跨仓库个人画像或全局用户记忆。'],
      ['同一仓库轮换使用多个编程 Agent。', '希望无差别自动保存全部对话，不接受证据门与风险边界。'],
      ['在意本地、可复现且没有检索 API 账单的召回。', '需要大规模云向量搜索或实时全局知识图谱。'],
      ['错误记忆必须可归因、可拒绝、可撤销。', '记忆数量比治理更重要。'],
    ],
    researchSummary: '研究脉络',
    researchIntro: 'OwnMem 不把这些基础概念冒充原创；它的贡献是把它们组合成仓库记忆的可执行协议：',
    researchItems: [
      `**Agent Memory 与反思学习：** ${COMMON.links.reflexion}、${COMMON.links.memgpt}`,
      `**记忆与知识库投毒：** ${COMMON.links.agentPoison}、${COMMON.links.poisonedRag}`,
      `**不可信数据与授权分离：** ${COMMON.links.camel}`,
      `**独立来源证明：** ${COMMON.links.intoto}`,
      `**选择性预测与弃答：** ${COMMON.links.selective}`,
      `**消融式验证：** ${COMMON.links.metamorphic}`,
      `**分维度检索评测：** ${COMMON.links.ares}、${COMMON.links.ragchecker}`,
    ],
    researchAfter: '这些引用只说明研究脉络，不表示相关论文实现了 OwnMem，也不表示 OwnMem 复现了论文实验。',
    docsHeader: ['文档', '内容'],
    docsRows: [['architecture', '包边界、快照、信任与交付'], ['technical', '机制、威胁模型与研究对应'], ['plugins', '各宿主接入、插件与授信步骤'], ['updating', '安全更新与版本迁移'], ['privacy', '本地数据和可选通道边界'], ['changelog', '版本变化'], ['contributing', '提交 issue 与贡献代码'], ['security', '报告安全漏洞'], ['license', 'Apache-2.0']],
    closing: 'OwnMem 是开源项目，欢迎提交带可复现证据的 issue 和 pull request。',
  },
  'zh-TW': {
    subtitle: '為 AI 程式 Agent 打造的 Git 原生記憶',
    tagline: '把 AI 程式 Agent 的專案記憶留在儲存庫：本機、確定、可審閱，而且沒有你提交就不會被寫入。',
    headings: ['為什麼是 OwnMem', '與同類方案比較', '快速開始', '日常使用', '運作原理', '隱私與邊界', '適用情境', '文件'],
    whyIntro: '多數記憶方案先解決「記得更多」。OwnMem 先問另一件事：**專案知識由誰擁有，誰有權改變它，錯誤記憶如何在影響 Agent 行動前被攔下？**',
    whyHeader: ['優勢', '對實際開發的意義'],
    benchmarkAlt: 'OwnMem 公開基準：40 種語言、128 條查詢的 Recall@1 為 100%，同一語料上 grep -F 為 3.9%；4200 個樣本的召回延遲 P50 0.46 ms、P95 1.05 ms，低於 5 ms 的發布門檻；MRR 1.000，對 40 條無關查詢全部棄權，不呼叫模型、不請求網路，兩個執行階段相依套件。',
    benchmarkCaption: '在本儲存庫鎖定的 CC0 語料上實測。複製本儲存庫後執行 `npm run benchmark` 即可重現。',
    whyRows: [
      ['**記憶歸儲存庫所有**', '記憶是 `.ownmem/` 中可讀的 Markdown，隨 Git 複製、審閱與回復；儲存庫裡的每個 Agent 讀的都是同一份。'],
      ['**預設召回確定且本機**', '不呼叫模型、不請求網路；相同查詢、設定與快照得到相同排序。'],
      ['**先驗證證據，再授予 authority**', '正文不能自證可信；獨立收據與即時證據核驗決定是否交付。'],
      ['**不知道就說不知道**', '交付分檔：引用記憶正文、給最多三條指標、或說明是哪道門拒的之後棄權。'],
      ['**淨零成長**', '條目數上限只降不升；往一個滿了的語料裡加一條，就得在同一次變更裡退役一條。'],
    ],
    differsIntro: 'OwnMem 不取代 `CLAUDE.md` 或 `AGENTS.md`。那兩個檔案說的是「在這裡該怎麼做事」，每一輪都整份讀進去。OwnMem 回答的是另一個問題——這個專案踩過的坑裡，哪幾條值得**為目前這個任務**放到模型眼前——而且它有權回答「一條都不值得」。',
    differsHeader: ['', '專案指令檔', '平台內建 memory', 'OwnMem'],
    differsRows: [
      ['誰來寫', '你，手寫', 'Agent，從你和它的對話裡擷取', '你寫，像程式碼一樣被審閱'],
      ['存在哪', '儲存庫裡的一個檔案', '廠商的帳號裡', '你儲存庫裡的 Markdown'],
      ['每輪進模型的是什麼', '整份，每一輪', '它自己的召回挑中的那些', '三檔之一，且受 token 預算約束'],
      ['某條寫錯了會怎樣', '你去改那個檔案', '你可能永遠看不到那一條', '證據漂移把它降級，並說明變的是什麼'],
      ['每輪成本', '整份檔案的 token', '一次檢索呼叫', '零模型呼叫、零網路請求'],
    ],
    quickIntro: '需要 Node.js 20.6 或更新版本。在希望擁有專案記憶的儲存庫中執行：',
    quickAfter: '裝好後重新開啟 Agent。用 `--hosts` 列出你在用的宿主（`claude`、`codex`、`cursor`、`gemini`、`grok`）；這份清單會被記錄下來，之後增減宿主就是帶著新清單再執行一次。`init` 會建立 `.ownmem/` 與各宿主的配接檔，對 `CLAUDE.md` 這類指令檔只修改受管理的區塊，並把各宿主仍需完成的一次性步驟直接印出來。在同一條指令後加上 `--check` 可以先預覽；加上 `--locale auto`，產生的指令檔會使用系統語言。',
    hostsHeader: ['宿主', '怎麼召回', '設定方式'],
    hostsRows: [
      ['Claude Code', '每次 Edit、Write 前由 hook 召回，也可以隨時要求', '`claude`'],
      ['Codex', '每次套用修補檔前由 hook 召回，也可以隨時要求', '`codex`；hook 需要三步一次性信任設定，`init` 會逐條提示'],
      ['Grok CLI', '透過相容層讀取 Claude Code 的 hook 設定', '`grok`，若同時使用 Claude Code，一併寫上 `claude`；在 grok 裡執行一次 `/hooks-trust` 信任這個資料夾'],
      ['Cursor', '一律套用的規則檔，或 MCP server', '`cursor`；MCP server 需要手動設定一步，見[外掛與宿主](%PLUGINS%)'],
      ['Gemini CLI', '指令檔，或 MCP server', '`gemini`；MCP server 需要手動設定一步，見[外掛與宿主](%PLUGINS%)'],
    ],
    upgradeNote: '> **⚠️ 從 0.6.0 升級？** 先用 `npm install --save-dev ownmem@latest` 升級套件，再執行一次 `npx ownmem init --update`，其他都往後放。0.6.0 裝的 hook 指向的子指令已經不存在，留著它們，Agent 每跑一條 Bash 都會觸發一個失敗的指令。更新會把它們移除，你自己寫的 hook 不會被更動。其餘事項（包括清理 `core.hooksPath`）見[升級指南](%UPDATING%)。',
    dailyIntro: '接下來照常用自然語言工作。你要 Agent 記下什麼，它就起草一條記憶，你像審程式碼一樣審它：',
    rememberQuote: '> 「記住：staging 部署逾時來自連線池上限，不是 worker 太少。下次兩者一起檢查。」',
    recallQuote: '> 「修改前先看看專案記憶是否遇過同一種故障。」',
    demoIntro: '召回會以三檔之一作答：引用記憶正文、給最多三條指標讓你去讀，或是棄權。一次真實執行：',
    demoAfter: '信任程度會明確標示，而非隱含。這條記憶目前沒有任何背書——沒有人複核確認過，也沒有引用權威文件或程式碼錨點——所以它以「需要回頭核對的線索」交付，而不是既定事實。',
    commandsIntro: '你自己會用到的幾條指令：',
    consoleAlt: 'OwnMem 本機主控台：以已知誤交付殘留率為主指標，旁邊是查找漏斗，下方是語料與證據健康度，側欄可切換效能、品質、治理與語意檢索。',
    mcpNote: '`ownmem mcp` 是為沒有 hook 的宿主準備的。它只開放 `recall` 與 `read` 兩個工具，兩者都不能更動記憶；門禁指令（`audit`、`trust`、`compile`）與所有記憶寫入都不在這個介面上。怎麼註冊才能確保執行的是專案自己安裝的那一份，見[外掛與宿主](%PLUGINS%)。',
    architectureAlt: 'OwnMem 總架構：儲存庫擁有的 Markdown 與獨立信任收據編譯成不可變快照；本機確定性召回經過四道交付門，並按三檔之一交付——引用記憶正文、給最多三條指標、或說明原因後棄權；本機回饋帳本、評測台與淨零成長配額約束語料的走向。',
    architectureItems: [
      '**儲存庫是唯一事實來源。** L1 路由、L2 領域索引與 L3 topic 是可審閱 Markdown；信任收據獨立於它授權的正文。',
      '**編譯後再召回。** 經 schema、圖關係、生命週期與證據校驗後，產生內容定址的不可變快照。exact、BM25F、n-gram、fuzzy、graph 五路檢索通道在本機融合；embedding 是可選的第六路，本機 A/B 證據通過之前權重為 0。',
      '**四道門，三檔交付。** 相關性、認知有效性、任務適用性與動作風險各自按自己的理由拒絕。分數高於門檻（取自消融曲線）就引用記憶正文；低於門檻給最多三條**明確不是答案**的指標；一條合格的都沒有則棄權，並報出是哪道門拒的。',
      '**沒有無人值守寫入。** 沒有協調器、沒有晉升、沒有候選佇列。這個套件只負責量測、提議與拒絕；記憶的每一次變更都是某個人的一次提交，任何排序變更都要先過評測台。',
    ],
    technicalLink: '機制、威脅模型與研究對應見[技術設計](%TECHNICAL%)。',
    boundaryItems: [
      '**預設本機。** 排序只讀儲存庫檔案與本機快照：零 LLM 呼叫、零網路請求、沒有檢索 API 帳單。交付給 Agent 的摘錄仍會占用上下文視窗，並受設定的預算限制。',
      '**遙測不離開本機。** 執行事件存放在被 Git 忽略的目錄中，30 天後過期。每日封存（`ownmem daily`）把每個已結束的日子彙整成計數包，不含查詢原文、topic 正文與檔案路徑。沒有樣本就顯示「暫無」，不偽裝成 0%。',
      '**召回的文字只是資料。** 它不能覆寫宿主指令，也不能授權工具；Agent 的自歸因永遠不算使用者確認。',
      '**失敗看得見。** 正文未簽署或證據目標無法核驗的條目會被扣住；證據漂移會把條目降為 advisory，並說明變的是什麼。',
      '**祕密不進記憶。** 不該進入 Git 的金鑰、個人資料與正式環境資料，也不該進入記憶。',
    ],
    fitHeader: ['適合 OwnMem', '這些情況更適合其他系統'],
    fitRows: [
      ['團隊希望專案知識與程式碼一起審閱、遷移。', '需要跨儲存庫個人輪廓或全域使用者記憶。'],
      ['同一儲存庫輪流使用多個程式 Agent。', '希望無差別自動保存所有對話，不接受證據門與風險邊界。'],
      ['重視本機、可重現且沒有檢索 API 帳單的召回。', '需要大規模雲端向量搜尋或即時全域知識圖譜。'],
      ['錯誤記憶必須可歸因、可拒絕、可撤銷。', '記憶數量比治理更重要。'],
    ],
    researchSummary: '研究脈絡',
    researchIntro: 'OwnMem 不把這些基礎概念冒充原創；它的貢獻是把它們組成儲存庫記憶的可執行協定：',
    researchItems: [
      `**Agent Memory 與反思學習：** ${COMMON.links.reflexion}、${COMMON.links.memgpt}`,
      `**記憶與知識庫投毒：** ${COMMON.links.agentPoison}、${COMMON.links.poisonedRag}`,
      `**不可信資料與授權分離：** ${COMMON.links.camel}`,
      `**獨立來源證明：** ${COMMON.links.intoto}`,
      `**選擇性預測與棄答：** ${COMMON.links.selective}`,
      `**消融式驗證：** ${COMMON.links.metamorphic}`,
      `**分維度檢索評測：** ${COMMON.links.ares}、${COMMON.links.ragchecker}`,
    ],
    researchAfter: '這些引用只說明研究脈絡，不表示相關論文實作了 OwnMem，也不表示 OwnMem 重現了論文實驗。',
    docsHeader: ['文件', '內容'],
    docsRows: [['architecture', '套件邊界、快照、信任與交付'], ['technical', '機制、威脅模型與研究對應'], ['plugins', '各宿主接入、外掛與授信步驟'], ['updating', '安全更新與版本遷移'], ['privacy', '本機資料與可選通道邊界'], ['changelog', '版本變更'], ['contributing', '回報 issue 與貢獻程式碼'], ['security', '回報安全漏洞'], ['license', 'Apache-2.0']],
    closing: 'OwnMem 是開源專案，歡迎提交附可重現證據的 issue 與 pull request。',
  },
  ja: {
    subtitle: 'AI コーディングエージェントのための Git ネイティブな記憶',
    tagline: 'AI コーディングエージェントのプロジェクト記憶をリポジトリに置く。ローカル、決定的、レビュー可能で、あなたの commit なしに書き換わることはない。',
    headings: ['なぜ OwnMem なのか', '類似手法との比較', 'クイックスタート', '日常の使い方', '仕組み', 'プライバシーと境界', '向いている場面', 'ドキュメント'],
    whyIntro: '多くの記憶システムは「より多く覚える」ことを最適化します。OwnMem は先に、**プロジェクト知識を誰が所有し、誰が変更でき、誤った記憶を行動の前にどう止めるか**を問います。',
    whyHeader: ['強み', '実開発での意味'],
    benchmarkAlt: 'OwnMem の公開ベンチマーク：40 言語・128 クエリで Recall@1 は 100%、同じコーパスで grep -F は 3.9%。4,200 サンプルの想起レイテンシは P50 0.46 ms、P95 1.05 ms で、リリース基準の 5 ms を下回る。MRR 1.000、無関係なクエリ 40 件すべてで棄権、モデル・ネットワーク呼び出しはゼロ、ランタイム依存は 2 つ。',
    benchmarkCaption: 'このリポジトリに固定された CC0 コーパスで計測。クローンして `npm run benchmark` を実行すれば再現できます。',
    whyRows: [
      ['**記憶はリポジトリ所有**', '`.ownmem/` の可読 Markdown がコードと一緒に clone、review、rollback され、リポジトリ内のどの Agent も同じ情報源を読みます。'],
      ['**既定で決定的なローカル想起**', 'モデルもネットワークも呼ばず、同じクエリ・設定・snapshot なら同じ順位です。'],
      ['**authority より先に証拠**', '本文は自分を信頼済みにできません。独立 receipt と生きた証拠検証が配信を決めます。'],
      ['**知らないときは知らないと言う**', '配信は段階的です。記憶本文の引用、最大 3 件のポインタ、または拒んだ gate を明示した棄権。'],
      ['**純増ゼロの成長**', '件数上限は下がる方向にしか動きません。満杯のコーパスに一件足すなら、同じ変更で一件退役させます。'],
    ],
    differsIntro: 'OwnMem は `CLAUDE.md` や `AGENTS.md` の代わりではありません。この 2 つは「ここではどう進めるか」を書いたもので、毎 turn 全文が読まれます。OwnMem が答えるのは別の問いです。このプロジェクトが痛い目を見て学んだことのうち、**この作業のために**モデルの目の前に置く価値があるのはどれか。そして「どれでもない」と答える権利があります。',
    differsHeader: ['', 'プロジェクト指示ファイル', '組み込みの agent memory', 'OwnMem'],
    differsRows: [
      ['誰が書くか', 'あなたが手で書く', 'agent が会話から', 'あなたが書き、コードと同じくレビューされる'],
      ['どこにあるか', 'リポジトリ内の 1 ファイル', 'ベンダーのアカウント', 'あなたのリポジトリ内の Markdown'],
      ['毎 turn 何がモデルに届くか', '全文が毎回', 'その recall が選んだもの', '3 tier のいずれか、token 予算の範囲で'],
      ['内容が間違っていたら', 'ファイルを直す', 'その項目を目にしないかもしれない', 'evidence drift が格下げし、何が動いたかを示す'],
      ['1 turn あたりのコスト', 'ファイル全体の token', 'retrieval 1 回', 'モデル呼び出し 0、ネットワーク 0'],
    ],
    quickIntro: 'Node.js 20.6 以上が必要です。記憶を所有させるリポジトリで実行します。',
    quickAfter: 'インストール後は Agent を再起動してください。使っている host を `--hosts` に列挙します（`claude`、`codex`、`cursor`、`gemini`、`grok`）。この一覧は記録され、あとから host を増減するときは新しい一覧でもう一度実行します。`init` は `.ownmem/` と各 host のアダプタを作り、`CLAUDE.md` のような指示ファイルは管理ブロックの中だけを編集し、host ごとに残っている一度きりの手順があれば表示します。同じコマンドに `--check` を付ければ事前に確認でき、`--locale auto` を付ければ生成される指示文がシステムの言語になります。',
    hostsHeader: [
      'Host',
      '想起のしかた',
      'セットアップ',
    ],
    hostsRows: [
      ['Claude Code', 'Edit と Write の前に毎回 hook で想起。依頼時にも想起', '`claude`'],
      ['Codex', 'パッチを適用する前に毎回 hook で想起。依頼時にも想起', '`codex`。hook には一度きりの信頼手順が 3 つ必要（`init` が表示）'],
      ['Grok CLI', '互換レイヤー経由で Claude Code の hook 設定を読む', '`grok`（Claude Code も使うなら `claude` も併記）。grok 内で `/hooks-trust` を一度実行してフォルダを信頼'],
      ['Cursor', '常に適用されるルール、または MCP サーバー', '`cursor`。MCP サーバーは手動の手順が 1 つ必要（[Plugins](%PLUGINS%) 参照）'],
      ['Gemini CLI', '指示ファイル、または MCP サーバー', '`gemini`。MCP サーバーは手動の手順が 1 つ必要（[Plugins](%PLUGINS%) 参照）'],
    ],
    upgradeNote: '> **⚠️ 0.6.0 から更新する場合** まず `npm install --save-dev ownmem@latest` でパッケージを更新し、ほかの作業より先に `npx ownmem init --update` を一度実行してください。0.6.0 が入れた hook の参照先サブコマンドはもう存在しないため、残したままだと Bash を実行するたびに失敗するコマンドが走ります。更新はそれらを取り除き、自分で書いた hook には触れません。`core.hooksPath` の後始末を含む残りの手順は [Updating](%UPDATING%) を参照してください。',
    dailyIntro: 'あとは普段どおりの言葉で作業します。頼めば Agent が記憶を下書きし、あなたはそれをコードと同じようにレビューします。',
    rememberQuote: '> 「覚えておいて。staging deploy の timeout は worker 不足ではなく pool cap が原因。次回は両方確認する。」',
    recallQuote: '> 「変更前に、同じ障害をプロジェクト記憶で経験していないか確認して。」',
    demoIntro: '想起は 3 つの tier のいずれかで答えます。記憶本文の引用、読みに行くべきポインタ最大 3 件、または棄権です。実際の実行例：',
    demoAfter: '信頼度は暗黙ではなく明示されます。この項目にはまだ裏付けがありません。レビューで確認されておらず、authority 文書もコードアンカーも引用していないため、確定した事実ではなく、確かめ直すべき手がかりとして届きます。',
    commandsIntro: '自分で使うことになるコマンド：',
    consoleAlt: 'OwnMem のローカルコンソール。既知の誤配信残存率を主指標に、その横に検索ファネル、下にコーパスと証拠の健全性を表示し、サイドバーからパフォーマンス・品質・ガバナンス・セマンティック検索に切り替えられる。',
    mcpNote: '`ownmem mcp` は hook を持たない host のためのものです。公開するのは `recall` と `read` の 2 つだけで、どちらも記憶を変更できません。gate 系コマンド（`audit`、`trust`、`compile`）や記憶への書き込みはこの経路からは使えません。プロジェクト自身にインストールされたものを確実に動かす登録方法は [Plugins](%PLUGINS%) を参照してください。',
    architectureAlt: 'OwnMem の全体構成。リポジトリ所有の Markdown と独立した信頼 receipt を不変 snapshot にコンパイルし、決定的ローカル想起を 4 つの配信 gate に通し、3 つの tier のいずれかで届ける。記憶本文の引用、最大 3 件のポインタ、理由を明示した棄権である。ローカルの feedback 台帳、評価ハーネス、純増ゼロの quota がコーパスの行き先を縛る。',
    architectureItems: [
      '**リポジトリが唯一の情報源。** L1 routing、L2 area index、L3 topic は review 可能な Markdown。trust receipt は本文と分離されます。',
      '**compile してから recall。** Schema、graph、lifecycle、evidence gate が content-addressed な不変 snapshot を作ります。exact、BM25F、n-gram、fuzzy、graph の 5 本の決定的 lane をローカルで融合し、embedding は任意の第 6 lane として、ローカルの A/B 証拠が通るまで重み 0 です。',
      '**4 つの gate、3 つの tier。** relevance、epistemic validity、task applicability、action risk はそれぞれ独自の理由で拒みます。ablation 曲線から読み取った閾値以上なら記憶本文を引用し、それ未満なら**答えではないと明記した**ポインタを最大 3 件示し、合格候補がなければ拒んだ gate を名指しして棄権します。',
      '**無人の書き込みはしない。** coordinator も昇格も候補キューもありません。このパッケージは計測し、提案し、拒むだけで、記憶の変更はすべて誰かの commit です。ranking の変更は評価ハーネスを通らない限り入りません。',
    ],
    technicalLink: '仕組み、脅威モデル、研究との対応は [Technical design](%TECHNICAL%) にあります。',
    boundaryItems: [
      '**既定でローカル。** ranking はリポジトリのファイルとローカル snapshot だけを読み、LLM 呼び出しもネットワークリクエストも retrieval API 課金もありません。それでも Agent に渡す抜粋はコンテキストウィンドウを使い、設定された予算で制限されます。',
      '**テレメトリはマシンから出ない。** 実行時イベントは Git-ignore されたディレクトリに置かれ、30 日で失効します。日次処理（`ownmem daily`）は終わった日を集計パッケージにまとめ、クエリ本文、topic 本文、ファイルパスは含めません。サンプルがなければ 0% ではなく「データなし」と表示します。',
      '**想起された本文はデータ。** host の指示を上書きすることも tool を許可することもできず、Agent の self-attribution がユーザー確認として数えられることもありません。',
      '**失敗は見える形で。** 本文が未署名の項目や、evidence を検証できない項目は配信しません。evidence drift は項目を advisory に下げ、何が動いたかを示します。',
      '**秘密は入れない。** Git に置くべきでない secret、個人情報、本番データは記憶にも置きません。',
    ],
    fitHeader: ['OwnMem が合う', '別のシステムが合う'],
    fitRows: [
      ['プロジェクト知識をコードと一緒に review・移行したい。', 'リポジトリ横断の個人 profile や global user memory が必要。'],
      ['同じリポジトリで複数の coding Agent を使う。', '証拠や risk boundary なしで全会話を自動保存したい。'],
      ['ローカルで再現可能、retrieval API 課金なしの recall が重要。', '大規模 cloud vector search や realtime global knowledge graph が必要。'],
      ['誤った記憶を追跡、拒否、撤回できる必要がある。', 'governance より記憶量を優先する。'],
    ],
    researchSummary: '研究上の系譜',
    researchIntro: 'OwnMem は基礎技術の発明を主張しません。貢献は、それらをリポジトリ記憶の実行可能 protocol に組み合わせることです。',
    researchItems: [
      `**Agent memory と reflection:** ${COMMON.links.reflexion}, ${COMMON.links.memgpt}`,
      `**Memory / knowledge-base poisoning:** ${COMMON.links.agentPoison}, ${COMMON.links.poisonedRag}`,
      `**Untrusted data と authority の分離:** ${COMMON.links.camel}`,
      `**独立 provenance:** ${COMMON.links.intoto}`,
      `**Selective prediction と abstention:** ${COMMON.links.selective}`,
      `**Ablation による検証:** ${COMMON.links.metamorphic}`,
      `**分解された retrieval evaluation:** ${COMMON.links.ares}, ${COMMON.links.ragchecker}`,
    ],
    researchAfter: '引用は研究上の系譜を示すもので、各論文が OwnMem を実装した、または OwnMem が実験を再現したという意味ではありません。',
    docsHeader: ['文書', '内容'],
    docsRows: [['architecture', 'パッケージ境界、snapshot、trust、配信'], ['technical', '仕組み、脅威モデル、研究との対応'], ['plugins', 'host ごとのセットアップ、plugin、信頼手順'], ['updating', '安全な更新とバージョン移行'], ['privacy', 'ローカルデータと任意チャネルの境界'], ['changelog', 'バージョン履歴'], ['contributing', 'issue の報告と変更の送り方'], ['security', '脆弱性の報告'], ['license', 'Apache-2.0']],
    closing: 'OwnMem はオープンソースです。再現可能な issue と pull request を歓迎します。',
  },
  ko: {
    subtitle: 'AI 코딩 에이전트를 위한 Git 네이티브 메모리',
    tagline: 'AI 코딩 에이전트의 프로젝트 메모리를 저장소에 둡니다. 로컬·결정적·검토 가능하고, 당신의 commit 없이는 아무것도 쓰이지 않습니다.',
    headings: ['왜 OwnMem인가', '다른 방식과의 비교', '빠른 시작', '일상 사용', '작동 방식', '프라이버시와 경계', '언제 쓰면 좋은가', '문서'],
    whyIntro: '대부분의 메모리 시스템은 “더 많이 기억하기”를 최적화합니다. OwnMem은 먼저 **프로젝트 지식을 누가 소유하고, 누가 바꿀 수 있으며, 잘못된 메모리를 행동 전에 어떻게 막을지** 묻습니다.',
    whyHeader: ['장점', '실제 개발에서의 의미'],
    benchmarkAlt: 'OwnMem 공개 벤치마크: 40개 언어, 128개 질의에서 Recall@1 100%, 같은 코퍼스에서 grep -F는 3.9%. 4,200개 샘플의 회상 지연은 P50 0.46 ms, P95 1.05 ms로 릴리스 기준 5 ms 이내. MRR 1.000, 무관한 질의 40개 모두에서 기권, 모델·네트워크 호출 0회, 런타임 의존성 2개.',
    benchmarkCaption: '이 저장소에 고정된 CC0 코퍼스에서 측정했습니다. 저장소를 클론한 뒤 `npm run benchmark`로 재현할 수 있습니다.',
    whyRows: [
      ['**메모리는 저장소 소유**', '`.ownmem/`의 읽을 수 있는 Markdown이 코드와 함께 clone, review, rollback 되며, 저장소의 모든 Agent가 같은 원본을 읽습니다.'],
      ['**기본 회상은 결정적·로컬**', '모델이나 네트워크를 호출하지 않고 같은 query·config·snapshot에 같은 순위를 냅니다.'],
      ['**authority보다 증거가 먼저**', '본문은 스스로 신뢰를 부여하지 못하며 독립 receipt와 실시간 evidence 검증이 전달을 결정합니다.'],
      ['**모를 때는 모른다고 말합니다**', '전달은 등급별입니다. 기억 본문 인용, 최대 3개의 포인터, 또는 어느 gate가 거절했는지 밝힌 기권.'],
      ['**순증가 0 성장**', '항목 수 상한은 낮아지기만 합니다. 가득 찬 코퍼스에 하나를 더하려면 같은 변경에서 하나를 퇴역시켜야 합니다.'],
    ],
    differsIntro: 'OwnMem은 `CLAUDE.md`나 `AGENTS.md`를 대체하지 않습니다. 그 파일들은 “여기서는 이렇게 일한다”를 적은 것이고 매 turn 전문이 읽힙니다. OwnMem이 답하는 질문은 다릅니다. 이 프로젝트가 어렵게 배운 것들 가운데 **이번 작업을 위해** 모델 앞에 둘 만한 것이 무엇인가. 그리고 “하나도 없다”고 답할 권리가 있습니다.',
    differsHeader: ['', '프로젝트 지시 파일', '내장 agent memory', 'OwnMem'],
    differsRows: [
      ['누가 쓰나', '당신이 손으로', 'agent가 대화에서 뽑아서', '당신이 쓰고 코드처럼 검토받는다'],
      ['어디에 있나', '저장소 안의 파일 하나', '벤더의 계정', '당신 저장소 안의 Markdown'],
      ['매 turn 무엇이 모델에 닿나', '전문이 매번', '그 recall이 고른 것', '세 tier 중 하나, token 예산 안에서'],
      ['항목이 틀렸을 때', '파일을 고친다', '그 항목을 영영 못 볼 수도 있다', 'evidence drift가 등급을 낮추고 무엇이 바뀌었는지 밝힌다'],
      ['turn당 비용', '파일 전체의 token', 'retrieval 호출 한 번', '모델 호출 0, 네트워크 0'],
    ],
    quickIntro: 'Node.js 20.6 이상이 필요합니다. 메모리를 소유할 저장소에서 실행하세요.',
    quickAfter: '설치가 끝나면 Agent를 다시 시작하세요. 사용하는 host(`claude`, `codex`, `cursor`, `gemini`, `grok`)를 `--hosts`에 나열합니다. 이 목록은 기록되며, 나중에 host를 추가하거나 빼려면 새 목록으로 다시 실행하면 됩니다. `init`은 `.ownmem/`과 각 host의 어댑터를 만들고, `CLAUDE.md` 같은 지침 파일은 관리되는 블록 안에서만 수정하며, host마다 남은 일회성 단계가 있으면 출력해 줍니다. 같은 명령에 `--check`를 붙이면 미리 볼 수 있고, `--locale auto`를 붙이면 생성되는 지침이 시스템 언어로 작성됩니다.',
    hostsHeader: [
      'Host',
      '회상 방식',
      '설정',
    ],
    hostsRows: [
      ['Claude Code', '매번 Edit·Write 전에 hook으로 회상, 요청 시에도 회상', '`claude`'],
      ['Codex', '매번 패치를 적용하기 전에 hook으로 회상, 요청 시에도 회상', '`codex`. hook에는 일회성 신뢰 단계 세 가지가 필요(`init`이 안내)'],
      ['Grok CLI', '호환 계층을 통해 Claude Code의 hook 설정을 읽음', '`grok`(Claude Code도 쓴다면 `claude`도 함께). grok에서 `/hooks-trust`를 한 번 실행해 폴더를 신뢰'],
      ['Cursor', '항상 적용되는 규칙 파일, 또는 MCP 서버', '`cursor`. MCP 서버는 수동 설정 한 단계가 필요([Plugins](%PLUGINS%) 참고)'],
      ['Gemini CLI', '지침 파일, 또는 MCP 서버', '`gemini`. MCP 서버는 수동 설정 한 단계가 필요([Plugins](%PLUGINS%) 참고)'],
    ],
    upgradeNote: '> **⚠️ 0.6.0에서 업그레이드하나요?** 먼저 `npm install --save-dev ownmem@latest`로 패키지를 올린 뒤, 다른 작업보다 앞서 `npx ownmem init --update`를 한 번 실행하세요. 0.6.0이 설치한 hook은 이제 존재하지 않는 하위 명령을 가리키므로, 그대로 두면 Bash를 실행할 때마다 실패하는 명령이 돌아갑니다. 업데이트는 이를 제거하고 직접 작성한 hook은 건드리지 않습니다. `core.hooksPath` 정리를 포함한 나머지는 [Updating](%UPDATING%)을 참고하세요.',
    dailyIntro: '이제 평소처럼 자연어로 일하면 됩니다. 기억해 달라고 하면 Agent가 메모리 초안을 쓰고, 그 초안을 코드처럼 검토합니다:',
    rememberQuote: '> “기억해 둬. staging 배포 timeout은 worker 부족이 아니라 pool cap 때문이야. 다음에는 둘 다 확인해.”',
    recallQuote: '> “바꾸기 전에 프로젝트 메모리에 같은 장애가 있었는지 확인해.”',
    demoIntro: '회상은 세 tier 중 하나로 답합니다. 기억 본문 인용, 가서 읽어 볼 포인터 최대 3개, 또는 기권입니다. 실제 실행 결과:',
    demoAfter: '신뢰 수준은 암묵적으로 넘어가지 않고 명시됩니다. 이 항목은 아직 뒷받침이 없습니다. 리뷰로 확인되지 않았고 authority 문서나 코드 앵커도 인용하지 않으므로, 확정된 사실이 아니라 다시 확인해야 할 단서로 전달됩니다.',
    commandsIntro: '직접 쓰게 될 명령:',
    consoleAlt: 'OwnMem 로컬 콘솔: 알려진 오전달 잔존율을 주 지표로, 옆에는 조회 퍼널, 아래에는 코퍼스와 증거 상태를 보여 주며, 사이드바에서 성능·품질·거버넌스·의미 검색으로 이동할 수 있습니다.',
    mcpNote: '`ownmem mcp`는 hook이 없는 host를 위한 것입니다. 노출하는 도구는 `recall`과 `read` 두 개뿐이며 둘 다 메모리를 바꿀 수 없습니다. gate 명령(`audit`, `trust`, `compile`)과 모든 메모리 쓰기는 이 경로로는 노출되지 않습니다. 프로젝트에 설치된 사본이 실행되도록 등록하는 방법은 [Plugins](%PLUGINS%)에 있습니다.',
    architectureAlt: 'OwnMem 전체 아키텍처. 저장소 소유 Markdown과 독립 trust receipt를 불변 snapshot으로 compile하고 결정적 로컬 recall을 네 전달 gate에 통과시켜 세 tier 중 하나로 전달한다. 기억 본문 인용, 최대 3개의 포인터, 이유를 밝힌 기권이다. 로컬 feedback 원장, 평가 하네스, 순증가 0 quota가 코퍼스의 방향을 묶는다.',
    architectureItems: [
      '**저장소가 진실의 원천.** L1 routing, L2 area index, L3 topic은 검토 가능한 Markdown이며 trust receipt는 본문과 분리됩니다.',
      '**compile 후 recall.** Schema, graph, lifecycle, evidence gate가 content-addressed 불변 snapshot을 만듭니다. exact, BM25F, n-gram, fuzzy, graph 5개 결정적 lane을 로컬에서 융합하며, embedding은 선택적 6번째 lane으로 로컬 A/B 증거가 통과하기 전에는 가중치 0입니다.',
      '**4개 gate, 3개 tier.** relevance, epistemic validity, task applicability, action risk는 각자의 근거로 거절합니다. ablation 곡선에서 읽은 임계값 이상이면 메모리 본문을 인용하고, 그 아래면 **답이 아님을 명시한** 포인터를 최대 3개, 적격 후보가 없으면 거절한 gate를 밝히고 기권합니다.',
      '**무인 쓰기 없음.** coordinator도, 승격도, 후보 큐도 없습니다. 이 패키지는 측정하고 제안하고 거절할 뿐이며, 메모리의 모든 변경은 누군가의 commit입니다. ranking 변경은 평가 하네스를 거치지 않고는 들어가지 않습니다.',
    ],
    technicalLink: '작동 원리, 위협 모델, 연구와의 대응은 [Technical design](%TECHNICAL%)에 있습니다.',
    boundaryItems: [
      '**기본은 로컬입니다.** ranking은 저장소 파일과 로컬 snapshot만 읽으므로 LLM 호출도, 네트워크 요청도, retrieval API 비용도 없습니다. 그래도 Agent에 전달되는 발췌문은 컨텍스트 창을 사용하며 설정된 예산으로 제한됩니다.',
      '**텔레메트리는 머신을 벗어나지 않습니다.** 런타임 이벤트는 Git-ignore된 디렉터리에 저장되고 30일 뒤 만료됩니다. 일일 집계(`ownmem daily`)는 끝난 하루를 횟수만 담은 패키지로 줄이며, 질의 원문·topic 본문·파일 경로는 담지 않습니다. 샘플이 없으면 0%가 아니라 “없음”으로 표시합니다.',
      '**회상된 텍스트는 데이터입니다.** host 지시를 덮어쓰거나 도구를 허가할 수 없으며, Agent의 self-attribution은 결코 사용자 확인으로 간주되지 않습니다.',
      '**실패는 드러납니다.** 본문이 서명되지 않았거나 evidence를 검증할 수 없는 항목은 전달하지 않습니다. evidence drift는 항목을 advisory로 낮추고 무엇이 바뀌었는지 밝힙니다.',
      '**비밀은 넣지 않습니다.** Git에 두어서는 안 되는 secret, 개인정보, 운영 데이터는 메모리에도 두지 않습니다.',
    ],
    fitHeader: ['OwnMem이 잘 맞음', '다른 시스템이 더 맞음'],
    fitRows: [
      ['프로젝트 지식을 코드와 함께 검토·이동하고 싶다.', '저장소를 넘는 개인 profile이나 global user memory가 필요하다.'],
      ['한 저장소에서 여러 coding Agent를 번갈아 쓴다.', '증거·risk boundary 없이 모든 대화를 자동 저장하고 싶다.'],
      ['로컬·재현 가능하고 retrieval API 비용이 없는 recall이 중요하다.', '대규모 cloud vector search나 realtime global knowledge graph가 필요하다.'],
      ['잘못된 메모리를 추적·거절·철회할 수 있어야 한다.', 'governance보다 메모리 양이 중요하다.'],
    ],
    researchSummary: '연구 계보',
    researchIntro: 'OwnMem은 기초 기술을 발명했다고 주장하지 않습니다. 기여는 이를 저장소 메모리의 실행 가능한 protocol로 조합한 데 있습니다.',
    researchItems: [
      `**Agent memory와 reflection:** ${COMMON.links.reflexion}, ${COMMON.links.memgpt}`,
      `**Memory / knowledge-base poisoning:** ${COMMON.links.agentPoison}, ${COMMON.links.poisonedRag}`,
      `**Untrusted data와 authority 분리:** ${COMMON.links.camel}`,
      `**독립 provenance:** ${COMMON.links.intoto}`,
      `**Selective prediction과 abstention:** ${COMMON.links.selective}`,
      `**Ablation 기반 검증:** ${COMMON.links.metamorphic}`,
      `**분해된 retrieval evaluation:** ${COMMON.links.ares}, ${COMMON.links.ragchecker}`,
    ],
    researchAfter: '인용은 연구 계보를 설명할 뿐 해당 논문이 OwnMem을 구현했거나 OwnMem이 실험을 재현했다는 뜻이 아닙니다.',
    docsHeader: ['문서', '내용'],
    docsRows: [['architecture', '패키지 경계, snapshot, trust, 전달'], ['technical', '작동 원리, 위협 모델, 연구와의 대응'], ['plugins', 'host별 설정, plugin, 신뢰 단계'], ['updating', '안전한 업데이트와 버전 마이그레이션'], ['privacy', '로컬 데이터와 선택적 채널의 경계'], ['changelog', '버전 기록'], ['contributing', 'issue 보고와 변경 제안 방법'], ['security', '보안 취약점 신고'], ['license', 'Apache-2.0']],
    closing: 'OwnMem은 오픈 소스입니다. 재현 가능한 issue와 pull request를 환영합니다.',
  },
  es: {
    subtitle: 'Memoria nativa de Git para agentes de programación con IA',
    tagline: 'Memoria de proyecto en el repositorio para agentes de programación: local, determinista, revisable y que nunca se escribe sin tu commit.',
    headings: ['Por qué OwnMem', 'Comparativa', 'Inicio rápido', 'Uso diario', 'Cómo funciona', 'Privacidad y límites', 'Cuándo encaja', 'Documentación'],
    whyIntro: 'La mayoría de los sistemas optimiza «recordar más». OwnMem empieza por otra pregunta: **¿quién posee el conocimiento del proyecto, quién puede cambiarlo y cómo se detiene un recuerdo erróneo antes de que altere las acciones del agente?**',
    whyHeader: ['Ventaja', 'Qué significa en la práctica'],
    benchmarkAlt: 'Benchmark público de OwnMem: Recall@1 del 100 % en 128 consultas de 40 idiomas, frente al 3,9 % de grep -F sobre el mismo corpus; latencia de recall de 0,46 ms en P50 y 1,05 ms en P95 en 4200 muestras, por debajo del umbral de publicación de 5 ms; MRR 1,000, abstención en las 40 consultas no relacionadas, ninguna llamada a modelos ni a la red y dos dependencias en tiempo de ejecución.',
    benchmarkCaption: 'Medido sobre el corpus CC0 fijado en este repositorio. Para reproducirlo, ejecuta `npm run benchmark` en un clon.',
    whyRows: [
      ['**La memoria pertenece al repositorio**', 'Markdown legible en `.ownmem/` viaja con el código al clonar, revisar y revertir, y todos los agentes del repositorio leen la misma fuente.'],
      ['**Recall local y determinista**', 'Sin modelo ni red; la misma consulta, configuración y snapshot producen el mismo orden.'],
      ['**Evidencia antes que autoridad**', 'El contenido no puede declararse fiable; receipts independientes y evidencia viva deciden la entrega.'],
      ['**Avisa cuando no lo sabe**', 'La entrega es por niveles: la memoria citada, hasta tres punteros, o una abstención que nombra la puerta que se negó.'],
      ['**Crecimiento neto cero**', 'El número de entradas solo puede bajar: añadir a un corpus lleno obliga a retirar algo en el mismo cambio.'],
    ],
    differsIntro: 'OwnMem no sustituye a `CLAUDE.md` ni a `AGENTS.md`. Esos archivos dicen cómo se trabaja aquí y se leen enteros en cada turno. OwnMem responde otra pregunta: de todo lo que este proyecto aprendió a golpes, qué merece ponerse delante del modelo **para esta tarea** — y tiene permiso para responder «nada».',
    differsHeader: ['', 'Archivos de instrucciones', 'Memoria integrada del agente', 'OwnMem'],
    differsRows: [
      ['Quién lo escribe', 'tú, a mano', 'el agente, desde tus conversaciones', 'tú, revisado como código'],
      ['Dónde vive', 'un archivo del repositorio', 'la cuenta del proveedor', 'Markdown en tu repositorio'],
      ['Qué llega al modelo', 'todo, en cada turno', 'lo que eligió su propio recall', 'uno de tres niveles, bajo un presupuesto de tokens'],
      ['Cuando una entrada está mal', 'editas el archivo', 'puede que nunca veas esa entrada', 'el drift de evidencia la degrada y dice qué se movió'],
      ['Coste por turno', 'el archivo entero en tokens', 'una llamada de recuperación', 'sin llamada a modelo ni a la red'],
    ],
    quickIntro: 'Requiere Node.js 20.6 o posterior. Ejecútalo en el repositorio que debe poseer la memoria:',
    quickAfter: 'Después, vuelve a abrir el agente. Indica en `--hosts` los hosts que usas (`claude`, `codex`, `cursor`, `gemini`, `grok`); la lista queda registrada, y para añadir o quitar un host basta con volver a pasar la lista completa. `init` crea `.ownmem/` y los adaptadores de cada host, en archivos de instrucciones como `CLAUDE.md` solo modifica lo que hay dentro de bloques gestionados y muestra los pasos puntuales que aún necesite algún host. Añade `--check` al mismo comando para previsualizarlo, y `--locale auto` para generar las instrucciones en el idioma de tu sistema.',
    hostsHeader: ['Host', 'Cómo se activa el recall', 'Configuración'],
    hostsRows: [
      ['Claude Code', 'Un hook antes de cada Edit y Write, y cuando se lo pides', '`claude`'],
      ['Codex', 'Un hook antes de cada parche que aplica, y cuando se lo pides', '`codex`; los hooks necesitan tres pasos de confianza que solo se hacen una vez, y `init` los muestra'],
      ['Grok CLI', 'Lee la configuración de hooks de Claude Code mediante su capa de compatibilidad', '`grok`, junto con `claude` si usas ambos; marca la carpeta como de confianza una vez con `/hooks-trust`'],
      ['Cursor', 'Una regla que se aplica siempre o el servidor MCP', '`cursor`; el servidor MCP requiere un paso manual, ver [Plugins](%PLUGINS%)'],
      ['Gemini CLI', 'Instrucciones o el servidor MCP', '`gemini`; el servidor MCP requiere un paso manual, ver [Plugins](%PLUGINS%)'],
    ],
    upgradeNote: '> **⚠️ ¿Vienes de la 0.6.0?** Actualiza el paquete con `npm install --save-dev ownmem@latest` y, antes que nada, ejecuta `npx ownmem init --update`. La 0.6.0 instaló hooks cuyos subcomandos ya no existen, así que una instalación que los conserve ejecuta un comando que falla en cada llamada a Bash. La actualización los elimina y nunca toca los hooks que escribiste tú. [Updating](%UPDATING%) explica el resto, incluida la limpieza de `core.hooksPath`.',
    dailyIntro: 'Sigue trabajando en lenguaje natural. Tu agente redacta una memoria cuando se lo pides, y tú la revisas como si fuera código:',
    rememberQuote: '> «Recuerda: el timeout de staging viene del límite del pool, no de pocos workers. Comprueba ambos la próxima vez.»',
    recallQuote: '> «Antes de cambiar esto, revisa si la memoria del proyecto ya vio el mismo fallo.»',
    demoIntro: 'El recall responde en uno de tres niveles: la memoria citada, hasta tres punteros para ir a leer o una abstención. Una ejecución real:',
    demoAfter: 'La confianza se declara, no se presupone. Nada respalda todavía esta entrada —ninguna revisión la ha confirmado y no cita ningún documento de autoridad ni ancla de código—, así que llega como una pista que hay que volver a comprobar, no como un hecho establecido.',
    commandsIntro: 'Los comandos que usarás tú mismo:',
    consoleAlt: 'La consola local de OwnMem: el residuo conocido de entregas erróneas como cifra principal, el embudo de búsquedas a su lado, el estado del corpus y de la evidencia debajo, y la navegación a rendimiento, calidad, gobernanza y recuperación semántica.',
    mcpNote: '`ownmem mcp` existe para los hosts sin hooks. Expone exactamente dos herramientas, `recall` y `read`, y ninguna puede modificar una memoria; los comandos de control (`audit`, `trust`, `compile`) y cualquier escritura de memoria quedan fuera de su alcance. [Plugins](%PLUGINS%) explica cómo registrarlo para que ejecute la copia instalada en el proyecto.',
    architectureAlt: 'Arquitectura de OwnMem: Markdown propiedad del repositorio y receipts de confianza independientes se compilan en snapshots inmutables; el recall local determinista pasa cuatro puertas de entrega y llega en uno de tres niveles — la memoria citada, hasta tres punteros, o una abstención que dice por qué — mientras los libros de feedback local, el banco de evaluación y una cuota de crecimiento neto cero acotan en qué se convierte el corpus.',
    architectureItems: [
      '**El repositorio es la fuente.** Rutas L1, índices L2 y temas L3 son Markdown revisable; los trust receipts viven fuera del texto autorizado.',
      '**Compilar antes de recordar.** Las puertas de schema, grafo, ciclo de vida y evidencia producen un snapshot inmutable y direccionado por contenido. Cinco canales deterministas —exact, BM25F, n-gram, fuzzy y graph— se fusionan localmente; embedding es un sexto canal opcional con peso 0 hasta superar la prueba A/B local.',
      '**Cuatro puertas, tres niveles.** Relevancia, validez epistémica, aplicabilidad a la tarea y riesgo de la acción se niegan cada una por su propio motivo. Por encima de un umbral que sale de una curva de ablación se cita la memoria; por debajo, hasta tres punteros que explícitamente no son respuestas; sin candidatos aptos, una abstención que nombra la puerta que se negó.',
      '**Ninguna escritura desatendida.** No hay coordinador, ni promoción, ni cola de candidatos. El paquete mide, propone y se niega; cada cambio en la memoria es un commit que hace una persona, y ningún cambio de ranking entra sin pasar por el banco de evaluación.',
    ],
    technicalLink: 'Mecanismos, modelo de amenazas y relación con la investigación: [Technical design](%TECHNICAL%).',
    boundaryItems: [
      '**Local por defecto.** El ranking solo lee archivos del repositorio y snapshots locales: cero llamadas LLM, cero peticiones de red y ninguna factura de API de recuperación. Los extractos entregados sí ocupan contexto del agente, dentro del presupuesto configurado.',
      '**La telemetría no sale de la máquina.** Los eventos de ejecución viven en un directorio ignorado por Git y caducan a los treinta días. La pasada diaria (`ownmem daily`) reduce cada día terminado a un paquete de recuentos sin texto de consultas, cuerpo de los temas ni rutas de archivo. Si faltan muestras, aparece «no disponible», nunca un 0 %.',
      '**El texto recuperado se trata como datos.** No puede anular las instrucciones del host ni autorizar una herramienta, y la autoatribución de un agente nunca cuenta como confirmación del usuario.',
      '**Los fallos son visibles.** Una entrada con contenido sin firmar o con un objetivo de evidencia no verificable se retiene; el drift de evidencia la baja a advisory y dice qué se movió.',
      '**Nada de secretos.** Secretos y datos personales o de producción que no deben ir a Git tampoco deben ir a memoria.',
    ],
    fitHeader: ['OwnMem encaja', 'Mejor otro sistema'],
    fitRows: [
      ['El conocimiento debe revisarse y migrar con el código.', 'Necesitas un perfil personal o memoria global entre repositorios.'],
      ['Varios agentes trabajan por turnos en un repositorio.', 'Quieres capturar toda conversación sin límites de evidencia o riesgo.'],
      ['Importa el recall local y reproducible sin factura de API de recuperación.', 'Necesitas búsqueda vectorial cloud masiva o un grafo global en tiempo real.'],
      ['La memoria errónea debe poder atribuirse, rechazarse y revertirse.', 'La cantidad importa más que el gobierno.'],
    ],
    researchSummary: 'Antecedentes de investigación',
    researchIntro: 'OwnMem no presenta estas bases como invenciones; su aportación es componerlas en un protocolo ejecutable para memoria de repositorio:',
    researchItems: [
      `**Memoria de agentes y reflexión:** ${COMMON.links.reflexion}, ${COMMON.links.memgpt}`,
      `**Poisoning de memoria y conocimiento:** ${COMMON.links.agentPoison}, ${COMMON.links.poisonedRag}`,
      `**Datos no fiables separados de autoridad:** ${COMMON.links.camel}`,
      `**Procedencia independiente:** ${COMMON.links.intoto}`,
      `**Predicción selectiva y abstención:** ${COMMON.links.selective}`,
      `**Validación por ablación:** ${COMMON.links.metamorphic}`,
      `**Evaluación descompuesta de retrieval:** ${COMMON.links.ares}, ${COMMON.links.ragchecker}`,
    ],
    researchAfter: 'Las citas describen el linaje; no implican que esos trabajos implementen OwnMem ni que OwnMem reproduzca sus experimentos.',
    docsHeader: ['Documento', 'Contenido'],
    docsRows: [['architecture', 'Límites, snapshots, confianza y entrega'], ['technical', 'Mecanismos, amenazas e investigación'], ['plugins', 'Configuración por host, plugins y pasos de confianza'], ['updating', 'Actualización segura y migraciones de versión'], ['privacy', 'Datos locales y canales opcionales'], ['changelog', 'Historial de versiones'], ['contributing', 'Cómo reportar issues y enviar cambios'], ['security', 'Cómo reportar una vulnerabilidad'], ['license', 'Apache-2.0']],
    closing: 'OwnMem es código abierto. Se agradecen issues y pull requests reproducibles.',
  },
  fr: {
    subtitle: 'Une mémoire native Git pour les agents de code IA',
    tagline: 'La mémoire de projet des agents de code reste dans le dépôt : locale, déterministe, révisable, et jamais écrite sans votre commit.',
    headings: ['Pourquoi OwnMem', 'Comparaison', 'Démarrage rapide', 'Usage quotidien', 'Fonctionnement', 'Confidentialité et limites', 'Quand OwnMem convient', 'Documentation'],
    whyIntro: 'La plupart des mémoires cherchent d’abord à « retenir plus ». OwnMem pose une autre question : **qui possède le savoir du projet, qui peut le modifier et comment arrêter un mauvais souvenir avant qu’il influence l’agent ?**',
    whyHeader: ['Avantage', 'Conséquence pratique'],
    benchmarkAlt: 'Benchmark public d’OwnMem : Recall@1 de 100 % sur 128 requêtes en 40 langues, contre 3,9 % pour grep -F sur le même corpus ; latence de rappel de 0,46 ms au P50 et 1,05 ms au P95 sur 4 200 échantillons, sous le seuil de publication de 5 ms ; MRR 1,000, abstention sur les 40 requêtes hors sujet, aucun appel à un modèle ni au réseau, deux dépendances d’exécution.',
    benchmarkCaption: 'Mesuré sur le corpus CC0 figé dans ce dépôt. Pour le reproduire, lancez `npm run benchmark` dans un clone.',
    whyRows: [
      ['**Le dépôt possède la mémoire**', 'Le Markdown lisible de `.ownmem/` voyage avec le code lors du clone, de la revue et du rollback, et tous les agents du dépôt lisent la même source.'],
      ['**Rappel local et déterministe**', 'Aucun modèle ni réseau ; mêmes requête, configuration et snapshot, même classement.'],
      ['**Les preuves avant l’autorité**', 'Le texte ne peut pas s’auto-déclarer fiable ; receipts indépendants et preuves vivantes décident.'],
      ['**Il dit quand il ne sait pas**', 'La livraison est graduée : la mémoire citée, jusqu’à trois pointeurs, ou une abstention qui nomme la porte ayant refusé.'],
      ['**Croissance nette nulle**', 'Le nombre d’entrées ne peut que baisser : ajouter à un corpus plein oblige à en retirer une dans le même changement.'],
    ],
    differsIntro: 'OwnMem ne remplace ni `CLAUDE.md` ni `AGENTS.md`. Ces fichiers disent comment on travaille ici, et ils sont lus en entier à chaque tour. OwnMem répond à une autre question : parmi tout ce que ce projet a appris à la dure, qu’est-ce qui mérite d’être mis sous les yeux du modèle **pour cette tâche** — avec le droit de répondre « rien ».',
    differsHeader: ['', 'Fichiers d’instructions', 'Mémoire intégrée de l’agent', 'OwnMem'],
    differsRows: [
      ['Qui l’écrit', 'vous, à la main', 'l’agent, depuis vos conversations', 'vous, relu comme du code'],
      ['Où elle vit', 'un fichier du dépôt', 'le compte de l’éditeur', 'du Markdown dans votre dépôt'],
      ['Ce qui atteint le modèle', 'tout, à chaque tour', 'ce que son propre rappel a choisi', 'l’un de trois niveaux, sous un budget de tokens'],
      ['Quand une entrée est fausse', 'vous éditez le fichier', 'vous ne verrez peut-être jamais l’entrée', 'la dérive de preuve la rétrograde et dit ce qui a bougé'],
      ['Coût par tour', 'le fichier entier en tokens', 'un appel de récupération', 'aucun appel de modèle ni de réseau'],
    ],
    quickIntro: 'Node.js 20.6 ou plus récent est requis. Exécutez ceci dans le dépôt qui doit posséder la mémoire :',
    quickAfter: 'Rouvrez ensuite l’agent. Indiquez dans `--hosts` les hosts que vous utilisez (`claude`, `codex`, `cursor`, `gemini`, `grok`) ; la liste est enregistrée, et c’est en la repassant plus tard qu’on ajoute ou retire un host. `init` crée `.ownmem/` et les adaptateurs de chaque host, ne modifie les fichiers d’instructions comme `CLAUDE.md` qu’à l’intérieur de blocs gérés, et affiche toute étape ponctuelle qu’il reste à faire pour un host. Ajoutez `--check` à la même commande pour la prévisualiser, et `--locale auto` pour générer les instructions dans la langue du système.',
    hostsHeader: [
      'Host',
      'Déclenchement du rappel',
      'Installation',
    ],
    hostsRows: [
      ['Claude Code', 'Un hook avant chaque Edit et Write, et à la demande', '`claude`'],
      ['Codex', 'Un hook avant chaque patch qu’il applique, et à la demande', '`codex` ; les hooks demandent trois étapes de confiance ponctuelles, qu’`init` affiche'],
      ['Grok CLI', 'Lit la configuration des hooks de Claude Code via sa couche de compatibilité', '`grok`, avec `claude` si vous utilisez les deux ; approuvez le dossier une fois avec `/hooks-trust`'],
      ['Cursor', 'Une règle toujours appliquée ou le serveur MCP', '`cursor` ; le serveur MCP demande une étape manuelle, voir [Plugins](%PLUGINS%)'],
      ['Gemini CLI', 'Instructions ou le serveur MCP', '`gemini` ; le serveur MCP demande une étape manuelle, voir [Plugins](%PLUGINS%)'],
    ],
    upgradeNote: '> **⚠️ Vous venez de la 0.6.0 ?** Mettez le paquet à jour avec `npm install --save-dev ownmem@latest`, puis lancez `npx ownmem init --update` avant toute autre chose. La 0.6.0 a installé des hooks dont les sous-commandes n’existent plus : une installation qui les garde exécute une commande qui échoue à chaque appel Bash. La mise à jour les retire et ne touche jamais aux hooks que vous avez écrits. [Updating](%UPDATING%) détaille le reste, dont le nettoyage de `core.hooksPath`.',
    dailyIntro: 'Continuez à travailler en langage courant. Votre agent rédige une mémoire quand vous le lui demandez, et vous la relisez comme du code :',
    rememberQuote: '> « Mémorise ceci : le timeout de staging vient de la limite du pool, pas d’un manque de workers. Vérifie les deux la prochaine fois. »',
    recallQuote: '> « Avant de modifier, regarde si la mémoire du projet a déjà rencontré la même panne. »',
    demoIntro: 'Le rappel répond selon l’un des trois niveaux : la mémoire citée, jusqu’à trois pointeurs à aller lire ou une abstention. Une exécution réelle :',
    demoAfter: 'La confiance est affichée, jamais sous-entendue. Rien n’étaye encore cette entrée — aucune revue ne l’a confirmée et elle ne cite ni document d’autorité ni ancre de code : elle arrive donc comme une piste à revérifier, pas comme un fait établi.',
    commandsIntro: 'Les commandes que vous lancerez vous-même :',
    consoleAlt: 'La console locale d’OwnMem : le résidu connu de livraisons erronées en chiffre principal, l’entonnoir des recherches à côté, l’état du corpus et des preuves en dessous, et la navigation vers performances, qualité, gouvernance et recherche sémantique.',
    mcpNote: '`ownmem mcp` est destiné aux hosts sans hooks. Il expose exactement deux outils, `recall` et `read`, et aucun ne peut modifier une mémoire ; les commandes de contrôle (`audit`, `trust`, `compile`) et toute écriture en mémoire ne sont pas accessibles par cette voie. [Plugins](%PLUGINS%) montre comment le déclarer pour qu’il exécute la copie installée dans le projet.',
    architectureAlt: 'Architecture OwnMem : le Markdown détenu par le dépôt et des receipts de confiance indépendants sont compilés en snapshots immuables ; le rappel local déterministe franchit quatre portes de livraison et arrive selon l’un de trois niveaux — la mémoire citée, jusqu’à trois pointeurs, ou une abstention qui en donne la raison — tandis que les registres de retour locaux, le banc d’évaluation et un quota à croissance nette nulle bornent ce que devient le corpus.',
    architectureItems: [
      '**Le dépôt est la source.** Routage L1, index L2 et sujets L3 sont du Markdown révisable ; les trust receipts sont extérieurs au texte autorisé.',
      '**Compiler avant le rappel.** Les portes de schéma, de graphe, de cycle de vie et de preuve produisent un snapshot immuable adressé par contenu. Cinq canaux déterministes — exact, BM25F, n-gram, fuzzy et graph — fusionnent localement ; embedding est un sixième canal optionnel, à poids 0 tant que la preuve A/B locale n’est pas faite.',
      '**Quatre portes, trois niveaux.** Pertinence, validité épistémique, applicabilité à la tâche et risque de l’action refusent chacune pour un motif propre. Au-dessus d’un seuil lu sur une courbe d’ablation, la mémoire est citée ; en dessous, jusqu’à trois pointeurs qui ne sont explicitement pas des réponses ; sans candidat qualifié, une abstention qui nomme la porte ayant refusé.',
      '**Aucune écriture sans supervision.** Ni coordinateur, ni promotion, ni file de candidats. Le paquet mesure, propose et refuse ; chaque changement de la mémoire est un commit fait par quelqu’un, et aucun changement de classement n’entre sans passer par le banc d’évaluation.',
    ],
    technicalLink: 'Mécanismes, modèle de menaces et correspondance avec la recherche : [Technical design](%TECHNICAL%).',
    boundaryItems: [
      '**Local par défaut.** Le classement ne lit que les fichiers du dépôt et les snapshots locaux : aucun appel LLM, aucune requête réseau, aucune facture d’API de récupération. Les extraits livrés occupent tout de même le contexte de l’agent, dans la limite du budget configuré.',
      '**La télémétrie reste sur la machine.** Les événements d’exécution vivent dans un dossier ignoré par Git et expirent au bout de trente jours. La passe quotidienne (`ownmem daily`) réduit chaque journée terminée à un paquet de compteurs, sans texte de requête, corps de sujet ni chemin de fichier. Faute d’échantillon, l’interface affiche « indisponible », jamais 0 %.',
      '**Le texte rappelé est traité comme une donnée.** Il ne peut ni prendre le pas sur les instructions du host ni autoriser un outil, et l’auto-attribution d’un agent ne vaut jamais confirmation de l’utilisateur.',
      '**Les échecs restent visibles.** Une entrée au contenu non signé ou à la cible de preuve invérifiable n’est pas livrée ; la dérive de preuve la fait passer en advisory et dit ce qui a bougé.',
      '**Pas de secrets.** Secrets et données personnelles ou de production interdits dans Git le sont aussi dans la mémoire.',
    ],
    fitHeader: ['OwnMem convient', 'Préférer un autre système'],
    fitRows: [
      ['Le savoir doit être relu et migrer avec le code.', 'Il faut un profil personnel ou une mémoire globale entre dépôts.'],
      ['Plusieurs agents alternent sur un même dépôt.', 'Toute conversation doit être capturée sans limite de preuve ni de risque.'],
      ['Le rappel local et reproductible sans facture d’API de retrieval compte.', 'Il faut une recherche vectorielle cloud massive ou un graphe mondial temps réel.'],
      ['Une mauvaise mémoire doit être traçable, rejetable et réversible.', 'Le volume prime sur la gouvernance.'],
    ],
    researchSummary: 'Filiation scientifique',
    researchIntro: 'OwnMem ne revendique pas ces fondations. Sa contribution est leur composition en protocole exécutable pour la mémoire de dépôt :',
    researchItems: [
      `**Mémoire agent et réflexion :** ${COMMON.links.reflexion}, ${COMMON.links.memgpt}`,
      `**Empoisonnement de mémoire et de connaissances :** ${COMMON.links.agentPoison}, ${COMMON.links.poisonedRag}`,
      `**Données non fiables séparées de l’autorité :** ${COMMON.links.camel}`,
      `**Provenance indépendante :** ${COMMON.links.intoto}`,
      `**Prédiction sélective et abstention :** ${COMMON.links.selective}`,
      `**Validation par ablation :** ${COMMON.links.metamorphic}`,
      `**Évaluation décomposée du retrieval :** ${COMMON.links.ares}, ${COMMON.links.ragchecker}`,
    ],
    researchAfter: 'Ces citations indiquent une filiation ; elles ne signifient ni que ces travaux implémentent OwnMem ni qu’OwnMem reproduit leurs expériences.',
    docsHeader: ['Document', 'Contenu'],
    docsRows: [['architecture', 'Frontières, snapshots, confiance et livraison'], ['technical', 'Mécanismes, menaces et recherche'], ['plugins', 'Installation par host, plugins et étapes de confiance'], ['updating', 'Mise à jour sûre et migrations de version'], ['privacy', 'Données locales et canaux optionnels'], ['changelog', 'Historique des versions'], ['contributing', 'Signaler un problème et proposer des changements'], ['security', 'Signaler une vulnérabilité'], ['license', 'Apache-2.0']],
    closing: 'OwnMem est open source. Les issues et pull requests reproductibles sont bienvenues.',
  },
  de: {
    subtitle: 'Git-natives Gedächtnis für KI-Coding-Agents',
    tagline: 'Projektgedächtnis für Coding Agents im Repository: lokal, deterministisch, reviewbar und nie ohne deinen Commit geschrieben.',
    headings: ['Warum OwnMem', 'Im Vergleich', 'Schnellstart', 'Tägliche Nutzung', 'So funktioniert es', 'Datenschutz und Grenzen', 'Wann es passt', 'Dokumentation'],
    whyIntro: 'Die meisten Memory-Systeme optimieren „mehr erinnern“. OwnMem fragt zuerst: **Wem gehört Projektwissen, wer darf es ändern und wie stoppen wir eine falsche Erinnerung, bevor sie Agent-Aktionen beeinflusst?**',
    whyHeader: ['Vorteil', 'Praktische Bedeutung'],
    benchmarkAlt: 'Öffentlicher OwnMem-Benchmark: Recall@1 von 100 % bei 128 Abfragen in 40 Sprachen, gegenüber 3,9 % für grep -F auf demselben Korpus; Abruflatenz 0,46 ms (P50) und 1,05 ms (P95) aus 4.200 Stichproben, unter dem Release-Gate von 5 ms; MRR 1,000, Enthaltung bei allen 40 themenfremden Abfragen, keine Modell- oder Netzwerkaufrufe, zwei Laufzeitabhängigkeiten.',
    benchmarkCaption: 'Gemessen auf dem festgeschriebenen CC0-Korpus dieses Repositorys. Reproduzierbar in einem Klon mit `npm run benchmark`.',
    whyRows: [
      ['**Das Repository besitzt das Memory**', 'Lesbares Markdown in `.ownmem/` reist beim Clone, Review und Rollback mit dem Code, und jeder Agent im Repository liest dieselbe Quelle.'],
      ['**Deterministischer lokaler Recall**', 'Kein Modell, kein Netzwerk; gleiche Query, Config und Snapshot ergeben dieselbe Rangfolge.'],
      ['**Evidenz vor Autorität**', 'Text kann sich nicht selbst vertrauenswürdig nennen; unabhängige Receipts und Live-Prüfung entscheiden.'],
      ['**Es sagt, wenn es nichts weiß**', 'Die Auslieferung ist abgestuft: die zitierte Erinnerung, bis zu drei Verweise, oder eine Enthaltung mit dem Gate, das abgelehnt hat.'],
      ['**Netto-Null-Wachstum**', 'Die Anzahl der Einträge kann nur sinken: Wer einem vollen Korpus etwas hinzufügt, mustert im selben Schritt etwas aus.'],
    ],
    differsIntro: 'OwnMem ersetzt weder `CLAUDE.md` noch `AGENTS.md`. Diese Dateien sagen, wie hier gearbeitet wird, und werden in jedem Turn vollständig gelesen. OwnMem beantwortet eine andere Frage: Was von dem, was dieses Projekt schmerzhaft gelernt hat, gehört **für diese Aufgabe** vor das Modell — und es darf „nichts davon“ antworten.',
    differsHeader: ['', 'Anweisungsdateien', 'Eingebautes Agent-Gedächtnis', 'OwnMem'],
    differsRows: [
      ['Wer schreibt es', 'du, von Hand', 'der Agent, aus euren Gesprächen', 'du, reviewt wie Code'],
      ['Wo es liegt', 'eine Datei im Repository', 'im Konto des Anbieters', 'Markdown in deinem Repository'],
      ['Was beim Modell ankommt', 'alles, in jedem Turn', 'was sein eigener Recall ausgewählt hat', 'eine von drei Stufen, innerhalb eines Token-Budgets'],
      ['Wenn ein Eintrag falsch ist', 'du änderst die Datei', 'du siehst den Eintrag womöglich nie', 'Evidenzdrift stuft ihn herab und nennt, was sich bewegt hat'],
      ['Kosten pro Turn', 'die ganze Datei in Tokens', 'ein Retrieval-Aufruf', 'kein Modellaufruf, kein Netzwerk'],
    ],
    quickIntro: 'Erfordert Node.js 20.6 oder neuer. Im Repository ausführen, das das Memory besitzen soll:',
    quickAfter: 'Öffne danach den Agenten neu. Nenne in `--hosts` die Hosts, die du nutzt (`claude`, `codex`, `cursor`, `gemini`, `grok`); die Liste wird gespeichert, und willst du später einen Host hinzufügen oder entfernen, übergib sie einfach erneut. `init` legt `.ownmem/` und die Host-Adapter an, ändert Anweisungsdateien wie `CLAUDE.md` nur innerhalb verwalteter Blöcke und gibt jeden einmaligen Schritt aus, der einem Host noch fehlt. Mit `--check` am selben Befehl siehst du vorab, was passiert; mit `--locale auto` werden die generierten Anweisungen in deiner Systemsprache geschrieben.',
    hostsHeader: ['Host', 'Wie der Abruf ausgelöst wird', 'Einrichtung'],
    hostsRows: [
      ['Claude Code', 'Ein Hook vor jedem Edit und Write, dazu auf Anfrage', '`claude`'],
      ['Codex', 'Ein Hook vor jedem Patch, den Codex anwendet, dazu auf Anfrage', '`codex`; die Hooks brauchen drei einmalige Vertrauensschritte, die `init` ausgibt'],
      ['Grok CLI', 'Liest die Hook-Konfiguration von Claude Code über seine Kompatibilitätsschicht', '`grok`, zusammen mit `claude`, wenn du beide nutzt; markiere den Ordner einmal mit `/hooks-trust` als vertrauenswürdig'],
      ['Cursor', 'Eine immer aktive Regel oder der MCP-Server', '`cursor`; der MCP-Server braucht einen manuellen Schritt, siehe [Plugins](%PLUGINS%)'],
      ['Gemini CLI', 'Anweisungen oder der MCP-Server', '`gemini`; der MCP-Server braucht einen manuellen Schritt, siehe [Plugins](%PLUGINS%)'],
    ],
    upgradeNote: '> **⚠️ Update von 0.6.0?** Aktualisiere das Paket mit `npm install --save-dev ownmem@latest` und führe dann vor allem anderen `npx ownmem init --update` aus. 0.6.0 hat Hooks installiert, deren Unterbefehle es nicht mehr gibt; eine Installation, die sie behält, startet bei jedem Bash-Aufruf einen fehlschlagenden Befehl. Das Update entfernt sie und rührt selbst geschriebene Hooks nie an. [Updating](%UPDATING%) beschreibt den Rest, einschließlich des Aufräumens von `core.hooksPath`.',
    dailyIntro: 'Arbeite einfach in normaler Sprache weiter. Dein Agent entwirft eine Erinnerung, wenn du darum bittest, und du prüfst sie wie Code:',
    rememberQuote: '> „Merke dir: Das Staging-Timeout kommt vom Pool-Cap, nicht von zu wenigen Workern. Prüfe nächstes Mal beides.“',
    recallQuote: '> „Bevor du das änderst, prüfe, ob das Projektgedächtnis denselben Fehler kennt.“',
    demoIntro: 'Der Abruf antwortet in einer von drei Stufen: die zitierte Erinnerung, bis zu drei Verweise zum Nachlesen oder eine Enthaltung. Ein echter Lauf:',
    demoAfter: 'Vertrauen wird ausgewiesen, nicht unterstellt. Diesen Eintrag stützt noch nichts – kein Review hat ihn bestätigt, und er verweist weder auf ein Autoritätsdokument noch auf einen Code-Anker –, deshalb kommt er als Hinweis zum Nachprüfen an, nicht als feststehende Tatsache.',
    commandsIntro: 'Die Befehle, die du selbst brauchst:',
    consoleAlt: 'Die lokale OwnMem-Konsole: der bekannte Rest an Fehlauslieferungen als Leitkennzahl, daneben der Abruftrichter, darunter der Zustand von Korpus und Evidenz, dazu die Navigation zu Leistung, Qualität, Governance und semantischem Abruf.',
    mcpNote: '`ownmem mcp` ist für Hosts ohne Hooks gedacht. Er bietet genau zwei Werkzeuge, `recall` und `read`, und keines kann eine Erinnerung ändern; die Gate-Befehle (`audit`, `trust`, `compile`) und alle Schreibvorgänge am Gedächtnis sind über diese Schnittstelle nicht erreichbar. Wie du ihn so registrierst, dass die im Projekt installierte Kopie läuft, steht unter [Plugins](%PLUGINS%).',
    architectureAlt: 'OwnMem-Architektur: Repository-eigenes Markdown und unabhängige Trust Receipts werden zu unveränderlichen Snapshots kompiliert; deterministischer lokaler Recall passiert vier Auslieferungstore und kommt in einer von drei Stufen an — die zitierte Erinnerung, bis zu drei Verweise oder eine Enthaltung mit Begründung — während lokale Feedback-Register, ein Evaluationsstand und eine Netto-Null-Quote begrenzen, wozu der Korpus wird.',
    architectureItems: [
      '**Das Repository ist die Quelle.** L1-Routing, L2-Indizes und L3-Topics sind reviewbares Markdown; Trust Receipts stehen außerhalb des autorisierten Textes.',
      '**Erst kompilieren, dann erinnern.** Schema-, Graph-, Lifecycle- und Evidenz-Gates erzeugen einen inhaltsadressierten, unveränderlichen Snapshot. Fünf deterministische Kanäle – exact, BM25F, n-gram, fuzzy und graph – werden lokal fusioniert; embedding ist ein optionaler sechster Kanal mit Gewicht 0 bis zum lokalen A/B-Nachweis.',
      '**Vier Gates, drei Stufen.** Relevanz, epistemische Gültigkeit, Anwendbarkeit auf die Aufgabe und Handlungsrisiko lehnen jeweils aus eigenem Grund ab. Über einem Schwellwert aus einer Ablationskurve wird die Erinnerung zitiert; darunter kommen bis zu drei Verweise, die ausdrücklich keine Antwort sind; ohne geeigneten Kandidaten eine Enthaltung, die das ablehnende Gate nennt.',
      '**Keine unbeaufsichtigten Schreibvorgänge.** Kein Koordinator, keine Promotion, keine Kandidatenschlange. Das Paket misst, schlägt vor und lehnt ab; jede Änderung am Gedächtnis ist ein Commit, den ein Mensch macht, und keine Ranking-Änderung landet ohne den Evaluationsstand.',
    ],
    technicalLink: 'Mechanismen, Bedrohungsmodell und Forschungsbezug: [Technical design](%TECHNICAL%).',
    boundaryItems: [
      '**Standardmäßig lokal.** Das Ranking liest nur Repository-Dateien und lokale Snapshots: keine LLM-Aufrufe, keine Netzwerkanfragen, keine Retrieval-API-Rechnung. Gelieferte Auszüge belegen weiterhin Platz im Kontextfenster des Agenten, begrenzt durch das konfigurierte Budget.',
      '**Telemetrie bleibt auf dem Rechner.** Laufzeitereignisse liegen in einem von Git ignorierten Ordner und verfallen nach dreißig Tagen. Der tägliche Durchlauf (`ownmem daily`) verdichtet jeden abgeschlossenen Tag zu einem Paket aus reinen Zählwerten, ohne Abfragetext, Topic-Inhalte oder Dateipfade. Fehlende Stichproben erscheinen als „nicht verfügbar“, nie als 0 %.',
      '**Abgerufener Text gilt als Daten.** Er überschreibt keine Host-Anweisungen und autorisiert kein Werkzeug, und die Selbstzuordnung eines Agenten zählt nie als Bestätigung durch den Nutzer.',
      '**Fehler bleiben sichtbar.** Ein Eintrag mit unsigniertem Inhalt oder unprüfbarem Evidenzziel wird zurückgehalten; Evidenzdrift stuft ihn auf advisory herab und nennt, was sich geändert hat.',
      '**Keine Secrets.** Secrets sowie persönliche oder Produktionsdaten, die nicht in Git gehören, gehören auch nicht ins Memory.',
    ],
    fitHeader: ['OwnMem passt', 'Anderes System wählen'],
    fitRows: [
      ['Projektwissen soll mit Code reviewt und migriert werden.', 'Repository-übergreifendes persönliches Profil oder globales User Memory ist nötig.'],
      ['Mehrere Coding Agents wechseln sich in einem Repository ab.', 'Alle Gespräche sollen ohne Evidenz- oder Risikogrenze automatisch gespeichert werden.'],
      ['Lokaler, reproduzierbarer Recall ohne Retrieval-API-Rechnung zählt.', 'Große Cloud-Vektorsuche oder globaler Echtzeitgraph ist nötig.'],
      ['Falsches Memory muss zurechenbar, ablehnbar und reversibel sein.', 'Menge ist wichtiger als Governance.'],
    ],
    researchSummary: 'Forschungsgrundlagen',
    researchIntro: 'OwnMem beansprucht diese Grundlagen nicht als Erfindung. Der Beitrag ist ihre Kombination zu einem ausführbaren Protokoll für Repository Memory:',
    researchItems: [
      `**Agent Memory und Reflexion:** ${COMMON.links.reflexion}, ${COMMON.links.memgpt}`,
      `**Memory- und Wissens-Poisoning:** ${COMMON.links.agentPoison}, ${COMMON.links.poisonedRag}`,
      `**Untrusted Data getrennt von Authority:** ${COMMON.links.camel}`,
      `**Unabhängige Provenance:** ${COMMON.links.intoto}`,
      `**Selektive Vorhersage und Abstention:** ${COMMON.links.selective}`,
      `**Validierung durch Ablation:** ${COMMON.links.metamorphic}`,
      `**Zerlegte Retrieval-Evaluation:** ${COMMON.links.ares}, ${COMMON.links.ragchecker}`,
    ],
    researchAfter: 'Die Zitate zeigen die Forschungslinie; sie bedeuten weder, dass diese Arbeiten OwnMem implementieren, noch dass OwnMem ihre Experimente reproduziert.',
    docsHeader: ['Dokument', 'Inhalt'],
    docsRows: [['architecture', 'Grenzen, Snapshots, Trust und Auslieferung'], ['technical', 'Mechanismen, Bedrohungen und Forschung'], ['plugins', 'Einrichtung pro Host, Plugins und Vertrauensschritte'], ['updating', 'Sicheres Update und Versionsmigrationen'], ['privacy', 'Lokale Daten und optionale Kanäle'], ['changelog', 'Versionsverlauf'], ['contributing', 'Issues melden und Änderungen einreichen'], ['security', 'Sicherheitslücken melden'], ['license', 'Apache-2.0']],
    closing: 'OwnMem ist Open Source. Reproduzierbare Issues und Pull Requests sind willkommen.',
  },
  'pt-BR': {
    subtitle: 'Memória nativa do Git para agentes de programação com IA',
    tagline: 'Memória de projeto para agentes de programação no repositório: local, determinística, revisável e nunca escrita sem o seu commit.',
    headings: ['Por que o OwnMem', 'Comparação', 'Início rápido', 'Uso diário', 'Como funciona', 'Privacidade e limites', 'Quando usar', 'Documentação'],
    whyIntro: 'A maioria dos sistemas otimiza “lembrar mais”. O OwnMem começa por outra pergunta: **quem possui o conhecimento do projeto, quem pode alterá-lo e como impedir uma memória errada antes que ela mude as ações do agente?**',
    whyHeader: ['Vantagem', 'O que significa na prática'],
    benchmarkAlt: 'Benchmark público do OwnMem: Recall@1 de 100% em 128 consultas em 40 idiomas, contra 3,9% do grep -F no mesmo corpus; latência de recall de 0,46 ms no P50 e 1,05 ms no P95 em 4.200 amostras, abaixo do limite de publicação de 5 ms; MRR 1,000, abstenção nas 40 consultas não relacionadas, nenhuma chamada de modelo ou de rede e duas dependências de execução.',
    benchmarkCaption: 'Medido no corpus CC0 fixado neste repositório. Para reproduzir, rode `npm run benchmark` em um clone.',
    whyRows: [
      ['**A memória pertence ao repositório**', 'Markdown legível em `.ownmem/` acompanha o código em clone, revisão e rollback, e todos os agentes do repositório leem a mesma fonte.'],
      ['**Recall local e determinístico**', 'Sem modelo ou rede; mesma consulta, configuração e snapshot geram a mesma ordem.'],
      ['**Evidência antes da autoridade**', 'O conteúdo não pode se declarar confiável; receipts independentes e evidência viva decidem.'],
      ['**Diz quando não sabe**', 'A entrega é em níveis: a memória citada, até três ponteiros, ou uma abstenção que nomeia o portão que recusou.'],
      ['**Crescimento líquido zero**', 'O número de entradas só diminui: acrescentar a um corpus cheio obriga a aposentar algo na mesma mudança.'],
    ],
    differsIntro: 'O OwnMem não substitui `CLAUDE.md` nem `AGENTS.md`. Esses arquivos dizem como se trabalha aqui e são lidos por inteiro a cada turno. O OwnMem responde a outra pergunta: de tudo o que este projeto aprendeu na marra, o que vale colocar diante do modelo **para esta tarefa** — e ele tem o direito de responder “nada”.',
    differsHeader: ['', 'Arquivos de instruções', 'Memória embutida do agente', 'OwnMem'],
    differsRows: [
      ['Quem escreve', 'você, à mão', 'o agente, a partir das suas conversas', 'você, revisado como código'],
      ['Onde vive', 'um arquivo no repositório', 'a conta do fornecedor', 'Markdown no seu repositório'],
      ['O que chega ao modelo', 'tudo, a cada turno', 'o que o recall dele escolheu', 'um de três níveis, sob um orçamento de tokens'],
      ['Quando uma entrada está errada', 'você edita o arquivo', 'talvez você nunca veja aquela entrada', 'o drift de evidência a rebaixa e diz o que mudou'],
      ['Custo por turno', 'o arquivo inteiro em tokens', 'uma chamada de recuperação', 'nenhuma chamada de modelo nem de rede'],
    ],
    quickIntro: 'Requer Node.js 20.6 ou mais recente. Execute no repositório que deve possuir a memória:',
    quickAfter: 'Depois, reabra o agente. Liste em `--hosts` os hosts que você usa (`claude`, `codex`, `cursor`, `gemini`, `grok`); a lista fica registrada, e para adicionar ou remover um host depois basta passá-la de novo. O `init` cria `.ownmem/` e os adaptadores de cada host, em arquivos de instruções como `CLAUDE.md`, só altera o que está dentro de blocos gerenciados e mostra qualquer etapa de configuração, feita uma única vez, que ainda falte para um host. Adicione `--check` ao mesmo comando para ver antes o que ele faz, e `--locale auto` para gerar as instruções no idioma do sistema.',
    hostsHeader: [
      'Host',
      'Como o recall acontece',
      'Configuração',
    ],
    hostsRows: [
      ['Claude Code', 'Um hook antes de cada Edit e Write, e quando você pedir', '`claude`'],
      ['Codex', 'Um hook antes de cada patch que ele aplica, e quando você pedir', '`codex`; os hooks exigem três passos de confiança feitos uma única vez, que o `init` mostra'],
      ['Grok CLI', 'Lê a configuração de hooks do Claude Code pela sua camada de compatibilidade', '`grok`, junto com `claude` se você usa os dois; marque a pasta como confiável uma vez com `/hooks-trust`'],
      ['Cursor', 'Uma regra sempre aplicada ou o servidor MCP', '`cursor`; o servidor MCP exige um passo manual, veja [Plugins](%PLUGINS%)'],
      ['Gemini CLI', 'Instruções ou o servidor MCP', '`gemini`; o servidor MCP exige um passo manual, veja [Plugins](%PLUGINS%)'],
    ],
    upgradeNote: '> **⚠️ Vindo do 0.6.0?** Atualize o pacote com `npm install --save-dev ownmem@latest` e, antes de qualquer outra coisa, rode `npx ownmem init --update`. O 0.6.0 instalou hooks cujos subcomandos não existem mais, então uma instalação que os mantém executa um comando que falha a cada chamada de Bash. A atualização os remove e nunca mexe nos hooks que você mesmo escreveu. [Updating](%UPDATING%) explica o resto, incluindo a limpeza do `core.hooksPath`.',
    dailyIntro: 'Continue trabalhando em linguagem natural. Seu agente rascunha uma memória quando você pedir, e você a revisa como código:',
    rememberQuote: '> “Lembre: o timeout de staging vem do limite do pool, não de poucos workers. Verifique os dois na próxima vez.”',
    recallQuote: '> “Antes de mudar, veja se a memória do projeto já encontrou a mesma falha.”',
    demoIntro: 'O recall responde em um de três níveis: a memória citada, até três ponteiros para ir ler ou uma abstenção. Uma execução real:',
    demoAfter: 'A confiança é declarada, não presumida. Nada sustenta esta entrada ainda — nenhuma revisão a confirmou e ela não cita documento de autoridade nem âncora de código —, então ela chega como uma pista a verificar de novo, não como um fato estabelecido.',
    commandsIntro: 'Os comandos que você mesmo vai usar:',
    consoleAlt: 'O console local do OwnMem: o resíduo conhecido de entregas erradas como número principal, o funil de buscas ao lado, a saúde do corpus e das evidências abaixo e a navegação para desempenho, qualidade, governança e recuperação semântica.',
    mcpNote: '`ownmem mcp` existe para hosts sem hooks. Ele expõe exatamente duas ferramentas, `recall` e `read`, e nenhuma pode alterar uma memória; os comandos de controle (`audit`, `trust`, `compile`) e qualquer escrita de memória não ficam acessíveis por essa via. [Plugins](%PLUGINS%) mostra como registrá-lo para que rode a cópia instalada no projeto.',
    architectureAlt: 'Arquitetura do OwnMem: Markdown pertencente ao repositório e trust receipts independentes são compilados em snapshots imutáveis; o recall local determinístico passa por quatro portões de entrega e chega em um de três níveis — a memória citada, até três ponteiros, ou uma abstenção que diz o motivo — enquanto os livros de feedback local, o banco de avaliação e uma cota de crescimento líquido zero limitam no que o corpus se torna.',
    architectureItems: [
      '**O repositório é a fonte.** Rotas L1, índices L2 e tópicos L3 são Markdown revisável; trust receipts ficam fora do texto autorizado.',
      '**Compile antes do recall.** Os portões de schema, grafo, ciclo de vida e evidência geram um snapshot imutável endereçado por conteúdo. Cinco canais determinísticos — exact, BM25F, n-gram, fuzzy e graph — são fundidos localmente; embedding é um sexto canal opcional com peso 0 até ser aprovado na avaliação A/B local.',
      '**Quatro portões, três níveis.** Relevância, validade epistêmica, aplicabilidade à tarefa e risco da ação recusam cada um por motivo próprio. Acima de um limiar tirado de uma curva de ablação, a memória é citada; abaixo dele, até três ponteiros que explicitamente não são respostas; sem candidato apto, uma abstenção que nomeia o portão que recusou.',
      '**Nenhuma escrita sem supervisão.** Não há coordenador, nem promoção, nem fila de candidatos. O pacote mede, propõe e recusa; cada mudança na memória é um commit que alguém faz, e nenhuma mudança de ranking entra sem passar pelo banco de avaliação.',
    ],
    technicalLink: 'Mecanismos, modelo de ameaças e relação com a pesquisa: [Technical design](%TECHNICAL%).',
    boundaryItems: [
      '**Local por padrão.** O ranking lê apenas arquivos do repositório e snapshots locais: zero chamadas LLM, zero requisições de rede e nenhuma cobrança de API de recuperação. Os trechos entregues ainda usam o contexto do agente, dentro do orçamento configurado.',
      '**A telemetria não sai da máquina.** Eventos de execução ficam em um diretório ignorado pelo Git e expiram em trinta dias. A rotina diária (`ownmem daily`) reduz cada dia encerrado a um pacote de contagens sem texto de consulta, corpo dos tópicos ou caminhos de arquivo. Sem amostras, aparece “indisponível”, nunca 0%.',
      '**Texto recuperado é tratado como dado.** Ele não se sobrepõe às instruções do host nem autoriza ferramentas, e a autoatribuição de um agente nunca conta como confirmação do usuário.',
      '**Falhas ficam visíveis.** Uma entrada com conteúdo não assinado ou alvo de evidência não verificável fica retida; o drift de evidência a rebaixa para advisory e diz o que mudou.',
      '**Nada de segredos.** Segredos e dados pessoais ou de produção que não pertencem ao Git também não pertencem à memória.',
    ],
    fitHeader: ['OwnMem é adequado', 'Prefira outro sistema'],
    fitRows: [
      ['O conhecimento deve ser revisado e migrar com o código.', 'Você precisa de perfil pessoal ou memória global entre repositórios.'],
      ['Vários agentes se alternam em um repositório.', 'Você quer capturar toda conversa sem limites de evidência ou risco.'],
      ['Recall local e reproduzível sem cobrança de API de recuperação importa.', 'Você precisa de busca vetorial cloud em escala ou grafo global em tempo real.'],
      ['Memória errada deve ser atribuível, rejeitável e reversível.', 'Quantidade importa mais que governança.'],
    ],
    researchSummary: 'Fundamentos de pesquisa',
    researchIntro: 'O OwnMem não reivindica essas bases como invenções. Sua contribuição é combiná-las em um protocolo executável para memória de repositório:',
    researchItems: [
      `**Memória de agentes e reflexão:** ${COMMON.links.reflexion}, ${COMMON.links.memgpt}`,
      `**Poisoning de memória e conhecimento:** ${COMMON.links.agentPoison}, ${COMMON.links.poisonedRag}`,
      `**Dados não confiáveis separados da autoridade:** ${COMMON.links.camel}`,
      `**Proveniência independente:** ${COMMON.links.intoto}`,
      `**Predição seletiva e abstenção:** ${COMMON.links.selective}`,
      `**Validação por ablação:** ${COMMON.links.metamorphic}`,
      `**Avaliação de retrieval decomposta:** ${COMMON.links.ares}, ${COMMON.links.ragchecker}`,
    ],
    researchAfter: 'As citações mostram a linhagem; não significam que esses trabalhos implementem o OwnMem nem que o OwnMem reproduza seus experimentos.',
    docsHeader: ['Documento', 'Conteúdo'],
    docsRows: [['architecture', 'Limites, snapshots, confiança e entrega'], ['technical', 'Mecanismos, ameaças e pesquisa'], ['plugins', 'Configuração por host, plugins e passos de confiança'], ['updating', 'Atualização segura e migrações de versão'], ['privacy', 'Dados locais e canais opcionais'], ['changelog', 'Histórico de versões'], ['contributing', 'Como reportar issues e enviar mudanças'], ['security', 'Como reportar uma vulnerabilidade'], ['license', 'Apache-2.0']],
    closing: 'OwnMem é código aberto. Issues e pull requests reproduzíveis são bem-vindos.',
  },
};

const DOCUMENT_LABELS = {
  architecture: 'Architecture', technical: 'Technical design', plugins: 'Plugins', updating: 'Updating',
  privacy: 'Privacy', changelog: 'Changelog', contributing: 'Contributing', security: 'Security', license: 'License',
};

// One icon per section, shared by every locale so the nine READMEs keep an identical outline.
const HEADING_ICONS = ['✨', '🆚', '🚀', '💬', '🧩', '🔒', '🧭', '📚'];

// Anchors that do not depend on the icon or the translation. The icon makes GitHub's own slug start
// with a hyphen (#-quick-start), so each section also carries a plain English name that is the same
// in every locale, plus the slugs the English README published before its sections were merged, so
// deep links written against 0.6.0 still land on the section that absorbed them.
const SECTION_ANCHORS = [
  ['why-ownmem'],
  ['how-it-compares', 'how-this-differs-from-claudemd-and-built-in-memory'],
  ['quick-start'],
  ['daily-use'],
  ['how-it-works', 'architecture', 'how-ownmem-governs-ai-agent-memory'],
  ['privacy-and-boundaries', 'trust-and-automation-boundary', 'local-first-by-default', 'telemetry-and-the-daily-pass'],
  ['when-to-use-it', 'where-it-fits'],
  ['documentation', 'research-lineage'],
];

function table(header, rows) {
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n');
}

function list(items) {
  return items.map(item => `- ${item}`).join('\n');
}

function relativeLink(fromFile, toFile) {
  const relative = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return relative.startsWith('../') ? relative : `./${relative}`;
}

function languageSwitcher(currentFile) {
  return LANGUAGES.map(([, label, file]) => file === currentFile ? `**${label}**` : `[${label}](${relativeLink(currentFile, file)})`).join(' · ');
}

function documentTargets(file, locale) {
  const targets = {
    architecture: 'docs/ARCHITECTURE.md',
    technical: locale === 'zh-CN' ? 'docs/i18n/TECHNICAL.zh-CN.md' : 'docs/TECHNICAL.md',
    plugins: 'docs/PLUGINS.md',
    updating: 'docs/UPDATING.md',
    privacy: 'docs/PRIVACY.md',
    changelog: 'CHANGELOG.md',
    contributing: '.github/CONTRIBUTING.md',
    security: '.github/SECURITY.md',
    license: 'LICENSE',
  };
  return Object.fromEntries(Object.entries(targets).map(([key, target]) => [key, relativeLink(file, target)]));
}

// Prose links are written as %PLUGINS% and resolved per file, because the English README and the
// docs/i18n/ translations reach the same document through different relative paths. Only the known
// document keys are replaced, and any %word% left in the prose afterwards is a misspelt placeholder;
// fenced code is skipped so a shell variable such as %APPDATA% can appear there verbatim.
function resolveLinks(page, docs, locale) {
  const known = new RegExp(`%(${Object.keys(docs).map(key => key.toUpperCase()).join('|')})%`, 'g');
  const resolved = page.replace(known, (_, key) => docs[key.toLowerCase()]);
  const prose = resolved.split(/^```.*$/m).filter((_, index) => index % 2 === 0).join('\n');
  const leftover = prose.match(/%[A-Za-z]{2,}%/);
  if (leftover) throw new Error(`${locale}: unknown document placeholder ${leftover[0]}`);
  return resolved;
}

function render(locale, file) {
  const t = COPY[locale];
  const assetBase = relativeLink(file, 'docs/assets').replace(/\/$/, '');
  const docs = documentTargets(file, locale);
  const heading = index => `## ${SECTION_ANCHORS[index].map(name => `<a name="${name}"></a>`).join('')}${HEADING_ICONS[index]} ${t.headings[index]}`;
  const suffix = locale === 'en' ? '' : `-${locale}`;
  const docRows = t.docsRows.map(([key, purpose]) => {
    if (!DOCUMENT_LABELS[key] || !docs[key]) throw new Error(`${locale}: unknown document key ${key}`);
    return [`[${DOCUMENT_LABELS[key]}](${docs[key]})`, purpose];
  });
  if (t.headings.length !== HEADING_ICONS.length) throw new Error(`${locale}: expected ${HEADING_ICONS.length} headings`);
  return resolveLinks(`<div align="center">

# OwnMem

**${t.subtitle}**

${t.tagline}

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![npm downloads](https://img.shields.io/npm/dm/ownmem?style=flat-square&logo=npm&color=555)](https://www.npmjs.com/package/ownmem)
[![GitHub stars](https://img.shields.io/github/stars/grpcer/ownmem?style=flat-square&logo=github&color=e3b341)](https://github.com/grpcer/ownmem/stargazers)
[![release gates](https://img.shields.io/github/actions/workflow/status/grpcer/ownmem/ci.yml?branch=main&style=flat-square&label=release%20gates)](https://github.com/grpcer/ownmem/actions/workflows/ci.yml)
[![node >= 20.6](https://img.shields.io/badge/node-%E2%89%A5%2020.6-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](${docs.license})

${languageSwitcher(file)}

</div>

${heading(0)}

${t.whyIntro}

${table(t.whyHeader, t.whyRows)}

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="${assetBase}/benchmark-dark.svg">
  <img alt="${t.benchmarkAlt}" src="${assetBase}/benchmark-light.svg" width="100%">
</picture>

<sub>${t.benchmarkCaption}</sub>

${heading(1)}

${t.differsIntro}

${table(t.differsHeader, t.differsRows)}

${heading(2)}

${t.quickIntro}

${COMMON.install}

${t.quickAfter}

${table(t.hostsHeader, t.hostsRows)}

${t.upgradeNote}

${heading(3)}

${t.dailyIntro}

${t.rememberQuote}

${t.recallQuote}

${t.demoIntro}

${COMMON.demo}

${t.demoAfter}

${t.commandsIntro}

${COMMON.commands}

<img alt="${t.consoleAlt}" src="${assetBase}/console.png" width="100%">

${t.mcpNote}

${heading(4)}

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="${assetBase}/architecture${suffix}-dark.svg">
  <img alt="${t.architectureAlt}" src="${assetBase}/architecture${suffix}-light.svg" width="100%">
</picture>

${list(t.architectureItems)}

${t.technicalLink}

${heading(5)}

${list(t.boundaryItems)}

${heading(6)}

${table(t.fitHeader, t.fitRows)}

${heading(7)}

${table(t.docsHeader, docRows)}

<details>
<summary><b>${t.researchSummary}</b></summary>

${t.researchIntro}

${list(t.researchItems)}

${t.researchAfter}

</details>

${t.closing}
`, docs, locale);
}

for (const [locale, , file] of LANGUAGES) {
  if (!COPY[locale]) continue;
  const output = path.join(ROOT, file);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, render(locale, file), 'utf8');
  process.stdout.write(`wrote ${file}\n`);
}
