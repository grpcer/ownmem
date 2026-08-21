---
name: observation_period_bootstrap
description: 0.2.1 observation period is active on branch fix/0.2.1-hardening — how to bootstrap a new machine, what is forbidden until acceptance, and which report metrics gate the release
metadata:
  node_type: memory
  type: lesson
  status: active
  scopes: [process]
  applies_to: [all]
  triggers:
    - "continue the observation"
    - "继续观察"
    - "new machine bootstrap"
    - "换电脑 部署"
    - "office setup"
    - "when can 0.2.1 ship"
    - "observation period status"
  last_verified: 2026-08-21
  expires_at: null
  authority: observed
  authority_docs: []
  history_docs: []
  supersedes: []
  code_evidence:
    - path: package.json
      symbols: []
      tests: []
  evidence:
    - "2026-08-21: 23 defects (15 from the v0.1.2..v0.2.0 review + 8 from the adversarial re-review) fixed on this branch; CI run 32498277237 green on all 5 lanes"
---

# 0.2.1 observation period bootstrap

This branch (`fix/0.2.1-hardening`, draft PR #1) carries the fixed build under
real-usage observation. Until the owner explicitly accepts: **do not merge the
PR, do not touch `main`, do not `npm publish`, do not bump the version.**

## Bootstrap a machine (fresh clone of this branch)

```bash
npm ci
npm link        # global `ownmem` must point at this working copy (Node >= 20.6)
ownmem init --update        # config on this branch carries the hook/claude setup; regenerates hook registration
rm -f .ownmem/example_repository_memory.md   # init wart: creates an example topic no L2 routes, which fails audit
npm test && ownmem audit && ownmem hook status   # all three must be green
mkdir -p .local-test/observation && ownmem report --since 7d --json > .local-test/observation/day0-$(date +%Y%m%d).json
```

Never use `npx ownmem` inside this repo: it resolves the published 0.2.0 from
the registry, not this branch. `.local-test/` observation data is per-machine
by design; only code syncs through this branch.

## Acceptance metrics (from `ownmem report --json`, schema ownmem-report/v5)

- >= 50 real recall samples across machines; delivered -> consumed chain populated
- feedback correct/wrong/miss dominated by correct; abstain rate sane
- P50/P95 latency at the order the README claims; invalid events = 0
- "Data gaps" section empty; hook daemon stable (`ownmem hook status`)

## Release day (owner's command only)

Bump version + finalize the CHANGELOG `[Unreleased]` section, decide whether
the dogfood commits (hook config, committed CLAUDE.md/.claude/) stay or get
reverted, merge PR #1, publish per docs/RELEASE.md.
