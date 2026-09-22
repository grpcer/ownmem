<div align="center">

# OwnMem

**Git-native memory for AI coding agents**

Open-source project memory for Claude Code, Codex, Cursor, Gemini CLI, and other AI coding agents — local, deterministic, reviewable, and never written behind your back.

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![npm downloads](https://img.shields.io/npm/dm/ownmem?style=flat-square&logo=npm&color=555)](https://www.npmjs.com/package/ownmem)
[![GitHub stars](https://img.shields.io/github/stars/grpcer/ownmem?style=flat-square&logo=github&color=e3b341)](https://github.com/grpcer/ownmem/stargazers)
[![release gates](https://img.shields.io/github/actions/workflow/status/grpcer/ownmem/ci.yml?branch=main&style=flat-square&label=release%20gates)](https://github.com/grpcer/ownmem/actions/workflows/ci.yml)
[![node >= 20.6](https://img.shields.io/badge/node-%E2%89%A5%2020.6-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](./LICENSE)

**English** · [简体中文](./docs/i18n/README.zh-CN.md) · [繁體中文](./docs/i18n/README.zh-TW.md) · [日本語](./docs/i18n/README.ja.md) · [한국어](./docs/i18n/README.ko.md) · [Español](./docs/i18n/README.es.md) · [Français](./docs/i18n/README.fr.md) · [Deutsch](./docs/i18n/README.de.md) · [Português (BR)](./docs/i18n/README.pt-BR.md)

</div>

## <a name="why-ownmem"></a>✨ Why OwnMem

Most AI agent memory systems optimize for remembering more. OwnMem starts with a different question: **who owns project knowledge, who may change it, and how can a bad memory be stopped before it changes a coding agent's actions?**

| Advantage | What it means in practice |
| --- | --- |
| **The repository owns memory** | Readable Markdown in `.ownmem/` travels through clone, review, and rollback with the code, and every agent in the repository reads the same source. |
| **Deterministic local recall** | Default recall makes no model or network call; the same query, config, and snapshot produce the same ranking. |
| **Evidence before authority** | Content cannot declare itself trusted. Independent receipts and live evidence checks decide delivery. |
| **It tells you when it does not know** | Delivery is graded: the memory quoted, up to three pointers, or an abstention that names the gate that refused. |
| **Net-zero growth** | A hard entry count that only ratchets down, so adding to a full corpus means retiring something in the same change. |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/benchmark-dark.svg">
  <img alt="OwnMem public benchmark: Recall@1 of 100% on 128 queries in 40 languages, against 3.9% for grep -F on the same corpus; recall latency of 0.46 ms at P50 and 1.05 ms at P95 over 4,200 samples, under a 5 ms release gate; MRR 1.000, all 40 unrelated queries abstained, no model or network calls, two runtime dependencies." src="./docs/assets/benchmark-light.svg" width="100%">
</picture>

<sub>Measured on the locked CC0 corpus in this repository. Reproduce it in a clone with `npm run benchmark`.</sub>

## <a name="how-it-compares"></a><a name="how-this-differs-from-claudemd-and-built-in-memory"></a>🆚 How it compares

OwnMem does not replace `CLAUDE.md` or `AGENTS.md`. Those files say how to work here, and they are read in full every turn. OwnMem answers a different question — which of the things this project learned the hard way are worth putting in front of the model *for this task* — and it is allowed to answer “none of them”.

|  | Instruction files | Built-in agent memory | OwnMem |
| --- | --- | --- | --- |
| Who writes it | you, by hand | the agent, from your conversations | you, reviewed like code |
| Where it lives | one file in the repository | the vendor's account | Markdown in your repository |
| What reaches the model | all of it, every turn | whatever its own recall picked | one of three tiers, under a token budget |
| When an entry is wrong | you edit the file | you may never see the entry | evidence drift downgrades it and names what moved |
| Cost per turn | the whole file in tokens | a retrieval call | no model call, no network call |

## <a name="quick-start"></a>🚀 Quick start

Requires Node.js 20.6 or newer. Run this inside the repository that should own the memory:

```bash
npm install --save-dev ownmem
npx ownmem init --hook --hosts claude,codex
```

Reopen the agent afterwards. Name the hosts you use in `--hosts` (`claude`, `codex`, `cursor`, `gemini`, `grok`); the list is recorded, and passing it again later is how a host is added or removed. `init` creates `.ownmem/` and the host adapters, edits instruction files such as `CLAUDE.md` only inside managed blocks, and prints any one-time step a host still needs. Add `--check` to the same command to preview it, and `--locale auto` to write the generated instructions in your system language.

| Host | How recall happens | Setup |
| --- | --- | --- |
| Claude Code | A hook before every Edit and Write, and on request | `claude` |
| Codex | A hook before every patch it applies, and on request | `codex`; the hooks need three one-time trust steps, which `init` prints |
| Grok CLI | Reads Claude Code's hook configuration through its compatibility layer | `grok`, alongside `claude` if you use both; trust the folder once with `/hooks-trust` |
| Cursor | An always-applied rule, or the MCP server | `cursor`; the MCP server takes one manual step, see [Plugins](./docs/PLUGINS.md) |
| Gemini CLI | Instructions, or the MCP server | `gemini`; the MCP server takes one manual step, see [Plugins](./docs/PLUGINS.md) |

> **⚠️ Upgrading from 0.6.0?** Update the package with `npm install --save-dev ownmem@latest`, then run `npx ownmem init --update` before anything else. 0.6.0 installed hooks whose subcommands no longer exist, so an installation that keeps them runs a failing command on every Bash call. The update removes them and never touches hooks you wrote yourself. [Updating](./docs/UPDATING.md) covers the rest, including the `core.hooksPath` cleanup.

## <a name="daily-use"></a>💬 Daily use

Keep working in plain language. Your agent drafts a memory when you ask for one, and you review it like code:

> “Remember this: staging deployment timeouts come from the pool cap, not too few workers. Check both together next time.”

> “Before changing this, check whether the project memory has seen the same failure.”

Recall answers in one of three tiers: the memory quoted, up to three pointers to go and read, or an abstention. A real run:

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

Trust is stated, not implied. Nothing backs this entry yet — no review has confirmed it, and it cites no authority document or code anchor — so it arrives as a lead to re-check rather than as an established fact.

The commands you will reach for yourself:

```bash
npx ownmem new staging_timeout_pool_cap   # scaffold one memory that already passes every gate
npx ownmem report --since 7d              # used? fast enough? right? what to do next
npx ownmem dashboard --open               # open the local console
npx ownmem mcp                            # serve recall and read to any MCP host over stdio
```

<img alt="The OwnMem local console: the known false-delivery residual as the headline figure, the lookup funnel beside it, corpus and evidence health below, and navigation for performance, quality, governance, and semantic retrieval." src="./docs/assets/console.png" width="100%">

`ownmem mcp` exists for hosts without hooks. It exposes exactly two tools, `recall` and `read`, and neither can change a memory; the gate commands (`audit`, `trust`, `compile`) and every memory write stay off that surface. [Plugins](./docs/PLUGINS.md) shows how to register it so it runs the project's own copy.

## <a name="how-it-works"></a><a name="architecture"></a><a name="how-ownmem-governs-ai-agent-memory"></a>🧩 How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/architecture-dark.svg">
  <img alt="OwnMem architecture: repository-owned Markdown and independent trust receipts compile into immutable snapshots; deterministic local recall passes four delivery gates and arrives in one of three tiers — the memory quoted, up to three pointers, or an abstention that names its reason — while local feedback ledgers, an evaluation harness and a net-zero quota bound what the corpus becomes." src="./docs/assets/architecture-light.svg" width="100%">
</picture>

- **Repository source of truth.** L1 routing, L2 area indexes, and L3 topics remain reviewable Markdown; trust receipts live outside the text they authorize.
- **Compile, then recall.** Schema, graph, lifecycle, and evidence gates produce a content-addressed immutable snapshot. Five deterministic lanes — exact, BM25F, n-gram, fuzzy, and graph — are fused locally; embeddings are an optional sixth lane at weight 0 until local A/B evidence passes.
- **Four gates, three tiers.** Relevance, epistemic validity, task applicability, and action risk each refuse on their own grounds. Above a threshold read off an ablation curve the memory is quoted; below it come up to three pointers that are explicitly not answers; with nothing qualified, an abstention that names the gate that refused.
- **No unattended writes.** There is no coordinator, no promotion, and no candidate queue. The package measures, proposes, and refuses; every change to memory is a commit somebody makes, and no ranking change lands without the evaluation harness.

Mechanisms, threat model, and research mapping: [Technical design](./docs/TECHNICAL.md).

## <a name="privacy-and-boundaries"></a><a name="trust-and-automation-boundary"></a><a name="local-first-by-default"></a><a name="telemetry-and-the-daily-pass"></a>🔒 Privacy and boundaries

- **Local by default.** Ranking reads repository files and local snapshots only: no LLM call, no network request, no retrieval API bill. Delivered excerpts still use the agent's context window, capped by the configured budget.
- **Telemetry stays on the machine.** Runtime events live in a Git-ignored directory and expire after thirty days. The daily pass (`ownmem daily`) reduces each finished day to a counted package with no query text, topic bodies, or file paths. Missing samples show as unavailable, never as 0%.
- **Retrieved text is data.** It cannot override host instructions or authorize a tool, and an agent's self-attribution never counts as user confirmation.
- **Failures are visible.** An entry with unsigned content or an unverifiable evidence target is withheld; evidence drift downgrades it to advisory and names what moved.
- **Keep secrets out.** Secrets and personal or production data that do not belong in Git do not belong in memory.

## <a name="when-to-use-it"></a><a name="where-it-fits"></a>🧭 When to use it

| Good fit | Choose another system when |
| --- | --- |
| A team wants project knowledge reviewed and migrated with code. | You need a cross-repository personal profile or global user memory. |
| Several coding agents rotate through one repository. | You need to capture every conversation automatically with no evidence or risk boundary. |
| Local, reproducible recall with no retrieval API bill matters. | You need large-scale cloud vector search or a real-time global knowledge graph. |
| Bad memory must be attributable, rejectable, and reversible. | Maximum recall volume matters more than governance. |

## <a name="documentation"></a><a name="research-lineage"></a>📚 Documentation

| Document | Purpose |
| --- | --- |
| [Architecture](./docs/ARCHITECTURE.md) | Package boundaries, snapshots, trust, and delivery |
| [Technical design](./docs/TECHNICAL.md) | Mechanisms, threat model, and research mapping |
| [Plugins](./docs/PLUGINS.md) | Per-host setup, plugins, and trust steps |
| [Updating](./docs/UPDATING.md) | Safe repository updates and version migrations |
| [Privacy](./docs/PRIVACY.md) | Local data and optional channel boundaries |
| [Changelog](./CHANGELOG.md) | Version history |
| [Contributing](./.github/CONTRIBUTING.md) | Reporting issues and sending changes |
| [Security](./.github/SECURITY.md) | Reporting a vulnerability |
| [License](./LICENSE) | Apache-2.0 |

<details>
<summary><b>Research lineage</b></summary>

OwnMem does not claim these foundations as inventions. Its contribution is their composition into an executable protocol for repository memory:

- **Agent memory and reflection:** [Reflexion (NeurIPS 2023)](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html), [MemGPT (2023)](https://arxiv.org/abs/2310.08560)
- **Memory and knowledge-base poisoning:** [AgentPoison (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html), [PoisonedRAG (USENIX Security 2025)](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)
- **Untrusted data separated from authority:** [CaMeL: Defeating Prompt Injections by Design (2025)](https://arxiv.org/abs/2503.18813)
- **Independent provenance:** [in-toto (USENIX Security 2019)](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)
- **Selective prediction and abstention:** [Selective Classification (JMLR 2010)](https://jmlr.org/papers/v11/el-yaniv10a.html)
- **Ablation-based validation:** [Metamorphic Testing (1998)](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf)
- **Decomposed retrieval evaluation:** [ARES (NAACL 2024)](https://aclanthology.org/2024.naacl-long.20/), [RAGChecker (2024)](https://arxiv.org/abs/2408.08067)

These citations describe the research lineage; they do not imply that the papers implement OwnMem or that OwnMem reproduces their experiments.

</details>

OwnMem is open source. Reproducible issues and pull requests are welcome.
