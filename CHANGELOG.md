# Changelog

All notable changes follow Keep a Changelog. Versions follow Semantic
Versioning.

## [Unreleased]

## [0.7.0] - 2026-09-22

The observation-window and fleet work that was built and removed again between
0.6.0 and this release was never published, so it is not recorded as an
addition followed by a removal; every entry below is stated against 0.6.0,
which is what consumers had.

### Breaking

- The unattended governance layer is removed: `ownmem evolve`, `ownmem promote`,
  `ownmem tripwire`, `ownmem candidates`, `report --governance`,
  `--quarantine-file`, and the `memory-maintenance` module. In 703 runs it
  promoted nothing and rolled back nothing, and the promotion, quarantine, and
  tripwire ledgers it was documented as keeping had never been created. Local
  ledger files a consumer already has are not deleted; they are no longer read.
- `PostToolUse`, `PostToolUseFailure`, and `Stop` hooks are removed, together
  with the `hook posttool` and `hook stop` subcommands and the three events they
  collected. The events had no reader anywhere in the package. **Run
  `ownmem init --update`:** an installation that keeps the 0.6.0 entries now
  fires a command that exits non-zero on every Bash call. `--update` removes
  them where they stand and `--check` reports a leftover as drift.
- `ownmem daily` no longer commits, no longer claims `core.hooksPath`, and no
  longer generates `<memory-dir>/git-hooks/post-commit`. The
  `telemetry.auto_commit` and `telemetry.manage_hooks_path` keys are ignored
  rather than honoured. A `core.hooksPath` that 0.6.0 claimed is not handed
  back automatically; check and unset it yourself.
- Daily packages are `ownmem-telemetry-day/v3` and live under the gitignored
  observability tree rather than inside the memory directory, so they are no
  longer committed. `report --fleet`, which merged committed packages across
  machines, is removed with them. A finished v2 package on disk is kept, not
  rewritten and not read.
- The recall envelope is `ownmem-query-result/v6`, up from v5, and the index
  manifest's `compatibility.query_result_schema` follows. The shape changed and
  the version did not, so for a while 0.6.0 envelopes and 2.0 envelopes shared
  one version number while failing each other's validator — and that number is
  the only thing a consumer can tell them apart by. A v5 snapshot on disk is now
  judged incompatible and rebuilt rather than read.
- The recall envelope gained `delivery{tier, content_threshold, eligible}` and a
  separate `pointers[]` array. A consumer that reads `results[]` as the whole
  delivery now silently drops qualified memories handed over as pointers, and
  any trust disclosure attached to them. `abstain.reason` gained
  `below-content-threshold`, `blocked-validity`, `blocked-applicability`, and
  `blocked-risk`; the last three were previously reported as
  `no-trusted-candidate`, which asks the caller for the opposite response.
- `max_active_bytes` is removed from the quota lock. In seven weeks it was
  raised by hand six times, and the lock's own rationale gives the same reason
  each time — no compliant swap-out, raised to the new entry's exact byte count,
  no headroom — which is to say the ceiling was always set equal to the present
  and never refused anything. Net-zero growth is carried by the entry count,
  which still ratchets downward only.

### Added

- `ownmem recall` delivers in three tiers instead of two. Above the content
  threshold it quotes the memory; below it, with qualified candidates, it
  returns up to three pointers — a title, one line, and the command that opens
  the topic; with no qualified candidate it abstains and names the reason. The
  threshold is read off the measured ablation curve, not chosen by taste: it is
  the smallest value at which false delivery stops falling. Every renderer
  states that a pointer is not an answer.
- `ownmem new NAME` scaffolds one memory that already passes every gate,
  including the trust receipt and the area-index routing line, and refuses
  before writing the file when the corpus is at its quota. The frontmatter
  schema and several rules that existed only in prose were previously
  discoverable only by writing an entry and being told it was wrong.
- `ownmem mcp` serves recall and read over MCP on stdio, hand-rolled with no
  dependencies. Exactly two tools, neither of which can change a memory: the
  gate commands (`audit`, `trust`, `compile`) and every memory write stay off
  the surface. `read` is the only producer of the consumption receipt
  on a host with no tool-level hook, which is the case this server exists for.
