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

`ownmem archive` and `ownmem daily` reduce a finished UTC day of those local
events to a counted package under the ignored local-data directory, beside the
event files themselves — never inside the memory directory, and never committed.
The package holds counts and buckets, latency percentiles, abstention reasons,
the quota and quality lock digests, and the topic names recall returned most
often that day. It never holds query text or a query digest, topic bodies, file
paths, a machine or account name, or a timestamp finer than the day; the writer
inspects the rendered file for each of those and refuses to write it otherwise.

There is no fleet merge, no upload, and no endpoint. A package is a local
summary of one machine's own day, and it stays on that machine unless somebody
copies it out deliberately.

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

The compiled index stores each topic's full text, not only derived tokens and
hashes, so that body excerpts are bound to the bytes the snapshot indexed.
**Treat the index directory as a complete second copy of your memory corpus.**
On the default layout it sits at `<memory-dir>/index/` — inside the memory
directory, beside the Markdown, and *not* covered by the `.local-test/` entry
`ownmem init` adds to `.gitignore`. Decide deliberately whether to commit it:
committing keeps recall reproducible for everyone who clones, and it also means
every byte of every memory travels twice. Either way it must be removed from any
artifact you share, exactly like the memory files themselves.

Before sharing a bug report, generated repository, benchmark artifact, or
dashboard screenshot, remove real memory text, paths, repository names,
credentials, local identifiers, and operational event files.
