# Optional agent plugins

The npm package and `.ownmem/` directory are the OwnMem runtime. Plugins are
optional host-level convenience: install them once per machine, then initialize
each repository that should own its own memory.

## Claude Code

Add the OwnMem marketplace and install the plugin:

```text
/plugin marketplace add grpcer/ownmem
/plugin install ownmem@ownmem
```

The plugin provides `/ownmem:recall`, `/ownmem:init`, and
`/ownmem:dashboard`. Repository initialization still installs and pins the npm
engine in the project.

## Codex

Install the repository plugin from the OwnMem source tree, or initialize a
repository with `--hosts codex` so the project-local skill and `AGENTS.md`
adapter are generated together. The project adapter remains the portable
contract; a machine-level plugin is only a shortcut.

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