- `report` answers four questions by default — whether memory is being used,
  whether it is fast enough, whether it is right, and what to do next — and
  `report --full` restores the cohort splits, abstention reasons, token
  distribution, and build counters. Data gaps are never hidden either way.
- The evidence verifier reports `symbol-not-a-definition` when an anchor's
  slice matched a comment or a call site rather than a definition. Such a
  receipt reads as healthy while vouching for the wrong block, and refreshing
  it only re-signs the comment.
- `ownmem archive` reports a finished day it declined to rewrite as `kept`
  rather than as unchanged.

### Changed

- Recall and compiler stack identity advances to `0.11.0`. Three-tier delivery
  and the coverage requirement for quoting changed what recall hands over, so
  the current-engine telemetry cohort and the embedding A/B evidence the console
  accepts start fresh instead of mixing in `0.10.x` behaviour. The ranking
  profile hash is unchanged.
- Recall is faster on both paths. Trust is evaluated after the two relevance
  gates rather than over every candidate, code-anchor fingerprints are memoised
  per `(inode, size, mtime, ctime)`, and the snapshot reader parses the bytes it
  already holds instead of re-running the schema check the compiler just ran.
  The hot path fell from 20.8ms to 3.0ms P95 and the cold path from 369ms to
  281ms, with the full ranker output over the whole evaluation corpus identical
  byte for byte before and after.
- The recall daemon idles for 30 minutes instead of 5, loads the snapshot at
  start rather than on first query, and watches only `*.md` under the memory
  directory, so ledger and lock writes no longer kill the resident process.
  `SessionStart` warms it. An end-to-end Edit hook takes 120ms once the daemon
  is ready, against 450–530ms before.
