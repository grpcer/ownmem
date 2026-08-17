<div align="center">

# OwnMem

**Your project. Its own memory.**

Local, deterministic, git-native memory for coding agents.<br>
One set of files serves Claude Code · Codex · Antigravity · Cursor · Grok CLI.

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![node >= 20](https://img.shields.io/badge/node-%E2%89%A5%2020-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/grpcer/ownmem/ci.yml?branch=main&style=flat-square&logo=githubactions&logoColor=white&label=CI)](https://github.com/grpcer/ownmem/actions/workflows/ci.yml)
[![recall P95 2.46 ms](https://img.shields.io/badge/recall%20P95-2.46%20ms-8250df?style=flat-square)](#benchmarks)
[![model calls 0](https://img.shields.io/badge/model%20calls-0-8250df?style=flat-square)](#benchmarks)

**English** · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · [Português (BR)](./README.pt-BR.md)

</div>

OwnMem gives Claude Code, Codex, and other coding agents a memory that lives
inside the repository: plain Markdown in `.ownmem/`, ranked by a deterministic,
Unicode-script-aware BM25F engine. Recall never calls a model, never touches
the network, and never spends a query-time token — the same question returns
the same answer, in about two milliseconds.

OwnMem has two pieces. The **npm package** is the engine: it lives in each
repository as a reviewed `devDependency` and owns that repository's memory in
`.ownmem/`. The **agent plugin** is an optional convenience layer installed
once per machine: it teaches your agent to run the engine, including walking
you through the per-repository setup.

> **Note:** A repository is ready once it has the package and `.ownmem/`,
> however you got there. Start from either piece.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/architecture-dark.svg">
  <img alt="OwnMem end-to-end architecture, three trust domains: the repository holds curated Markdown that passes governance gates and compiles into an immutable snapshot; the deterministic engine answers through six candidate lanes, ranking, a confidence gate and a 400-token envelope; the coding agent asks, verifies against live code, and writes new lessons that flow back through audit and compile" src="./assets/architecture-light.svg" width="100%">
</picture>

## Quick start

OwnMem requires Node.js 20 or newer. Three steps, all inside the repository
you want to give a memory.

**Step 1 — install the engine.** It becomes a normal `devDependency`,
reviewed and pinned like any other:

```bash
npm install --save-dev ownmem
```

**Step 2 — initialize this repository.** This creates `.ownmem/` and the
per-agent adapter files:

```bash
npx ownmem init --locale auto --hosts claude,codex --layers dashboard --hook
```

**Step 3 — reopen your agent.** Agents discover commands at session start,
so everything below appears in the next session, not the one that ran init.

This is the recommended setup — Claude Code and Codex work out of the box and
the local console is included. What you have after reopening:

- **Claude Code** gains a project command: `/ownmem <anything you want the
  memory to do>`.
- **Codex and Grok CLI** automatically discover the repository's `ownmem`
  skill.
- **Antigravity** loads the same project instructions (`AGENTS.md`,
  `GEMINI.md`), so it follows the memory discipline too — as does every
  other agent that reads them.
- **The console** is a terminal command, not a slash command:
  `npx ownmem dashboard --open`. (The optional plugin below adds
  `/ownmem:dashboard`.)

There is no daily setup command — just work as usual. Repeat the three steps
once for each repository that should have its own memory.

Only use one agent? Change `--hosts claude,codex` to `--hosts claude` or
`--hosts codex`. Antigravity and Grok CLI read the same `AGENTS.md` (and,
for Grok, `.agents/skills/`) files as Codex, so `--hosts codex` covers both.
Cursor uses `--hosts cursor`, classic Gemini CLI setups use `--hosts gemini`,
and `--hosts generic` works with other agents.

Initialization creates `.ownmem/` and adds a small OwnMem section to the
agent's project instructions. It never changes text outside its marked
boundaries.

## Daily use

After setup, there are only two things to remember.

**1. Talk to your agent.** When you learn something worth keeping, say it in
plain language:

> "Remember this — the timeout comes from the pool cap, not the worker
> count. Never raise workers without raising the pool."

Later, ask as naturally as you normally would:

> "The staging deploy is hanging again. Check the project memory before you
> change anything."

The agent handles writing, validation, and recall. You do not need to open
`.ownmem/` or run `audit` and `recall` yourself. Prefer an explicit command?
`/ownmem <request>` (Claude Code) and the `ownmem` skill (Codex) route the
same request through the memory.

**2. Open the console when you want an overview.** It shows adoption, recall
quality, latency, and memory health for this repository, and is available only
on your computer at 127.0.0.1:

```bash
npx ownmem dashboard --open
```

<img alt="OwnMem Console — adoption funnel, recall quality, corpus and governance, all local" src="./assets/console.png" width="100%">

That is the whole daily workflow. The `audit`, manual `recall`, and feedback
commands are for CI and troubleshooting; normal users do not need to remember
them.

## Why this exists

I build Oriveo, a BYOK multi-model AI client shipping on iOS, Android, Web, and desktop — a large codebase I work on every day with coding agents, switching between Claude Code and Codex. Every repository kept accumulating hard-won lessons: debugging root causes, toolchain traps, timing races. And every time the agent, the machine, or a teammate changed, those lessons quietly disappeared, because they lived in one tool's memory on one machine.

Vector and cloud memory services never felt right for this: knowledge about a repository should not need an account, a server, or a per-query bill. So the memory moved into the repository itself. OwnMem is the system I run daily inside the Oriveo codebase — hundreds of curated memories, kept honest by quotas and audits — extracted and rebuilt as a clean public engine.

## Why OwnMem

OwnMem makes four bets, and every design decision follows from them:

- **Memory belongs in the repository.** Reviewable Markdown that travels with
  git, shows up in pull requests, and rolls back like any other code. Clone
  the repo, get the memory — no account, no sync service, no export step.
- **Recall must be free and deterministic.** The same query returns the same
  ranking, with no model call, no latency tax, and no per-question bill:
  100% Recall@1 at a 2.46 ms P95 on the locked public benchmark.
- **Memory must outlive any single tool.** The same files serve Claude Code,
  Codex, Antigravity, Cursor, and Grok CLI, so switching agents never means
  losing what the team learned.
- **Memory must stay small to stay trusted.** A zero-net-growth quota, a pure
  Node audit, near-duplicate and drift gates keep it lean and current instead
  of turning into a second wiki that nobody prunes.

### What OwnMem is not

- **Not a vector database.** If you want fuzzy semantic search over large
  memory pools, a vector or knowledge-graph memory service fits better.
- **Not automatic capture.** Writes are deliberate and curated — review is
  the quality gate. Built-in agent memories are more convenient, at the cost
  of being tool-locked and unreviewable.
- **Not cross-repository or cloud-synced.** Memory travels with the
  repository's own git history — clone the repo and it is there. But it is
  never shared across repositories, and it never passes through a memory
  service, by design.

## Inside `.ownmem/`: the three-tier memory

The always-loaded part stays tiny; everything else is read on demand:

| Tier | File | When it is read |
| --- | --- | --- |
| **L1** | `MEMORY.md` | The index — loaded at the start of every session |
| **L2** | `MEMORY-<area>.md` | Area sub-indexes — opened when that area is touched |
| **L3** | one file per topic | A single lesson each — returned by `recall` when its triggers match |

A topic file is plain Markdown with a strict, schema-checked frontmatter —
symptoms and phrasings in `triggers`, proof in `evidence` (abridged here;
`ownmem init` scaffolds a complete example):

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

This structure is what makes recall free: the index is small enough to stay
loaded, and BM25F only has to rank small, well-labeled topic files.

## How OwnMem compares

Every column below solves a real problem — the table shows which trade-offs
each one makes, including ours.

| | OwnMem | [Mem0 (OSS)](https://github.com/mem0ai/mem0) | [Zep / Graphiti](https://github.com/getzep/graphiti) | [claude-mem](https://github.com/thedotmack/claude-mem) | Built-in auto memory¹ |
| --- | :---: | :---: | :---: | :---: | :---: |
| Memory lives in your repo, travels with git and PRs | ✅ | ❌ | ❌ | ❌ | ❌ |
| Human-readable, reviewable Markdown | ✅ | ❌ | ❌ | ❌ | ⚠️² |
| Recall without model or network calls | ✅ | ❌³ | ❌ | ❌ | — |
| Deterministic, reproducible ranking | ✅ | ❌ | ❌ | ❌ | — |
| One memory across Claude Code, Codex, Antigravity, Cursor, Grok CLI | ✅ | ⚠️⁴ | ⚠️⁴ | ⚠️⁴ | ❌ |
| Anti-bloat governance (growth quota, audit, drift gates) | ✅ | ❌ | ❌ | ❌ | ⚠️⁵ |
| Semantic paraphrase search | ⚠️⁶ | ✅ | ✅ | ✅ | ❌ |
| Fully automatic capture | ❌⁷ | ✅ | ✅ | ✅ | ✅ |
| Cross-repository, user-level memory | ❌⁷ | ✅ | ✅ | ⚠️ | ❌ |

¹ Claude Code auto memory and Codex Memories: files under your home
directory — machine-local, tool-locked, outside the repository. Cursor
retired Memories in 2.1 in favor of Rules; Windsurf memories stay local to
one machine and are never committed.
² Editable Markdown, but it lives outside the repo, so it never appears in a
pull request.
³ Mem0's Apache-2.0 library runs locally, yet still requires an LLM and an
embedding model (an OpenAI key by default, or local models via Ollama) to
write and query memory.
⁴ Through an MCP server or its own API — memory is user- or app-scoped, not
a set of files your repository owns.
⁵ Claude Code caps its always-loaded index (200 lines / 25 KB); there is no
quota, audit, or duplicate gate behind it.
⁶ Optional embedding lane, off by default; it joins ranking only after your
local A/B evidence passes the safety gate.
⁷ By design. OwnMem bets on curated, reviewed writes and one-repository
scope; if you want automatic capture or user-level memory across apps, those
tools genuinely fit better.

Facts checked August 2026 against each project's public documentation —
[Mem0](https://docs.mem0.ai), [Zep / Graphiti](https://help.getzep.com/graphiti/getting-started/overview),
[claude-mem](https://github.com/thedotmack/claude-mem),
[Claude Code auto memory](https://code.claude.com/docs/en/memory),
[Codex memories](https://developers.openai.com/codex/memories),
[Cursor rules](https://cursor.com/docs/context/rules),
[Windsurf memories](https://docs.devin.ai/desktop/cascade/memories) — corrections welcome.

## Benchmarks

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/benchmark-dark.svg">
  <img alt="OwnMem benchmark: 100% Recall@1 versus 3.1% for naive grep, and 1.17 ms P50 / 2.46 ms P95 recall latency against a 5 ms release gate" src="./assets/benchmark-light.svg" width="100%">
</picture>

Every release must pass a locked public benchmark: a 40-topic CC0 corpus
spanning 40 BCP 47 language tags and 25 script groups, with 128 positive
queries and 40 unrelated negatives. Numbers below are from a release-grade
run (25 timed iterations per query):

| Metric | Result | Release gate |
| --- | --- | --- |
| Recall@1 / Recall@5 (128 positive queries) | **100% / 100%** | = 100% |
| MRR | **1.000** | = 1.000 |
| Abstention on 40 unrelated queries | **40 / 40** | = 100% |
| Recall latency P50 / P95 (4,200 timed samples) | **1.17 ms / 2.46 ms** | P95 ≤ 5 ms |
| Languages / scripts under the same gates | 40 tags / 25 scripts | per-language & per-script P95 ≤ 5 ms |
| Model calls / network calls during recall | **0 / 0** | = 0 |
| Runtime dependencies | 2 (`ajv`, `yaml` — pure JS) | locked |
| Extra memory during the run (RSS delta) | < 2 MB | — |

On the same corpus, a case-insensitive fixed-string grep scores 3.1%
Recall@1. Staying lexical and deterministic is not the trick by itself — the
Unicode-script-aware BM25F ranking is.

Reproduce it yourself:

```bash
git clone https://github.com/grpcer/ownmem
cd ownmem && npm ci && npm run benchmark
```

> **Note:** Measured on an Apple M5 Pro with Node 25. The corpus hash,
> rankings, and thresholds are locked, and the run repeats with a reversed
> topic order to prove determinism. These synthetic metrics are regression
> evidence, not a claim of real-user accuracy.

## References

None of the ranking math is homemade — every technique in the engine is a
published, battle-tested method. OwnMem's contribution is composing them into
a deterministic, dependency-free engine:

| In OwnMem | Technique | Literature |
| --- | --- | --- |
| `bm25f` lane | Field-weighted BM25 ranking | Robertson & Zaragoza (2009), *[The Probabilistic Relevance Framework: BM25 and Beyond](https://doi.org/10.1561/1500000019)*; Robertson, Zaragoza & Taylor (2004), *[Simple BM25 extension to multiple weighted fields](https://doi.org/10.1145/1031171.1031181)* |
| Lane & multi-query fusion | Reciprocal Rank Fusion | Cormack, Clarke & Büttcher (2009), *[Reciprocal rank fusion outperforms Condorcet and individual rank learning methods](https://doi.org/10.1145/1571941.1572114)* |
| Result diversity | Maximal Marginal Relevance | Carbonell & Goldstein (1998), *[The use of MMR, diversity-based reranking for reordering documents and producing summaries](https://doi.org/10.1145/290941.291025)* |
| `ngram` lane | Character n-gram similarity (Dice) | Dice (1945), *[Measures of the amount of ecologic association between species](https://doi.org/10.2307/1932409)* |
| `fuzzy` lane | Bounded edit distance | Levenshtein (1966), *Binary codes capable of correcting deletions, insertions, and reversals*, Soviet Physics Doklady 10(8) |
| Near-duplicate gate | SimHash | Charikar (2002), *[Similarity estimation techniques from rounding algorithms](https://doi.org/10.1145/509907.509965)*; Manku, Jain & Das Sarma (2007), *[Detecting near-duplicates for web crawling](https://doi.org/10.1145/1242572.1242592)* |
| Near-duplicate gate | MinHash | Broder (1997), *[On the resemblance and containment of documents](https://doi.org/10.1109/SEQUEN.1997.666900)* |
| Tokenizer | Script-aware segmentation | *[UAX #24: Unicode Script Property](https://unicode.org/reports/tr24/)*; *[UAX #29: Unicode Text Segmentation](https://unicode.org/reports/tr29/)* |

## Install the agent plugin (optional, once per machine)

**Do you have to install it? No — skip it and everything still works.**
`ownmem init` already wrote the discipline into the repository's agent
instructions, so any agent that opens the repository follows it. The plugin is
machine-wide convenience: it adds the same three skills to every repository
on the machine — including ones with no `.ownmem/` yet, where the init skill
walks the agent through the engine setup. This repository doubles as the
plugin marketplace, and the plugin's commands just route to `npx ownmem`, so
a plugin update never rewrites your memory.

One plugin, three skills, one set of names:

| Skill | Claude Code | Codex CLI | What it does |
| --- | --- | --- | --- |
| `recall` | `/ownmem:recall` | `ownmem:recall` | Recall memory before changing code |
| `init` | `/ownmem:init` | `ownmem:init` | Set up or update OwnMem in a repository |
| `dashboard` | `/ownmem:dashboard` | `ownmem:dashboard` | Open the local console |

**Claude Code** — run both commands, in order: the first registers this
repository as a plugin marketplace (needed once), the second installs the
plugin from it:

```
/plugin marketplace add grpcer/ownmem
/plugin install ownmem@ownmem
```

Then restart Claude Code: plugin commands load at session start, so they
appear in the next session, not the one that installed them. Enable
auto-update for the marketplace under `/plugin` → Marketplaces to receive new
versions automatically.

**Codex CLI** — the same two steps in order: register the marketplace, then
add the plugin:

```
codex plugin marketplace add grpcer/ownmem
codex plugin add ownmem@ownmem
```

Skills load at session start here too; find them in the `$` skill picker.
Refresh later with `codex plugin marketplace upgrade ownmem` followed by
`codex plugin add ownmem@ownmem`.

**Grok CLI** — again both commands in order: register the marketplace, then
install (Grok requires the explicit `--trust`). Skip the first command if
Grok already imported your Claude Code marketplaces:

```
grok plugin marketplace add grpcer/ownmem
grok plugin install ownmem@ownmem --trust
```

This installs the same three skills. When a bare skill name is already
taken, Grok namespaces it — its built-in dashboard makes ours
`/ownmem:dashboard`. Update with `grok plugin update ownmem`.

**Antigravity** — a single command, no marketplace step:

```
agy plugin install https://github.com/grpcer/ownmem
```

This imports the `ownmem`, `ownmem-init`, and `ownmem-dashboard` skills;
update by re-running the same command. (Classic Gemini CLI setups — API key,
Vertex AI, or an enterprise license — can still install the same repository
with `gemini extensions install https://github.com/grpcer/ownmem`.)

## Safe automatic updates

OwnMem is designed for reviewable dependency updates, not silent background
rewrites. Enable Dependabot or Renovate for npm dependencies. When it opens an
OwnMem upgrade pull request, CI should run these three commands in order:

```bash
npx ownmem init --update
npx ownmem init --check
npx ownmem audit
```

`init --update` refreshes only OwnMem-managed boundaries and preserves project
memory. `init --check` fails when generated adapters drift. Committing
`package-lock.json` keeps every agent and CI job on the reviewed version.

For a manual update, run all four in order:

```bash
npm install --save-dev ownmem@latest
npx ownmem init --update
npx ownmem init --check
npx ownmem audit
```

Avoid floating `npx ownmem@latest` in production repositories: it is convenient
for a first look, but it makes executions non-reproducible.

## Layers

Pick how much machinery you want — each layer contains the previous one:

| Layer | Adds |
| --- | --- |
| `core` | Initialization, strict schema, Unicode-script BM25F recall, deterministic multi-query fusion, growth quota |
| `gates` | Pure-Node audit and near-duplicate gate |
| `compiler` | Immutable snapshots, stdio resident runtime, optional Claude Code hook |
| `dashboard` | OwnMem Console and the optional embedding evaluation lane |

All layers use only the pure-JavaScript `ajv` and `yaml` runtime dependencies.
OwnMem Console ships complete catalogs for English, Simplified and Traditional
Chinese, Japanese, Korean, Spanish, French, German, Brazilian Portuguese,
Arabic, Hindi, Indonesian, Russian, Thai, Turkish, and Vietnamese.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md)
for the ground rules: keep default recall deterministic, local, and model-free,
add a regression case for every retrieval change, and run `npm test` plus
`npm run benchmark:release` before requesting review. Security reports go
through [SECURITY.md](./SECURITY.md).

## Safety and evidence

- Memory files remain inspectable Markdown inside the repository.
- Schema, quota, generated-boundary, and near-duplicate checks run locally.
- `recall.consumed` is the adoption north star; Recall@K is a process metric.
- The default installation never downloads or invokes a model.
- The optional embedding lane stays out of ranking until local A/B evidence passes its safety gate.

OwnMem is licensed under Apache-2.0. See `PRIVACY.md`, `SECURITY.md`, and
`RELEASE.md` before sharing artifacts or publishing a release.
