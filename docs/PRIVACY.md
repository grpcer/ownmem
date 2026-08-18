# Privacy boundary

OwnMem is local-first. Default initialization, recall, audit,
compilation, reporting, and dashboard use do not transmit memory or query
content to grpcer, OwnMem, or any hosted service.

The optional embedding lane is disabled until a user selects and configures
a provider. When enabled, the provider receives the text required to build
or query the semantic index under that provider's own terms. API keys are
stored locally, masked in dashboard responses, and excluded from reports.

Local operational events use derived identifiers instead of raw queries.
They remain under the initialized repository's ignored local-data directory.
The public package contains no telemetry endpoint and no automatic upload.
Explicit `correct`, `wrong`, or `miss` feedback is different: it stores the raw
query in the ignored local review inbox so a maintainer can reproduce the
result. Feedback is never collected automatically, uploaded, or promoted into
a benchmark without manual privacy review.

Before sharing a bug report, generated repository, benchmark artifact, or
dashboard screenshot, remove real memory text, paths, repository names,
credentials, local identifiers, and operational event files.
