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

## Moving from 0.6.0 to 0.7.0

**After `npm install --save-dev ownmem@latest`, run `ownmem init --update`
before anything else.** 0.6.0 installed three hooks
that no longer exist — `PostToolUse`, `PostToolUseFailure`, and `Stop`, all
routed to `ownmem hook posttool` or `ownmem hook stop`. Those subcommands are
gone, so an upgraded installation that keeps them fires a command that exits
non-zero on every Bash, WebFetch, WebSearch and MCP call the agent makes and at
the end of every turn. Since 2026-09-20 the failure says so and names the fix:
`memory hook 'posttool' was retired; ... Run ownmem init --update`. `init
--update` removes the entries where they stand and leaves your own hooks — and
anything else in that file — untouched; `init --check` reports a leftover as
drift and prints the same one-line fix.

The unattended governance layer is gone: `ownmem evolve`, `ownmem promote`,
`ownmem tripwire`, `ownmem candidates`, `report --governance`, and the
`--quarantine-file` option no longer exist. Local ledger files you already have
— candidates, evolution, quarantine, trigger-backfill receipts — are not
deleted; they are simply never read again. Delete them when you are ready to.

`ownmem daily` no longer commits anything, no longer sets `core.hooksPath`, and
no longer generates `<memory-dir>/git-hooks/post-commit`. The old
`telemetry.auto_commit` and `telemetry.manage_hooks_path` keys in
`<memory-dir>/config.json` are ignored rather than honoured, and `init --update`
removes them for you.

**If 0.6.0 claimed `core.hooksPath` for you, the upgrade does not give it back**
— and this is the one piece of leftover state that fails silently. Git installs
no repository hooks at all from a `core.hooksPath` that does not resolve, so once
`<memory-dir>/git-hooks/` is gone — you delete it, a colleague clones without it,
this version never regenerates it — *your own* hooks stop running and every
commit still succeeds. Since 2026-09-20 `init --check` and `init --update` both
report it as a note naming the exact command, rather than leaving you to find it:

```bash
git config --get core.hooksPath     # .ownmem/git-hooks, set by 0.6.0
git config --unset core.hooksPath   # unless that directory is yours now
```

It is reported and never repaired: you may have pointed that setting somewhere
deliberately since, and this version does not own it.

Daily telemetry packages are `ownmem-telemetry-day/v3` and are written under the
ignored local-data directory instead of inside the memory directory. They are
not committed, and `report --fleet` — which merged committed packages across
machines — is gone with them. Packages 0.6.0 already committed are left where
they are and are no longer read.

The recall envelope gained a delivery tier. `recall --json` now carries
`delivery{tier, content_threshold, eligible}` and a separate `pointers[]` array,
where `tier` is `content`, `pointers`, or `abstain`. Anything that reads
`results[]` as the whole delivery will now silently miss qualified memories the
envelope handed over as pointers — including any trust disclosure attached to
them. `abstain.reason` gained `below-content-threshold` and the three
`blocked-*` values that were previously all reported as `no-trusted-candidate`.

The compiled index is rebuilt rather than migrated. 0.6.0's snapshots declare
artifact contracts this reader does not accept, so the first recall after the
upgrade rebuilds from your Markdown sources and says so in the envelope
(`source.status: "rebuilt"`, `source.rebuild_trigger: "manifest-invalid"`). The
old snapshot directories are left on disk, unread; delete
`<memory-dir>/.ownmem/index/snapshots/` when you want the space back.

A feedback ledger written by a version older than 0.6.0 is not migrated either.
`ownmem report` now declares the rows it could not read, because they are absent
from the north star and from every verdict count rather than merely uncounted.
Rewrite or delete `.local-test/memory-recall-feedback.jsonl` when you see that
line.

Two new commands: `ownmem new NAME` scaffolds a memory that already passes every
gate, and `ownmem mcp` serves recall and read over MCP on stdio.

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
4. run `ownmem compile` and reopen the agent.

Local telemetry from pre-0.3 schemas is discardable and is not migrated or
dual-parsed. Delete the old Git-ignored local telemetry directory if the CLI
reports a schema mismatch; current events will be collected from a clean slate.

## Release status

A commit on `main` is not an npm release. Before claiming that an update is
available to users, the maintainer must complete the platform matrix, locked
benchmark, public release audit, package dry run, npm publish, GitHub release,
and registry version verification described in [RELEASE.md](./RELEASE.md).
