---
name: ownmem-dashboard
description: Open OwnMem Console, the local dashboard for this repository's memory. Use when the user asks to open the dashboard, see memory metrics, check adoption or recall quality, or set up the optional embedding lane. Requires a repository initialized with the dashboard layer.
---

# Open OwnMem Console

OwnMem Console renders this repository's memory metrics — adoption funnel,
recall latency, corpus health, governance — in the browser. It binds
127.0.0.1 only; nothing is served off this machine.

If `npx ownmem dashboard` fails because the layer is missing, the repository
was initialized without it. Re-run init with `--layers dashboard` (see the
init skill), then retry.

## Start it for the user

The server stays resident. Start it in the background; if an instance is
already running, the same command returns `"reused": true` instead of starting
a second one.

Do **not** redirect `--json` output to `/tmp` or any other shared directory.
That JSON contains a long-lived access token, and `/tmp` is commonly
world-readable.

In Claude Code, use the Bash tool with `run_in_background: true`. In other
hosts, start the process in the background without capturing the token to a
world-readable file:

```bash
npx ownmem dashboard --json
```

Then read the URL from the private instance record (mode 0600 under
`.local-test/`):

```bash
npx ownmem dashboard --status --json
```

Open the `url` field in the browser. Keep the `#t=` fragment — the access
token lives in the URL fragment and never reaches the server; without it the
page only shows an access notice.

The CLI defaults to a random port. Pass `--port 45300` (or another free local
port) when the user needs a stable bookmark, and keep using that port later.

After opening, run `npx ownmem report --since 7d` once and give the user a
one-line summary: adoption north star, latency P50/P95, and the most notable
gap or warning. When the sample is small, say so instead of dressing process
metrics up as adoption.

## Lifecycle

```bash
npx ownmem dashboard --status --json
npx ownmem dashboard --stop
npx ownmem dashboard --open
```
