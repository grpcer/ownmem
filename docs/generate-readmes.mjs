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
npx ownmem init --locale auto --hosts claude,codex --layers dashboard --hook
\`\`\``,
  evolution: `\`\`\`bash
npx ownmem dashboard --open
npx ownmem evolve status
npx ownmem evolve run --force
\`\`\``,
  links: {
    agentPoison: '[AgentPoison (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html)',
    poisonedRag: '[PoisonedRAG (USENIX Security 2025)](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)',
    camel: '[CaMeL: Defeating Prompt Injections by Design (2025)](https://arxiv.org/abs/2503.18813)',
    intoto: '[in-toto (USENIX Security 2019)](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)',
    selective: '[Selective Classification (JMLR 2010)](https://jmlr.org/papers/v11/el-yaniv10a.html)',
    metamorphic: '[Metamorphic Testing (1998)](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf)',
    sagas: '[Sagas (SIGMOD 1987)](https://doi.org/10.1145/38713.38742)',
    ares: '[ARES (NAACL 2024)](https://aclanthology.org/2024.naacl-long.20/)',
    ragchecker: '[RAGChecker (2024)](https://arxiv.org/abs/2408.08067)',
    memgpt: '[MemGPT (2023)](https://arxiv.org/abs/2310.08560)',
    reflexion: '[Reflexion (NeurIPS 2023)](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html)',
  },
};

