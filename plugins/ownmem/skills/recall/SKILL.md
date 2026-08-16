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

Run one recall for the problem, path, or symbol you are about to touch:

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

## Record recall quality

When a recall clearly helped or clearly missed, say so. Feedback stays in a
project-local review inbox and is never uploaded:

```bash
npx ownmem recall --feedback correct -- "query that matched"
npx ownmem recall --feedback miss --expected memory_name -- "query that should have matched"
```

## Keep the memory healthy

```bash
npx ownmem audit              # schema, quota, boundary, and duplicate gates
npx ownmem report --since 7d  # adoption and recall-quality report
npx ownmem dashboard --open   # local Web console
```

Write a new memory only for lessons that reading the code cannot recover —
upstream quirks, toolchain traps, timing races. Keep entries small and let
`npx ownmem audit` enforce the growth quota.
