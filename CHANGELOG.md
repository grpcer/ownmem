# Changelog

All notable changes follow Keep a Changelog. Versions follow Semantic
Versioning.

## [Unreleased]

## [0.5.1] - 2026-09-01

### Fixed

- Reports now separate a `wrong` verdict recorded after a delivered memory from one recorded after
  an abstention. The former is a precision failure; the latter is missing retrieval or missing
  corpus coverage. Paired recall traces reconstruct the direction without adding raw queries to
  telemetry, and legacy unpaired verdicts remain explicitly unknown. The closed report contract is
  now `ownmem-report/v8`.

- Session-report self-tests now build balanced fixtures exclusively through production recorders;
  concurrent local telemetry can no longer split a recall/delivery pair at a moving tail boundary
  and create a false release failure.

## [0.5.0] - 2026-08-31

### Added

- Recall results now expose normalized query-span coverage as an observable
  ranking feature. The accompanying conjunctive abstention floor remains
  disabled by default until multilingual holdout evidence can support a safe
  threshold; this release measures the signal without silently changing
  recall decisions.
- The public benchmark now reports an answer-ablation partition so false
  answers on queries with no gold memory are visible instead of being hidden
  by saturated positive fixtures.

### Changed

- The root README and all eight localized READMEs now use version-independent
  architecture language, current host and migration guidance, searchable AI
  coding-agent terminology, and an explicit distinction between zero-call
  local ranking and the bounded context tokens consumed by delivered excerpts.
- Full-index compilation now avoids `Intl.Segmenter` for plain letter and
  number runs whose graphemes are already individual Unicode code points, and
  builds n-grams without per-window array slices. Combining marks and
  decomposed Hangul still use the standards-based grapheme path, preserving
  multilingual token output while reducing full-build allocation pressure.
- Benchmark floors are enforced per evidence-bearing group rather than as
  per-case zero-tolerance assertions, leaving measurable headroom without
  weakening the aggregate quality lock.
- Pure repository-path recalls now stop after exact path and basename evidence.
  They no longer expand an exact topic through shared L2 or evidence graph
  nodes, which could turn one file match into fifty unrelated candidates and
  make trust revalidation dominate every matching edit. Mixed path-plus-prose
  queries retain graph expansion.
- Recall and compiler stack identity advances to `0.10.0`. Ranking/schema
  changes after 0.4.0 had incorrectly kept the `0.8.0` identity, merging
  before/after telemetry cohorts and allowing stale A/B evidence to appear
  current.
- Exact single-class identifier and error queries now skip broad lexical and
  typo-recovery lanes after structural evidence resolves them, while genuine
  typos and mixed prose keep those lanes. Graph traversal also stops treating
  an L2 routing index as a semantic relay to every topic in its platform
  bucket; direct topic, code, document, and test relations remain available.

### Fixed

- Holdout case details are withheld unless an operator explicitly requests
  them, preventing routine gate runs from training against the sealed set.
- `ownmem recall --help` now names the `ownmem-query-result/v5` contract it
  actually emits instead of the retired v1 schema.

## [0.4.0] - 2026-08-27

### Added

- `correct_abstain` records the other way recall can be right: it returned
  nothing, and nothing was the right answer. `correct` rejects an empty result
  set, so until now a correct abstention could only be filed as `wrong` or
  `coverage_gap` -- recall's successes were being counted as its failures, and
  every operator's own error rate was inflated by exactly that much. It judges
  recall's behaviour; `coverage_gap` judges the corpus, and both can be true of
  one query: a question about an unrelated product is `correct_abstain` and no
  gap at all, while a real question this repository has never written down is
  both. It never takes `--expected`, and it is refused unless recall did in
  fact return nothing.
- The feedback reader exports `FEEDBACK_CORRECT_VERDICTS`. Three call sites
  independently spelled "still needs a person" as `verdict !== 'correct'`, so a
  second correct verdict would silently have been counted as outstanding work
  in all three.
- `readMissDismissalReceipts` reads an `ownmem-miss-dismissal-receipt/v1`
  ledger, and `pendingTriggerBackfills` now excludes a miss recorded in it
  rather than re-proposing it every run. A dismissal is deliberately not a
  resolution: a resolution asserts the miss stopped reproducing, while a
  dismissal only records that a person looked and decided no trigger edit can
  reach it, so a queue with no terminal state re-grades that decision forever.
  A receipt without a reason is rejected. The reader and the exclusion ship
  first; no CLI command writes this ledger yet.

### Fixed

- A rejected telemetry event no longer leaves its feedback row behind. The
  event is validated against a closed schema and can throw, and it used to be
  built after the row had already been appended: the operator reads an error,
  re-runs the command, and the ledger now holds the same verdict twice.
- `lib/features/trust.mjs` refuses to run as a direct entry point instead of
  loading, exporting everything and exiting 0 having done nothing at all. A
  clean exit from a module that needs the defaults its wrapper supplies reads
  as a successful run: two such invocations reported success while the ledger
  stayed stale.

### Migration

- `ownmem-recall-feedback/v3` gains one enum value rather than a new schema id.
  A 0.4.0 reader accepts every 0.3.0 ledger unchanged, but a 0.3.0 reader
  rejects a row carrying `correct_abstain` as invalid. Upgrade every reader in
  a repository before writing the new verdict into its ledger.

## [0.3.0] - 2026-08-24

### Added

