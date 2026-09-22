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

## Delivery boundary

Recall answers in one of three ways, and the envelope says which. Above the
content threshold it quotes the memory itself. Below it, but still with
qualified candidates, it returns up to three pointers: a title, one line, and
the command that opens the topic. With no qualified candidate it abstains and
names the reason. A pointer is not a short answer and the renderer must not
present it as one; the tier exists because the protocol previously had only
"quote" and "say nothing", and a confident quote was the cheaper of the two
mistakes to make.

Gates are independent of tiers. Relevance, epistemic validity, task
applicability, and action risk each refuse on their own grounds, and the
abstention reason names the gate that refused rather than collapsing every
refusal into "nothing matched".

## No unattended writes

There is no coordinator, no promotion, no candidate queue, and no tripwire.
Every change to memory is an edit a person makes and commits; the package
proposes and measures, and it never writes a memory on its own. The commands
that could write -- `init`, `new`, `outcome` -- are human entry points, and the
MCP server deliberately exposes only `recall` and `read`, because a governance
command one token away from an autonomous agent is not governance.

Growth is bounded by a topic quota rather than by automation limits. `ownmem
audit` enforces a hard entry count for the active corpus that ratchets downward
only, so a corpus at its ceiling has to give something up before it takes
something on. Deciding what leaves is a human judgement and stays one; the audit
refuses the write, it does not pick a victim.

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
