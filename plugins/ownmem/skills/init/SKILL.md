---
name: init
description: Install or update OwnMem in the current repository. Use when the user asks to set up OwnMem, add local project memory for coding agents, or refresh an existing OwnMem installation after a version bump.
---

# Set up OwnMem in this repository

OwnMem requires Node.js 20.6 or newer. Install the reviewed dependency, then
generate the host adapters:

```bash
npm install --save-dev ownmem
npx ownmem init --locale auto --hosts claude,codex --layers dashboard --hook --command "npx ownmem"
```

Adjust the flags before running:

- `--hosts`: any comma-separated combination of `claude`, `codex`, `cursor`,
  `gemini`, and `generic` — match the tools the team uses. Grok CLI reads the
  Codex adapter (`.agents/skills/ownmem` and `AGENTS.md`).
- `--layers`: `core`, `gates`, `compiler`, or `dashboard` — `dashboard` adds the local Web console.
- Drop `--hook` if the team does not want the Claude Code PreToolUse recall guard.

Initialization creates `.ownmem/` plus bounded `ownmem-generated` blocks in the
host instructions, and preserves every line outside those boundaries. Verify:

```bash
npx ownmem init --check
npx ownmem audit
```

The npm package is the engine. This plugin is an optional shortcut and does
not auto-update on every host. After a version bump (for example a Dependabot
pull request):

```bash
npx ownmem init --update && npx ownmem init --check && npx ownmem audit
```