- `ownmem evolve` is the default end-of-turn safe-maintenance coordinator. It
  serializes and debounces runs, evaluates tripwires first, scans the local
  candidate queue, applies only replay-proven R0 retrieval metadata, issues the
  matching trust delta, audits the result, and compiles a validated snapshot.
  Repository-local `status`, `enable`, and `disable` controls keep the
  unattended path visible and reversible.
- Automatic R0 promotions carry a content-addressed inverse operation. A
  harmful host- or user-confirmed outcome quarantines the memory and restores
  the exact previous bytes while appending a rollback receipt; manual and
  higher-risk promotions remain review-only.
- `evolution.completed` local events and dashboard overview data report runs,
  promotions, rollbacks, blocked work, and failures without recording queries
  or memory content.
- Content-bound trust receipts separate topic text from authority, lifecycle,
  evidence, applicability, and rollback history.
- Evidence verifiers cover repository paths, symbol slices, tests, commits,
  canonical documents, user confirmations, and procedure replays. A replay
  anchor is bound to a committed replay record and checked against the
  procedure it names: the fixture it ran against, the environment it ran in,
  and whether every postcondition it reports was one that procedure declared.
  A fixture or environment that moved is drift; a missing fixture, an edited
  procedure, an undeclared postcondition or a run in a forbidden environment
  is blocking.
- `ownmem trust check` audits receipt integrity and produces a proposal-only
  quota utility report. `ownmem trust issue <memory>` (or `--all`, with
  `--dry-run`) signs the receipt for a new or edited memory: a first receipt
  imports it, and every later edit is recorded as a delta that names the
  content it replaces. Signing a person- or host-authored topic change is
  always an explicit command: the audit reports what is unsigned and how to
  sign it, but never signs for you. The unattended R0 coordinator is the narrow
  exception because its promotion receipt, replay, inverse operation, and
  machine verifier bind the exact metadata edit it signs in the same transaction.
  Drifted evidence is a warning, not an error: the memory is still recalled,
  with its authority capped at advisory. `--refresh-evidence` is the way back.
  It re-signs a memory whose body is unchanged but whose evidence moved,
  recording that it still holds against the files as they are now, and it
  reports which anchors drifted so the assertion is reviewable. It re-signs
  only topics that actually drifted, and only when you type it: without an
  explicit exit, a downgrade caused by editing a file elsewhere would be
  permanent, and a refresh that ran by itself would vouch for nothing.
- `ownmem compile --rollback-previous` restores the prior validated snapshot in
  one operation.

### Changed

- Every command now shares one project memory-directory resolver; legacy
  `.memory` installations and Oriveo's `.claude/memory` dogfood layout remain
  discoverable without creating a competing empty directory.
- The supported Node floor is `>=20.6.0`, and the npm artifact now ships its
  `test/` and `benchmarks/` evidence so consumers can reproduce release gates.
- CI runs the full benchmark on one lane and checks `npm pack` on every other
  supported platform lane.
- General knowledge remains net-zero. Differentially replayed R0 retrieval
  metadata may spend at most 256 bytes per promotion, only inside the
  repository's existing hard byte cap and without adding a topic.
- The README is now a concise architecture, advantages, usage, automation
  boundary, and research overview in nine languages. Detailed technical,
  plugin, migration, privacy, and release material lives in dedicated docs.
- Every recall surface now uses the compiled canonical runtime; Markdown search
  remains only as an explicit, degraded rebuild fallback.
- Query envelopes separate retrieval relevance, epistemic validity, task
  applicability, and action risk under one bounded context contract.
- The compiler layer now owns recall. Core-only installs fail with an explicit
  layer requirement instead of silently running a second retrieval engine.
- Hook-enabled Claude installs register both write-time recall and Read-time
  consumption receipts.
- Recall revalidates external evidence at use time. Missing evidence, tampered
  receipts, unreviewed topic edits, stale entries, and instruction-injecting
  text are quarantined before context delivery. Evidence that still exists but
  whose code moved is downgraded to advisory and reported, not hidden: a lesson
  is most needed in the task that just refactored the code it points at.
- Active memory history accepts only content-bound delta or structured-merge
  receipts.
- 0.3.0 is a clean break. Local run data written before it is not read: rows
  under an older schema are rejected with the reason and the remedy, never
  migrated and never dual-parsed. `.local-test/` is discardable local
  telemetry, so deleting it is the whole fix — the current build collects
  fresh rows. An install that predates the rename from `@oriveo/memory` is not
  upgraded in place either; run `ownmem init` again. Upgrading from 0.2.x is
  unaffected: `ownmem init --update` signs a trust baseline for the corpus
  that install already has.

### Security

- Negated or unauthorized high-impact actions, stale guidance, cross-scope
  matches, weak authority, and superseded instructions are blocked before
  memory enters agent context.
- Frontmatter can no longer grant itself normative authority. Host adapters
  label recalled memory as untrusted advisory data that cannot override system
  or developer instructions or authorize tools.

### Fixed

- Recall, compile, embed, audit, report, dashboard, review, and hook commands
  agree on the corpus and snapshot paths selected by the project.
- Hook subcommands, bare embed usage, runtime recall options, transitive optional
  dependency errors, compile prevalidation, and installed-package structure
  checks now fail or route as documented.

## [0.2.0] - 2026-08-18

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
- CI now uses five targeted runtime/platform combinations instead of repeating
  the full release gate across a nine-job Cartesian matrix. Superseded runs are
  cancelled, and official Actions are pinned to reviewed release commits.

### Fixed

- The structure gate now reads the executable bit for `bin/ownmem.mjs` from
  Git's cross-platform index metadata. Windows no longer fails because its
  filesystem does not expose POSIX execute bits through `fs.stat()`.

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
