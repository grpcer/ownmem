---
name: npm_publish_requires_2fa_and_ci_provenance
description: npm publish needs 2FA/OTP or a bypass-enabled granular token, and provenance can only be generated inside GitHub Actions; local publishes pass --provenance=false
metadata:
  node_type: memory
  type: lesson
  status: active
  scopes: [release]
  applies_to: [all]
  triggers:
    - "E403 Two-factor authentication or granular access token with bypass 2fa enabled is required"
    - "npm publish 403"
    - "provenance generation not supported"
    - "how was 0.1.0 published"
  last_verified: 2026-08-16
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
    - "2026-08-16: ownmem 0.1.0 published locally by the maintainer with an OTP after an initial E403; registry integrity matched the audited local tarball byte for byte"
    - "2026-08-16: 0.1.1 published the same way (local OTP, --provenance=false); integrity verified again and a fresh git consumer exercised the new init .gitignore behavior from the registry artifact"
---

# npm publish requires 2FA and CI-side provenance

The registry rejects `npm publish` with E403 unless the account passes a 2FA
OTP or uses a granular access token with 2FA bypass enabled. `publishConfig`
in package.json sets `provenance: true`, which can only be generated inside a
supported CI (GitHub Actions OIDC); a local publish must explicitly pass
`--provenance=false` or it errors before upload.

0.1.0 and 0.1.1 were both published locally with an OTP on 2026-08-16. For later releases,
configuring npm Trusted Publishing for this repository's workflow removes both
the token and the OTP step and restores the provenance attestation; until
then, every local publish repeats the `--provenance=false` dance. After any
publish, verify `npm view ownmem dist.integrity` against the locally packed
tarball before announcing the release.
