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
