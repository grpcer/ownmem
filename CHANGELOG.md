# Changelog

All notable changes follow Keep a Changelog. Versions follow Semantic
Versioning.

## [Unreleased]

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