const COPY = {
  en: {
    tagline: 'Repository-owned memory for AI coding agents — local, deterministic, reviewable, and safely self-improving.',
    chips: '`Git-native` · `local recall` · `multi-agent` · `evidence-governed` · `Apache-2.0`',
    headings: ['Why OwnMem', 'Architecture', 'What is different in 0.3', 'Quick start', 'Daily use', 'Trust and automation boundary', 'Where it fits', 'Local-first by default', 'Research lineage', 'Documentation'],
    whyIntro: 'Most memory systems optimize for remembering more. OwnMem starts with a different question: **who owns project knowledge, who may change it, and how can a bad memory be stopped before it changes an agent\'s actions?**',
    whyHeader: ['Advantage', 'What it means in practice'],
    whyRows: [
      ['**The repository owns memory**', 'Readable Markdown in `.ownmem/` travels through clone, review, and rollback with the code.'],
      ['**One memory serves many agents**', 'Claude Code, Codex, Cursor, Gemini CLI, Grok CLI, and other hosts share one source of project truth.'],
      ['**Deterministic local recall**', 'Default recall makes no model or network call; the same query, config, and snapshot produce the same ranking.'],
      ['**Evidence before authority**', 'Content cannot declare itself trusted. Independent receipts and live evidence checks decide delivery.'],
      ['**Bounded growth**', 'Schemas, quotas, duplicate gates, lifecycle rules, and audits keep memory from becoming a second abandoned wiki.'],
      ['**Low-risk automation, review for impact**', 'Replay-proven R0 retrieval metadata can evolve unattended; prose, policy, and higher-risk changes cannot.'],
    ],
    architectureAlt: 'OwnMem architecture: repository-owned Markdown and independent trust receipts compile into immutable snapshots; deterministic local recall passes four delivery gates, while a bounded evolution coordinator replays, promotes, observes, quarantines, and precisely rolls back low-risk changes.',
    architectureIntro: 'OwnMem separates writing experience from delivering it to an agent:',
    architectureItems: [
      '**Repository source of truth.** L1 routing, L2 area indexes, and L3 topics remain reviewable Markdown; trust receipts live outside the text they authorize.',
      '**Compile, then recall.** Schema, graph, lifecycle, and evidence gates produce a content-addressed immutable snapshot instead of rereading changing prose at query time.',
      '**Five deterministic candidate lanes.** exact, BM25F, n-gram, fuzzy, and graph are fused locally. Embeddings are an optional sixth lane and stay at weight 0 until local A/B evidence passes.',
      '**Four independent delivery gates.** relevance, epistemic validity, task applicability, and action risk lead to normal delivery, advisory, quarantine, or abstention under a context budget.',
      '**Bounded unattended evolution.** The end-of-turn coordinator may promote only replay-proven, quota-bounded, precisely reversible R0 metadata; R1–R5 becomes review material.',
    ],
    techIntro: 'The differentiator is not one ranking formula. OwnMem 0.3 turns agent memory into a verifiable evolution protocol:',
    techHeader: ['Mechanism', 'OwnMem 0.3'],
    techRows: [
      ['**Evidence-carrying memory**', 'Content hash, evidence root, lifecycle, applicability, risk, and predecessor receipts determine whether text may enter context.'],
      ['**Counterfactual promotion gate**', 'Automation must prove baseline miss, candidate-only recovery, and zero regression on the previously passing corpus.'],
      ['**Risk from change surface**', 'Risk is derived from what changed and what it can affect; an agent cannot downgrade its own proposal.'],
      ['**Content-addressed compensating rollback**', 'Automatic edits carry a verified inverse operation; failures or harmful outcomes restore the exact previous bytes without erasing history.'],
      ['**Memory-poisoning quarantine**', 'Candidates, content, authority, and evidence are separate trust domains; retrieval never grants permission to act.'],
      ['**Selective delivery**', 'Insufficient evidence produces advisory, quarantine, or abstention instead of invented confidence.'],
      ['**Immutable compiled snapshots**', 'Markdown, graph edges, ranking identity, and trust state become one reproducible runtime input.'],
      ['**Three anti-pollution ledgers**', 'Retrieval correctness, user/host-confirmed outcomes, and agent self-attribution never impersonate one another.'],
    ],
    technicalLink: 'Read the detailed [technical design and research mapping](./docs/TECHNICAL.md).',
    quickIntro: 'Requires Node.js 20.6 or newer. Run this inside the repository that should own the memory:',
    quickAfter: 'Reopen the agent after initialization. OwnMem creates `.ownmem/` and edits only managed marker regions in host files. Use `--hosts claude`, `--hosts codex`, `--hosts cursor`, or `--hosts gemini` when only one adapter is needed; preview changes with `npx ownmem init --check`.',
    dailyIntro: 'After setup, keep working in plain language:',
    rememberQuote: '> “Remember this: staging deployment timeouts come from the pool cap, not too few workers. Check both together next time.”',
    recallQuote: '> “Before changing this, check whether the project memory has seen the same failure.”',
    dailyAfter: 'The host recalls before scoped work and schedules one locked, debounced evolution pass at the end of a turn. You normally do not need to chain promotion, trust, audit, or compile commands. Open the local console or inspect the coordinator when you want visibility:',
    trustIntro: 'OwnMem automates the part it can prove, not the part that merely sounds plausible.',
    trustItems: [
      '**Automatic:** deterministic recall, candidate scanning, tripwire checks, counterfactual replay, R0 trigger backfill, machine trust receipt, audit, compile, observation, quarantine, and exact rollback.',
      '**Escalated:** new prose knowledge, policy, active-set changes, conflicts, insufficient evidence, R1–R5 changes, and publishing.',
      '**Hard boundary:** a candidate is not memory; self-attribution is not user confirmation; retrieved text cannot override host instructions or authorize tools.',
      '**Failure behavior:** unsigned content or unverifiable evidence is quarantined; evidence drift becomes advisory; transaction failure restores the prior validated state.',
    ],
    fitHeader: ['Good fit', 'Choose another system when'],
    fitRows: [
      ['A team wants project knowledge reviewed and migrated with code.', 'You need a cross-repository personal profile or global user memory.'],
      ['Several coding agents rotate through one repository.', 'You need to capture every conversation automatically with no evidence or risk boundary.'],
      ['Local, reproducible, zero-query-cost recall matters.', 'You need large-scale cloud vector search or a real-time global knowledge graph.'],
      ['Bad memory must be attributable, rejectable, and reversible.', 'Maximum recall volume matters more than governance.'],
    ],
    localItems: [
      'Default recall reads repository files and local snapshots only: no LLM call, network request, or per-query token cost.',
      'Runtime events stay in a Git-ignored local directory. Missing outcome samples are shown as unavailable, never fabricated as 0%.',
      'Secrets and personal or production data that do not belong in Git do not belong in memory.',
      'The embedding lane is optional and isolated. It joins weighted ranking only after repository-local A/B evidence passes the safety gate.',
    ],
    researchIntro: 'OwnMem does not claim these foundations as inventions. Its contribution is their composition into an executable protocol for repository memory:',
    researchItems: [
      `**Agent memory and reflection:** ${COMMON.links.reflexion}, ${COMMON.links.memgpt}`,
      `**Memory and knowledge-base poisoning:** ${COMMON.links.agentPoison}, ${COMMON.links.poisonedRag}`,
      `**Untrusted data separated from authority:** ${COMMON.links.camel}`,
      `**Independent provenance:** ${COMMON.links.intoto}`,
      `**Selective prediction and abstention:** ${COMMON.links.selective}`,
      `**Differential validation and compensation:** ${COMMON.links.metamorphic}, ${COMMON.links.sagas}`,
      `**Decomposed retrieval evaluation:** ${COMMON.links.ares}, ${COMMON.links.ragchecker}`,
    ],
    researchAfter: 'These citations describe the research lineage; they do not imply that the papers implement OwnMem or that OwnMem reproduces their experiments.',
    docsHeader: ['Document', 'Purpose'],
    docsRows: [['architecture', 'Package boundaries, snapshots, trust, and evolution'], ['technical', 'Mechanisms, threat model, and research mapping'], ['plugins', 'Optional host plugin installation'], ['updating', 'Safe repository updates and 0.2 → 0.3 migration'], ['privacy', 'Local data and optional channel boundaries'], ['changelog', 'Version history'], ['license', 'Apache-2.0']],
    closing: 'OwnMem is open source. Reproducible issues and pull requests are welcome.',
  },
  'zh-CN': {
    tagline: '把 AI 编程 Agent 的项目记忆留在仓库里：本地、确定、可审阅，并能在安全边界内自我改进。',
    chips: '`Git 原生` · `本地召回` · `多 Agent 共用` · `证据治理` · `Apache-2.0`',
    headings: ['为什么是 OwnMem', '总架构', '0.3 到底独特在哪里', '三分钟开始', '日常怎么用', '信任与自动化边界', '适合什么', '默认本地优先', '研究脉络', '文档'],
    whyIntro: '大多数记忆方案先解决“记得更多”。OwnMem 先问另一件事：**项目知识由谁拥有，谁有权改变它，错误记忆怎样在影响 Agent 行动前被拦住？**',
    whyHeader: ['优势', '对实际开发意味着什么'],
    whyRows: [
      ['**记忆归仓库所有**', '记忆是 `.ownmem/` 中可读的 Markdown，随 Git 克隆、评审和回滚。'],
      ['**一份记忆，多 Agent 共用**', 'Claude Code、Codex、Cursor、Gemini CLI、Grok CLI 等宿主共享同一知识源。'],
      ['**默认召回确定且本地**', '不调用模型、不请求网络；相同查询、配置和快照得到相同排序。'],
      ['**先验证证据，再授予 authority**', '正文不能自证可信；独立收据和活体证据核验决定是否交付。'],
      ['**有界增长**', 'Schema、配额、去重、生命周期和审计避免记忆变成第二个没人维护的 Wiki。'],
      ['**低风险自动，高影响复审**', '回放证明有效的 R0 检索元数据可以无人值守；正文、策略和高风险变化不能。'],
    ],
    architectureAlt: 'OwnMem 总架构：仓库拥有的 Markdown 与独立信任收据编译成不可变快照；本地确定性召回经过四道交付门，受限演化协调器则回放、晋升、观察、隔离并精确回滚低风险变化。',
    architectureIntro: 'OwnMem 把“写下经验”和“把经验交给 Agent”分成两个受控流程：',
    architectureItems: [
      '**仓库是真源。** L1 路由、L2 领域索引和 L3 topic 是可审阅 Markdown；信任收据独立于它所授权的正文。',
      '**编译后再召回。** Schema、图关系、生命周期和证据门生成内容寻址的不可变快照，查询期不重读正在变化的正文。',
      '**默认五路确定性候选。** exact、BM25F、n-gram、fuzzy、graph 在本地融合；embedding 是可选第六路，没有 A/B 证据前权重为 0。',
      '**交付前四道门。** 相关性、事实有效性、任务适用性和动作风险共同决定正常交付、advisory、隔离或弃答。',
      '**有界无人值守演化。** 轮末协调器只自动晋升经过回放、受配额约束且可精确撤销的 R0 元数据；R1–R5 进入复审。',
    ],
    techIntro: '差异不在某一个排序公式，而在于 OwnMem 0.3 把 Agent Memory 做成一条可验证的演化协议：',
    techHeader: ['机制', 'OwnMem 0.3 做了什么'],
    techRows: [
      ['**证据携带记忆**', '内容哈希、证据根、生命周期、适用范围、风险和前驱收据共同决定正文能否进入上下文。'],
      ['**反事实晋升门**', '自动化必须证明“改前失败、只因候选改动而恢复、原有通过语料零回归”。'],
      ['**按变更面定风险**', '风险来自改了什么、能影响什么；Agent 不能给自己的提案降级。'],
      ['**内容寻址补偿回滚**', '自动编辑携带可验证逆操作；事务失败或 harmful 结局会恢复原字节，同时保留历史。'],
      ['**记忆投毒隔离**', '候选、正文、authority 与证据处于不同信任域；被检索到从不等于获得行动权限。'],
      ['**选择性交付**', '证据不足时 advisory、隔离或弃答，不伪造置信度。'],
      ['**不可变编译快照**', 'Markdown、图关系、排序身份和信任状态共同成为可复现的运行时输入。'],
      ['**三条反指标污染账**', '检索对错、用户/宿主确认结局和 Agent 自归因互不冒充。'],
    ],
    technicalLink: '深入阅读[技术设计与研究对应](./TECHNICAL.zh-CN.md)。',
    quickIntro: '需要 Node.js 20.6 或更新版本。在希望拥有项目记忆的仓库里执行：',
    quickAfter: '初始化后重新打开 Agent。OwnMem 会创建 `.ownmem/`，并只修改宿主文件中受管理的标记区。只需一个适配器时使用 `--hosts claude`、`--hosts codex`、`--hosts cursor` 或 `--hosts gemini`；用 `npx ownmem init --check` 可以先预览。',
    dailyIntro: '安装后继续用人话工作：',
    rememberQuote: '> “记住：staging 部署超时来自连接池上限，不是 worker 太少。下次两者一起检查。”',
    recallQuote: '> “改之前先看看项目记忆里有没有遇到同一种故障。”',
    dailyAfter: '宿主会在相关工作前召回，并在每轮结束后调度一次带锁、防抖的演化。通常不需要手工串联 promotion、trust、audit 和 compile。想查看时打开本地控制台或检查协调器：',
    trustIntro: 'OwnMem 自动化的是“机器能证明”的部分，不是“听起来像对”的部分。',
    trustItems: [
      '**自动完成：** 确定性召回、候选扫描、tripwire、反事实回放、R0 trigger 回填、机器信任收据、审计、编译、观察、隔离和精确回滚。',
      '**升级复审：** 新正文知识、策略、active set、冲突、证据不足、R1–R5 变化和发布动作。',
      '**硬边界：** candidate 不是 memory；Agent 自归因不是用户确认；被召回的文本不能覆盖宿主指令或授权工具。',
      '**失败行为：** 未签正文或不可核验证据进入隔离；证据漂移降为 advisory；事务失败恢复上一份已验证状态。',
    ],
    fitHeader: ['适合 OwnMem', '这些情况更适合其他系统'],
    fitRows: [
      ['团队希望项目知识和代码一起评审、迁移。', '需要跨仓库个人画像或全局用户记忆。'],
      ['同一仓库轮换使用多个编程 Agent。', '希望无差别自动保存全部对话，不接受证据门与风险边界。'],
      ['在意本地、可复现、零查询成本的召回。', '需要大规模云向量搜索或实时全局知识图谱。'],
      ['错误记忆必须可归因、可拒绝、可撤销。', '记忆数量比治理更重要。'],
    ],
    localItems: [
      '默认召回只读仓库文件和本地快照：零 LLM 调用、零网络请求、零查询 token 成本。',
      '运行事件保存在 Git 忽略的本机目录；没有 outcome 样本就显示“暂无”，不会伪装成 0%。',
      '不该进入 Git 的密钥、个人信息和生产秘密，也不该进入记忆。',
      'embedding 通道是隔离的可选增强；只有仓库本地 A/B 证据过安全门后才参与 weighted 排序。',
    ],
    researchIntro: 'OwnMem 不把这些基础概念冒充原创；它的贡献是把它们组合成仓库记忆的可执行协议：',
    researchItems: [
      `**Agent Memory 与反思学习：** ${COMMON.links.reflexion}、${COMMON.links.memgpt}`,
      `**记忆与知识库投毒：** ${COMMON.links.agentPoison}、${COMMON.links.poisonedRag}`,
      `**不可信数据与授权分离：** ${COMMON.links.camel}`,
      `**独立来源证明：** ${COMMON.links.intoto}`,
      `**选择性预测与弃答：** ${COMMON.links.selective}`,
      `**差分验证与补偿事务：** ${COMMON.links.metamorphic}、${COMMON.links.sagas}`,
      `**分维度检索评测：** ${COMMON.links.ares}、${COMMON.links.ragchecker}`,
    ],
    researchAfter: '这些引用只说明研究脉络，不表示相关论文实现了 OwnMem，也不表示 OwnMem 复现了论文实验。',
    docsHeader: ['文档', '内容'],
    docsRows: [['architecture', '包边界、快照、信任与演化'], ['technical', '机制、威胁模型与研究对应'], ['plugins', '可选宿主插件安装'], ['updating', '安全更新与 0.2 → 0.3 迁移'], ['privacy', '本地数据和可选通道边界'], ['changelog', '版本变化'], ['license', 'Apache-2.0']],
    closing: 'OwnMem 是开源项目，欢迎提交带可复现证据的 issue 和 pull request。',
  },
  'zh-TW': {
    tagline: '把 AI 程式 Agent 的專案記憶留在儲存庫：本機、確定、可審閱，並能在安全邊界內自我改進。',
    chips: '`Git 原生` · `本機召回` · `多 Agent 共用` · `證據治理` · `Apache-2.0`',
    headings: ['為什麼是 OwnMem', '總架構', '0.3 到底獨特在哪裡', '三分鐘開始', '日常怎麼用', '信任與自動化邊界', '適合什麼', '預設本機優先', '研究脈絡', '文件'],
    whyIntro: '多數記憶方案先解決「記得更多」。OwnMem 先問另一件事：**專案知識由誰擁有，誰有權改變它，錯誤記憶如何在影響 Agent 行動前被攔下？**',
    whyHeader: ['優勢', '對實際開發的意義'],
    whyRows: [
      ['**記憶歸儲存庫所有**', '記憶是 `.ownmem/` 中可讀的 Markdown，隨 Git 複製、審閱與回復。'],
      ['**一份記憶，多 Agent 共用**', 'Claude Code、Codex、Cursor、Gemini CLI、Grok CLI 等宿主共用同一知識源。'],
      ['**預設召回確定且本機**', '不呼叫模型、不請求網路；相同查詢、設定與快照得到相同排序。'],
      ['**先驗證證據，再授予 authority**', '正文不能自證可信；獨立收據與即時證據核驗決定是否交付。'],
      ['**有界成長**', 'Schema、配額、去重、生命週期與稽核避免記憶變成第二個無人維護的 Wiki。'],
      ['**低風險自動，高影響複審**', '回放證明有效的 R0 檢索中繼資料可以無人值守；正文、策略與高風險變更不能。'],
    ],
    architectureAlt: 'OwnMem 總架構：儲存庫擁有的 Markdown 與獨立信任收據編譯成不可變快照；本機確定性召回經過四道交付門，受限演化協調器則回放、晉升、觀察、隔離並精確回復低風險變更。',
    architectureIntro: 'OwnMem 把「寫下經驗」與「把經驗交給 Agent」拆成兩個受控流程：',
    architectureItems: [
      '**儲存庫是真源。** L1 路由、L2 領域索引與 L3 topic 是可審閱 Markdown；信任收據獨立於它授權的正文。',
      '**編譯後再召回。** Schema、圖關係、生命週期與證據門產生內容定址的不可變快照，查詢時不重讀正在變動的正文。',
      '**預設五路確定性候選。** exact、BM25F、n-gram、fuzzy、graph 在本機融合；embedding 是可選第六路，沒有 A/B 證據前權重為 0。',
      '**交付前四道門。** 相關性、事實有效性、任務適用性與動作風險共同決定正常交付、advisory、隔離或棄答。',
      '**有界無人值守演化。** 輪末協調器只自動晉升通過回放、受配額約束且可精確撤銷的 R0 中繼資料；R1–R5 進入複審。',
    ],
    techIntro: '差異不在某個排序公式，而在 OwnMem 0.3 把 Agent Memory 做成可驗證的演化協定：',
    techHeader: ['機制', 'OwnMem 0.3 做了什麼'],
    techRows: [
      ['**證據攜帶記憶**', '內容雜湊、證據根、生命週期、適用範圍、風險與前驅收據共同決定正文能否進入上下文。'],
      ['**反事實晉升門**', '自動化必須證明「改前失敗、只因候選變更而恢復、既有通過語料零退步」。'],
      ['**按變更面定風險**', '風險來自改了什麼、能影響什麼；Agent 不能替自己的提案降級。'],
      ['**內容定址補償回復**', '自動編輯攜帶可驗證逆操作；交易失敗或 harmful 結果會恢復原位元組並保留歷史。'],
      ['**記憶投毒隔離**', '候選、正文、authority 與證據位於不同信任域；被檢索到不等於取得行動權限。'],
      ['**選擇性交付**', '證據不足時 advisory、隔離或棄答，不虛構信心。'],
      ['**不可變編譯快照**', 'Markdown、圖關係、排序身分與信任狀態共同成為可重現的執行期輸入。'],
      ['**三條反指標污染帳**', '檢索對錯、使用者/宿主確認結果與 Agent 自歸因互不冒充。'],
    ],
    technicalLink: '深入閱讀[技術設計與研究對應](../TECHNICAL.md)。',
    quickIntro: '需要 Node.js 20.6 或更新版本。在希望擁有專案記憶的儲存庫中執行：',
    quickAfter: '初始化後重新開啟 Agent。OwnMem 會建立 `.ownmem/`，且只修改宿主檔案中受管理的標記區。只需要一個適配器時使用 `--hosts claude`、`--hosts codex`、`--hosts cursor` 或 `--hosts gemini`；`npx ownmem init --check` 可先預覽。',
    dailyIntro: '安裝後繼續用自然語言工作：',
    rememberQuote: '> 「記住：staging 部署逾時來自連線池上限，不是 worker 太少。下次兩者一起檢查。」',
    recallQuote: '> 「修改前先看看專案記憶是否遇過同一種故障。」',
    dailyAfter: '宿主會在相關工作前召回，並在每輪結束後排程一次帶鎖、防抖的演化。通常不必手動串接 promotion、trust、audit 與 compile。想查看時開啟本機主控台或檢查協調器：',
    trustIntro: 'OwnMem 自動化的是「機器能證明」的部分，不是「聽起來像對」的部分。',
    trustItems: [
      '**自動完成：** 確定性召回、候選掃描、tripwire、反事實回放、R0 trigger 回填、機器信任收據、稽核、編譯、觀察、隔離與精確回復。',
      '**升級複審：** 新正文知識、策略、active set、衝突、證據不足、R1–R5 變更與發布動作。',
      '**硬邊界：** candidate 不是 memory；Agent 自歸因不是使用者確認；召回文字不能覆寫宿主指令或授權工具。',
      '**失敗行為：** 未簽正文或不可核驗證據進入隔離；證據漂移降為 advisory；交易失敗恢復上一份已驗證狀態。',
    ],
    fitHeader: ['適合 OwnMem', '這些情況更適合其他系統'],
    fitRows: [
      ['團隊希望專案知識與程式碼一起審閱、遷移。', '需要跨儲存庫個人輪廓或全域使用者記憶。'],
      ['同一儲存庫輪流使用多個程式 Agent。', '希望無差別自動保存所有對話，不接受證據門與風險邊界。'],
      ['重視本機、可重現、零查詢成本的召回。', '需要大規模雲端向量搜尋或即時全域知識圖譜。'],
      ['錯誤記憶必須可歸因、可拒絕、可撤銷。', '記憶數量比治理更重要。'],
    ],
    localItems: [
      '預設召回只讀儲存庫檔案與本機快照：零 LLM 呼叫、零網路請求、零查詢 token 成本。',
      '執行事件保存在 Git 忽略的本機目錄；沒有 outcome 樣本就顯示「暫無」，不偽裝成 0%。',
      '不該進入 Git 的金鑰、個人資料與生產祕密，也不該進入記憶。',
      'embedding 通道是隔離的可選增強；只有儲存庫本機 A/B 證據通過安全門後才參與 weighted 排序。',
    ],
    researchIntro: 'OwnMem 不把這些基礎概念冒充原創；它的貢獻是把它們組成儲存庫記憶的可執行協定：',
    researchItems: [
      `**Agent Memory 與反思學習：** ${COMMON.links.reflexion}、${COMMON.links.memgpt}`,
      `**記憶與知識庫投毒：** ${COMMON.links.agentPoison}、${COMMON.links.poisonedRag}`,
      `**不可信資料與授權分離：** ${COMMON.links.camel}`,
      `**獨立來源證明：** ${COMMON.links.intoto}`,
      `**選擇性預測與棄答：** ${COMMON.links.selective}`,
      `**差分驗證與補償交易：** ${COMMON.links.metamorphic}、${COMMON.links.sagas}`,
      `**分維度檢索評測：** ${COMMON.links.ares}、${COMMON.links.ragchecker}`,
    ],
    researchAfter: '這些引用只說明研究脈絡，不表示相關論文實作了 OwnMem，也不表示 OwnMem 重現了論文實驗。',
    docsHeader: ['文件', '內容'],
    docsRows: [['architecture', '套件邊界、快照、信任與演化'], ['technical', '機制、威脅模型與研究對應'], ['plugins', '可選宿主外掛安裝'], ['updating', '安全更新與 0.2 → 0.3 遷移'], ['privacy', '本機資料與可選通道邊界'], ['changelog', '版本變更'], ['license', 'Apache-2.0']],
    closing: 'OwnMem 是開源專案，歡迎提交附可重現證據的 issue 與 pull request。',
  },
  ja: {
    tagline: 'AI コーディングエージェントのプロジェクト記憶をリポジトリに置く。ローカル、決定的、レビュー可能、そして安全な範囲で自己改善。',
    chips: '`Git ネイティブ` · `ローカル想起` · `マルチエージェント` · `証拠ガバナンス` · `Apache-2.0`',
    headings: ['なぜ OwnMem なのか', '全体アーキテクチャ', '0.3 の独自性', '3 分で始める', '日常の使い方', '信頼と自動化の境界', '適している場面', 'ローカルファースト', '研究上の系譜', 'ドキュメント'],
    whyIntro: '多くの記憶システムは「より多く覚える」ことを最適化します。OwnMem は先に、**プロジェクト知識を誰が所有し、誰が変更でき、誤った記憶を行動の前にどう止めるか**を問います。',
    whyHeader: ['強み', '実開発での意味'],
    whyRows: [
      ['**記憶はリポジトリ所有**', '`.ownmem/` の可読 Markdown がコードと一緒に clone、review、rollback されます。'],
      ['**1 つの記憶を複数 Agent で共有**', 'Claude Code、Codex、Cursor、Gemini CLI、Grok CLI などが同じ知識源を使います。'],
      ['**既定で決定的なローカル想起**', 'モデルもネットワークも呼ばず、同じクエリ・設定・snapshot なら同じ順位です。'],
      ['**authority より先に証拠**', '本文は自分を信頼済みにできません。独立 receipt と生きた証拠検証が配信を決めます。'],
      ['**成長を制限**', 'Schema、quota、重複、lifecycle、audit が第二の放置 Wiki 化を防ぎます。'],
      ['**低リスクは自動、高影響はレビュー**', 'replay で証明された R0 検索メタデータだけが無人で進化できます。'],
    ],
    architectureAlt: 'OwnMem の全体構成。リポジトリ所有の Markdown と独立した信頼 receipt を不変 snapshot にコンパイルし、決定的ローカル想起を 4 つの配信 gate に通す。制限付き進化 coordinator は低リスク変更を replay、昇格、観測、隔離し、正確に rollback する。',
    architectureIntro: 'OwnMem は「経験を書くこと」と「Agent に渡すこと」を分離します。',
    architectureItems: [
      '**リポジトリが唯一の情報源。** L1 routing、L2 area index、L3 topic は review 可能な Markdown。trust receipt は本文と分離されます。',
      '**compile してから recall。** Schema、graph、lifecycle、evidence gate が content-addressed な不変 snapshot を作ります。',
      '**5 本の決定的候補 lane。** exact、BM25F、n-gram、fuzzy、graph をローカル融合。embedding は任意の第 6 lane で、A/B 証拠が通るまで重み 0 です。',
      '**配信前の 4 gate。** relevance、factual validity、task applicability、action risk が通常配信、advisory、quarantine、abstention を決めます。',
      '**制限付き無人進化。** turn 終了時に replay 済み・quota 内・正確に戻せる R0 だけを自動昇格し、R1–R5 はレビューへ送ります。',
    ],
    techIntro: '違いは単一の ranking 式ではありません。OwnMem 0.3 は Agent Memory を検証可能な進化プロトコルにします。',
    techHeader: ['仕組み', 'OwnMem 0.3 の動作'],
    techRows: [
      ['**証拠を伴う記憶**', 'content hash、evidence root、lifecycle、applicability、risk、predecessor receipt が注入可否を決めます。'],
      ['**反実仮想 promotion gate**', '基準で miss、候補だけで回復、既存合格 corpus は無回帰であることを証明します。'],
      ['**変更面からリスク算定**', '何を変え何に影響するかで決まり、Agent は自分の提案を低リスク化できません。'],
      ['**content-addressed 補償 rollback**', '自動変更は検証可能な逆操作を持ち、失敗や harmful outcome で以前の byte を正確に復元します。'],
      ['**memory poisoning の隔離**', 'candidate、content、authority、evidence は別の trust domain。検索されたことは権限ではありません。'],
      ['**選択的配信**', '証拠不足なら advisory、quarantine、abstention とし、信頼度を捏造しません。'],
      ['**不変 compiled snapshot**', 'Markdown、graph、ranking identity、trust state を再現可能な runtime input にします。'],
      ['**混同しない 3 台帳**', '検索の正誤、user/host outcome、Agent self-attribution を別々に記録します。'],
    ],
    technicalLink: '詳細は [technical design and research mapping](../TECHNICAL.md) を参照してください。',
    quickIntro: 'Node.js 20.6 以上が必要です。記憶を所有させるリポジトリで実行します。',
    quickAfter: '初期化後に Agent を開き直してください。OwnMem は `.ownmem/` を作成し、host ファイルの管理 marker 内だけを変更します。adapter が 1 つなら `--hosts claude`、`--hosts codex`、`--hosts cursor`、`--hosts gemini` を使い、`npx ownmem init --check` で事前確認できます。',
    dailyIntro: 'セットアップ後は自然な言葉で作業します。',
    rememberQuote: '> 「覚えておいて。staging deploy の timeout は worker 不足ではなく pool cap が原因。次回は両方確認する。」',
    recallQuote: '> 「変更前に、同じ障害をプロジェクト記憶で経験していないか確認して。」',
    dailyAfter: 'host は関連作業前に recall し、turn 終了時に lock・debounce 付きの進化を 1 回予約します。promotion、trust、audit、compile を手作業で連結する必要は通常ありません。可視化にはローカル console と coordinator status を使います。',
    trustIntro: 'OwnMem が自動化するのは「機械で証明できる部分」であり、「もっともらしい部分」ではありません。',
    trustItems: [
      '**自動：** 決定的 recall、candidate scan、tripwire、反実仮想 replay、R0 trigger backfill、machine trust receipt、audit、compile、観測、隔離、正確な rollback。',
      '**レビューへ：** 新しい本文知識、policy、active set、conflict、証拠不足、R1–R5、publish。',
      '**固定境界：** candidate は memory ではなく、self-attribution は user confirmation ではなく、想起本文は host 指示や tool 権限を上書きできません。',
      '**失敗時：** unsigned content と検証不能 evidence は隔離、evidence drift は advisory、transaction failure は直前の検証済み状態へ復元します。',
    ],
    fitHeader: ['OwnMem が合う', '別のシステムが合う'],
    fitRows: [
      ['プロジェクト知識をコードと一緒に review・移行したい。', 'リポジトリ横断の個人 profile や global user memory が必要。'],
      ['同じリポジトリで複数の coding Agent を使う。', '証拠や risk boundary なしで全会話を自動保存したい。'],
      ['ローカル、再現可能、query cost 0 の recall が重要。', '大規模 cloud vector search や realtime global knowledge graph が必要。'],
      ['誤った記憶を追跡、拒否、撤回できる必要がある。', 'governance より記憶量を優先する。'],
    ],
    localItems: [
      '既定 recall はリポジトリ file と local snapshot だけを読み、LLM・network・query token cost は 0 です。',
      'runtime event は Git-ignore された local directory に保存。outcome sample がなければ 0% ではなく「利用不可」と表示します。',
      'Git に置けない secret、個人情報、本番 data は memory にも置きません。',
      'embedding lane は任意かつ隔離。repository-local A/B evidence が safety gate を通って初めて weighted ranking に参加します。',
    ],
    researchIntro: 'OwnMem は基礎技術の発明を主張しません。貢献は、それらをリポジトリ記憶の実行可能 protocol に組み合わせることです。',
    researchItems: [
      `**Agent memory と reflection:** ${COMMON.links.reflexion}, ${COMMON.links.memgpt}`,
      `**Memory / knowledge-base poisoning:** ${COMMON.links.agentPoison}, ${COMMON.links.poisonedRag}`,
      `**Untrusted data と authority の分離:** ${COMMON.links.camel}`,
      `**独立 provenance:** ${COMMON.links.intoto}`,
      `**Selective prediction と abstention:** ${COMMON.links.selective}`,
      `**Differential validation と compensation:** ${COMMON.links.metamorphic}, ${COMMON.links.sagas}`,
      `**分解された retrieval evaluation:** ${COMMON.links.ares}, ${COMMON.links.ragchecker}`,
    ],
    researchAfter: '引用は研究上の系譜を示すもので、各論文が OwnMem を実装した、または OwnMem が実験を再現したという意味ではありません。',
    docsHeader: ['文書', '内容'],
    docsRows: [['architecture', 'package 境界、snapshot、trust、evolution'], ['technical', 'mechanism、threat model、research mapping'], ['plugins', '任意 host plugin の導入'], ['updating', '安全な更新と 0.2 → 0.3 migration'], ['privacy', 'local data と optional channel'], ['changelog', 'version history'], ['license', 'Apache-2.0']],
    closing: 'OwnMem はオープンソースです。再現可能な issue と pull request を歓迎します。',
  },
  ko: {
    tagline: 'AI 코딩 에이전트의 프로젝트 메모리를 저장소에 둡니다. 로컬·결정적·검토 가능하며 안전한 범위에서 스스로 개선됩니다.',
    chips: '`Git 네이티브` · `로컬 회상` · `멀티 에이전트` · `증거 거버넌스` · `Apache-2.0`',
    headings: ['왜 OwnMem인가', '전체 아키텍처', '0.3의 차별점', '3분 만에 시작', '일상 사용', '신뢰와 자동화 경계', '적합한 경우', '기본은 로컬 우선', '연구 계보', '문서'],
    whyIntro: '대부분의 메모리 시스템은 “더 많이 기억하기”를 최적화합니다. OwnMem은 먼저 **프로젝트 지식을 누가 소유하고, 누가 바꿀 수 있으며, 잘못된 메모리를 행동 전에 어떻게 막을지** 묻습니다.',
    whyHeader: ['장점', '실제 개발에서의 의미'],
    whyRows: [
      ['**메모리는 저장소 소유**', '`.ownmem/`의 읽을 수 있는 Markdown이 코드와 함께 clone, review, rollback 됩니다.'],
      ['**하나의 메모리를 여러 Agent가 공유**', 'Claude Code, Codex, Cursor, Gemini CLI, Grok CLI 등이 동일한 지식 원본을 사용합니다.'],
      ['**기본 회상은 결정적·로컬**', '모델이나 네트워크를 호출하지 않고 같은 query·config·snapshot에 같은 순위를 냅니다.'],
      ['**authority보다 증거가 먼저**', '본문은 스스로 신뢰를 부여하지 못하며 독립 receipt와 실시간 evidence 검증이 전달을 결정합니다.'],
      ['**제한된 성장**', 'Schema, quota, 중복, lifecycle, audit가 방치된 두 번째 Wiki가 되는 것을 막습니다.'],
      ['**저위험은 자동, 고영향은 검토**', 'replay로 입증된 R0 검색 metadata만 무인 진화할 수 있습니다.'],
    ],
    architectureAlt: 'OwnMem 전체 아키텍처. 저장소 소유 Markdown과 독립 trust receipt를 불변 snapshot으로 compile하고 결정적 로컬 recall을 네 전달 gate에 통과시킨다. 제한된 evolution coordinator는 저위험 변경을 replay, 승격, 관찰, 격리하고 정확히 rollback한다.',
    architectureIntro: 'OwnMem은 “경험을 기록하는 일”과 “Agent에게 전달하는 일”을 분리합니다.',
    architectureItems: [
      '**저장소가 진실의 원천.** L1 routing, L2 area index, L3 topic은 검토 가능한 Markdown이며 trust receipt는 본문과 분리됩니다.',
      '**compile 후 recall.** Schema, graph, lifecycle, evidence gate가 content-addressed 불변 snapshot을 만듭니다.',
      '**5개 결정적 후보 lane.** exact, BM25F, n-gram, fuzzy, graph를 로컬에서 융합합니다. embedding은 선택적 6번째 lane이며 A/B 증거 전에는 가중치 0입니다.',
      '**전달 전 4개 gate.** relevance, factual validity, task applicability, action risk가 정상 전달, advisory, quarantine, abstention을 정합니다.',
      '**제한된 무인 진화.** turn 종료 coordinator는 replay 입증·quota 내·정확히 되돌릴 수 있는 R0만 자동 승격하고 R1–R5는 검토로 보냅니다.',
    ],
    techIntro: '차이는 하나의 ranking 공식이 아닙니다. OwnMem 0.3은 Agent Memory를 검증 가능한 진화 프로토콜로 만듭니다.',
    techHeader: ['메커니즘', 'OwnMem 0.3의 동작'],
    techRows: [
      ['**증거를 지닌 메모리**', 'content hash, evidence root, lifecycle, applicability, risk, predecessor receipt가 context 진입을 결정합니다.'],
      ['**반사실 promotion gate**', 'baseline miss, 후보로만 복구, 기존 통과 corpus의 무회귀를 증명해야 합니다.'],
      ['**변경 면에서 위험 산정**', '무엇을 바꾸고 어디에 영향 주는지로 정하며 Agent는 자신의 제안을 낮은 위험으로 바꿀 수 없습니다.'],
      ['**content-addressed 보상 rollback**', '자동 변경은 검증 가능한 역연산을 갖고 실패나 harmful outcome 시 이전 byte를 정확히 복구합니다.'],
      ['**memory poisoning 격리**', 'candidate, content, authority, evidence는 다른 trust domain이며 검색됨은 권한이 아닙니다.'],
      ['**선택적 전달**', '증거가 부족하면 advisory, quarantine, abstention하고 신뢰도를 꾸며내지 않습니다.'],
      ['**불변 compiled snapshot**', 'Markdown, graph, ranking identity, trust state를 재현 가능한 runtime input으로 만듭니다.'],
      ['**서로 섞지 않는 세 ledger**', '검색 정오, user/host outcome, Agent self-attribution을 분리 기록합니다.'],
    ],
    technicalLink: '자세한 내용은 [technical design and research mapping](../TECHNICAL.md)을 참고하세요.',
    quickIntro: 'Node.js 20.6 이상이 필요합니다. 메모리를 소유할 저장소에서 실행하세요.',
    quickAfter: '초기화 뒤 Agent를 다시 여세요. OwnMem은 `.ownmem/`을 만들고 host 파일의 관리 marker 내부만 수정합니다. adapter 하나만 필요하면 `--hosts claude`, `--hosts codex`, `--hosts cursor`, `--hosts gemini`를 사용하고 `npx ownmem init --check`로 미리 볼 수 있습니다.',
    dailyIntro: '설치 후에는 자연어로 계속 작업합니다.',
    rememberQuote: '> “기억해 둬. staging 배포 timeout은 worker 부족이 아니라 pool cap 때문이야. 다음에는 둘 다 확인해.”',
    recallQuote: '> “바꾸기 전에 프로젝트 메모리에 같은 장애가 있었는지 확인해.”',
    dailyAfter: 'host는 관련 작업 전 recall하고 turn 끝에 lock·debounce가 적용된 evolution을 한 번 예약합니다. promotion, trust, audit, compile을 수동으로 연결할 필요는 보통 없습니다. 로컬 console이나 coordinator status로 확인할 수 있습니다.',
    trustIntro: 'OwnMem이 자동화하는 것은 “기계가 증명할 수 있는 부분”이지 “그럴듯한 부분”이 아닙니다.',
    trustItems: [
      '**자동:** 결정적 recall, candidate scan, tripwire, 반사실 replay, R0 trigger backfill, machine trust receipt, audit, compile, 관찰, 격리, 정확한 rollback.',
      '**검토로 승격:** 새 본문 지식, policy, active set, conflict, 증거 부족, R1–R5, publish.',
      '**고정 경계:** candidate는 memory가 아니고 self-attribution은 user confirmation이 아니며 recall된 텍스트는 host 지시나 tool 권한을 덮을 수 없습니다.',
      '**실패 동작:** unsigned content와 검증 불가 evidence는 격리, evidence drift는 advisory, transaction failure는 직전 검증 상태로 복구합니다.',
    ],
    fitHeader: ['OwnMem이 잘 맞음', '다른 시스템이 더 맞음'],
    fitRows: [
      ['프로젝트 지식을 코드와 함께 검토·이동하고 싶다.', '저장소를 넘는 개인 profile이나 global user memory가 필요하다.'],
      ['한 저장소에서 여러 coding Agent를 번갈아 쓴다.', '증거·risk boundary 없이 모든 대화를 자동 저장하고 싶다.'],
      ['로컬·재현 가능·query cost 0 recall이 중요하다.', '대규모 cloud vector search나 realtime global knowledge graph가 필요하다.'],
      ['잘못된 메모리를 추적·거절·철회할 수 있어야 한다.', 'governance보다 메모리 양이 중요하다.'],
    ],
    localItems: [
      '기본 recall은 저장소 파일과 local snapshot만 읽어 LLM·network·query token cost가 0입니다.',
      'runtime event는 Git-ignore된 local directory에 저장됩니다. outcome sample이 없으면 0%가 아니라 “없음”으로 표시합니다.',
      'Git에 둘 수 없는 secret, 개인정보, production data는 memory에도 두지 않습니다.',
      'embedding lane은 선택적·격리형입니다. repository-local A/B evidence가 safety gate를 통과해야 weighted ranking에 참여합니다.',
    ],
    researchIntro: 'OwnMem은 기초 기술을 발명했다고 주장하지 않습니다. 기여는 이를 저장소 메모리의 실행 가능한 protocol로 조합한 데 있습니다.',
    researchItems: [
      `**Agent memory와 reflection:** ${COMMON.links.reflexion}, ${COMMON.links.memgpt}`,
      `**Memory / knowledge-base poisoning:** ${COMMON.links.agentPoison}, ${COMMON.links.poisonedRag}`,
      `**Untrusted data와 authority 분리:** ${COMMON.links.camel}`,
      `**독립 provenance:** ${COMMON.links.intoto}`,
      `**Selective prediction과 abstention:** ${COMMON.links.selective}`,
      `**Differential validation과 compensation:** ${COMMON.links.metamorphic}, ${COMMON.links.sagas}`,
      `**분해된 retrieval evaluation:** ${COMMON.links.ares}, ${COMMON.links.ragchecker}`,
    ],
    researchAfter: '인용은 연구 계보를 설명할 뿐 해당 논문이 OwnMem을 구현했거나 OwnMem이 실험을 재현했다는 뜻이 아닙니다.',
    docsHeader: ['문서', '내용'],
    docsRows: [['architecture', 'package 경계, snapshot, trust, evolution'], ['technical', 'mechanism, threat model, research mapping'], ['plugins', '선택적 host plugin 설치'], ['updating', '안전한 업데이트와 0.2 → 0.3 migration'], ['privacy', 'local data와 optional channel'], ['changelog', 'version history'], ['license', 'Apache-2.0']],
    closing: 'OwnMem은 오픈 소스입니다. 재현 가능한 issue와 pull request를 환영합니다.',
  },
  es: {
    tagline: 'Memoria de proyecto para agentes de programación: local, determinista, revisable y capaz de mejorar dentro de límites seguros.',
    chips: '`Nativo de Git` · `recall local` · `multiagente` · `gobierno por evidencia` · `Apache-2.0`',
    headings: ['Por qué OwnMem', 'Arquitectura', 'Qué distingue a la versión 0.3', 'Inicio en tres minutos', 'Uso diario', 'Límite entre confianza y automatización', 'Cuándo encaja', 'Local por defecto', 'Linaje de investigación', 'Documentación'],
    whyIntro: 'La mayoría de los sistemas optimiza «recordar más». OwnMem empieza por otra pregunta: **¿quién posee el conocimiento del proyecto, quién puede cambiarlo y cómo se detiene un recuerdo erróneo antes de que altere las acciones del agente?**',
    whyHeader: ['Ventaja', 'Qué significa en la práctica'],
    whyRows: [
      ['**La memoria pertenece al repositorio**', 'Markdown legible en `.ownmem/` viaja con el código al clonar, revisar y revertir.'],
      ['**Una memoria para varios agentes**', 'Claude Code, Codex, Cursor, Gemini CLI, Grok CLI y otros hosts comparten una sola fuente.'],
      ['**Recall local y determinista**', 'Sin modelo ni red; la misma consulta, configuración y snapshot producen el mismo orden.'],
      ['**Evidencia antes que autoridad**', 'El contenido no puede declararse fiable; receipts independientes y evidencia viva deciden la entrega.'],
      ['**Crecimiento acotado**', 'Schema, cuotas, duplicados, ciclo de vida y auditoría evitan otro wiki abandonado.'],
      ['**Automático si el riesgo es bajo**', 'Solo metadata R0 demostrada por replay evoluciona sin supervisión; prosa, política y alto impacto no.'],
    ],
    architectureAlt: 'Arquitectura de OwnMem: Markdown propiedad del repositorio y receipts de confianza independientes se compilan en snapshots inmutables; el recall local determinista pasa cuatro puertas de entrega y un coordinador acotado reproduce, promueve, observa, aísla y revierte con precisión cambios de bajo riesgo.',
    architectureIntro: 'OwnMem separa «escribir la experiencia» de «entregarla a un agente»:',
    architectureItems: [
      '**El repositorio es la fuente.** Rutas L1, índices L2 y temas L3 son Markdown revisable; los trust receipts viven fuera del texto autorizado.',
      '**Compilar antes de recordar.** Schema, grafo, ciclo de vida y evidencia producen un snapshot inmutable y direccionado por contenido.',
      '**Cinco canales deterministas.** exact, BM25F, n-gram, fuzzy y graph se fusionan localmente. embedding es un sexto canal opcional con peso 0 hasta superar A/B.',
      '**Cuatro puertas de entrega.** relevancia, validez factual, aplicabilidad y riesgo deciden entrega normal, advisory, cuarentena o abstención.',
      '**Evolución desatendida y acotada.** Al final del turno solo se promueve R0 demostrado, dentro de cuota y reversible; R1–R5 pasa a revisión.',
    ],
    techIntro: 'La diferencia no es una fórmula de ranking. OwnMem 0.3 convierte la memoria del agente en un protocolo de evolución verificable:',
    techHeader: ['Mecanismo', 'Qué hace OwnMem 0.3'],
    techRows: [
      ['**Memoria con evidencia**', 'Hash, raíz de evidencia, ciclo de vida, ámbito, riesgo y receipts previos deciden si el texto entra en contexto.'],
      ['**Puerta contrafactual de promoción**', 'Debe probar fallo base, recuperación causada solo por el candidato y cero regresiones en el corpus aprobado.'],
      ['**Riesgo según la superficie cambiada**', 'Deriva de qué cambia y qué puede afectar; el agente no puede rebajar su propia propuesta.'],
      ['**Rollback compensatorio y direccionado**', 'Cada cambio automático lleva su inversa verificada y restaura bytes exactos sin borrar el historial.'],
      ['**Cuarentena contra poisoning**', 'Candidato, contenido, autoridad y evidencia son dominios separados; ser recuperado no concede permiso.'],
      ['**Entrega selectiva**', 'La falta de evidencia produce advisory, cuarentena o abstención, no confianza inventada.'],
      ['**Snapshots compilados e inmutables**', 'Markdown, grafo, identidad de ranking y confianza forman una entrada de runtime reproducible.'],
      ['**Tres libros sin contaminación**', 'Corrección del recall, resultados confirmados y autoatribución del agente nunca se sustituyen.'],
    ],
    technicalLink: 'Consulta el [diseño técnico y su relación con la investigación](../TECHNICAL.md).',
    quickIntro: 'Requiere Node.js 20.6 o posterior. Ejecútalo en el repositorio que debe poseer la memoria:',
    quickAfter: 'Vuelve a abrir el agente tras inicializar. OwnMem crea `.ownmem/` y solo modifica regiones marcadas como administradas. Para un único adaptador usa `--hosts claude`, `--hosts codex`, `--hosts cursor` o `--hosts gemini`; previsualiza con `npx ownmem init --check`.',
    dailyIntro: 'Después, trabaja en lenguaje natural:',
    rememberQuote: '> «Recuerda: el timeout de staging viene del límite del pool, no de pocos workers. Comprueba ambos la próxima vez.»',
    recallQuote: '> «Antes de cambiar esto, revisa si la memoria del proyecto ya vio el mismo fallo.»',
    dailyAfter: 'El host hace recall antes del trabajo relevante y programa una evolución bloqueada y con debounce al final del turno. Normalmente no hay que encadenar promotion, trust, audit y compile. Para observarlo abre la consola local o consulta el coordinador:',
    trustIntro: 'OwnMem automatiza lo que una máquina puede demostrar, no lo que solo parece plausible.',
    trustItems: [
      '**Automático:** recall determinista, escaneo, tripwire, replay contrafactual, backfill R0, receipt de máquina, audit, compile, observación, cuarentena y rollback exacto.',
      '**A revisión:** nueva prosa, política, active set, conflictos, evidencia insuficiente, cambios R1–R5 y publicación.',
      '**Límite duro:** candidate no es memory; autoatribución no es confirmación; el texto recuperado no reemplaza instrucciones ni autoriza herramientas.',
      '**Ante fallos:** contenido sin firmar o evidencia no verificable se aísla; el drift baja a advisory; una transacción fallida restaura el estado validado anterior.',
    ],
    fitHeader: ['OwnMem encaja', 'Mejor otro sistema'],
    fitRows: [
      ['El conocimiento debe revisarse y migrar con el código.', 'Necesitas un perfil personal o memoria global entre repositorios.'],
      ['Varios agentes trabajan por turnos en un repositorio.', 'Quieres capturar toda conversación sin límites de evidencia o riesgo.'],
      ['Importa el recall local, reproducible y sin coste por consulta.', 'Necesitas búsqueda vectorial cloud masiva o un grafo global en tiempo real.'],
      ['La memoria errónea debe poder atribuirse, rechazarse y revertirse.', 'La cantidad importa más que el gobierno.'],
    ],
    localItems: [
      'El recall predeterminado solo lee archivos y snapshots locales: cero LLM, red y tokens por consulta.',
      'Los eventos quedan en un directorio local ignorado por Git. Sin outcomes se muestra «no disponible», nunca un 0 % inventado.',
      'Secretos y datos personales o de producción que no deben ir a Git tampoco deben ir a memoria.',
      'embedding es opcional y aislado; solo entra en ranking weighted tras superar evidencia A/B local.',
    ],
    researchIntro: 'OwnMem no presenta estas bases como invenciones; su aportación es componerlas en un protocolo ejecutable para memoria de repositorio:',
    researchItems: [
      `**Memoria de agentes y reflexión:** ${COMMON.links.reflexion}, ${COMMON.links.memgpt}`,
      `**Poisoning de memoria y conocimiento:** ${COMMON.links.agentPoison}, ${COMMON.links.poisonedRag}`,
      `**Datos no fiables separados de autoridad:** ${COMMON.links.camel}`,
      `**Procedencia independiente:** ${COMMON.links.intoto}`,
      `**Predicción selectiva y abstención:** ${COMMON.links.selective}`,
      `**Validación diferencial y compensación:** ${COMMON.links.metamorphic}, ${COMMON.links.sagas}`,
      `**Evaluación descompuesta de retrieval:** ${COMMON.links.ares}, ${COMMON.links.ragchecker}`,
    ],
    researchAfter: 'Las citas describen el linaje; no implican que esos trabajos implementen OwnMem ni que OwnMem reproduzca sus experimentos.',
    docsHeader: ['Documento', 'Contenido'],
    docsRows: [['architecture', 'Límites, snapshots, confianza y evolución'], ['technical', 'Mecanismos, amenazas e investigación'], ['plugins', 'Instalación opcional de plugins'], ['updating', 'Actualización segura y migración 0.2 → 0.3'], ['privacy', 'Datos locales y canales opcionales'], ['changelog', 'Historial de versiones'], ['license', 'Apache-2.0']],
    closing: 'OwnMem es código abierto. Se agradecen issues y pull requests reproducibles.',
  },
  fr: {
    tagline: 'La mémoire de projet des agents de code reste dans le dépôt : locale, déterministe, révisable et capable de progresser dans des limites sûres.',
    chips: '`Natif Git` · `rappel local` · `multi-agent` · `gouverné par les preuves` · `Apache-2.0`',
    headings: ['Pourquoi OwnMem', 'Architecture', 'Ce qui distingue la version 0.3', 'Démarrer en trois minutes', 'Usage quotidien', 'Frontière entre confiance et automatisation', 'Quand OwnMem convient', 'Local par défaut', 'Filiation scientifique', 'Documentation'],
    whyIntro: 'La plupart des mémoires cherchent d’abord à « retenir plus ». OwnMem pose une autre question : **qui possède le savoir du projet, qui peut le modifier et comment arrêter un mauvais souvenir avant qu’il influence l’agent ?**',
    whyHeader: ['Avantage', 'Conséquence pratique'],
    whyRows: [
      ['**Le dépôt possède la mémoire**', 'Le Markdown lisible de `.ownmem/` voyage avec le code lors du clone, de la revue et du rollback.'],
      ['**Une mémoire, plusieurs agents**', 'Claude Code, Codex, Cursor, Gemini CLI, Grok CLI et d’autres hosts partagent la même source.'],
      ['**Rappel local et déterministe**', 'Aucun modèle ni réseau ; mêmes requête, configuration et snapshot, même classement.'],
      ['**Les preuves avant l’autorité**', 'Le texte ne peut pas s’auto-déclarer fiable ; receipts indépendants et preuves vivantes décident.'],
      ['**Croissance bornée**', 'Schema, quotas, doublons, cycle de vie et audit évitent un second wiki abandonné.'],
      ['**Faible risque automatique, fort impact relu**', 'Seule la metadata R0 prouvée par replay évolue sans intervention.'],
    ],
    architectureAlt: 'Architecture OwnMem : le Markdown détenu par le dépôt et des receipts de confiance indépendants sont compilés en snapshots immuables ; le rappel local déterministe passe quatre portes de livraison, tandis qu’un coordinateur borné rejoue, promeut, observe, isole et annule précisément les changements à faible risque.',
    architectureIntro: 'OwnMem sépare « écrire l’expérience » de « la livrer à un agent » :',
    architectureItems: [
      '**Le dépôt est la source.** Routage L1, index L2 et sujets L3 sont du Markdown révisable ; les trust receipts sont extérieurs au texte autorisé.',
      '**Compiler avant le rappel.** Schema, graphe, cycle de vie et preuves produisent un snapshot immuable adressé par contenu.',
      '**Cinq canaux déterministes.** exact, BM25F, n-gram, fuzzy et graph fusionnent localement. embedding est un sixième canal optionnel à poids 0 avant preuve A/B.',
      '**Quatre portes de livraison.** pertinence, validité, applicabilité et risque mènent à livraison, advisory, quarantaine ou abstention.',
      '**Évolution autonome bornée.** En fin de tour, seul R0 prouvé, sous quota et exactement réversible est promu ; R1–R5 est relu.',
    ],
    techIntro: 'La différence n’est pas une formule de ranking. OwnMem 0.3 transforme la mémoire agent en protocole d’évolution vérifiable :',
    techHeader: ['Mécanisme', 'OwnMem 0.3'],
    techRows: [
      ['**Mémoire porteuse de preuves**', 'Hash, racine de preuve, cycle de vie, applicabilité, risque et receipts précédents décident de l’injection.'],
      ['**Porte de promotion contrefactuelle**', 'Il faut prouver l’échec initial, la récupération causée seulement par le candidat et zéro régression.'],
      ['**Risque dérivé de la surface modifiée**', 'Il dépend de ce qui change et de son impact ; l’agent ne peut pas déclasser sa proposition.'],
      ['**Rollback compensatoire adressé par contenu**', 'Chaque édition automatique porte son inverse vérifié et restaure les octets exacts sans effacer l’historique.'],
      ['**Quarantaine contre l’empoisonnement**', 'Candidat, contenu, autorité et preuve sont séparés ; être retrouvé n’accorde aucun pouvoir.'],
      ['**Livraison sélective**', 'Le manque de preuve produit advisory, quarantaine ou abstention, jamais une confiance inventée.'],
      ['**Snapshots compilés immuables**', 'Markdown, graphe, identité de ranking et état de confiance forment une entrée reproductible.'],
      ['**Trois registres non substituables**', 'Correction du rappel, outcomes confirmés et auto-attribution de l’agent restent distincts.'],
    ],
    technicalLink: 'Lire le [design technique et la correspondance avec la recherche](../TECHNICAL.md).',
    quickIntro: 'Node.js 20.6 ou plus récent est requis. Exécutez ceci dans le dépôt qui doit posséder la mémoire :',
    quickAfter: 'Rouvrez l’agent après l’initialisation. OwnMem crée `.ownmem/` et ne modifie que les zones marquées comme gérées. Pour un seul adaptateur, utilisez `--hosts claude`, `--hosts codex`, `--hosts cursor` ou `--hosts gemini` ; prévisualisez avec `npx ownmem init --check`.',
    dailyIntro: 'Ensuite, travaillez en langage naturel :',
    rememberQuote: '> « Mémorise ceci : le timeout de staging vient de la limite du pool, pas d’un manque de workers. Vérifie les deux la prochaine fois. »',
    recallQuote: '> « Avant de modifier, regarde si la mémoire du projet a déjà rencontré la même panne. »',
    dailyAfter: 'Le host rappelle avant le travail concerné et planifie une évolution verrouillée et debounced en fin de tour. Inutile d’enchaîner manuellement promotion, trust, audit et compile. La console locale et le statut du coordinateur rendent le tout visible :',
    trustIntro: 'OwnMem automatise ce que la machine peut prouver, pas ce qui semble seulement plausible.',
    trustItems: [
      '**Automatique :** rappel déterministe, scan, tripwire, replay contrefactuel, backfill R0, receipt machine, audit, compile, observation, quarantaine et rollback exact.',
      '**À relire :** nouvelle prose, politique, active set, conflits, preuves insuffisantes, changements R1–R5 et publication.',
      '**Frontière dure :** candidate n’est pas memory ; auto-attribution n’est pas confirmation ; le texte rappelé ne remplace pas les instructions ni les autorisations.',
      '**En cas d’échec :** contenu non signé ou preuve invérifiable est isolé ; le drift devient advisory ; une transaction échouée restaure l’état validé précédent.',
    ],
    fitHeader: ['OwnMem convient', 'Préférer un autre système'],
    fitRows: [
      ['Le savoir doit être relu et migrer avec le code.', 'Il faut un profil personnel ou une mémoire globale entre dépôts.'],
      ['Plusieurs agents alternent sur un même dépôt.', 'Toute conversation doit être capturée sans limite de preuve ni de risque.'],
      ['Le rappel local, reproductible et sans coût compte.', 'Il faut une recherche vectorielle cloud massive ou un graphe mondial temps réel.'],
      ['Une mauvaise mémoire doit être traçable, rejetable et réversible.', 'Le volume prime sur la gouvernance.'],
    ],
    localItems: [
      'Le rappel par défaut ne lit que fichiers et snapshots locaux : zéro LLM, réseau ou token par requête.',
      'Les événements restent dans un dossier local ignoré par Git. Sans outcome, l’interface affiche « indisponible », pas un faux 0 %.',
      'Secrets et données personnelles ou de production interdits dans Git le sont aussi dans la mémoire.',
      'embedding est optionnel et isolé ; il rejoint le ranking weighted seulement après preuve A/B locale.',
    ],
    researchIntro: 'OwnMem ne revendique pas ces fondations. Sa contribution est leur composition en protocole exécutable pour la mémoire de dépôt :',
    researchItems: [
      `**Mémoire agent et réflexion :** ${COMMON.links.reflexion}, ${COMMON.links.memgpt}`,
      `**Empoisonnement de mémoire et de connaissances :** ${COMMON.links.agentPoison}, ${COMMON.links.poisonedRag}`,
      `**Données non fiables séparées de l’autorité :** ${COMMON.links.camel}`,
      `**Provenance indépendante :** ${COMMON.links.intoto}`,
      `**Prédiction sélective et abstention :** ${COMMON.links.selective}`,
      `**Validation différentielle et compensation :** ${COMMON.links.metamorphic}, ${COMMON.links.sagas}`,
      `**Évaluation décomposée du retrieval :** ${COMMON.links.ares}, ${COMMON.links.ragchecker}`,
    ],
    researchAfter: 'Ces citations indiquent une filiation ; elles ne signifient ni que ces travaux implémentent OwnMem ni qu’OwnMem reproduit leurs expériences.',
    docsHeader: ['Document', 'Contenu'],
    docsRows: [['architecture', 'Frontières, snapshots, confiance et évolution'], ['technical', 'Mécanismes, menaces et recherche'], ['plugins', 'Installation optionnelle des plugins'], ['updating', 'Mise à jour sûre et migration 0.2 → 0.3'], ['privacy', 'Données locales et canaux optionnels'], ['changelog', 'Historique des versions'], ['license', 'Apache-2.0']],
    closing: 'OwnMem est open source. Les issues et pull requests reproductibles sont bienvenues.',
  },
  de: {
    tagline: 'Projektgedächtnis für Coding Agents im Repository: lokal, deterministisch, reviewbar und innerhalb sicherer Grenzen selbstverbessernd.',
    chips: '`Git-nativ` · `lokaler Recall` · `Multi-Agent` · `evidenzgesteuert` · `Apache-2.0`',
    headings: ['Warum OwnMem', 'Architektur', 'Was 0.3 besonders macht', 'In drei Minuten starten', 'Tägliche Nutzung', 'Grenze von Vertrauen und Automatisierung', 'Wann es passt', 'Standardmäßig lokal', 'Forschungslinie', 'Dokumentation'],
    whyIntro: 'Die meisten Memory-Systeme optimieren „mehr erinnern“. OwnMem fragt zuerst: **Wem gehört Projektwissen, wer darf es ändern und wie stoppen wir eine falsche Erinnerung, bevor sie Agent-Aktionen beeinflusst?**',
    whyHeader: ['Vorteil', 'Praktische Bedeutung'],
    whyRows: [
      ['**Das Repository besitzt das Memory**', 'Lesbares Markdown in `.ownmem/` reist beim Clone, Review und Rollback mit dem Code.'],
      ['**Ein Memory für viele Agents**', 'Claude Code, Codex, Cursor, Gemini CLI, Grok CLI und weitere Hosts teilen eine Quelle.'],
      ['**Deterministischer lokaler Recall**', 'Kein Modell, kein Netzwerk; gleiche Query, Config und Snapshot ergeben dieselbe Rangfolge.'],
      ['**Evidenz vor Autorität**', 'Text kann sich nicht selbst vertrauenswürdig nennen; unabhängige Receipts und Live-Prüfung entscheiden.'],
      ['**Begrenztes Wachstum**', 'Schema, Quota, Duplikate, Lifecycle und Audit verhindern ein zweites verlassenes Wiki.'],
      ['**Niedriges Risiko automatisch**', 'Nur per Replay bewiesene R0-Retrieval-Metadaten entwickeln sich unbeaufsichtigt.'],
    ],
    architectureAlt: 'OwnMem-Architektur: Repository-eigenes Markdown und unabhängige Trust Receipts werden zu unveränderlichen Snapshots kompiliert; deterministischer lokaler Recall passiert vier Auslieferungstore, während ein begrenzter Evolutionskoordinator risikoarme Änderungen replayt, promotet, beobachtet, isoliert und präzise zurückrollt.',
    architectureIntro: 'OwnMem trennt „Erfahrung aufschreiben“ von „sie einem Agent liefern“:',
    architectureItems: [
      '**Das Repository ist die Quelle.** L1-Routing, L2-Indizes und L3-Topics sind reviewbares Markdown; Trust Receipts stehen außerhalb des autorisierten Textes.',
      '**Erst kompilieren, dann erinnern.** Schema, Graph, Lifecycle und Evidenz erzeugen einen content-addressed unveränderlichen Snapshot.',
      '**Fünf deterministische Kanäle.** exact, BM25F, n-gram, fuzzy und graph werden lokal fusioniert. embedding ist ein optionaler sechster Kanal mit Gewicht 0 bis zum A/B-Nachweis.',
      '**Vier Auslieferungstore.** Relevanz, faktische Gültigkeit, Anwendbarkeit und Risiko führen zu normal, advisory, Quarantäne oder Abstention.',
      '**Begrenzte autonome Evolution.** Am Turn-Ende wird nur bewiesenes, quota-begrenztes und exakt reversibles R0 promoviert; R1–R5 geht ins Review.',
    ],
    techIntro: 'Der Unterschied ist keine einzelne Ranking-Formel. OwnMem 0.3 macht Agent Memory zu einem verifizierbaren Evolutionsprotokoll:',
    techHeader: ['Mechanismus', 'OwnMem 0.3'],
    techRows: [
      ['**Evidenztragendes Memory**', 'Hash, Evidenzwurzel, Lifecycle, Anwendbarkeit, Risiko und Vorgänger-Receipts entscheiden über Kontext.'],
      ['**Kontrafaktisches Promotion-Gate**', 'Baseline-Miss, nur durch den Kandidaten erzeugte Recovery und null Regression müssen bewiesen werden.'],
      ['**Risiko aus der Änderungsfläche**', 'Es folgt aus Änderung und Wirkung; der Agent kann seinen eigenen Vorschlag nicht herunterstufen.'],
      ['**Content-addressed kompensierender Rollback**', 'Automatische Edits tragen eine geprüfte Inverse und stellen exakte Bytes wieder her, ohne Historie zu löschen.'],
      ['**Quarantäne gegen Memory Poisoning**', 'Kandidat, Inhalt, Autorität und Evidenz sind getrennt; gefunden zu werden gewährt keine Befugnis.'],
      ['**Selektive Auslieferung**', 'Fehlende Evidenz ergibt advisory, Quarantäne oder Abstention statt erfundener Sicherheit.'],
      ['**Unveränderliche kompilierte Snapshots**', 'Markdown, Graph, Ranking-Identität und Trust State bilden reproduzierbaren Runtime-Input.'],
      ['**Drei unverwechselbare Ledger**', 'Recall-Korrektheit, bestätigte Outcomes und Agent-Selbstzuordnung bleiben getrennt.'],
    ],
    technicalLink: 'Mehr im [technischen Design und Research Mapping](../TECHNICAL.md).',
    quickIntro: 'Erfordert Node.js 20.6 oder neuer. Im Repository ausführen, das das Memory besitzen soll:',
    quickAfter: 'Danach den Agent neu öffnen. OwnMem erstellt `.ownmem/` und ändert nur verwaltete Markerbereiche. Für einen Adapter `--hosts claude`, `--hosts codex`, `--hosts cursor` oder `--hosts gemini` verwenden; mit `npx ownmem init --check` vorher prüfen.',
    dailyIntro: 'Danach in natürlicher Sprache weiterarbeiten:',
    rememberQuote: '> „Merke dir: Das staging timeout kommt vom pool cap, nicht von zu wenigen workers. Prüfe nächstes Mal beides.“',
    recallQuote: '> „Bevor du das änderst, prüfe, ob das Projektgedächtnis denselben Fehler kennt.“',
    dailyAfter: 'Der Host ruft vor relevanter Arbeit ab und plant am Turn-Ende eine gesperrte, entprellte Evolution. promotion, trust, audit und compile müssen normalerweise nicht manuell verkettet werden. Lokale Konsole und Coordinator-Status zeigen den Zustand:',
    trustIntro: 'OwnMem automatisiert, was eine Maschine beweisen kann, nicht was nur plausibel klingt.',
    trustItems: [
      '**Automatisch:** deterministischer Recall, Scan, Tripwire, kontrafaktisches Replay, R0-Backfill, Maschinen-Receipt, Audit, Compile, Beobachtung, Quarantäne und exakter Rollback.',
      '**Zum Review:** neuer Text, Policy, Active Set, Konflikte, ungenügende Evidenz, R1–R5 und Veröffentlichung.',
      '**Harte Grenze:** candidate ist nicht memory; Selbstzuordnung ist keine Bestätigung; Recall-Text überschreibt keine Host-Anweisungen oder Tool-Rechte.',
      '**Bei Fehlern:** unsignierter Inhalt oder unprüfbare Evidenz wird isoliert; Drift wird advisory; Transaktionsfehler stellen den letzten validierten Zustand her.',
    ],
    fitHeader: ['OwnMem passt', 'Anderes System wählen'],
    fitRows: [
      ['Projektwissen soll mit Code reviewt und migriert werden.', 'Repository-übergreifendes persönliches Profil oder globales User Memory ist nötig.'],
      ['Mehrere Coding Agents wechseln sich in einem Repository ab.', 'Alle Gespräche sollen ohne Evidenz- oder Risikogrenze automatisch gespeichert werden.'],
      ['Lokaler, reproduzierbarer Recall ohne Query-Kosten zählt.', 'Große Cloud-Vektorsuche oder globaler Echtzeitgraph ist nötig.'],
      ['Falsches Memory muss zurechenbar, ablehnbar und reversibel sein.', 'Menge ist wichtiger als Governance.'],
    ],
    localItems: [
      'Standard-Recall liest nur Repository-Dateien und lokale Snapshots: null LLM-, Netzwerk- und Query-Token-Kosten.',
      'Runtime-Events bleiben in einem von Git ignorierten lokalen Ordner. Ohne Outcomes erscheint „nicht verfügbar“, nie erfundene 0 %.',
      'Secrets sowie persönliche oder Produktionsdaten, die nicht in Git gehören, gehören auch nicht ins Memory.',
      'embedding ist optional und isoliert; weighted ranking beginnt erst nach lokalem A/B-Sicherheitsnachweis.',
    ],
    researchIntro: 'OwnMem beansprucht diese Grundlagen nicht als Erfindung. Der Beitrag ist ihre Kombination zu einem ausführbaren Protokoll für Repository Memory:',
    researchItems: [
      `**Agent Memory und Reflexion:** ${COMMON.links.reflexion}, ${COMMON.links.memgpt}`,
      `**Memory- und Wissens-Poisoning:** ${COMMON.links.agentPoison}, ${COMMON.links.poisonedRag}`,
      `**Untrusted Data getrennt von Authority:** ${COMMON.links.camel}`,
      `**Unabhängige Provenance:** ${COMMON.links.intoto}`,
      `**Selektive Vorhersage und Abstention:** ${COMMON.links.selective}`,
      `**Differentielle Validierung und Kompensation:** ${COMMON.links.metamorphic}, ${COMMON.links.sagas}`,
      `**Zerlegte Retrieval-Evaluation:** ${COMMON.links.ares}, ${COMMON.links.ragchecker}`,
    ],
    researchAfter: 'Die Zitate zeigen die Forschungslinie; sie bedeuten weder, dass diese Arbeiten OwnMem implementieren, noch dass OwnMem ihre Experimente reproduziert.',
    docsHeader: ['Dokument', 'Inhalt'],
    docsRows: [['architecture', 'Grenzen, Snapshots, Trust und Evolution'], ['technical', 'Mechanismen, Bedrohungen und Forschung'], ['plugins', 'Optionale Host-Plugins'], ['updating', 'Sicheres Update und 0.2 → 0.3 Migration'], ['privacy', 'Lokale Daten und optionale Kanäle'], ['changelog', 'Versionsverlauf'], ['license', 'Apache-2.0']],
    closing: 'OwnMem ist Open Source. Reproduzierbare Issues und Pull Requests sind willkommen.',
  },
  'pt-BR': {
    tagline: 'Memória de projeto para agentes de programação no repositório: local, determinística, revisável e capaz de evoluir dentro de limites seguros.',
    chips: '`Nativo do Git` · `recall local` · `multiagente` · `governado por evidência` · `Apache-2.0`',
    headings: ['Por que OwnMem', 'Arquitetura', 'O diferencial da versão 0.3', 'Comece em três minutos', 'Uso diário', 'Limite entre confiança e automação', 'Quando usar', 'Local por padrão', 'Linhagem de pesquisa', 'Documentação'],
    whyIntro: 'A maioria dos sistemas otimiza “lembrar mais”. O OwnMem começa por outra pergunta: **quem possui o conhecimento do projeto, quem pode alterá-lo e como impedir uma memória errada antes que ela mude as ações do agente?**',
    whyHeader: ['Vantagem', 'O que significa na prática'],
    whyRows: [
      ['**A memória pertence ao repositório**', 'Markdown legível em `.ownmem/` acompanha o código em clone, revisão e rollback.'],
      ['**Uma memória para vários agentes**', 'Claude Code, Codex, Cursor, Gemini CLI, Grok CLI e outros hosts compartilham uma fonte.'],
      ['**Recall local e determinístico**', 'Sem modelo ou rede; mesma consulta, configuração e snapshot geram a mesma ordem.'],
      ['**Evidência antes da autoridade**', 'O conteúdo não pode se declarar confiável; receipts independentes e evidência viva decidem.'],
      ['**Crescimento limitado**', 'Schema, cotas, duplicatas, ciclo de vida e auditoria evitam outro wiki abandonado.'],
      ['**Baixo risco automático, alto impacto revisado**', 'Somente metadata R0 comprovada por replay evolui sem intervenção.'],
    ],
    architectureAlt: 'Arquitetura do OwnMem: Markdown pertencente ao repositório e trust receipts independentes são compilados em snapshots imutáveis; recall local determinístico passa por quatro portões de entrega, enquanto um coordenador limitado reproduz, promove, observa, isola e reverte com precisão mudanças de baixo risco.',
    architectureIntro: 'O OwnMem separa “registrar a experiência” de “entregá-la a um agente”:',
    architectureItems: [
      '**O repositório é a fonte.** Rotas L1, índices L2 e tópicos L3 são Markdown revisável; trust receipts ficam fora do texto autorizado.',
      '**Compile antes do recall.** Schema, grafo, ciclo de vida e evidência geram um snapshot imutável endereçado por conteúdo.',
      '**Cinco canais determinísticos.** exact, BM25F, n-gram, fuzzy e graph são fundidos localmente. embedding é um sexto canal opcional com peso 0 até passar A/B.',
      '**Quatro portões de entrega.** relevância, validade factual, aplicabilidade e risco resultam em entrega, advisory, quarentena ou abstenção.',
      '**Evolução autônoma limitada.** No fim do turno, só R0 comprovado, dentro da cota e exatamente reversível é promovido; R1–R5 vai para revisão.',
    ],
    techIntro: 'O diferencial não é uma fórmula de ranking. O OwnMem 0.3 transforma memória de agente em um protocolo de evolução verificável:',
    techHeader: ['Mecanismo', 'OwnMem 0.3'],
    techRows: [
      ['**Memória com evidência**', 'Hash, raiz de evidência, ciclo de vida, aplicabilidade, risco e receipts anteriores decidem a entrada no contexto.'],
      ['**Portão contrafactual de promoção**', 'É preciso provar falha na base, recuperação só pelo candidato e zero regressão no corpus aprovado.'],
      ['**Risco pela superfície alterada**', 'Deriva do que mudou e do impacto possível; o agente não pode rebaixar a própria proposta.'],
      ['**Rollback compensatório endereçado**', 'Mudanças automáticas carregam uma inversa verificada e restauram bytes exatos sem apagar histórico.'],
      ['**Quarentena contra poisoning**', 'Candidato, conteúdo, autoridade e evidência são domínios separados; ser recuperado não concede permissão.'],
      ['**Entrega seletiva**', 'Evidência insuficiente gera advisory, quarentena ou abstenção, nunca confiança inventada.'],
      ['**Snapshots compilados imutáveis**', 'Markdown, grafo, identidade de ranking e confiança formam uma entrada de runtime reproduzível.'],
      ['**Três registros sem mistura**', 'Correção do recall, outcomes confirmados e autoatribuição do agente permanecem separados.'],
    ],
    technicalLink: 'Leia o [design técnico e o mapeamento de pesquisa](../TECHNICAL.md).',
    quickIntro: 'Requer Node.js 20.6 ou mais recente. Execute no repositório que deve possuir a memória:',
    quickAfter: 'Reabra o agente após inicializar. O OwnMem cria `.ownmem/` e altera apenas áreas marcadas como gerenciadas. Para um adaptador use `--hosts claude`, `--hosts codex`, `--hosts cursor` ou `--hosts gemini`; veja antes com `npx ownmem init --check`.',
    dailyIntro: 'Depois, continue trabalhando em linguagem natural:',
    rememberQuote: '> “Lembre: o timeout de staging vem do limite do pool, não de poucos workers. Verifique os dois na próxima vez.”',
    recallQuote: '> “Antes de mudar, veja se a memória do projeto já encontrou a mesma falha.”',
    dailyAfter: 'O host faz recall antes do trabalho relevante e agenda uma evolução bloqueada e com debounce ao fim do turno. Normalmente não é preciso encadear promotion, trust, audit e compile. Use o console local ou o status do coordenador para acompanhar:',
    trustIntro: 'O OwnMem automatiza o que a máquina consegue provar, não o que apenas parece plausível.',
    trustItems: [
      '**Automático:** recall determinístico, varredura, tripwire, replay contrafactual, backfill R0, receipt de máquina, audit, compile, observação, quarentena e rollback exato.',
      '**Para revisão:** nova prosa, política, active set, conflitos, evidência insuficiente, mudanças R1–R5 e publicação.',
      '**Limite rígido:** candidate não é memory; autoatribuição não é confirmação; texto recuperado não substitui instruções nem autoriza ferramentas.',
      '**Em falhas:** conteúdo não assinado ou evidência não verificável é isolado; drift vira advisory; falha transacional restaura o estado validado anterior.',
    ],
    fitHeader: ['OwnMem é adequado', 'Prefira outro sistema'],
    fitRows: [
      ['O conhecimento deve ser revisado e migrar com o código.', 'Você precisa de perfil pessoal ou memória global entre repositórios.'],
      ['Vários agentes se alternam em um repositório.', 'Você quer capturar toda conversa sem limites de evidência ou risco.'],
      ['Recall local, reproduzível e sem custo por consulta importa.', 'Você precisa de busca vetorial cloud em escala ou grafo global em tempo real.'],
      ['Memória errada deve ser atribuível, rejeitável e reversível.', 'Quantidade importa mais que governança.'],
    ],
    localItems: [
      'O recall padrão lê apenas arquivos e snapshots locais: zero LLM, rede e tokens por consulta.',
      'Eventos ficam em diretório local ignorado pelo Git. Sem outcomes, aparece “indisponível”, nunca 0% inventado.',
      'Segredos e dados pessoais ou de produção que não pertencem ao Git também não pertencem à memória.',
      'embedding é opcional e isolado; só entra no ranking weighted após evidência A/B local.',
    ],
    researchIntro: 'O OwnMem não reivindica essas bases como invenções. Sua contribuição é combiná-las em um protocolo executável para memória de repositório:',
    researchItems: [
      `**Memória de agentes e reflexão:** ${COMMON.links.reflexion}, ${COMMON.links.memgpt}`,
      `**Poisoning de memória e conhecimento:** ${COMMON.links.agentPoison}, ${COMMON.links.poisonedRag}`,
      `**Dados não confiáveis separados da autoridade:** ${COMMON.links.camel}`,
      `**Proveniência independente:** ${COMMON.links.intoto}`,
      `**Predição seletiva e abstenção:** ${COMMON.links.selective}`,
      `**Validação diferencial e compensação:** ${COMMON.links.metamorphic}, ${COMMON.links.sagas}`,
      `**Avaliação de retrieval decomposta:** ${COMMON.links.ares}, ${COMMON.links.ragchecker}`,
    ],
    researchAfter: 'As citações mostram a linhagem; não significam que esses trabalhos implementem o OwnMem nem que o OwnMem reproduza seus experimentos.',
    docsHeader: ['Documento', 'Conteúdo'],
    docsRows: [['architecture', 'Limites, snapshots, confiança e evolução'], ['technical', 'Mecanismos, ameaças e pesquisa'], ['plugins', 'Instalação opcional de plugins'], ['updating', 'Atualização segura e migração 0.2 → 0.3'], ['privacy', 'Dados locais e canais opcionais'], ['changelog', 'Histórico de versões'], ['license', 'Apache-2.0']],
    closing: 'OwnMem é código aberto. Issues e pull requests reproduzíveis são bem-vindos.',
  },
};

