# Changelog

All notable changes follow Keep a Changelog. Versions follow Semantic
Versioning.

## [Unreleased]

### Added

- A structural regression gate checks the root allowlist, local documentation
  links, ESM imports, canonical schema URLs, npm publication boundary, and
  cross-host skill mirrors.
- `ownmem embed` exposes the optional embedding workflow through the stable CLI
  instead of requiring a package-internal script path.

### Changed

- Runtime entry points now have explicit boundaries: `bin/ownmem.mjs` is the
  executable, `lib/index.mjs` is the package API, feature orchestration lives in
  `lib/features/`, and runtime contracts live under domain-grouped `schemas/`.
- Tests and locked benchmark evidence moved to `test/` and `benchmarks/`; npm
  now publishes an explicit runtime allowlist instead of every root-level MJS
  and JSON file.
- Community health files moved to `.github/`; translated READMEs, project docs,
  and media moved to `docs/`, reducing the GitHub root from 67 entries to 22.

### Migration

- Invoke runtime behavior through `ownmem <command>` and import the supported
  API from `ownmem`; root-level `memory-*.mjs` package internals no longer ship.
- Resolve JSON contracts through `ownmem/schemas/*`. The three schemas with
  canonical GitHub URLs now identify their real paths under `schemas/`.

## [0.1.2] - 2026-08-17

### Added

- A `dashboard` skill in the agent plugin (`/ownmem:dashboard` in Claude
  Code, `ownmem:dashboard` in Codex) and an `ownmem-dashboard` skill in the
  Gemini extension: they start OwnMem Console in the background, hand the
  user the tokenized URL, and summarize the report.
- The marketplace manifest carries a description, so marketplace listings no
  longer show an empty summary.

- The local observability write path now ships in the public package:
  `lib/memory-runtime-observability.mjs` (recall/build events and trace IDs),
  `lib/memory-recall-ledger.mjs` (recent-recall ledger for consumption
  pairing), and `lib/memory-hook-observability.mjs` (hook delivery and
  consumption sinks). `report` and the dashboard finally have producers for
  the events they read in consumer repositories.
- `ownmem recall` records `recall.completed`, `recall.delivered`, and
  `feedback.recorded` events and a ledger entry under
  `.local-test/memory-observability/`, so the adoption funnel works without
  the compiler layer. A new `--no-observability` flag skips the writes.
- `ownmem audit` emits a `gate.completed` event; the previously accepted
  `--no-observability` flag now actually controls it, and
  `recordMemoryAuditObservability` is a real recorder instead of an empty
  stub.
- The public self-test asserts the full loop: consumer usage produces
  schema-valid local events, the ledger file exists, and `report` attributes
  the local install.

### Changed

- The plugin ships one skill set for every host. The duplicated
  `codex-skills/` directory is gone; the Codex manifest now points at the
  same `skills/` directory, so Codex shows `ownmem:init`, `ownmem:recall`,
  and `ownmem:dashboard` instead of the previous `ownmem:ownmem` and
  `ownmem:ownmem-init` names.
- README quick start now states exactly what each host gains after init
  (`/ownmem` in Claude Code, the `ownmem` skill in Codex, the console as a
  terminal command) and that commands appear at the next session start; the
  plugin section gains a per-host command table and restart notes for both
  Claude Code and Codex, in every locale.

### Fixed

- `memory-recall.mjs` loaded its three optional adapters through one
  `Promise.all`, so a single missing module silently disabled every event
  writer — the root cause of `report` showing "observed no local events"
  forever in consumer installs. Each adapter now degrades independently.
- The hook's Read-consumption detector only recognized the historical
  `.claude/memory` layout; it now resolves the installation's configured
  memory directory, so full-text opens in `.ownmem` repositories pair with
  their recalls (`recall.consumed`).
- npm 11's publish-time normalization silently dropped the package `bin`
  entry because its path carried a `./` prefix — every consumer would have
  lost the `ownmem` executable. The manifest now declares the normalized
  `memory.mjs` path, and the publish dry run is clean.
- The public self-test gave its npm steps 60 seconds, which killed the
  cold-cache warm install on slow or proxied registry routes and reported the
  unhelpful `exited null`. Network-bound npm steps now get five minutes, and
  a timeout kill is reported as a kill with its signal instead of a null
  exit.
- CLI and report texts no longer point at private-repository scripts that do
  not ship in the package (`scripts/memory-maintenance.mjs`,
  `scripts/memory-recall.sh`, `scripts/memory-read.mjs`,
  `scripts/memory-observe.mjs`, `scripts/memory-dashboard.mjs`, and the
  schema-check hint); they reference `npx ownmem` commands instead.

## [0.1.1] - 2026-08-16

### Added

- `ownmem init` now ensures `.local-test/` (the local index and telemetry
  directory) is ignored in git consumers: one line is appended to an existing
  `.gitignore`, never rewriting user-owned content, and `init --check` reports
  a missing entry as drift. Non-git repositories are left untouched.

### Fixed

- The packed offline-install E2E is hermetic: it warms and asserts against a
  fixture-owned npm cache instead of silently depending on the developer's
  global cache, and npm now runs as `node + npm-cli.js` so the self-test
  passes on Windows.
- The release latency lock scales by a measured machine-speed factor, so a
  complexity regression still fails on any hardware while shared CI runners no
  longer fail on raw hardware speed. Per-language/per-script groups carry a 2x
  small-sample allowance; the calibration factor and budgets are printed with
  every enforced run.

## [0.1.0] - 2026-08-09

### Added

- OwnMem branding, the `ownmem` npm package and CLI, and the canonical
  `grpcer/ownmem` repository identity.
- Deterministic Unicode-aware engineering-memory initialization and recall.
- Schema, quota, duplicate, review, and immutable-index gates.
- Claude Code and Codex project adapters.
- Loopback-only local dashboard with 16 locale catalogs and RTL support.
- Optional embedding evaluation lane guarded by snapshot-specific A/B proof.
- Synthetic public benchmark covering 40 language tags and 25 script groups,
  with a fixed six-algorithm bake-off and per-language/per-script release gates.
- Exact recall for a memory topic's own repository path and Markdown basename.
