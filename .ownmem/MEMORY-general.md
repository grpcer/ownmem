# General

- [CI latency lock](ci_latency_lock_needs_machine_scaling.md) - P95 budget scales by a measured machine factor; absolute 5 ms fails shared runners
- [Offline E2E cache](offline_e2e_requires_fixture_owned_npm_cache.md) - offline install needs a fixture-owned npm cache; npm runs as node + npm-cli.js
- [npm publish gates](npm_publish_requires_2fa_and_ci_provenance.md) - publish needs 2FA/OTP; provenance only in GitHub Actions, locally --provenance=false
- [Lockfile registry](lockfile_must_pin_canonical_registry.md) - resolved URLs must pin registry.npmjs.org or the host mirror leaks to consumers
- [Observation bootstrap](observation_period_bootstrap.md) - 0.2.1 observation period: new-machine bootstrap, do-not-merge rules, acceptance metrics
