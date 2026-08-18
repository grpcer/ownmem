---
name: ci_latency_lock_needs_machine_scaling
description: The P95 latency lock scales by a measured machine factor; absolute budgets fail shared CI runners on hardware speed alone
metadata:
  node_type: memory
  type: lesson
  status: active
  scopes: [benchmark, ci]
  applies_to: [all]
  triggers:
    - "Performance gate: failed"
    - "release-gates red but quality gate passed"
    - "P95 over budget on ubuntu or windows runners"
    - "machine factor"
    - "calibrateMachineSpeed"
  last_verified: 2026-08-18
  expires_at: null
  authority: observed
  authority_docs: []
  history_docs: []
  supersedes: []
  code_evidence:
    - path: benchmarks/public-benchmark.mjs
      symbols: [calibrateMachineSpeed, performanceGate]
      tests: [test/public-self-test.mjs]
  evidence:
    - "2026-08-16 run 31949549383: windows factor 2.84, budget 14.19 ms, measured P95 5.09 ms, 9/9 jobs green"
    - "2026-08-16 run 31948376256: fixed 5 ms lock, windows global P95 6.72 ms, every quality and determinism lock green, release blocked"
---

# CI latency lock needs machine scaling

The original release gate locked global and per-group P95 at an absolute 5 ms,
calibrated on the maintainer's workstation. The first real CI run failed the
lock on every ubuntu and windows job purely on hardware speed: shared 2-core
runners pushed the windows global P95 to 6.72 ms while recall quality,
abstention, and determinism stayed perfect on all nine jobs.

The lock exists to catch algorithmic regressions, not to certify runner
hardware. `calibrateMachineSpeed` therefore times a fixed pure-CPU Unicode
workload (untimed warmup, then median of 5 runs; reference 38 ms) and the
budget becomes `5 ms x machine factor`. A complexity blowup exceeds any
hardware factor; a slow runner does not. Per-language/per-script groups get a
2x allowance on top because their sample counts are small enough that one
scheduler preemption lands directly on the P95 statistic.

If the gate fails with quality green, read the printed factor and budgets
before touching thresholds: a genuine regression shows P95 far beyond the
scaled budget on every platform, not one group barely over on one runner.
