# Updating OwnMem

OwnMem updates are repository changes, not silent machine-level mutations.
Review the dependency, generated adapters, memory contracts, and compiled state
together.

## Update a repository

```bash
npm install --save-dev ownmem@latest
npx ownmem init --update
npx ownmem audit
npx ownmem compile
```

`init --update` changes only OwnMem-managed marker regions. Commit the package
lock, generated adapters, and intentional memory changes together so every
agent and CI environment uses the same version.

Host plugins (Claude Code, Codex, Grok, Gemini) are optional shortcuts. They
do not replace this repository update, and they do not auto-update on every
host. See [PLUGINS.md](./PLUGINS.md) for per-host refresh steps. After the
package bump, `init --update` refreshes the in-repo adapters those hosts
actually follow.

## Moving from 0.5.x to 0.6.0

Events record `surface` as `hook` rather than `claude-hook`, and carry two new
top-level fields: `agent`, the coding agent that produced the row, and `nested`,
set when more than one host marker was present and attribution is refused rather
than guessed. Rows written before the upgrade keep `claude-hook` and are reported
as a separate legacy bucket; nothing is re-attributed after the fact. Anything
that reads the event files directly, or that buckets the report's output, has to
be updated.

`init --update` installs the unattended daily pass on `SessionStart` and `Stop`,
and generates `<memory-dir>/git-hooks/post-commit` as a third trigger. That pass
commits the telemetry packages it writes under `<memory-dir>/telemetry/`, and it
points `core.hooksPath` at the generated hook directory while that setting is
empty, or names a directory that is empty or absent -- a hooks path that installs
no hook displaces nothing by being claimed. A directory that exists and holds
hooks is reported and left where it is. Both behaviours are disclosed at install
time. To switch them off, set `telemetry.auto_commit` or
`telemetry.manage_hooks_path` to `false` in `<memory-dir>/config.json`, or pass
`ownmem daily --no-commit`.

The hook configuration is now v2 and the installed version is recorded in
`<memory-dir>/config.json`, so run `ownmem init --update` once. v1 entries are
replaced where they stand rather than appended beside, and hooks written by hand
are left untouched. `init --check` reports an installation that is still on v1.

Codex hooks take three separate permissions before they run: `hooks = true` under
`[features]` in `~/.codex/config.toml`, the project trusted in that same file,
and the hook trust prompt on first sight. A project missing any of them is silent
rather than failing. Grok runs a repository's hooks only while the checkout is in
its trusted-folder list. `init --check` reports both.

`PostToolUse` and `Stop` never ran under 0.5.x, because v1 registered subcommand
names the CLI does not have. Command outcomes and turn corrections start being
collected at this upgrade. A report covering days before it shows those two
empty because they were never collected, not because anything was lost.

## Moving from 0.4.x to 0.5.x

Version 0.5 aligns the published query contract with `ownmem-query-result/v5`,
separates telemetry under the current `0.10.0` runtime identity, observes
query-span coverage without enabling an unsafe multilingual threshold, and
short-circuits exact path and identifier queries before broad recovery lanes.

There is no manual data migration. Run the normal update commands above; the
compiler rebuilds an incompatible derived snapshot from the Markdown source of
truth. Local observability remains local and reports runtime cohorts separately.

## Legacy migration: 0.2.x to 0.3.x

Version 0.3 adds content-bound trust receipts, canonical compiled recall,
separate delivery verdicts, and bounded unattended R0 evolution.

For a normal 0.2.x repository:

1. update the package;
2. run `ownmem init --update` to create the trust baseline for the existing
   corpus and refresh host adapters;
3. run `ownmem audit` and resolve every blocking issue;
4. run `ownmem compile` and reopen the agent;
5. inspect `ownmem evolve status` and disable the repository-local coordinator
   if unattended R0 metadata evolution is not desired.

Local telemetry from pre-0.3 schemas is discardable and is not migrated or
dual-parsed. Delete the old Git-ignored local telemetry directory if the CLI
reports a schema mismatch; current events will be collected from a clean slate.

## Automation controls

```bash
npx ownmem evolve status
npx ownmem evolve disable
npx ownmem evolve enable
npx ownmem evolve run --force
```

Disabling evolution does not disable recall, trust checks, audit, or manual
maintenance. It only stops the end-of-turn unattended coordinator for that
repository.

## Release status

A commit on `main` is not an npm release. Before claiming that an update is
available to users, the maintainer must complete the platform matrix, locked
benchmark, public release audit, package dry run, npm publish, GitHub release,
and registry version verification described in [RELEASE.md](./RELEASE.md).
