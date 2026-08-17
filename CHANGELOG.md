# Changelog

All notable changes follow Keep a Changelog. Versions follow Semantic
Versioning.

## [Unreleased]

### Added

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

### Fixed

- `memory-recall.mjs` loaded its three optional adapters through one
  `Promise.all`, so a single missing module silently disabled every event
  writer — the root cause of `report` showing "observed no local events"
  forever in consumer installs. Each adapter now degrades independently.
- The hook's Read-consumption detector only recognized the historical
  `.claude/memory` layout; it now resolves the installation's configured
  memory directory, so full-text opens in `.ownmem` repositories pair with
  their recalls (`recall.consumed`).
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
