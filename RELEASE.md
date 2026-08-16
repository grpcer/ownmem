# Release checklist

Canonical targets:

- GitHub: `https://github.com/grpcer/ownmem`
- npm: `ownmem`
- CLI: `ownmem`
- Web console: `OwnMem Console`

A release is blocked until every item below has fresh evidence:

- `npm run verify:release` passes on Node 20, 22, and the current Node release.
- macOS, Linux, and Windows jobs exercise installation, recall, audit,
  compilation, dashboard lifecycle, Unicode paths, and the npm bin entry.
- `npm run benchmark:release` meets every global, per-language, and per-script
  Recall@1/5, MRR, unrelated-query abstention, latency, and determinism lock; the
  fixed algorithm selector still chooses the shipped default.
- The public release audit reports zero private-content, secret, comment,
  catalog, package-whitelist, and dependency-license findings.
- `npm pack --dry-run --json` matches the locked package whitelist.
- The packed tarball installs with npm's offline mode into a clean consumer,
  then its npm bin initializes and recalls from that consumer.
- The version, changelog date, tag, and package manifest agree.
- The GitHub release and npm publish targets are explicitly confirmed by a
  maintainer. Publishing credentials are never stored in this repository.

Do not substitute a simulated platform contract for an executed platform
job. Missing platform evidence blocks publishing and must be reported as
unverified.
