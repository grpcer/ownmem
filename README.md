<div align="center">

# OwnMem

**Your project. Its own memory.**

Local, deterministic, git-native memory for coding agents.<br>
One set of files serves Claude Code · Codex · Gemini CLI · Cursor · Grok CLI.

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![node >= 20](https://img.shields.io/badge/node-%E2%89%A5%2020-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](./LICENSE)
![recall P95 2.46 ms](https://img.shields.io/badge/recall%20P95-2.46%20ms-8250df?style=flat-square)
![model calls 0](https://img.shields.io/badge/model%20calls-0-8250df?style=flat-square)

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
  <img alt="OwnMem architecture: Markdown memory and the BM25F engine live inside your repository; Claude Code, Codex, Gemini CLI, Cursor, and Grok CLI recall from the same files, and the memory travels with git" src="./assets/architecture-light.svg" width="100%">
</picture>

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
  Codex, Gemini CLI, Cursor, and Grok CLI, so switching agents never means
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
- **Not cross-repository or cloud-synced.** One repository, one memory, fully
  local, by design.

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
| One memory across Claude Code, Codex, Gemini CLI, Cursor, Grok CLI | ✅ | ⚠️⁴ | ⚠️⁴ | ⚠️⁴ | ❌ |
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
corrections welcome.

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

## Quick start

OwnMem requires Node.js 20 or newer. Install the engine in the repository
that should remember its own engineering context:

```bash
npm install --save-dev ownmem
```

For Claude Code:

```bash
npx ownmem init --locale auto --hosts claude --layers compiler --hook --command "npx ownmem"
```

For Codex:

```bash
npx ownmem init --locale auto --hosts codex --layers compiler --command "npx ownmem"
```

For both tools, with the local Web console:

```bash
npx ownmem init --locale auto --hosts claude,codex --layers dashboard --hook --command "npx ownmem"
```

Initialization creates `.ownmem/` and bounded OwnMem blocks in the host's
project instructions. It preserves all text outside `ownmem-generated`
boundaries. Claude Code also receives `/ownmem` and, when `--hook` is enabled,
a `PreToolUse` guard. Codex receives the same discipline through `AGENTS.md`
plus a repository-level skill at `.agents/skills/ownmem/`, which Cursor and
Grok CLI discover from the same path. Gemini CLI and Cursor rules are also
supported (`--hosts gemini,cursor`), and `--hosts generic` writes a plain
`MEMORY_INSTRUCTIONS.md` for any other agent.

When working from a source checkout before publication, use the equivalent
local entry: `node memory.mjs init --locale auto`.

> **Note:** Slash commands come from two places. `init` writes the
> per-repository ones you just set up (`/ownmem` for Claude Code, plus the
> `.agents/skills/ownmem/` skill shared by Codex, Cursor, and Grok CLI).
> The optional plugin in the next section adds machine-wide `/ownmem:recall`
> and `/ownmem:init` — handy even in repositories that have no `.ownmem/`
> yet.

## Install the agent plugin (optional, once per machine)

**Do you have to install it? No — skip it and everything still works.**
`ownmem init` already wrote the discipline into the repository's agent
instructions, so any agent that opens the repository follows it. The plugin is
machine-wide convenience: it adds `/ownmem:recall` and `/ownmem:init` to
every repository on the machine — including ones with no `.ownmem/` yet,
where the init skill walks the agent through the engine setup. This repository
doubles as the plugin marketplace, and the plugin's commands just route to
`npx ownmem`, so a plugin update never rewrites your memory.

Claude Code:

```
/plugin marketplace add grpcer/ownmem
/plugin install ownmem@ownmem
```

This adds the `/ownmem:recall` and `/ownmem:init` commands together with their
model-invoked skills. Enable auto-update for the marketplace under `/plugin` →
Marketplaces to receive new versions automatically.

Codex CLI:

```
codex plugin marketplace add grpcer/ownmem
codex plugin add ownmem@ownmem
```

This installs the `$ownmem` and `$ownmem-init` skills. Refresh later with
`codex plugin marketplace upgrade ownmem`.

Gemini CLI:

```
gemini extensions install https://github.com/grpcer/ownmem
```

This adds the `/ownmem` command and the same two skills. Update with
`gemini extensions update ownmem`.

## Safe automatic updates

OwnMem is designed for reviewable dependency updates, not silent background
rewrites. Enable Dependabot or Renovate for npm dependencies. When it opens an
OwnMem upgrade pull request, CI should run:

```bash
npx ownmem init --update
npx ownmem init --check
npx ownmem audit
```

`init --update` refreshes only OwnMem-managed boundaries and preserves project
memory. `init --check` fails when generated adapters drift. Committing
`package-lock.json` keeps every agent and CI job on the reviewed version.

For a manual update:

```bash
npm install --save-dev ownmem@latest
npx ownmem init --update
npx ownmem init --check
npx ownmem audit
```

Avoid floating `npx ownmem@latest` in production repositories: it is convenient
for a first look, but it makes executions non-reproducible.

## Daily use

**Teach it a lesson.** You just burned an hour discovering that staging
deploys time out because the connection pool caps at five. Tell your agent:

> "Remember this — the timeout comes from the pool cap, not the worker
> count. Never raise workers without raising the pool."

The agent writes one small topic file under `.ownmem/` — symptoms in
`triggers`, proof in `evidence` — and the gates keep it honest:

```bash
npx ownmem audit
```

**Recall it when it matters.** Next week, another machine, a different
agent, the same symptom:

```bash
npx ownmem recall -- "staging deploy timeout"
```

The lesson is back in about two milliseconds, evidence attached — no model
call, no network request, no token spent.

**Grade what came back.** Explicit feedback stays in a git-ignored local
inbox — never uploaded, never auto-promoted into a benchmark:

```bash
npx ownmem recall --feedback correct -- "staging deploy timeout"
npx ownmem recall --feedback miss --expected pool_cap_timeout -- "why do deploys hang"
```

**Watch the whole system.** OwnMem Console shows adoption, recall quality,
latency, and governance for this repository — served on 127.0.0.1 only
(`--status` and `--stop` manage it):

```bash
npx ownmem dashboard --open
```

<img alt="OwnMem Console — adoption funnel, recall quality, corpus and governance, all local" src="./assets/console.png" width="100%">

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

## Safety and evidence

- Memory files remain inspectable Markdown inside the repository.
- Schema, quota, generated-boundary, and near-duplicate checks run locally.
- `recall.consumed` is the adoption north star; Recall@K is a process metric.
- The default installation never downloads or invokes a model.
- The optional embedding lane stays out of ranking until local A/B evidence passes its safety gate.

OwnMem is licensed under Apache-2.0. See `PRIVACY.md`, `SECURITY.md`, and
`RELEASE.md` before sharing artifacts or publishing a release.
