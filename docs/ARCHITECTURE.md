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
   trees ship with the npm package so a consumer can re-run the self-test and
   the locked benchmark against the exact released artifact.
2. Keep npm's `files` field allowlisted. Do not restore root-level `*.mjs` or
   `*.json` globs.
3. Treat moves under `schemas/`, changes to `lib/index.mjs`, and CLI command
   changes as public compatibility work.
4. Run `npm run verify:release` after changing any published path.
