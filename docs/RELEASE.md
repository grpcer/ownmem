# Release checklist

Canonical targets:

- GitHub: `https://github.com/grpcer/ownmem`
- npm: `ownmem`
- CLI: `ownmem`
- Web console: `OwnMem Console`

A release is blocked until every item below has fresh evidence:

- Linux runs `npm run verify:release` on the current Node release. Linux on
  Node 20 and 22, macOS, and Windows run the public compatibility suite plus
  the `npm pack` gate, so every supported runtime and operating system is
  covered — including pack regressions — without repeating the full benchmark
  on every lane.
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
- `npm view ownmem version` matches the latest release heading in
  `CHANGELOG.md` after publishing. A fix merged to `main` is not shipped
  until it is on the registry: consumers install the npm artifact, not the
  git tree, so a commit without a version bump and publish leaves every
  consumer on the broken build.
- The GitHub release and npm publish targets are explicitly confirmed by a
  maintainer. Publishing credentials are never stored in this repository.

Do not substitute a simulated platform contract for an executed platform
job. Missing platform evidence blocks publishing and must be reported as
unverified.
