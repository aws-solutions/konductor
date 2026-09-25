<!-- SPDX-License-Identifier: Apache-2.0 -->

# Update an installation

[← Task guides](README.md) · [Guide index](../README.md)

Brings a tracked install up to date. **Any local edit under the managed destinations is
destroyed** when the source is a local checkout (`--from`) — see the warning below before
running that path.

---

## Checking whether an update is available

```bash
konductor update --dry-run
```

`konductor doctor` also has two checks for this: `cli_version` compares the running binary's own
version against the latest published GitHub release, and `content_version` compares a tracked
target's installed content version against the same. Both are `warn`-severity only when stale —
never `failed`, and never affect `doctor`'s own exit code. Pass `--no-version-check` to skip the
network calls both checks make; this is independent of telemetry opt-out.

This version-comparison behaviour is new, and it applies only to a no-`--from` install/update. **A
`--from <repo-root>` update still has no version concept to compare against** — a local checkout
carries no release-version signal, so `--from` always overwrites unconditionally regardless of
what `doctor` reports. To know whether anything would change from a local source, compare your
source checkout against the manifest instead:

```bash
konductor update --from <repo-root> --dry-run
```

---

## Update

```bash
konductor update
```

```text
Updating Konductor
  agents          11 updated
  skills          82 updated
  SOPs            19 updated
  context files    1 updated

Updated. Start a new session to pick up the changes.
```

