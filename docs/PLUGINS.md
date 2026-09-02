# Optional agent plugins

The npm package and `.ownmem/` directory are the OwnMem runtime. Plugins are
optional host-level convenience: install them once per machine, then initialize
each repository that should own its own memory.

**The plugin is not the engine.** A host plugin teaches the agent how to invoke
`npx ownmem`. The versioned CLI, schemas, and compiled recall stack come from
the repository's `ownmem` dependency. After a release, update the package and
refresh adapters:

```bash
npm install --save-dev ownmem@latest
npx ownmem init --update
npx ownmem audit
```

Host plugins do not auto-update on every host. Treat a stale plugin as outdated
help text, not as a reason to skip the repository update.

## Claude Code

Add the OwnMem marketplace and install the plugin:

```text
/plugin marketplace add grpcer/ownmem
/plugin install ownmem@ownmem
```

The plugin provides `/ownmem:recall`, `/ownmem:init`, and
`/ownmem:dashboard`. Repository initialization still installs and pins the npm
engine in the project.

Claude Code auto-updates **official** Anthropic marketplaces by default.
Third-party marketplaces, including OwnMem, default to auto-update **off**.
Enable it once after install:

1. Run `/plugin` and open **Marketplaces**.
2. Select **ownmem**.
3. Choose **Enable auto-update**.

Or set `"autoUpdate": true` on the `ownmem` entry under
`extraKnownMarketplaces` in `~/.claude/settings.json`. Then run
`/plugin marketplace update ownmem` and `/plugin update ownmem@ownmem`
(or wait for the next auto-update cycle).

## Codex

Install the repository plugin from the OwnMem source tree, or initialize a
repository with `--hosts codex` so the project-local skill and `AGENTS.md`
adapter are generated together. The project adapter remains the portable
contract; a machine-level plugin is only a shortcut.

Codex best-effort refreshes configured Git marketplaces on startup. To refresh
explicitly:

```bash
codex plugin marketplace upgrade ownmem
```

## Grok CLI

Grok reads the Codex-family adapter from the repository
(`.agents/skills/ownmem` and `AGENTS.md`) after `ownmem init --hosts codex`.
The machine-level plugin is optional. Grok does not auto-update third-party
plugins; refresh with:

```bash
grok plugin marketplace update
grok plugin update ownmem
```

Or in the Marketplace tab, press `r` to refresh sources and `u` to update the
selected plugin.

## Gemini CLI and compatible hosts

The repository includes a Gemini extension manifest plus matching commands and
skills. `ownmem init --hosts gemini` installs the repository-scoped adapter.
Hosts that read `AGENTS.md` can use `--hosts codex` or `--hosts generic`.

## Ownership boundary

- A plugin teaches a host how to invoke OwnMem.
- The npm package supplies the versioned engine.
- `.ownmem/` is the repository-owned memory and trust state.
- Git remains the synchronization and review mechanism.

Removing a host plugin does not delete repository memory. Removing OwnMem from
a repository should be an explicit repository change, reviewed like any other
dependency and project-instruction change.