- Quoting a memory now also requires that it explain the question, so **more
  queries arrive as pointers than before**. Clearing the content threshold is no
  longer sufficient: the top candidate must additionally cover at least
  `coverage_floor` (0.45, the constant the ranker's relevance gate already used)
  of the query — character-span coverage for natural-language queries, the
  IDF-weighted coverage for identifier, path and error lookups, because a
  one-token symbol query has a span coverage of exactly 0 or 1. Nothing about
  ranking changed and no relevance gate moved, so a memory that fails this is
  handed over as a pointer rather than lost, and `ranking_profile_hash` is
  unchanged. Measured on the maintainer's corpus: of the queries a human had
  filed a wrong-delivery receipt for, those still answered with prose fell from
  21 of 106 to 8 of 106, the curated quality cases kept every correct quotation
  (40 of 40, none lost), and Recall@1 on every partition is identical to the
  digit. A consumer that treats `results[]` as the only answer surface will see
  this as a drop in answers; it is the same answers, arriving as pointers.
  `gate_score` alone was the weaker signal it replaced: over 336 quoted
  deliveries it separates right from wrong with AUC 0.812, but only 0.667 once
  self-proving smoke questions are excluded, where coverage reaches 0.886.
- `ownmem report`'s north star is the **known false-delivery residual**: of every
  distinct query a `wrong` retrieval receipt was recorded for, the share still
  answered with prose, replayed against the index on disk. Both halves are
  already-recorded facts and it falls only when retrieval improves. It replaces
  the confirmed full-text-open rate, which the 400-token envelope is designed to
  keep low and which was never an outcome; that funnel is still printed, as a
  coverage floor, now alongside a pointer-tier funnel (pointer deliveries and how
  many were opened) that the delivery counters could not see, because a pointers
  envelope is recorded as an abstention. The report object is
  `ownmem-report/v9`: `quality.false_delivery` is new, `delivery` gained four
  pointer fields, and `metric_roles.north_star` changed value. The replay costs
  about a second on a hundred-receipt ledger, so it is opt-in — the CLI does it,
  `--no-replay` turns it off, and a programmatic caller gets an explicit
  `not_measured` with the reason rather than a rate over zero replays.
- The console's headline figure is the same north star the CLI reports, the known
  false-delivery residual. It used to be the confirmed full-text-open rate under a
  message key literally named `north_star`, so one word meant two things depending
  on which entry point you opened. The open rate is still shown, as the middle bar
  of the funnel beside it, under a name that says what it counts. An unmeasured
  residual renders as unavailable rather than as 0%, because nothing measured and
  nothing left over are opposite readings and a percentage cannot tell them apart.
  The replay costs about a second, so the server builds it once per process and
  remembers each query's result, keyed on the feedback ledger and the compiled
  snapshot; only the current window gets it, since the residual is a property of
  the whole ledger and not of a time range. Message catalogs: `north_star` and
  `north_star_help` changed meaning, `no_residual` and `fulltext_open` are new,
  `no_consumption` is removed, in all 16 locales; nothing else in the catalogs
  moved.
- An unanswered recall now offers both endings on the command line. Only
  `retrieval_miss` was ever suggested, and it requires naming the memory that
  should have come back, so a reader whose honest report is "none of these, and I
  do not think anybody wrote this down" had no verdict they could use. That
  reader's verdict is `coverage_gap`, which carries no expected memory, and it is
  the commoner outcome on this surface: of the pointer deliveries this
  repository's own machine produced, every one that later received a verdict was
  a coverage gap and none was a correct answer.
- Upgrading from 0.6.0 now says what to do at each point it can go wrong, which
  was measured by upgrading a real 0.6.0 checkout in place rather than by
  installing fresh. A retired hook subcommand names itself retired and points at
  `ownmem init --update`, instead of reporting only `unknown memory hook command:
  posttool` on every Bash, WebFetch, WebSearch and MCP call and at the end of
  every turn. `init --check` prints the one command that clears the drift it just
  listed. And `core.hooksPath` left pointing at the `git-hooks` directory an
  earlier version generated is reported as a note on every `init` run, with the
  `git config --unset` line — it is the one leftover that fails in silence, since
  git installs no repository hooks at all from a path that does not resolve, so
  the repository's own hooks stop running and commits keep succeeding. It is
  reported and never repaired: the setting may be yours now.
- `report` declares the feedback rows it could not read. A ledger written under an
  older schema was simply absent from the north star and from every verdict count,
  which reads as "nobody ever reported a wrong answer" rather than as "your
  history is no longer being parsed".
- A snapshot this reader rejects is reported as `manifest-invalid` rather than as
  `missing`. When both the current and the previous pointer carry an older
  artifact contract — exactly what a 0.6.0 install looks like — the reader raises
  one aggregate error whose text reads as absence, and the published
  `source.rebuild_trigger` inherited that wording. Nothing was missing: both
  snapshots were found, read and rejected, and the rebuild is correct either way.
- `matched_terms` no longer reports words the query does not contain. The n-gram
  and fuzzy lanes were adding the indexed token they matched through, and the
  graph lane was adding the name of the memory it hopped from, so an envelope
  could list another memory's name among "matched terms". Each lane now keeps the
  query side and the corpus side apart and publishes only the query side. Ranking
  is unaffected -- the span-coverage feature still reads both, which is what keeps
  an inflected query word from being scored as irrelevant -- and every evaluation
  metric is identical before and after.
- The actual-application rate keeps its line and now states that it is expected
  to stay unmeasured. Only a user or the host may confirm an outcome receipt, and
  a user judges the deliverable rather than which memory was injected, so the
  numerator is not waiting on a lower confirmation bar. The one surface that can
  produce it is `--confirmed-by host`: a gate or test confirming the memory's own
  assertion. `recall.consumed` is still not a substitute — a confirmed full-text
  open proves a body was read, never that the answer used it.

### Fixed

- Codex edits now reach recall. Codex selects the `Edit|Write` hook through its
  matcher aliases but reports the canonical tool name `apply_patch`, with the raw
  patch as `tool_input.command`; the hook accepted only `Edit` and `Write`, so
  every Codex edit invoked it and returned before recalling anything. The target
  is now the first file header in the patch.
- A root `CLAUDE.md` or `GEMINI.md` is detected as a host marker. A first
  `ownmem init` without `--hosts` recognised Claude Code only from a `.claude/`
  directory, so a repository with just `CLAUDE.md` installed every host except
  the one it was written for.
- `ownmem init --check` before the first install names the previewed command as
  the fix instead of `ownmem init --update`, which on a repository with no
  config installs the core layer without hooks.
- A recorded feedback entry can now reach a closed state, so the review queue can
  reach zero. `stale` closes when the reported memory has been re-signed since
  the feedback was filed — judged on the trust receipt, never on the
  hand-editable `last_verified` — and `coverage_gap`, which carries no expected
  topic and so cannot be replayed, closes on a written ruling about where the gap
  belongs. A dismissed `coverage_gap` leaves the actionable count; a dismissed
  `retrieval_miss` does not, because that retrieval failure is still real and
  only its trigger lane was closed.
- A test-run ingest that records one changed outcome no longer rewrites every
  other stored outcome. Records whose graded fields (result, fingerprint,
  counts) match what the ledger already holds keep their stored entry, so the
  git-tracked `test-runs.lock.json` diff carries only the suites that actually
  moved instead of a fresh `run_id` and `duration_ms` on each of them.
- A test anchor is no longer captured by a production file that names its own
  suite in a comment. The weak match that accepted any file containing the
  identifier ran before the repository-wide lookup, so the receipt bound to a
  doc comment instead of to the test.

## [0.6.0] - 2026-09-09

### Breaking

- Events record `surface` as `hook` rather than `claude-hook`, and carry two new
  top-level fields: `agent` (which coding agent produced the row) and `nested`
  (more than one host marker was present, so attribution is refused rather than
  guessed). Rows written before this release keep `claude-hook` and are reported
  as a separate legacy bucket; nothing is re-attributed after the fact, because
  those days genuinely mixed hosts and a guessed attribution is worse than none.
  Anything reading the event files or the report's buckets has to be updated.
- `ownmem init --update` installs the unattended daily pass on `SessionStart`
  and `Stop`, and generates `<memory-dir>/git-hooks/post-commit` as a third
  trigger. That pass commits the telemetry packages it writes and points
  `core.hooksPath` at that directory while the setting is empty and the hook is
  present. Both are new behaviour for a 0.5.x installation and both are
  disclosed at install time; set `telemetry.auto_commit` or
  `telemetry.manage_hooks_path` to `false` in `<memory-dir>/config.json`, or
  pass `ownmem daily --no-commit`, to switch them off. Not upgrading changes
  nothing: 0.5.x hooks stay as they are.
- The hook configuration is now v2 and the installed version is recorded in
  `<memory-dir>/config.json`. Run `ownmem init --update` once. v1 entries are
  replaced where they stand rather than appended beside, and hooks written by
  hand are left untouched. `init --check` and the daily pass both report an
  installation that is still on v1.

### Added

- `ownmem archive [--day] [--backfill]` reduces a finished UTC day of local
  telemetry to a counted package under `<memory-dir>/telemetry/`, small enough
  to commit. Counts only: no query text or digest, topic body, path, machine or
  account name, or timestamp finer than the day. Idempotent, and a day with
  nothing new is not rewritten.
- `ownmem report --since 7d --fleet` merges the committed packages from every
  machine, leads with which machine covered which day, and names the days that
  have commits but no package. Overlapping days are counted once.
- `ownmem daily` is the unattended pass behind both of those: archive, commit,
  inspect what is already in Git, and print only what is wrong. It runs real
  work at most once per UTC day and always exits 0, so it can sit on a session
  hook and a `post-commit` hook without ever blocking either.
- Codex hook support: `ownmem init --hook` writes `<project>/.codex/hooks.json`
  with the same events as the Claude configuration. Reaching those hooks takes
  three separate permissions -- `hooks = true` under `[features]` in
  `~/.codex/config.toml`, the project trusted in that same file, and the hook
  trust prompt on first sight -- and an untrusted project is silent, because it
  never discovers the file at all. `init` names all three, and reports a
  checkout that is missing from the project trust list. A Codex hook process
  receives no environment of its own, so every command declares its host
  explicitly and finds the checkout from its working directory.
- Grok CLI is a supported host (`--hosts grok`). It reads the Claude files
  through a compatibility layer, so it shares that configuration; `init --check`
  reports when the checkout is missing from grok's trusted-folder list.
- Agent attribution: recall, command, and turn events say which host produced
  them, and the report buckets by agent instead of merging three agents into one
  average.

### Fixed

- A daily package names as its release point the earliest commit that declared
  the current version, rather than walking back from the day and stopping at the
  first commit that declared a different one. A version bump that is reverted --
  prepared, called off, and set back -- made that walk stop at the revert and
  compare the day's tree against a tree that was never published, so
  `unreleased_delta` reported no delta for code that is entirely unreleased.
- The daily pass points `core.hooksPath` at `<memory-dir>/git-hooks/`, which
  `ownmem init` generates, and leaves the setting alone until that directory
  holds a `post-commit` hook. A path in this project's own checkout was used
  during development; in any other repository it named a directory that does not
  exist, and a `core.hooksPath` pointing at nothing installs no hooks at all --
  every hook that repository had would have stopped running, silently.
- Repository root resolution prefers the git checkout root when it carries an
  installation, so a nested memory directory copy -- a fixture, an exported tree
  -- inside a subdirectory no longer claims the root and receives that
  checkout's local data. A checkout without an installation still yields to the
  nearest one below it, so a monorepo package that installed its own memory
  keeps answering for the directories under it.
- `PostToolUse` and `Stop` hooks now run. v1 registered `ownmem posttool` and
  `ownmem stop`, which are subcommands of `ownmem hook` and not of the CLI, so
  both answered "unknown memory command" and every installation collected
  command outcomes and turn corrections from nowhere. v2 registers
  `ownmem hook posttool` and `ownmem hook stop`.
- The hook daemon keys its resident runtime per agent, so two hosts working in
  one checkout no longer share one connection and one attribution.
- `ownmem init` on the default `core` layer no longer accepts `--hook` and then
  installs nothing: asking for hooks now installs the layers they need.
- `init --check` no longer reports `missing` forever on a repository that
  replaced the synthetic example topic it was told to replace, and `--update` no
  longer puts that topic back into a governed corpus.
- The host set chosen at install time is remembered instead of re-detected.
  Grok leaves no marker in a repository, so an installation that named it
  reported drift on the next check.

## [0.5.5] - 2026-09-06

### Fixed

- A filtered test rerun no longer shrinks a file's roll-up in the test-execution
  ledger. Selecting one case of a forty-case file derived a roll-up of one, and
  because the latest record per key won, a memory citing the suite then read
  `passed` on the strength of that single case. On an unchanged file a passing
  roll-up that observed fewer cases now leaves the wider record standing; a
  failure, a wider run, or a change to the tested file still lands.
- `ownmem` health no longer prints `0 query(s), 0.0% abstained` for an install
  that never wrote a usage log. The usage log is opt-in (`recall --usage-file`),
  so its absence is reported as unavailable rather than as a measurement.

## [0.5.4] - 2026-09-03

### Added

- `swift-test` is a known test runner in the test-execution ledger, for
  projects whose tests run through SwiftPM's `swift test --xunit-output`.
- `ingestTestRun` accepts any runner the caller supplies an adapter for, so a
  project can connect a toolchain of its own without editing the known list.

## [0.5.3] - 2026-09-03

### Fixed

- Trust receipts no longer bind a test anchor to a file inside a nested checkout
  (a linked git worktree such as `.claude/worktrees/<agent>/`, a submodule, a
  nested clone). The lookup by suite name descended into those copies, `.claude`
  sorted ahead of the real directory, and once the worktree was cleaned up the
  memory was quarantined as `missing-path` with its test untouched in the main
  tree. Any directory carrying its own `.git` entry is now skipped, and the path
  a memory declares next to its test locator takes precedence over the
  repository-wide lookup.
- Directory-anchor fingerprints skip nested checkouts for the same reason.
- A suite-level test anchor, whose symbol is the file's own type name, now
  resolves to that file's roll-up in the test-execution ledger instead of
  reading `never-run` forever: no runner reports a case by the suite's name.

## [0.5.2] - 2026-09-02

### Fixed

- Host plugin and Gemini skills no longer embed recall-feedback protocol details
  that go stale when a marketplace plugin lags behind the npm engine. They route
  to `npx ownmem` and tell the agent to read CLI help for the current contract.
- The dashboard skill no longer redirects `--json` output to `/tmp`. That file
  contained a long-lived access token and was world-readable on typical umasks.
- Negated high-risk recall now reads the authority ceiling granted by the trust
  receipt, not the post-drift effective authority. Evidence drift must not let a
  normative R5 prohibition leak through as if it were no longer a licence.

### Changed

- Plugin installation docs now state that host plugins do not auto-update on
  every host, how to enable Claude Code marketplace auto-update, and that
  `npm install ownmem@latest` plus `npx ownmem init --update` remains the
  version path.

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
