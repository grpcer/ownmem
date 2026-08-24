# Repository architecture

OwnMem is one npm package and one multi-host plugin marketplace. The repository
stays single-package because the runtime, schemas, and host adapters are released
together; a workspace or `packages/` layer would add a publishing boundary that
the product does not have.

## Boundaries

| Path | Responsibility | Published to npm |
| --- | --- | --- |
| `bin/` | Thin executable entry points | Yes |
| `lib/` | Public API, feature orchestration, and deterministic runtime | Yes |
| `schemas/` | Versioned runtime and protocol contracts, grouped by domain | Yes |
| `test/` | End-to-end, packaging, and structural regression gates | Yes |
| `benchmarks/` | Locked synthetic corpora and release performance gates | Yes |
| `plugins/ownmem/` | Self-contained Claude and Codex plugin package | No |
| `skills/` and `commands/` | Gemini extension components rooted at this repository | No |
| `.agents/` and `.claude-plugin/` | Host marketplace discovery manifests | No |
| `.ownmem/` | This repository's own reviewed project memory | No |
| `docs/` | Project documentation, translations, and media | No |

`bin/ownmem.mjs` only translates process completion into an exit code. The
importable package API is `lib/index.mjs`; command implementations live under
`lib/features/`, and reusable deterministic components live directly under
`lib/`. A library module must not import an implementation from the repository
root.

Schema paths are resolved centrally by `lib/schema-paths.mjs`. Public schemas
with URL identifiers use their real path under `schemas/`, so a checked-in `$id`
never points at a compatibility shim or generated copy.

## Trust and lifecycle boundary

Topic Markdown is untrusted content, including its own `authority` field. The
separate `trust.lock.json` stores content-bound receipts for lifecycle,
authority, action risk, version/environment applicability, evidence hashes,
and rollback lineage. The compiler records receipt provenance in immutable
snapshots, while recall revalidates external evidence (paths, symbol slices,
tests, commits, canonical documents, user confirmations) against the live
repository before delivery.

Topic text itself is bound at compile time, not reread per query: body excerpts
are cut from the bytes the snapshot indexed, so the same snapshot always
answers the same way. A source freshness probe on the recall entry path
rebuilds the snapshot when the memory directory no longer matches the manifest,
which is where an unreviewed topic edit surfaces as content drift.

Quarantine is reserved for signals that make the entry unsafe or unverifiable:
tampered receipts, unreviewed topic content, missing evidence targets, expired
entries, and non-injectable lifecycle states. Evidence whose target still
exists but whose symbol slice changed is a weaker signal — usually a refactor —
so it downgrades the entry to advisory and is reported rather than hidden.

Initial migration receipts may import an existing corpus once. Every later
change to active memory must name the prior content hash and use `delta` or
`structured-merge`; a full re-import is rejected. Snapshot pointers retain the
previous validated active set for deterministic rollback.

## Unattended evolution boundary

`ownmem evolve` coordinates the safe path at the end of a host turn. It does
not implement a second promotion policy: the existing candidate, replay,
regression, quota, trust, audit, compiler, tripwire, and rollback modules remain
the decision authorities. The coordinator adds a repository-local enable
switch, a cross-process lock, debounce, ordered execution, observable state,
and compensating rollback when a later step fails.

Only a change admitted as R0 and `automation: auto` may materialize without a
person. The first producer is retrieval-trigger backfill: the baseline query
must miss, the candidate query must hit because of the inserted trigger, and
every previously passing evaluation case must continue to pass. Sandbox
replays receive an ephemeral trust delta inside the mirror so they exercise the
same production recall gates without changing the real repository.

Each trigger promotion is proven to be a pure UTF-8 byte insertion. Its receipt
records the byte range and hashes needed to reverse it, so rollback neither
copies the topic into a second store nor requires the pre-promotion state to
have been committed. The runtime quarantines first, verifies both candidate and
restored hashes, appends a rollback receipt, reissues trust for the restored
state, and recompiles. Manual, policy, prose, and other higher-impact changes
remain review material.

## Host-owned root entries

Some root entries are protocol surface rather than clutter. Claude requires
`.claude-plugin/marketplace.json`; Gemini requires `gemini-extension.json` at
the extension root and discovers the adjacent `commands/` and `skills/`; Codex
uses the plugin package under `plugins/ownmem/`. These paths stay explicit.

The Gemini and plugin skill copies need different frontmatter names. Their
bodies must otherwise remain identical; `npm test` enforces that invariant.

## Change rules

1. Put executable wrappers in `bin/`, reusable behavior in `lib/`, contracts in
   `schemas/`, and release evidence in `test/` or `benchmarks/`. The evidence
   trees ship with the npm package so consumers can reproduce the self-test and
   locked benchmark against the exact released artifact.
2. Keep npm's `files` field allowlisted. Do not restore root-level `*.mjs` or
   `*.json` globs.
3. Treat moves under `schemas/`, changes to `lib/index.mjs`, and CLI command
   changes as public compatibility work.
4. Run `npm run verify:release` after changing any published path.
