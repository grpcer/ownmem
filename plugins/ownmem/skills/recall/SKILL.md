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

## The three feedback streams

Three different questions, three separate local files, three separate
denominators. Nothing here is uploaded, and no stream may stand in for another.

**1. Retrieval verdict** — did recall return the right thing?

```bash
npx ownmem recall --feedback correct -- "query that matched"
npx ownmem recall --feedback retrieval_miss --expected memory_name -- "query that should have matched"
```

`retrieval_miss` means the right memory is active but fell outside the top-k,
so it must name it. `coverage_gap` means no right memory exists yet, so it
never takes `--expected`. `wrong`, `stale` and `conflict` may name one.

**2. Outcome receipt** — what happened after a memory was used? Record it only
when the user or the host actually confirmed it; an agent's own opinion is
refused here on purpose. Only the digest of the confirming statement is stored,
never its text.

```bash
npx ownmem outcome --memory memory_name --outcome applied \
  --confirmed-by user --confirmation "yes, that fixed it"
```

This is the only honest measure of actual application. Until receipts
accumulate, a full-text open still means only that a body was read.

**3. Weak self-attribution** — at the end of a turn in which memory was
injected, and only when a memory clearly helped or clearly misled you:

```bash
npx ownmem attribute --memory memory_name --label useful
```

Record nothing when the turn was neutral. Because the sample selects itself,
these labels are counts and never a rate: an unlabelled turn is unknown, not
neutral.

## Keep the memory healthy

```bash
npx ownmem audit              # schema, quota, boundary, and duplicate gates
npx ownmem report --since 7d  # adoption and recall-quality report
npx ownmem dashboard --open   # local Web console
```

Write a new memory only for lessons that reading the code cannot recover —
upstream quirks, toolchain traps, timing races. Keep entries small and let
`npx ownmem audit` enforce the growth quota.
