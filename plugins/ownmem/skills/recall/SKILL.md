---
name: recall
description: Recall this repository's OwnMem local memory before changing code, and keep it healthy. Use when a repository contains .ownmem/, when past debugging lessons could apply ("have we hit this before", "why is it done this way"), or when the user mentions ownmem, project memory, or recalling across sessions.
---

# OwnMem recall and daily use

OwnMem is this repository's local, deterministic memory. Recall runs offline —
no model calls, no network, no query-time token cost — and every memory is
plain Markdown inside the repository.

If the repository has no `.ownmem/` directory, OwnMem is not installed here;
use the init skill from this plugin first.

## Recall before changing code

```bash
npx ownmem recall -- "problem, path, or symbol"
```

For natural-language symptoms, pass two or three phrasings in one call and let
the deterministic fusion rank them:

```bash
npx ownmem recall --multi -- "symptom in plain words" "root-cause term" "english symbol"
```

Open a hit's full topic file before relying on it, then verify against live
code: memories record what was true when they were written.

## Do not implement memory logic here

This skill only routes to the CLI. Flags, feedback names, and contracts belong
to the **installed package**, not to this plugin. Host plugins are optional
shortcuts and do not auto-update on every host, so a stale copy of this file
must not teach a retired protocol.

Use `npx ownmem --help` and `npx ownmem <command> --help` for the current
surface. After a version bump, update the repository package and run
`npx ownmem init --update`.

## Keep the memory healthy

```bash
npx ownmem audit
npx ownmem report --since 7d
npx ownmem dashboard --open
```

Write a new memory only for lessons that reading the code cannot recover —
upstream quirks, toolchain traps, timing races. Keep entries small and let
`npx ownmem audit` enforce the growth quota.
