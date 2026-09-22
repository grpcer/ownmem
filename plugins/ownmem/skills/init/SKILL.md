---
name: init
description: Install or update OwnMem in the current repository. Use when the user asks to set up OwnMem, add local project memory for coding agents, or refresh an existing OwnMem installation after a version bump.
---

# Set up OwnMem in this repository

OwnMem requires Node.js 20.6 or newer. Install the reviewed dependency, then
generate the host adapters:

```bash
npm install --save-dev ownmem
npx ownmem init --hook --hosts claude,codex
```

Adjust the flags before running:

- `--hosts`: any comma-separated combination of `claude`, `codex`, `cursor`,
  `gemini`, `grok`, and `generic` — match the tools the team uses. The list is
  recorded, and running init again with a new list is how a host is added or
  removed. Grok CLI reads Claude Code's files, so name it alongside `claude`
  when both are used.
- `--locale auto` writes the generated instructions in the system language;
  the default is English.
- Drop `--hook` if the team does not want the recall hooks. `--hook` also
  installs the layers those hooks need, up to the local Web console;
  `--layers core,gates,compiler,dashboard` installs a subset instead.

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
