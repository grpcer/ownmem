# Contributing

Thank you for improving OwnMem.

1. Open an issue for behavior changes or new public contracts.
2. Keep default recall deterministic, local, model-free, and network-free.
3. Add or update a synthetic regression case for every retrieval change.
4. Keep source comments, errors, tests, and maintenance documentation in
   English. User-facing dashboard copy belongs in the locale catalog.
5. Run `npm test` and `npm run benchmark:release` before requesting review.

Never contribute production memory, conversation excerpts, credentials,
private paths, customer data, or proprietary incident material. Synthetic
fixtures must use the repository's documented public fixture license.

Pull requests should explain the observed problem, root cause, chosen
trade-off, and exact verification commands. Performance claims must include
the corpus digest, platform, Node version, sample count, and percentile.