With no `--from`, `update` fetches a fresh synth output tree from the latest published GitHub
release (the same remote fallback chain `install`'s own no-`--from` path uses) and applies it
through the resolved target's already-tracked install strategy — no `--harness` re-prompt.

Before writing anything, this path compares the target's already-installed content version
against the version it would fetch (latest, or whatever `--version <v>` names). A match skips the
write and reports "already at version X, nothing to do" instead of a plain success — so re-running
`update` against an unchanged release is a safe no-op rather than a redundant overwrite. See
[`--version <v>` and `--force`](#--version-v-and---force) below for the full behaviour, including
how to bypass that skip.

### Alternative: updating from a local source checkout (`--from`)

If you're a maintainer or contributor working from a cloned repo rather than a published release,
point `update` at that checkout instead:

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

> **`update --from` is an unconditional overwrite.** There is no reconciliation and no merge: it
> calls the same routine `install` does, so the target ends up byte-identical to a fresh
> `install --target <dir>` from the given source. **Any local edit under the managed
> destinations — `.kiro/agents/`, `.konductor/skills/`, `.konductor/manifest` — is silently
> clobbered.** A real run reports only an aggregate count of how many files were overwritten
> while diverged, *after the fact*; that count never gates or alters the overwrite. `--from`
> always overwrites regardless of `--force` too — see [`--version <v>` and `--force`](#--version-v-and---force)
> below for why. Use `--dry-run` first (below) if local edits might exist.

`--from` has no default of its own. Reusing whatever source a target was last installed from
is not supported — pass `--from <repo-root>` explicitly every time.

`update --from <repo-root>` does not detect "already current" — a local checkout has no version
signal to compare against. Running it against an unchanged source overwrites every tracked file
with byte-identical content and reports the same counts. Exit code `0`. A no-`--from` update
does detect this — see [`--version <v>` and `--force`](#--version-v-and---force) below.

#### Preview it first: `--dry-run`

```bash
konductor update --from <repo-root> --dry-run
```

`--dry-run` reports exactly which files would be overwritten for every selected target, and
**flags each individual path that currently has local edits** — `(local edits would be
destroyed)` in plain text, or a per-path `"diverged"` boolean under `--json`. Unlike a real
run's aggregate count, this is per path, and it touches the filesystem in no way at all: no
file write, no manifest write, no index write. This same preview machinery works for a
no-`--from` target too — see [Checking whether an update is available](#checking-whether-an-update-is-available)
above.

#### Choosing which install to update

`update` resolves its target from `~/.konductor/installs`:

| Tracked installs | Flags | Behaviour |
| --- | --- | --- |
| 0 | neither | No-op, exit `0` |
| 0 | `--target <dir>` | Usage error, exit `64` |
| 1 | neither | Acts on that one target |
| 2+ | neither | Usage error, exit `64` — ambiguous; pass `--target` or `--all` |
| any | `--target <dir>` | Acts on the matching entry, or exit `64` if none matches |
| any | `--all` | Acts on every tracked entry |

This selection logic is the same regardless of whether the run is `--from <repo-root>` or a
no-`--from` release fetch. A target directory deleted since it was installed is reported as
**stale**, and `update --target <dir>` on it fails rather than recreating anything.

Two things to note about a `--from` run's output:

- **Local modifications are overwritten, not preserved.** The count above is reported *after* the
  fact and names nothing. To see **which** files carry edits, run `--dry-run` first — that is the
  only view that lists them per path.
- **A running session keeps the old content.** Agents, skills, and context files are read at session
  start, so you need a new session.

### `--version <v>` and `--force`

`--version <v>` and `--force` apply on **both** axes `update` can act on: the content axis (the
default, whether `--from` or a release fetch) and the `--cli` axis (see
[Update the CLI itself](#update-the-cli-itself) below). Each axis's behaviour is described once
here; the `--cli` section only covers what's specific to that axis.

`--version <v>` fetches a specific release tag instead of latest. It applies on either axis:
`konductor update --cli --version <v>` self-replaces with that tagged release's CLI binary, and
`konductor update --version <v>` (no `--cli`, no `--from`) fetches that tagged release's content
instead. Both are real by-tag fetches, and both are mutually exclusive with `--from` — a local
checkout has no release-tag concept, so combining them is a usage error, exit `64`. A tag that
does not name a real release on the repository fails with a distinct "release not found" error
rather than silently falling back to latest.

On the content axis, before a no-`--from` update writes anything, it compares the target's
already-installed content version against the version it would fetch (the tag named by
`--version`, or latest). A match skips the write and reports "already at version X, nothing to
do" instead of a plain success. `--force` bypasses that skip and overwrites even when the version
already matches.

**`--force` has no effect on `--from`, and no effect on `--cli`.** `--from` always overwrites
unconditionally regardless of `--force` — a local checkout has no version signal to skip against
in the first place, so there is nothing for `--force` to bypass; this is permanent by design, not
a gap to be closed later. On the `--cli` axis, `--force` is accepted at the parser level but does
nothing, since a binary self-replace has no version-tracking concept to force past either.

---

## Update the CLI itself

`konductor update --cli` self-replaces the running `konductor` binary from a published GitHub
release. This is a different operation from every other `update` invocation, which overwrites
installed *content* at a *target*: `--cli` has no per-target dimension at all, and is mutually
exclusive with `--from`, `--target`, `--all`, `--harness`, and `--dry-run`.

```bash
konductor update --cli
```

It fetches the platform-matching release asset plus its `.sha256` sidecar, verifies the checksum
(a mismatch is a hard failure, exit `65`), smoke-tests the downloaded binary by running it with
`--version` and confirming the expected version string, then atomically replaces the live binary
with the verified one.

```bash
konductor --version
```

```text
konductor 1.0.0
```

> **`update --cli`'s symlink handling on macOS is an open concern.** If you originally put
> `konductor` on your `PATH` via `--link-bin` (or `make link`), that path is a symlink pointing
> at the real binary elsewhere. Whether the atomic replace preserves that symlink or ends up
> targeting the symlink path itself — potentially breaking it — has been flagged as an open
> concern on macOS specifically and was not resolved as of the last reviewed change. Do not
> assume `update --cli` is unconditionally reliable there; if `konductor --version` stops
> resolving after running it, re-run `make link` (or `install --link-bin`) to repoint the
> symlink.

`--version <v>` and `--force` apply to this axis too — see [`--version <v>` and `--force`](#--version-v-and---force)
above for the full behaviour shared with the content axis.

If you prefer to build from source instead of using `update --cli`, the git-pull/build/link
sequence below still works as a source-based alternative:

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

See [Contributing and customizing](../appendix/contributing.md#building-the-cli-from-source) for
more on building from a checkout.

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
| **One tracked install** | Overwrites it — from a release fetch by default, or from `--from` if given. |
| **Two or more, no flag** | Usage error, exit `64`. Pass `--target <dir>` or `--all`. |
| **Target deleted since install** | Reported as **stale**; the update fails rather than recreating it. |
| **Content locally modified** | **Overwritten (`--from` only).** The count of clobbered files is reported afterwards. Run `--dry-run` first to see which. A no-`--from` update instead skips the write entirely when the content version already matches, unless `--force` is passed. |

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
