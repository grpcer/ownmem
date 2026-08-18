<div align="center">

# OwnMem — 面向 AI 编程 Agent 的 Git 原生项目记忆

**记忆归仓库所有：本地、确定、可审阅。**

开源、本地优先的 AI 记忆系统，专为编程 Agent 和代码仓库而设。<br>
一份持久项目记忆，同时供 Claude Code · Codex · Antigravity · Cursor · Gemini CLI · Grok CLI 使用。

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![node >= 20](https://img.shields.io/badge/node-%E2%89%A5%2020-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](../../LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/grpcer/ownmem/ci.yml?branch=main&style=flat-square&logo=githubactions&logoColor=white&label=CI)](https://github.com/grpcer/ownmem/actions/workflows/ci.yml)
[![recall P95 2.46 ms](https://img.shields.io/badge/recall%20P95-2.46%20ms-8250df?style=flat-square)](#基准测试)
[![model calls 0](https://img.shields.io/badge/model%20calls-0-8250df?style=flat-square)](#基准测试)

[English](../../README.md) · **简体中文** · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · [Português (BR)](./README.pt-BR.md)

</div>

## OwnMem 是什么？

OwnMem 是一个开源的编程 Agent 记忆系统，把项目决策、约束和排障经验以可审阅的
纯 Markdown 保存在代码仓库的 `.ownmem/` 中。同一份长期项目记忆可以跨 Agent、
跨会话使用，随 Git 审阅、协作和回滚。

支持多种文字系统的确定性 BM25F 引擎负责排序。在查询、配置和已编译快照相同时，
默认召回会返回相同排序，不调用模型、不请求网络，也不产生查询时 Token 成本；
在公开基准上通常只需两毫秒左右。

OwnMem 分为两部分。**npm 包**是核心引擎：以可审查的 `devDependency` 安装在
每个仓库中，管理该仓库 `.ownmem/` 里的记忆。**Agent 插件**是可选的辅助工具，
每台电脑只需安装一次；它会教 Agent 调用引擎，并引导你完成项目初始化。

> **提示：** 只要仓库中已有 npm 包和 `.ownmem/`，OwnMem 就可以工作；使用
> 哪种安装入口都不影响结果。

## OwnMem 一览

| 事实 | OwnMem v0.2.0 |
| --- | --- |
| 类别 | 归仓库所有的 AI 编程 Agent 项目记忆 |
| 范围 | 单个代码仓库；保存经筛选的工程知识，而非聊天记录 |
| 存储 | `.ownmem/` 中可审阅的 Markdown，由 Git 进行版本管理 |
| 默认召回 | 确定性 BM25F；0 次模型调用，0 次网络请求 |
| 公开基准 | 锁定合成基准上 Recall@1 为 100%、P95 为 2.46 ms——这是回归证据，不是真实用户准确率 |
| 许可证 | Apache-2.0 |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture-zh-CN-dark.svg">
  <img alt="OwnMem 端到端架构，三个信任域：仓库保存精选的 Markdown，经治理门禁编译为不可变快照；确定性引擎经六条候选通道、排序、置信门禁与 400 Token 上下文限额作答；编程 Agent 提问、对照当前代码复核，再通过 `audit` 与 `compile` 把新经验写回仓库" src="../assets/architecture-zh-CN-light.svg" width="100%">
</picture>

## 快速开始

OwnMem 需要 Node.js 20 或更新版本。三个步骤，全部在你希望“会记事”的
仓库里完成。

**第 1 步——安装引擎。** 它会成为一个普通的 `devDependency`，像其他依赖
一样可审查、可锁定版本：

```bash
npm install --save-dev ownmem
```

**第 2 步——初始化这个仓库。** 这会创建 `.ownmem/` 和每个 Agent 的
适配文件：

```bash
npx ownmem init --locale auto --hosts claude,codex --layers dashboard --hook
```

**第 3 步——重新打开你的 Agent。** Agent 在会话开始时才会发现命令，所以
下面这些都出现在下一个会话里，而不是运行 init 的那个会话。

这是推荐配置——Claude Code 和 Codex 都能直接使用，同时带本地控制台。
重新打开后你将拥有：

- **Claude Code** 获得一个项目命令：`/ownmem <任何你想让记忆做的事>`。
- **Codex 和 Grok CLI** 会自动发现仓库里的 `ownmem` skill。
- **Antigravity** 会加载同样的项目说明（`AGENTS.md`、`GEMINI.md`），
  因此同样遵守记忆纪律——所有读取这些文件的其他 Agent 也是如此。
- **控制台**是终端命令，不是斜杠命令：`npx ownmem dashboard --open`。
  （下文的可选插件会额外提供 `/ownmem:dashboard`。）

不需要每天再运行命令——照常工作即可。每个需要独立记忆的仓库，都把这
三个步骤重复一次。

只用一种工具？把 `--hosts claude,codex` 改成 `--hosts claude` 或
`--hosts codex`。Antigravity 和 Grok CLI 读取的是和 Codex 相同的
`AGENTS.md`（Grok 还会读 `.agents/skills/`）文件，所以 `--hosts codex`
就覆盖了两者。Cursor 使用 `--hosts cursor`，经典 Gemini CLI 环境使用
`--hosts gemini`；其他 Agent 可以使用 `--hosts generic`。

初始化会创建 `.ownmem/`，并在 Agent 的项目说明里加入一小段 OwnMem 配置；
所有标记范围之外的原有内容都不会被改动。

## 日常使用

安装完成后，平时只需要做两件事。

**1. 直接告诉 Agent。** 遇到值得留下来的经验，用平常说话的方式告诉它：

> “记住：staging 部署超时是因为连接池上限，不是 worker 太少。以后调整
> worker 时，要一起检查连接池。”

下次再遇到类似问题，照常提问即可：

> “staging 部署又卡住了，先查一下项目记忆里有没有类似问题，再开始改。”

Agent 会自己完成记忆写入、检查和召回。你不需要打开 `.ownmem/`，也不用
手动运行 `audit` 或 `recall`。更想用显式命令？`/ownmem <请求>`
（Claude Code）与 `ownmem` skill（Codex）会把同样的请求路由到记忆。

**2. 想看运行情况时，打开控制台。** 这里可以看到使用情况、召回质量、延迟
和记忆库健康状态；页面只在你自己的电脑上通过 127.0.0.1 打开：

```bash
npx ownmem dashboard --open
```

<img alt="OwnMem 控制台——使用情况、召回质量、记忆库与治理状态，全部在本地" src="../assets/console.png" width="100%">

就这么简单。`audit`、手动 `recall` 和反馈命令是给 CI 与排障用的，正常使用
不需要记。

## 缘起

我在做 Oriveo——一个覆盖 iOS、Android、Web 与桌面端的 BYOK 多模型 AI 客户端。这个不小的代码库每天都靠编程 Agent 开发，我在 Claude Code 和 Codex 之间来回切换。每个仓库都在不断沉淀来之不易的教训：调试根因、工具链的坑、时序竞态。可这些教训住在某一个工具的记忆里、某一台机器上——换 Agent、换机器、换协作者，它们就悄悄丢了。

向量与云端记忆服务始终让我觉得不对味：关于一个仓库的知识，不该需要账号、服务器，或者按次付费。于是记忆搬进了仓库本身。OwnMem 就是我每天在 Oriveo 代码库里跑的那套系统——数百条经筛选的记忆，由配额与审计管着——抽出来重写成一个干净的公共引擎。

## 为什么选 OwnMem

OwnMem 坚持四个原则，所有设计都围绕它们展开：

- **记忆属于仓库。** 以可审阅的 Markdown 形式随 git 流转，出现在 pull
  request 里，像任何代码一样可回滚。克隆仓库即得到记忆——不需要账号、
  不需要同步服务、不需要导出步骤。
- **召回必须免费且确定。** 同样的查询返回同样的排序，没有模型调用、没有
  延迟税、没有按次计费：在锁定的公开 benchmark 上 Recall@1 100%，P95 仅
  2.46 ms。
- **记忆必须比任何单一工具活得久。** 同一批文件同时服务 Claude Code、
  Codex、Antigravity、Cursor、Gemini CLI 与 Grok CLI，换 Agent 永远不意味着丢掉团队
  学到的东西。
- **记忆库必须控制规模，才能长期可信。** 零净增长配额、纯 Node 审计、
  近重复与防漂移检查让内容保持精简、及时更新，不会变成没人维护的第二个 Wiki。

### OwnMem 不是什么

- **不是向量数据库。** 想要在大记忆池上做模糊语义检索，向量或知识图谱类
  记忆服务更合适。
- **不会自动收集一切。** 每条记忆都要主动写入并经过筛选，审阅本身就是
  质量保障。各工具的内建记忆更省事，但通常只能留在单一工具中，也不便审查。
- **不是跨仓库或云同步的记忆。** 记忆随仓库自己的 git 历史走——clone 下来
  就有；但它不跨仓库共享，也不经过任何云端记忆服务，这是设计使然。

## `.ownmem/` 内部：三层记忆

常驻加载的部分保持极小，其余全部按需读取：

| 层 | 文件 | 何时被读 |
| --- | --- | --- |
| **L1** | `MEMORY.md` | 总索引——每次会话开始时加载 |
| **L2** | `MEMORY-<area>.md` | 领域子索引——触及该领域时打开 |
| **L3** | 每个 topic 一个文件 | 一课一文件——`recall` 命中其 triggers 时返回 |

topic 文件是带严格 schema 校验 frontmatter 的纯 Markdown——症状与措辞写进
`triggers`，证据写进 `evidence`（此处为节选；`ownmem init` 会生成一份
完整示例）：

```markdown
---
name: pool_cap_timeout
description: staging deploys time out when workers exceed the pool cap
metadata:
  type: lesson
  triggers: ["staging deploy timeout", "pool cap exceeded"]
  evidence: [deploy-2026-08-12.log]
---

Raising the worker count without raising the connection pool cap exhausts
the pool, and every deploy waits until it times out. Raise both together.
```

召回之所以能免费，靠的正是这个结构：索引小到可以常驻，BM25F 只需要对小而
标注良好的 topic 文件排序。

## 与其他方案的对比

下表中每一列都在解决真实的问题——表格展示的是各自的取舍，包括我们自己的。

| | OwnMem | [Mem0 (OSS)](https://github.com/mem0ai/mem0) | [Zep / Graphiti](https://github.com/getzep/graphiti) | [claude-mem](https://github.com/thedotmack/claude-mem) | 工具内建自动记忆¹ |
| --- | :---: | :---: | :---: | :---: | :---: |
| 记忆住在你的仓库里，随 git 与 PR 流转 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 人类可读、可审阅的 Markdown | ✅ | ❌ | ❌ | ❌ | ⚠️² |
| 召回不调用模型、不发网络请求 | ✅ | ❌³ | ❌ | ❌ | — |
| 确定性、可复现的排序 | ✅ | ❌ | ❌ | ❌ | — |
| 一份记忆同时供 Claude Code、Codex、Antigravity、Cursor、Gemini CLI、Grok CLI 使用 | ✅ | ⚠️⁴ | ⚠️⁴ | ⚠️⁴ | ❌ |
| 防膨胀治理（增长配额、审计、防漂移门禁） | ✅ | ❌ | ❌ | ❌ | ⚠️⁵ |
| 语义级同义改写检索 | ⚠️⁶ | ✅ | ✅ | ✅ | ❌ |
| 全自动捕获 | ❌⁷ | ✅ | ✅ | ✅ | ✅ |
| 跨仓库、用户级记忆 | ❌⁷ | ✅ | ✅ | ⚠️ | ❌ |

¹ 指 Claude Code 自动记忆与 Codex Memories：文件放在用户主目录下——
只在本机、锁定单一工具、不在仓库内。Cursor 已在 2.1 移除 Memories 改用
Rules；Windsurf 的记忆同样只留在本机且从不提交。
² 是可编辑的 Markdown，但位于仓库之外，因此永远不会出现在 pull request
里。
³ Mem0 的 Apache-2.0 库可以本地运行，但写入与查询仍需要一个 LLM 和一个
embedding 模型（默认 OpenAI key，或经 Ollama 使用本地模型）。
⁴ 经由 MCP server 或其自有 API——记忆按用户或应用划分，不是一组归你仓库
所有的文件。
⁵ Claude Code 对常驻加载的索引设了上限（200 行 / 25 KB），但背后没有配额、
审计或去重门禁。
⁶ 可选的 embedding 通道，默认关闭；只有本地 A/B 证据通过安全门后才参与
排序。
⁷ 设计使然。OwnMem 押注于经筛选、经审阅的写入与单仓库作用域；如果你需要
全自动捕获或跨应用的用户级记忆，那些工具确实更合适。

以上事实于 2026 年 8 月核对，依据各项目的公开文档：[Mem0](https://docs.mem0.ai)、
[Zep / Graphiti](https://help.getzep.com/graphiti/getting-started/overview)、
[claude-mem](https://github.com/thedotmack/claude-mem)、
[Claude Code 自动记忆](https://code.claude.com/docs/en/memory)、
[Codex memories](https://developers.openai.com/codex/memories)、
[Cursor rules](https://cursor.com/docs/context/rules)、
[Windsurf memories](https://docs.devin.ai/desktop/cascade/memories)——欢迎指正。

## 基准测试

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/benchmark-dark.svg">
  <img alt="OwnMem 基准：Recall@1 100% 对比 naive grep 的 3.1%；召回延迟 P50 1.17 ms / P95 2.46 ms，发布门禁 5 ms" src="../assets/benchmark-light.svg" width="100%">
</picture>

每次发布都必须通过一个锁定的公开 benchmark：40 主题的 CC0 语料，覆盖 40
个 BCP 47 语言标签与 25 个文字系统分组，含 128 条正例查询与 40 条无关负例。
下列数字来自 release 级运行（每条查询计时 25 轮）：

| 指标 | 结果 | 发布门禁 |
| --- | --- | --- |
| Recall@1 / Recall@5（128 条正例查询） | **100% / 100%** | = 100% |
| MRR | **1.000** | = 1.000 |
| 40 条无关查询的正确弃答 | **40 / 40** | = 100% |
| 召回延迟 P50 / P95（4,200 次计时采样） | **1.17 ms / 2.46 ms** | P95 ≤ 5 ms |
| 同一门禁覆盖的语言 / 文字系统 | 40 标签 / 25 文字系统 | 分语言与分文字系统 P95 ≤ 5 ms |
| 召回期间的模型调用 / 网络请求 | **0 / 0** | = 0 |
| 运行时依赖 | 2 个（`ajv`、`yaml`——纯 JS） | 锁定 |
| 运行期间的额外内存（RSS 增量） | < 2 MB | — |

在同一语料上，大小写不敏感的固定字符串 grep 只拿到 3.1% 的 Recall@1。
仅靠「词法且确定」本身并不是诀窍——Unicode 文字系统感知的 BM25F 排序
才是。

亲自复现：

```bash
git clone https://github.com/grpcer/ownmem
cd ownmem && npm ci && npm run benchmark
```

> **提示：** 测量环境为 Apple M5 Pro、Node 25。语料哈希、排序与阈值全部
> 锁定，且每次运行都会以倒序主题重跑一遍以证明确定性。这些合成指标是
> 回归证据，不代表真实用户准确率。

## 参考文献

排序管线里没有任何自创数学——引擎中的每项技术都是经过实战检验的公开方法，
OwnMem 的贡献在于把它们组合成一个确定性引擎，仅含 `ajv` 与 `yaml`
两个纯 JavaScript 运行时依赖：

| OwnMem 中的位置 | 技术 | 文献 |
| --- | --- | --- |
| `bm25f` 通道 | 字段加权 BM25 排序 | Robertson & Zaragoza (2009), *[The Probabilistic Relevance Framework: BM25 and Beyond](https://doi.org/10.1561/1500000019)*; Robertson, Zaragoza & Taylor (2004), *[Simple BM25 extension to multiple weighted fields](https://doi.org/10.1145/1031171.1031181)* |
| 通道与多问法融合 | Reciprocal Rank Fusion | Cormack, Clarke & Büttcher (2009), *[Reciprocal rank fusion outperforms Condorcet and individual rank learning methods](https://doi.org/10.1145/1571941.1572114)* |
| 结果去冗 | Maximal Marginal Relevance | Carbonell & Goldstein (1998), *[The use of MMR, diversity-based reranking for reordering documents and producing summaries](https://doi.org/10.1145/290941.291025)* |
| `ngram` 通道 | 字符 n-gram 相似度（Dice） | Dice (1945), *[Measures of the amount of ecologic association between species](https://doi.org/10.2307/1932409)* |
| `fuzzy` 通道 | 有界编辑距离 | Levenshtein (1966), *Binary codes capable of correcting deletions, insertions, and reversals*, Soviet Physics Doklady 10(8) |
| 近重复闸门 | SimHash | Charikar (2002), *[Similarity estimation techniques from rounding algorithms](https://doi.org/10.1145/509907.509965)*; Manku, Jain & Das Sarma (2007), *[Detecting near-duplicates for web crawling](https://doi.org/10.1145/1242572.1242592)* |
| 近重复闸门 | MinHash | Broder (1997), *[On the resemblance and containment of documents](https://doi.org/10.1109/SEQUEN.1997.666900)* |
| 分词器 | 文字系统感知切分 | *[UAX #24: Unicode Script Property](https://unicode.org/reports/tr24/)*; *[UAX #29: Unicode Text Segmentation](https://unicode.org/reports/tr29/)* |

## 安装 Agent 插件（可选，每台机器一次）

**到底要不要装？不装也一切正常。** `ownmem init` 已经把纪律写进了仓库的
Agent 指令文件，任何打开这个仓库的 Agent 都会遵守。插件解决的是整台机器的
便利：给机器上每一个仓库加上同样的三个 skill——包括
还没有 `.ownmem/` 的仓库，init skill 会引导 Agent 完成引擎安装。本仓库
同时就是插件 marketplace；插件的命令只是路由到 `npx ownmem`，所以插件
更新永远不会改写你的记忆。

一个插件、三个 skill、一套名字：

| Skill | Claude Code | Codex CLI | 作用 |
| --- | --- | --- | --- |
| `recall` | `/ownmem:recall` | `ownmem:recall` | 改代码前先召回记忆 |
| `init` | `/ownmem:init` | `ownmem:init` | 在仓库中安装或更新 OwnMem |
| `dashboard` | `/ownmem:dashboard` | `ownmem:dashboard` | 打开本地控制台 |

**Claude Code** —— 按顺序运行这两条命令：第一条把本仓库注册为 plugin
marketplace（只需一次），第二条从这个 marketplace 安装插件：

```
/plugin marketplace add grpcer/ownmem
/plugin install ownmem@ownmem
```

然后重启 Claude Code：插件命令在会话开始时加载，所以它们会出现在下一个
会话里，而不是安装它们的那个会话。在 `/plugin` → Marketplaces 里为该
marketplace 开启自动更新，即可自动收到新版本。

**Codex CLI** —— 同样两步、按顺序执行：先注册 marketplace，再添加插件：

```
codex plugin marketplace add grpcer/ownmem
codex plugin add ownmem@ownmem
```

这里的 skill 同样在会话开始时加载；可以在 `$` skill 选择器里找到它们。
之后可用 `codex plugin marketplace upgrade ownmem` 加
`codex plugin add ownmem@ownmem` 刷新。

**Grok CLI** —— 依然是两条命令按顺序执行：先注册 marketplace，再安装
（Grok 要求显式加 `--trust`）。如果 Grok 已经导入了你的 Claude Code
marketplace，可跳过第一条命令：

```
grok plugin marketplace add grpcer/ownmem
grok plugin install ownmem@ownmem --trust
```

这会安装同样的三个 skill。当裸 skill 名已被占用时，Grok 会加上命名空间——
它内置的 dashboard 会让我们的变成 `/ownmem:dashboard`。用
`grok plugin update ownmem` 更新。

**Antigravity** —— 只需一条命令，没有 marketplace 步骤：

```
agy plugin install https://github.com/grpcer/ownmem
```

这会导入 `ownmem`、`ownmem-init`、`ownmem-dashboard` 三个 skill；
重新运行同一条命令即可更新。（经典 Gemini CLI 环境——API key、Vertex AI
或企业许可——仍可以用 `gemini extensions install https://github.com/grpcer/ownmem`
安装同一个仓库。）

## 安全的自动更新

OwnMem 面向可审查的依赖更新设计，而非静默的后台改写。为 npm 依赖启用
Dependabot 或 Renovate；当它提出 OwnMem 升级 PR 时，CI 应按顺序运行这三条命令：

```bash
npx ownmem init --update
npx ownmem init --check
npx ownmem audit
```

`init --update` 只刷新 OwnMem 管理的边界区块并保留项目记忆；`init --check`
在生成的适配文件漂移时报错。提交 `package-lock.json` 可让每个 Agent 和 CI
任务都停留在经过审查的版本上。

手动更新时，请按顺序运行全部四条命令：

```bash
npm install --save-dev ownmem@latest
npx ownmem init --update
npx ownmem init --check
npx ownmem audit
```

避免在生产仓库里使用漂移的 `npx ownmem@latest`：初次尝鲜方便，但会让每次
执行不可复现。

## 分层

按需选择机制的多少——每一层都包含前一层：

| 分层 | 新增内容 |
| --- | --- |
| `core` | 初始化、严格 schema、Unicode 文字系统感知的 BM25F 召回、确定性多查询融合、增长配额 |
| `gates` | 纯 Node 审计与近重复门禁 |
| `compiler` | 不可变快照、stdio 常驻运行时、可选的 Claude Code hook |
| `dashboard` | OwnMem Console 与可选的 embedding 评测通道 |

所有分层仅依赖纯 JavaScript 的 `ajv` 与 `yaml` 两个运行时依赖。OwnMem
Console 内置英语、简体中文、繁体中文、日语、韩语、西班牙语、法语、德语、
巴西葡萄牙语、阿拉伯语、印地语、印尼语、俄语、泰语、土耳其语、越南语的
完整语言目录。

## AI Agent 记忆系统常见问题

### 什么是 AI Agent 记忆系统？

AI Agent 记忆系统会保存 Agent 能在不同任务或会话中复用的知识。OwnMem 专注于
代码仓库：它保存经审阅的工程经验，而不是聊天记录或用户画像。

### 如何让 Claude Code 或 Codex 拥有持久项目记忆？

在每个仓库中完成一次[快速开始](#快速开始)，再重新打开 Agent。Claude Code、Codex、
Antigravity、Cursor、Gemini CLI 和 Grok CLI 都可以读取同一份 `.ownmem/`
记忆，无需各自维护信息孤岛。

### 记忆存在哪里，团队如何共享？

记忆是 `.ownmem/` 下的纯 Markdown。把适合共享的记忆提交到 Git，它们就会随仓库的
clone、pull request、权限管理和回滚流程传递；不要记录本就不应进入仓库的秘密。

### OwnMem 需要 LLM、embedding API、向量数据库或网络吗？

默认召回都不需要：它在本地做词法检索，仅含两个小型纯 JavaScript 运行时依赖。
安装包可能需要网络；可选的 embedding 通道则要等本地 A/B 证据通过安全门才会启用。

### OwnMem 与 Mem0、Graphiti、claude-mem 或内置记忆有什么不同？

OwnMem 以单个仓库为边界，记忆经筛选、结果确定，并能在 Git 中审阅。如果你需要全自动
捕获、大规模语义检索、用户级记忆、知识图谱或云同步，那些方案可能更合适；详见
[带来源与局限说明的对比](#与其他方案的对比)。

## 参与贡献

欢迎 issue 和 pull request——基本规则见 [CONTRIBUTING.md](../../.github/CONTRIBUTING.md)：
默认召回必须保持确定性、在本地运行、不调用模型；每个检索改动都要附回归用例；
提交评审前先跑 `npm test` 和 `npm run benchmark:release`。安全问题请走
[SECURITY.md](../../.github/SECURITY.md)。

## 安全与证据

- 记忆文件始终是仓库内可审阅的 Markdown。
- Schema、配额、生成边界与近重复检查全部在本地运行。
- `recall.consumed` 是衡量实际采用的核心指标；Recall@K 只是过程指标。
- 默认安装永远不下载、不调用任何模型。
- 可选的 embedding 通道在本地 A/B 证据通过安全门之前，不参与排序。

OwnMem 以 Apache-2.0 许可发布。分享产物或发布版本前，请先阅读
`docs/PRIVACY.md`、`.github/SECURITY.md` 与 `docs/RELEASE.md`。

## 致谢

- [LINUX DO](https://linux.do/)
