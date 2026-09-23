<!-- SPDX-License-Identifier: Apache-2.0 -->

# Uninstall

[← Task guides](README.md) · [Guide index](../README.md)

Removes Konductor from your runtime. Everything lives in your home directory and your project — there
are no system files, services, or daemons.

---

## Remove the agents from your runtime

> **There is no confirmation prompt.** `uninstall` proceeds directly and deletes immediately.
> Run it with `--dry-run` first if you are not certain what it will remove.

### Preview it first: `--dry-run`

```bash
konductor uninstall --dry-run
```

```text
Would remove Konductor 1.0.0 from Kiro CLI:
  agents          11
  skills          82
  SOPs            19
  context files    1

  skills/backend-review/SKILL.md   (local edits would be destroyed)

Project files under .konductor/ would be left in place.
```

`--dry-run` touches the filesystem in no way at all. It flags each individual path whose
content has diverged from the hash recorded in the manifest — that is, a file you hand-edited
after install — in plain text as above, or as a per-path `"diverged"` boolean under `--json`.

### Then remove it

```bash
konductor uninstall
```

```text
Removed. Project files under .konductor/ were left in place.
```

Exit code `0`. `uninstall` removes every path listed in that target's `.konductor/manifest`,
the manifest itself, any now-empty directories under the managed destinations, and the
target's entry in `~/.konductor/installs`. `~/.konductor/installs` itself is never deleted,
even when its last entry goes. If the install used `--link-bin`, the symlink at
`$HOME/.local/bin/konductor` is removed too.

A real run also names the specific files it deleted whose hash had diverged from the
manifest. That is a disclosure after the fact, not a safeguard — it does not block the
deletion, which is why `--dry-run` exists.

### Choosing which install to remove

`uninstall` uses [`update`'s selection table](update.md#choosing-which-install-to-update)
exactly, including the ambiguity rule: a bare invocation against two or more tracked installs
is a usage error (exit `64`) that names every tracked install. There is no implicit `$HOME`
fallback and no picker.

One difference from `update`: a **stale** target — tracked in the index but with its manifest
gone, because the directory was deleted out-of-band — is a non-fatal prune. `uninstall`
removes the stale entry and reports `stale: true` rather than failing, since there is nothing
left on disk to protect.

Exit codes: `0` on success, `64` on any usage error, `65` on an unsupported index schema
version, and `6` when everything succeeded except removing a tracked `--link-bin` symlink.

`uninstall` deliberately leaves your project configuration alone, so reinstalling later picks up where
you left off. Remove it yourself if you want a clean slate — see below.

---

## Remove everything else

Do only the parts that apply. Read each command before running it; several delete directories.

### Project configuration

From inside a project you initialized:

```bash
rm -rf .konductor
```

Back it up first if you might want it:

```bash
cp .konductor/config.yml ~/konductor-config-backup.yml
```

### Generated runtime files

```bash
rm -rf dist
```

Always safe — `dist/` is regenerable with `konductor synth` and is gitignored.

### User-level configuration and logs

Removes the optional user-level config and the invocation log:

```bash
rm -rf ~/.konductor
```

To keep the config and drop only the log:

```bash
rm -f ~/.konductor/logs/konductor.log
```

### The CLI binary

If you downloaded it:

```bash
rm ~/.local/bin/konductor
```

If you installed it from source with `cargo install`:

```bash
cargo uninstall konductor
```

### Claude Code settings

Only if you set these for Konductor and want them gone. Edit `~/.claude/settings.json` and remove:

- `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`
- the `permissions.allow` entries you added
- `teammateMode`, if you set it

```bash
$EDITOR ~/.claude/settings.json
```

Edit rather than delete the file — it very likely holds settings unrelated to Konductor.

---

## What success looks like

```bash
konductor doctor
```

```text
manifest           no manifest at this target                  info
    fix: nothing is installed here. Run `konductor install --harness kiro-cli-v2`
index_status       no index entry for this target               info
```

And once the binary is gone too:

```bash
which konductor
```

No output means it is off your `PATH`.

- [ ] Starting a runtime session no longer offers the `konductor` and `k-*` agents.
- [ ] `ls ~/.konductor` reports `No such file or directory`, if you removed it.

---

## Everything Konductor creates

For reference, so you can confirm nothing is left behind:

| Location | Created by | Removed by |
| --- | --- | --- |
| Runtime agent directories | `konductor install` | `konductor uninstall` |
| `<project>/.konductor/config.yml` | `konductor init` | you, manually |
| `<project>/dist/` | `konductor synth` | you, manually — gitignored |
| `~/.konductor/logs/konductor.log` | every CLI invocation | you, manually |
| `~/.konductor/config.yml` | you, by hand | you, manually |
| The `konductor` binary | you, downloading or building it | you, manually |

---

## Uninstalling only part of it

| You want to… | Do only this |
| --- | --- |
| Stop using Konductor in one project, keep it elsewhere | `rm -rf .konductor dist` in that project |
| Keep the CLI, drop the agents | `konductor uninstall` |
| Keep the agents, drop the CLI | remove the binary |
| Reclaim disk space | `rm -rf dist` — and `cargo clean`, if you built from source |

---

## Related

- [Install for Kiro CLI](install-kiro-cli.md) · [Install for Claude Code](install-claude-code.md) — if
  you are reinstalling
- [Diagnose problems](diagnose-problems.md)

---

[← Update](update.md) · [Task guides](README.md) · [Next: Use cases →](../use-cases/README.md)
