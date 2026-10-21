<!-- SPDX-License-Identifier: Apache-2.0 -->

# Update an installation

[← Task guides](README.md) · [Guide index](../README.md)

Overwrites a tracked install in place from a source tree. **Any local edit under the managed
destinations is destroyed** — see the warning below before running it.

---

## There is no "is an update available?" check

Nothing in the CLI compares your installed version against a published one. `doctor` has six
checks — `source`, `runtime`, `manifest`, `config`, `container_runtime`, `index_status` — and
`cli/README.md` states plainly that it "does not … compare installed vs. available versions."
`update` has no version awareness either: it overwrites from whatever `--from` you give it,
without asking what version that is.

To know whether anything changed, compare your source checkout against the manifest:

```bash
konductor update --from <repo-root> --dry-run
```

---

## Update

```bash
konductor update --from <repo-root>
```

```text
Updating Konductor
  agents          11 updated
  skills          82 updated
  SOPs            19 updated
  context files    1 updated

2 files were overwritten while diverged from the manifest.

Updated. Start a new session to pick up the changes.
```

> **`update` is an unconditional overwrite.** There is no reconciliation and no merge: it
> calls the same routine `install` does, so the target ends up byte-identical to a fresh
> `install --target <dir>` from the given source. **Any local edit under the managed
> destinations — `.kiro/agents/`, `.konductor/skills/`, `.konductor/manifest` — is silently
> clobbered.** A real run reports only an aggregate count of how many files were overwritten
> while diverged, *after the fact*; that count never gates or alters the overwrite, and there
> is no `--force` flag either way. Use `--dry-run` first (below) if local edits might exist.

`--from` has no default of its own. Reusing whatever source a target was last installed from
is not supported — pass `--from <repo-root>` explicitly every time.

### Preview it first: `--dry-run`

```bash
konductor update --from <repo-root> --dry-run
```

`--dry-run` reports exactly which files would be overwritten for every selected target, and
**flags each individual path that currently has local edits** — `(local edits would be
destroyed)` in plain text, or a per-path `"diverged"` boolean under `--json`. Unlike a real
run's aggregate count, this is per path, and it touches the filesystem in no way at all: no
file write, no manifest write, no index write.

### Choosing which install to update

`update` resolves its target from `~/.konductor/installs`:

| Tracked installs | Flags | Behaviour |
| --- | --- | --- |
| 0 | neither | No-op, exit `0` |
| 0 | `--target <dir>` | Usage error, exit `64` |
| 1 | neither | Acts on that one target |
| 2+ | neither | Usage error, exit `64` — ambiguous; pass `--target` or `--all` |
| any | `--target <dir>` | Acts on the matching entry, or exit `64` if none matches |
| any | `--all` | Acts on every tracked entry |

A target directory deleted since it was installed is reported as **stale**, and
`update --target <dir>` on it fails rather than recreating anything.

Two things to note in that output:

- **Local modifications are overwritten, not preserved.** The count above is reported *after* the
  fact and names nothing. To see **which** files carry edits, run `--dry-run` first — that is the
  only view that lists them per path.
- **A running session keeps the old content.** Agents, skills, and context files are read at session
  start, so you need a new session.

`update` does not detect "already current" — it has no version awareness. Running it against
an unchanged source overwrites every tracked file with byte-identical content and reports the
same counts. Exit code `0`.

---

## Update the CLI itself

`update` refreshes the content it installed. The CLI binary is separate — rebuild it from your
clone the same way you did originally:

```bash
git -C <repo-root> pull
make -C <repo-root> build
make -C <repo-root> link
```

```bash
konductor --version
```

```text
konductor 1.0.0
```

If you built from source instead, see
[Contributing and customizing](../appendix/contributing.md#building-the-cli-from-source).

---

## What success looks like

- [ ] `konductor doctor` reports `manifest` as `ok` with no hash drift.
- [ ] A new runtime session lists the agents you expect.
- [ ] `konductor doctor` reports `config` as `ok`, confirming your config is still valid against
      the new release.

Check that last one, because a config schema change is the most likely thing to bite you:

```bash
konductor doctor
```

If it reports `config version <n> is not supported by this CLI`, the schema version changed. Back up
your config, re-scaffold, and re-apply your settings:

```bash
cp .konductor/config.yml .konductor/config.yml.bak
```

```bash
konductor init --force
```

`--force` overwrites `config.yml` with the release defaults, which is why the backup comes first.

---

## Behaviour differs by state

| State | What happens |
| --- | --- |
| **No tracked installs** | No-op, exit `0`. |
| **One tracked install** | Overwrites it from `--from`. |
| **Two or more, no flag** | Usage error, exit `64`. Pass `--target <dir>` or `--all`. |
| **Target deleted since install** | Reported as **stale**; the update fails rather than recreating it. |
| **Content locally modified** | **Overwritten.** The count of clobbered files is reported afterwards. Run `--dry-run` first to see which. |

---

## Seeing what changed

`CHANGELOG.md` in the repository follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html), with entries consolidated per release.

---

## Related

- [Diagnose problems](diagnose-problems.md) — if `doctor` reports something not ok after updating
- [Uninstall](uninstall.md)
- [Contributing and customizing](../appendix/contributing.md) — if your local modifications are
  something you want to contribute back

---

[← Diagnose problems](diagnose-problems.md) · [Next: Uninstall →](uninstall.md)
