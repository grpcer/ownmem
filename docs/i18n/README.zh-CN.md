<div align="center">

# OwnMem

**面向 AI 编程 Agent 的 Git 原生记忆**

把 AI 编程 Agent 的项目记忆留在仓库里：本地、确定、可审阅，而且没有你提交就不会被写入。

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![npm downloads](https://img.shields.io/npm/dm/ownmem?style=flat-square&logo=npm&color=555)](https://www.npmjs.com/package/ownmem)
[![GitHub stars](https://img.shields.io/github/stars/grpcer/ownmem?style=flat-square&logo=github&color=e3b341)](https://github.com/grpcer/ownmem/stargazers)
[![release gates](https://img.shields.io/github/actions/workflow/status/grpcer/ownmem/ci.yml?branch=main&style=flat-square&label=release%20gates)](https://github.com/grpcer/ownmem/actions/workflows/ci.yml)
[![node >= 20.6](https://img.shields.io/badge/node-%E2%89%A5%2020.6-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](../../LICENSE)

[English](../../README.md) · **简体中文** · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · [Português (BR)](./README.pt-BR.md)

</div>

## <a name="why-ownmem"></a>✨ 为什么是 OwnMem

大多数记忆方案先解决“记得更多”。OwnMem 先问另一件事：**项目知识由谁拥有，谁有权改变它，错误记忆怎样在影响 Agent 行动前被拦住？**

| 优势 | 对实际开发意味着什么 |
| --- | --- |
| **记忆归仓库所有** | 记忆是 `.ownmem/` 中可读的 Markdown，随 Git 克隆、评审和回滚；仓库里的每个 Agent 读的都是同一份。 |
| **默认召回确定且本地** | 不调用模型、不请求网络；相同查询、配置和快照得到相同排序。 |
| **先验证证据，再授予 authority** | 正文不能自证可信；独立收据和活体证据核验决定是否交付。 |
| **不知道就说不知道** | 交付分档：引用记忆正文、给最多三条指针、或说明是哪道门拒的之后弃权。 |
| **净零增长** | 条目数上限只降不升；往一个满了的语料里加一条，就得在同一次改动里退役一条。 |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/benchmark-dark.svg">
  <img alt="OwnMem 公开基准：40 种语言、128 条查询的 Recall@1 为 100%，同一语料上 grep -F 为 3.9%；4200 个样本的召回延迟 P50 0.46 ms、P95 1.05 ms，低于 5 ms 的发布门槛；MRR 1.000，对 40 条无关查询全部弃权，不调用模型、不请求网络，两个运行时依赖。" src="../assets/benchmark-light.svg" width="100%">
</picture>

<sub>在本仓库锁定的 CC0 语料上实测。克隆本仓库后运行 `npm run benchmark` 即可复现。</sub>

## <a name="how-it-compares"></a><a name="how-this-differs-from-claudemd-and-built-in-memory"></a>🆚 与同类方案对比

OwnMem 不替代 `CLAUDE.md` 或 `AGENTS.md`。那两个文件说的是“在这里该怎么干活”，每一轮都整份读进去。OwnMem 回答的是另一个问题——这个项目踩过的坑里，哪几条值得**为当前这个任务**放到模型眼前——而且它有权回答“一条都不值得”。

|  | 项目指令文件 | 平台自带 memory | OwnMem |
| --- | --- | --- | --- |
| 谁来写 | 你，手写 | Agent，从你和它的对话里提取 | 你写，像代码一样被审阅 |
| 存在哪 | 仓库里的一个文件 | 厂商的账号里 | 你仓库里的 Markdown |
| 每轮进模型的是什么 | 整份，每一轮 | 它自己的召回挑中的那些 | 三档之一，且受 token 预算约束 |
| 某条写错了会怎样 | 你去改那个文件 | 你可能永远看不到那一条 | 证据漂移把它降级，并说明变的是什么 |
| 每轮成本 | 整份文件的 token | 一次检索调用 | 零模型调用、零网络请求 |

## <a name="quick-start"></a>🚀 快速开始

需要 Node.js 20.6 或更新版本。在希望拥有项目记忆的仓库里执行：

```bash
npm install --save-dev ownmem
npx ownmem init --hook --hosts claude,codex
```

装好后重新打开 Agent。用 `--hosts` 列出你在用的宿主（`claude`、`codex`、`cursor`、`gemini`、`grok`）；这份列表会被记录下来，以后增减宿主就是带着新列表再跑一次。`init` 会创建 `.ownmem/` 和各宿主的适配文件，对 `CLAUDE.md` 这类指令文件只改托管区块，并把各宿主仍需完成的一次性步骤直接打印出来。在同一条命令后加 `--check` 可以先预览；加 `--locale auto`，生成的指令文件会使用系统语言。

| 宿主 | 怎么召回 | 接入方式 |
| --- | --- | --- |
| Claude Code | 每次 Edit、Write 前由 hook 召回，也可以随时要求 | `claude` |
| Codex | 每次应用补丁前由 hook 召回，也可以随时要求 | `codex`；hook 需要三步一次性信任设置，`init` 会逐条提示 |
| Grok CLI | 通过兼容层读取 Claude Code 的 hook 配置 | `grok`，若同时使用 Claude Code，一并写上 `claude`；在 grok 里执行一次 `/hooks-trust` 信任本目录 |
| Cursor | 始终生效的规则文件，或 MCP server | `cursor`；MCP server 需要一步手动配置，见[插件与宿主](../PLUGINS.md) |
| Gemini CLI | 指令文件，或 MCP server | `gemini`；MCP server 需要一步手动配置，见[插件与宿主](../PLUGINS.md) |

> **⚠️ 从 0.6.0 升级？** 先用 `npm install --save-dev ownmem@latest` 升级依赖，再跑一次 `npx ownmem init --update`，其他都往后放。0.6.0 装的 hook 指向的子命令已经不存在了，留着它们，Agent 每跑一条 Bash 都会触发一个失败的命令。更新会把它们移除，你自己写的 hook 不会被动到。其余事项（包括清理 `core.hooksPath`）见[升级指南](../UPDATING.md)。

## <a name="daily-use"></a>💬 日常使用

接下来照常用自然语言工作。你让 Agent 记下什么，它就起草一条记忆，你像审代码一样审它：

> “记住：staging 部署超时来自连接池上限，不是 worker 太少。下次两者一起检查。”

> “改之前先看看项目记忆里有没有遇到同一种故障。”

召回按三档之一作答：引用记忆正文、给最多三条指针让你去读，或者弃权。一次真实运行：

```console
$ npx ownmem recall -- "staging deploy timed out again, should I add more workers?"
== staging deploy timed out again, should I add more workers? ==
  staging_timeout_pool_cap  [score=0.875 lanes=exact,bm25f,ngram fields=body,codePath,description,hooks,name,triggers]
      matched deploy,more,out,staging,staging deploy timed out,timed
      trust advisory authority · lifecycle advisory (not fully verified)
        Treat it as a lead to re-check against the code, not as an established fact.
      excerpt(body) **Why**: `DB_POOL_MAX` is 10 on staging. Adding workers only queues more requests behind the same ten connections, so the deploy health check times out sooner, not later.
      file .ownmem/staging_timeout_pool_cap.md
```

信任程度会明确标出，而不是隐含的。这条记忆目前没有任何背书——没人复核确认过，也没引用权威文档或代码锚点——所以它作为“需要回头核对的线索”交付，而不是既定事实。

你自己会用到的几条命令：

```bash
npx ownmem new staging_timeout_pool_cap   # scaffold one memory that already passes every gate
npx ownmem report --since 7d              # used? fast enough? right? what to do next
npx ownmem dashboard --open               # open the local console
npx ownmem mcp                            # serve recall and read to any MCP host over stdio
```

<img alt="OwnMem 本地控制台：以已知误交付残留率为主指标，旁边是查找漏斗，下方是语料与证据健康度，侧栏可切换性能、质量、治理与语义检索。" src="../assets/console.png" width="100%">

`ownmem mcp` 是给没有 hook 的宿主准备的。它只暴露 `recall` 和 `read` 两个工具，两者都不能改动记忆；门禁命令（`audit`、`trust`、`compile`）和所有记忆写入都不在这个接口上。怎样注册才能确保运行的是项目自己安装的那一份，见[插件与宿主](../PLUGINS.md)。

## <a name="how-it-works"></a><a name="architecture"></a><a name="how-ownmem-governs-ai-agent-memory"></a>🧩 工作原理

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture-zh-CN-dark.svg">
  <img alt="OwnMem 总架构：仓库拥有的 Markdown 与独立信任收据编译成不可变快照；本地确定性召回经过四道交付门，并按三档之一交付——引用记忆正文、给最多三条指针、或说明原因后弃权；本地反馈账本、评测台与净零增长配额约束语料的走向。" src="../assets/architecture-zh-CN-light.svg" width="100%">
</picture>

- **仓库是唯一事实来源。** L1 路由、L2 领域索引和 L3 topic 是可审阅 Markdown；信任收据独立于它所授权的正文。
- **编译后再召回。** 经 schema、图关系、生命周期与证据校验后，生成内容寻址的不可变快照。exact、BM25F、n-gram、fuzzy、graph 五路检索通道在本地融合；embedding 是可选的第六路，本地 A/B 证据通过之前权重为 0。
- **四道门，三档交付。** 相关性、认知有效性、任务适用性和动作风险各自按自己的理由拒绝。分数高于阈值（取自消融曲线）就引用记忆正文；低于阈值给最多三条**明确不是答案**的指针；一条合格的都没有则弃权，并报出是哪道门拒的。
- **没有无人值守写入。** 没有协调器、没有晋升、没有候选队列。这个包只负责度量、提议和拒绝；记忆的每一次改动都是某个人的一次提交，任何排序改动都要先过评测台。

机制、威胁模型与研究对应见[技术设计](./TECHNICAL.zh-CN.md)。

## <a name="privacy-and-boundaries"></a><a name="trust-and-automation-boundary"></a><a name="local-first-by-default"></a><a name="telemetry-and-the-daily-pass"></a>🔒 隐私与边界

- **默认本地。** 排序只读仓库文件和本地快照：零 LLM 调用、零网络请求、没有检索 API 账单。交付给 Agent 的摘录仍会占用上下文窗口，并受配置的预算限制。
- **遥测不出本机。** 运行事件存放在被 Git 忽略的目录中，30 天后过期。每日封存（`ownmem daily`）把每个已结束的自然日归并为计数包，不含查询原文、topic 正文和文件路径。没有样本就显示“暂无”，不会伪装成 0%。
- **召回的文本只是数据。** 它不能覆盖宿主指令，也不能授权工具；Agent 的自归因永远不算用户确认。
- **失败看得见。** 正文未签名或证据目标无法核验的条目会被扣住；证据漂移会把条目降为 advisory，并说明变的是什么。
- **秘密不进记忆。** 不该进入 Git 的密钥、个人信息和生产数据，也不该进入记忆。

## <a name="when-to-use-it"></a><a name="where-it-fits"></a>🧭 适用场景

| 适合 OwnMem | 这些情况更适合其他系统 |
| --- | --- |
| 团队希望项目知识和代码一起评审、迁移。 | 需要跨仓库个人画像或全局用户记忆。 |
| 同一仓库轮换使用多个编程 Agent。 | 希望无差别自动保存全部对话，不接受证据门与风险边界。 |
| 在意本地、可复现且没有检索 API 账单的召回。 | 需要大规模云向量搜索或实时全局知识图谱。 |
| 错误记忆必须可归因、可拒绝、可撤销。 | 记忆数量比治理更重要。 |

## <a name="documentation"></a><a name="research-lineage"></a>📚 文档

| 文档 | 内容 |
| --- | --- |
| [Architecture](../ARCHITECTURE.md) | 包边界、快照、信任与交付 |
| [Technical design](./TECHNICAL.zh-CN.md) | 机制、威胁模型与研究对应 |
| [Plugins](../PLUGINS.md) | 各宿主接入、插件与授信步骤 |
| [Updating](../UPDATING.md) | 安全更新与版本迁移 |
| [Privacy](../PRIVACY.md) | 本地数据和可选通道边界 |
| [Changelog](../../CHANGELOG.md) | 版本变化 |
| [Contributing](../../.github/CONTRIBUTING.md) | 提交 issue 与贡献代码 |
| [Security](../../.github/SECURITY.md) | 报告安全漏洞 |
| [License](../../LICENSE) | Apache-2.0 |

<details>
<summary><b>研究脉络</b></summary>

OwnMem 不把这些基础概念冒充原创；它的贡献是把它们组合成仓库记忆的可执行协议：

- **Agent Memory 与反思学习：** [Reflexion (NeurIPS 2023)](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html)、[MemGPT (2023)](https://arxiv.org/abs/2310.08560)
- **记忆与知识库投毒：** [AgentPoison (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html)、[PoisonedRAG (USENIX Security 2025)](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)
- **不可信数据与授权分离：** [CaMeL: Defeating Prompt Injections by Design (2025)](https://arxiv.org/abs/2503.18813)
- **独立来源证明：** [in-toto (USENIX Security 2019)](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)
- **选择性预测与弃答：** [Selective Classification (JMLR 2010)](https://jmlr.org/papers/v11/el-yaniv10a.html)
- **消融式验证：** [Metamorphic Testing (1998)](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf)
- **分维度检索评测：** [ARES (NAACL 2024)](https://aclanthology.org/2024.naacl-long.20/)、[RAGChecker (2024)](https://arxiv.org/abs/2408.08067)

这些引用只说明研究脉络，不表示相关论文实现了 OwnMem，也不表示 OwnMem 复现了论文实验。

</details>

OwnMem 是开源项目，欢迎提交带可复现证据的 issue 和 pull request。
