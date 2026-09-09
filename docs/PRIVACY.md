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
Explicit retrieval feedback (`correct`, `wrong`, `retrieval_miss`,
`coverage_gap`, `stale`, `conflict`) is different: it stores the raw query in
the ignored local review inbox so a maintainer can reproduce the result.
Feedback is never collected automatically, uploaded, or promoted into a
benchmark without manual privacy review.

From 0.6.0, `ownmem archive` and `ownmem daily` reduce a finished UTC day of
those local events to a counted package at
`<memory-dir>/telemetry/<installation>/<day>.json`. That path is inside the
memory directory rather than the ignored local-data directory, and the daily
pass commits it by default, so the package travels with the repository to every
remote the repository is pushed to. That is what it is for -- `ownmem report
--fleet` merges the packages several machines wrote -- and it is not an upload
to OwnMem. A package holds counts and buckets, latency percentiles, abstention
reasons, the quota and quality lock digests, the topic names recall returned
most often that day, and an installation identifier derived from the machine's
local HMAC key. It never holds query text or a query digest, topic bodies, file
paths, a machine or account name, or a timestamp finer than the day; the writer
checks the rendered file for each of those and refuses to write it otherwise.
Set `telemetry.auto_commit` to `false` in `<memory-dir>/config.json`, or run
`ownmem daily --no-commit`, to keep the packages out of commits. They are still
written to disk, to be handled however the repository prefers.

Outcome receipts and weak self-attribution labels are stricter still. Neither
stores a prompt, a confirming sentence, or a file body. An outcome receipt keeps
only the SHA-256 of the statement that confirmed it, plus an optional note that
the caller must pass explicitly and that is capped at 200 characters; nothing
reaches into a conversation to collect one. Their operational events carry only
enumerations, booleans, and digests.

Trust receipts are repository data. They contain content and evidence hashes,
repository-relative locators, lifecycle metadata, and optional commit IDs, but
not prompts, transcripts, secrets, or model reasoning. The quota utility report
only proposes review; it never deletes memory automatically.

The compiled index now stores each topic's full text, not only derived tokens
and hashes, so that body excerpts are bound to the bytes the snapshot indexed.
Treat the local index directory as a complete copy of your memory corpus: it
stays under the ignored local-data directory, and it must be removed from any
artifact you share, exactly like the memory files themselves.

Before sharing a bug report, generated repository, benchmark artifact, or
dashboard screenshot, remove real memory text, paths, repository names,
credentials, local identifiers, and operational event files.
