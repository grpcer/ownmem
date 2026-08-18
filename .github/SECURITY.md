# Security policy

## Supported versions

Security fixes are provided for the latest published minor release.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's
private vulnerability reporting at `grpcer/ownmem`. Include the affected
version, operating system, reproduction steps, impact, and any proposed
mitigation. Please do not include real memory files, API keys, or private
repository content.

We aim to acknowledge a complete report within five business days. A fix
and coordinated disclosure timeline depend on severity and reproducibility.

## Security boundary

Default recall is local and performs no network or model calls. The optional
embedding lane sends only the text selected for embedding to the provider
explicitly configured by the user. The dashboard binds to `127.0.0.1`, uses
a random bearer token, and must not be exposed through a reverse proxy.