const DOCUMENT_LABELS = {
  architecture: 'Architecture', technical: 'Technical design', plugins: 'Plugins', updating: 'Updating',
  privacy: 'Privacy', changelog: 'Changelog', license: 'License',
};

function table(header, rows) {
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n');
}

function list(items) {
  return items.map(item => `- ${item}`).join('\n');
}

function relativeLink(fromFile, toFile) {
  const relative = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return relative.startsWith('.') ? relative : `./${relative}`;
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
    license: 'LICENSE',
  };
  return Object.fromEntries(Object.entries(targets).map(([key, target]) => [key, relativeLink(file, target)]));
}

function render(locale, file) {
  const t = COPY[locale];
  const assetBase = relativeLink(file, 'docs/assets').replace(/\/$/, '');
  const docs = documentTargets(file, locale);
  const suffix = locale === 'en' ? '' : `-${locale}`;
  const docRows = t.docsRows.map(([key, purpose]) => [`[${DOCUMENT_LABELS[key]}](${docs[key]})`, purpose]);
  return `<div align="center">

# OwnMem

**${t.tagline}**

${t.chips}

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![node >= 20.6](https://img.shields.io/badge/node-%E2%89%A5%2020.6-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](${docs.license})

${languageSwitcher(file)}

</div>

## ${t.headings[0]}

${t.whyIntro}

${table(t.whyHeader, t.whyRows)}

## ${t.headings[1]}

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="${assetBase}/architecture${suffix}-dark.svg">
  <img alt="${t.architectureAlt}" src="${assetBase}/architecture${suffix}-light.svg" width="100%">
</picture>

${t.architectureIntro}

${list(t.architectureItems)}

## ${t.headings[2]}

${t.techIntro}

${table(t.techHeader, t.techRows)}

${t.technicalLink}

## ${t.headings[3]}

${t.quickIntro}

${COMMON.install}

${t.quickAfter}

## ${t.headings[4]}

${t.dailyIntro}

${t.rememberQuote}

${t.recallQuote}

${t.dailyAfter}

${COMMON.evolution}

## ${t.headings[5]}

${t.trustIntro}

${list(t.trustItems)}

## ${t.headings[6]}

${table(t.fitHeader, t.fitRows)}

## ${t.headings[7]}

${list(t.localItems)}

## ${t.headings[8]}

${t.researchIntro}

${list(t.researchItems)}

${t.researchAfter}

## ${t.headings[9]}

${table(t.docsHeader, docRows)}

${t.closing}
`;
}

for (const [locale, , file] of LANGUAGES) {
  if (!COPY[locale]) continue;
  const output = path.join(ROOT, file);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, render(locale, file), 'utf8');
  process.stdout.write(`wrote ${file}\n`);
}
