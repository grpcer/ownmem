---
name: lockfile_must_pin_canonical_registry
description: package-lock.json resolved URLs must point at registry.npmjs.org; a build host's mirror configuration otherwise leaks into the published lockfile
metadata:
  node_type: memory
  type: lesson
  status: active
  scopes: [release]
  applies_to: [all]
  triggers:
    - "registry.npmmirror.com in package-lock"
    - "mirror URL leaked into lockfile"
    - "resolved host is not npmjs"
    - "npm ci fetches from an unexpected registry"
  last_verified: 2026-08-16
  expires_at: null
  authority: observed
  authority_docs: []
  history_docs: []
  supersedes: []
  code_evidence:
    - path: package-lock.json
      symbols: []
      tests: []
  evidence:
    - "2026-08-16: caught before the first push; 5 of 6 resolved URLs pointed at npmmirror/huaweicloud mirrors captured from the build host's npm configuration"
---

# Lockfile must pin the canonical registry

npm records whatever registry the installing machine was configured with into
each `resolved` URL. A build host using a regional mirror silently stamps that
mirror into the lockfile, so every consumer's `npm ci` fetches from an
endpoint the project never chose, and the lockfile leaks the host's registry
configuration. This repository's lockfile is generated with every `resolved`
URL rebuilt as `https://registry.npmjs.org/<name>/-/<name>-<version>.tgz`;
integrity hashes stay valid because mirrors serve byte-identical tarballs.

If a lockfile change ever shows a non-npmjs host in a `resolved` field, that
is a defect in the generation step, not a dependency change. Check with:
`grep -o 'https://[^/"]*' package-lock.json | sort -u`.
