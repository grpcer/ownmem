---
name: offline_e2e_requires_fixture_owned_npm_cache
description: The packed offline-install E2E must warm and use a fixture-owned npm cache; the developer's global cache hides ENOTCACHED, and Windows cannot spawn the npm .cmd shim
metadata:
  node_type: memory
  type: debug
  status: active
  scopes: [self-test, ci]
  applies_to: [all]
  triggers:
    - "ENOTCACHED"
    - "cache mode is 'only-if-cached' but no cached response is available"
    - "self-test passes locally but fails in CI"
    - "npm pack exited null on windows"
    - "spawnSync npm ENOENT"
  last_verified: 2026-08-18
  expires_at: null
  authority: observed
  authority_docs: []
  history_docs: []
  supersedes: []
  code_evidence:
    - path: test/public-self-test.mjs
      symbols: [packedOfflineInstall, npmCliScript, runNpm]
      tests: [test/public-self-test.mjs]
  evidence:
    - "2026-08-16 run 31948081998: first-ever CI run, all 9 jobs red; macOS/linux ENOTCACHED on the offline tarball install, windows npm spawn returned status null"
---

# Offline E2E requires a fixture-owned npm cache

`npm install --offline <tarball>` resolves dependency ranges from cached
registry metadata (packuments). `npm ci` downloads tarballs from the lockfile's
resolved URLs and never fetches packuments, so a fresh CI machine has a cache
that satisfies `npm ci` but not an offline install: the E2E died with
ENOTCACHED on every platform while passing on any developer machine whose
global cache had ever seen the dependencies. The offline assertion is only
meaningful against a cache the test controls: `packedOfflineInstall` first
installs the same tarball online into a throwaway consumer with
`npm_config_cache` pointed at a fixture directory, then asserts offline
against that cache only.

Separately, Windows ships npm as a `.cmd` shim that `spawnSync` cannot execute
without a shell, and a shell would mangle the deliberately space-laden fixture
paths. `runNpm` launches npm as `node + npm-cli.js`, resolved from
`npm_execpath` (set under any `npm run`) with bundled-layout fallbacks.
