---
name: dashboard
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

The server stays resident, so run it in the background and read the JSON it
prints. If an instance is already running, the same command returns it with
`"reused": true` instead of starting a second one:

```bash
npx ownmem dashboard --json > /tmp/ownmem-dashboard.json 2>&1 &
sleep 2 && cat /tmp/ownmem-dashboard.json
```

In Claude Code, prefer the Bash tool's `run_in_background: true` over `&`.

Then open the `url` field in the browser:

```bash
open "<url>"
```

Keep the `#t=` fragment — the access token lives in the URL fragment (it
never reaches the server); without it the page only shows an access notice.

After opening, run `npx ownmem report --since 7d` once and give the user a
one-line summary: adoption north star, latency P50/P95, and the most notable
gap or warning. When the sample is small, say so instead of dressing process
metrics up as adoption.

## Lifecycle

```bash
npx ownmem dashboard --status --json   # is an instance running?
npx ownmem dashboard --stop            # stop it
npx ownmem dashboard --open            # foreground + auto-open, for a human terminal
```
