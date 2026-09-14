<!-- SPDX-License-Identifier: Apache-2.0 -->

# Konductor CLI

The Konductor CLI is the command-line utility for setting up, building, and maintaining
a Konductor-managed repository. It handles installation, configuration, and diagnostics
for the ASDLC agent/skill/SOP content that Konductor manages — it does not itself run
SDLC workflows (that's the Konductor Kiro agent's job).

> **Status:** `init`, `config get`/`config list`/`config set`, `install`, `update`,
> `uninstall`, `synth`, and `doctor` now perform real work (see
> [Current state](#current-state)). The remaining command (`metrics`) is still a
> **stub** — it parses arguments and validates input correctly, but does not yet
> perform real work.

---

## The 8 commands

`install`, `update`, `uninstall`, `synth`, `init`, `doctor`, `config` (with
`get`/`set`/`list` subcommands), `metrics`.

Global options: `--config <path>` (default `.konductor/config.yml`), `--verbose`/`-v`,
`--json`, `--version`, `--no-color`.

Set `KONDUCTOR_LOG=debug` to turn on a stream of diagnostic trace lines to stderr for
the current invocation only — which config layer supplied a value, which install
strategy matched, what path was resolved. It never prints the resolved value of a
config field flagged sensitive. Unset, or set to anything other than `debug`, produces
no additional output. Independent of `--json` (trace lines never mix into the stdout
JSON document) and of the exit code (it fires on both success and failure).

`init` also accepts `--force`, to overwrite an existing `.konductor/` directory instead
of failing.

`install` accepts:
- `--from <repo-root>` — SOURCE: a local repo root to install previously-built (synthed)
  content from. Optional: omitting it tries a real GitHub Release fetch→verify→install
  first (against `aws-solutions/konductor`'s latest release), falling back to fetching
  `dist/`'s tarball straight from the `main` branch when the release path fails with a
  missing-asset error — see
  [Installing without `--from`: the GitHub-release / main-branch-`dist/` fallback chain](#installing-without---from-the-github-release--main-branch-dist-fallback-chain)
  below for why the release path does not yet succeed against a real release.
- `--target <dir>` — DESTINATION: directory to install into. Defaults to `$HOME` when
  omitted.
- `--harness <kiro-cli-v2|kiro-v3|claude>` — REQUIRED: which synthed harness output to
  install. There is no default and no destination-marker auto-detection — every `install`
  invocation must say explicitly which harness it means. `kiro-v3` is a real, synthed
  harness (see [`synth`](#synth) below) but has no install strategy implemented yet; passing
  it exits with a clear message rather than installing anything. See
  [`install`](#install) below for the full explanation.

`doctor` accepts:
- `--from <repo-root>` — SOURCE: an explicit override. When given, `source`/`config`
  always check this tree, regardless of any manifest. When omitted (the default), those
  two checks instead resolve against the manifest's recorded install-time source (see
  the [`doctor`](#doctor) section below for the full precedence).
- `--target <dir>` — DESTINATION: install directory to check for a runtime/manifest.
  Defaults to `$HOME` when omitted, same as `install --target`.

Running an SDLC *workflow* is **not** a CLI subcommand — that is driven by the Konductor
Kiro agent. The CLI utility handles setup, content build, lifecycle, and diagnostics only.

---

## Getting started

Prerequisites: a Rust toolchain (`cargo`/`rustc`). No minimum version is pinned by this
project — any recent stable toolchain works. If you don't have one, install via
[rustup](https://rustup.rs): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`.

Starting from a fresh clone of this repository (run from the repo root — the
root `Makefile` wraps `cli/`'s build and link targets, so no `cd` into `cli/`
is needed):

```bash
make build                                                    # 1. build
make link                                                     # 2. link
command -v konductor && konductor --version                  # 3. verify
konductor synth --from .                                      # 4. synth
konductor install --from . --harness kiro-cli-v2              # 5. install (to $HOME)
kiro-cli chat --agent konductor                               # 6. chat
```

The rest of this doc is the reference for each step — flags, destinations, and
troubleshooting.

> `make build` at the repo root also compiles `mcp/` (the root `Makefile` aggregates
> `cli/` and `mcp/`). If you only want the CLI, run `make -C cli build` and
> `make -C cli link` instead — see `make help` at the repo root for the full target list.
> Only do this if you will **not** run `konductor install` afterward: `install`
> auto-discovers a pre-built `mcp/` binary and silently skips it if missing (no error),
> so skipping the `mcp/` build here and then installing produces agents that can't load
> skills at runtime.

> **Working inside a Brazil workspace?** `cargo: command not found` means `~/.cargo/bin`
> isn't on `PATH` yet: `export PATH="$HOME/.cargo/bin:$PATH"`. If your shell also has a
> personal `RUSTUP_HOME` (pointing at `~/.rustup`), CargoBrazil will refuse to build —
> run `unset RUSTUP_HOME` first. Neither applies outside Brazil.

## Building

```bash
make build          # from the repo root; or `make -C cli build` for the CLI only
```

Or directly with cargo:

```bash
cd cli/konductor-rs
cargo build --release          # binary → target/release/konductor
```

See [Getting started](#getting-started) above for the full build → link → verify
sequence and the Brazil-only gotchas.

## Putting it on your PATH

```bash
mkdir -p ~/.local/bin
ln -sf "$(pwd)/target/release/konductor" ~/.local/bin/konductor
```

(`make link` does the same thing — run it from the repo root, or as `make -C cli link`
(also from the repo root, or with `-C` pointed at wherever `cli/` lives — `-C cli` on
its own only resolves when the shell's current directory already is the repo root);
see `make help` at either location for the full target list.
`konductor install --from <repo-root> --harness kiro-cli-v2 --link-bin` does this too,
as part of installing — see
[`install`'s `--link-bin`](#--link-bin-put-konductor-itself-on-your-path) below.)

`~/.local/bin` isn't on `PATH` by default on every distro. Check first:

```bash
echo "$PATH" | tr ':' '\n' | grep -qx "$HOME/.local/bin" && echo "on PATH" || echo "NOT on PATH"
```

If it's not, add it in your shell rc and reload:

```bash
# bash (~/.bashrc)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc

# zsh (~/.zshrc)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

Verify:

```bash
command -v konductor   # should print ~/.local/bin/konductor
konductor --version    # expected: konductor 0.1.0
```

> Note: `make install` (also in `cli/`) is a different target — it runs
> `cargo install --path .`, which installs into `~/.cargo/bin` and does not work inside
> a Brazil workspace (Brazil blocks `cargo install`). Use the symlink/`make link` path
> above instead.

---

## `synth`

```bash
konductor synth --from <repo-root>
```

Reads the repo's source content (`agents/`, `skills/`, `agent-sops/`) and
writes runtime-native output to `<repo-root>/dist/kiro-cli-v2/`, plus a
packaged `.tar.gz` archive of the whole `dist/` tree and its `.sha256`
checksum sidecar at `dist/`'s own top level:

```
dist/
├── konductor-v<version>.tar.gz         # packaged dist/ contents
├── konductor-v<version>.tar.gz.sha256   # its checksum sidecar
└── kiro-cli-v2/
    ├── agents/    # one JSON file per agent
    ├── skills/    # one directory per skill (SKILL.md + any scripts)
    └── sops/      # one file per SOP
```

The filename carries no architecture or OS: the packaged content (agent/skill/SOP
markdown and JSON config, no compiled code) is architecture- and OS-independent within
the Unix family, so there's nothing to disambiguate by encoding a target triple in the
name.

The archive and sidecar are what the main-branch-`dist/`-fallback install
source (see
[Installing without `--from`](#installing-without---from-the-github-release--main-branch-dist-fallback-chain)
below) expects to fetch from a published `main` branch's `dist/` directory.

On success, `synth` prints two summary lines to stdout: what was written
(agent/skill/SOP/context counts and the output root) and the packaged
artifact's filename. `dist/` is gitignored — inspect the output with a
plain directory listing, e.g. `find dist -maxdepth 3`.

---

## `install`

```bash
konductor install --from <repo-root> --harness kiro-cli-v2              # installs to $HOME
konductor install --from <repo-root> --harness kiro-cli-v2 --target dir  # installs to dir instead
konductor install --from <repo-root> --harness claude                   # installs Claude Code content instead
```

`--from` is the **source** — a repo root with content already synthed (or synthed by
`install` on the fly). `--target` is the **destination** — where the installed content
lands. They are never the same path in normal use: `--from` points at your Konductor
checkout, `--target` (or the `$HOME` default) points at wherever you want the agents to
run from.

`--harness <kiro-cli-v2|kiro-v3|claude>` is **required** — which of `synth`'s harness
outputs to install (see [`synth`](#synth) above; the three values are the same
`synth::registry::TRANSFORMERS` names that `dist/<name>/` is staged under). There is no
default, and no auto-detection from an existing `.kiro`/`.claude` marker at the
destination — every invocation must say explicitly which harness it means. This is
deliberate: a destination carrying both markers at once used to be resolved silently by
registration order; requiring `--harness` removes that ambiguity. It's a real behavior
change too — even a lone foreign marker (e.g. a `.kiro/` directory left over from
unrelated Kiro CLI use) no longer steers selection, so `--harness claude` installs
Claude Code content there regardless. `kiro-v3` is a real, registered `synth` harness,
but `install` has no strategy that reads `dist/kiro-v3/` yet — passing it exits `64`
with a message explaining the gap, rather than installing anything or crashing.

**`kiro-cli-v2` vs `kiro-v3` is not an IDE-vs-CLI split.** In Kiro v2, the CLI and IDE
are separate products: `kiro-cli-v2` installs CLI-only content and will not work in the
Kiro IDE at all. In Kiro v3, the CLI and IDE are unified into one product, so a single
`kiro-v3` harness (once implemented) covers both — there is no separate
`kiro-v3-ide`/`kiro-v3-cli` split to choose between.

| Content  | Destination                          |
| -------- | ------------------------------------ |
| Agents   | `<target>/.kiro/agents/`             |
| Skills   | `<target>/.konductor/skills/<name>/` |
| Manifest | `<target>/.konductor/manifest`       |

Skills land under `.konductor/skills/`, deliberately outside `.kiro/skills/`: Kiro CLI's
own skill discovery scans `.kiro/skills/` unconditionally and makes every skill visible
to every agent regardless of what it declares, which defeats per-agent scoping. Skill
install merges into `<target>/.konductor/skills/`: a skill directory this install did
not emit (e.g. hand-authored) is left untouched, but a skill directory it does own is
fully replaced so a file removed from the source doesn't linger in the destination.

### Installing without `--from`: the GitHub-release / main-branch-`dist/` fallback chain

```bash
konductor install --harness kiro-cli-v2   # tries GitHub Release, falls back to main's
                                            # dist/ tarball automatically if needed
```

Omitting `--from` tries the GitHub Release source first. If that fails with nothing
usable — a missing per-platform asset on an existing release, or a 404 meaning no
release has ever been published — it automatically falls back to fetching the same
tarball straight from `main`'s `dist/` directory. Both sources read the same repository
(`aws-solutions/konductor`), just a different ref: a tagged release's assets, or the
`main` branch's `dist/` directory. There's no separate opt-in for the fallback — it
crosses the same trust boundary the release path already does. Any other release
failure (network error, non-404 status, invalid response, or a verify/unpack/install
failure once bytes were in hand) is never fallback-eligible: trying a second source on
top of a real failure risks hiding it. On success, the report names which source
produced the install (a `source` field in `--json` mode, an inline clause in the
plain-text summary), so the two are never blended together.

1. **GitHub Release (primary).** Hits GitHub's `GET
   /repos/aws-solutions/konductor/releases/latest` API, looks for a release asset
   matching this host's exact expected filename (`synth::artifact_filename()`'s
   convention — a versioned, per-platform tarball) plus that filename's `.sha256`
   sidecar, downloads both, verifies the checksum against that maintainer-published
   sidecar, and installs through the same unpack/copy pipeline `--from` uses.

   **This does not yet succeed against a real release.** The live
   `.github/workflows/release.yml` doesn't publish assets in that shape yet — today it
   zips all of `dist/` into one fixed-name `konductor-release.zip`, with no per-platform
   tarball and no `.sha256` sidecar. Until that pipeline is fixed separately, this
   source fails with an `install.remote_asset_missing`-class error.

2. **`main` branch's `dist/` directory (automatic fallback).** `main`'s `dist/`
   directory carries the same pre-built tarball `synth` produces — at the same
   `<artifact_filename>` the release path expects — plus its `.sha256` sidecar, as two
   named files sitting directly under `dist/`. This source fetches each one, by exact
   filename, via one GitHub Contents API request apiece (`GET
   /repos/aws-solutions/konductor/contents/dist/{filename}?ref=main`) — two requests
   total, well under GitHub's unauthenticated rate limit — then verifies the fetched
   tarball against the fetched sidecar and installs through the same pipeline. No file
   listing, no per-file download loop, and no repackaging: the tarball is already
   packaged exactly as `synth` would produce it, so this source returns it unchanged.

   **This source has the same verification strength as the release path.** The only
   difference is WHERE the tarball+sidecar pair comes from — a release asset vs.
   `main`'s `dist/` directory — not how strongly the result is checked: both verify
   downloaded bytes against a real, independently-published sidecar. `dist/` is
   `.gitignore`d in this repo's own working tree, so this path needs a publishing step
   to place both files under `dist/` on `main`; until then, a missing tarball or
   sidecar cleanly fails with an
   `install.main_branch_dist_artifact_missing`/`install.main_branch_dist_sidecar_missing`-class
   error rather than installing something unverified — the same kind of gap the release
   path's own asset-shape gap already documents above. Once the `release.yml` fix
   lands, both sources will name the identical pair of published files — the same
   tarball and sidecar, just reachable from two different paths (a repo path vs. a
   release asset URL).

Omitting `--harness` entirely is a usage error too (clap's own missing-required-argument
message, remapped to exit `64`), independent of either source above.

**No provenance/signing check on either source.** Verification everywhere here is
SHA-256 transport-integrity only — proving the downloaded bytes match a digest published
alongside them. It does not prove the content itself is authentic (no GPG signature, no
sigstore attestation); an attacker able to replace both an artifact and its sidecar on
GitHub's side is not caught by this check.

A checksum-verification failure on either source maps to exit `65` (`EXIT_VERIFY_FAILED`);
every other failure (network error, missing asset/sidecar, unpack/install failure) maps
to exit `64` (`EXIT_USAGE_ERROR`), consistent with every other install failure in this
doc. If BOTH sources fail, the reported error names both underlying failures distinctly
— never collapsed into one message that can't be attributed to a specific source.

### `GITHUB_TOKEN`: optional authenticated access to the GitHub API

Pass `--use-github-token` to have `konductor install` (no `--from`) read `GITHUB_TOKEN`
from the environment and send `Authorization: Bearer $GITHUB_TOKEN` on its
`api.github.com` requests — the release path's metadata lookup and the
main-branch-`dist/` fallback's two Contents API requests. Without this flag,
`GITHUB_TOKEN` is never read, even if it's set in your shell: the environment variable
is opt-in, not ambient. It is never sent on the release path's asset-download requests
regardless of the flag: those follow a redirect off `api.github.com` to a short-lived,
pre-signed storage host that already carries its own auth and must never receive the
GitHub token. This is an access option, not a rate-limit workaround: unauthenticated
requests already comfortably fit under GitHub's rate limits at this codebase's request
volume (2-3 requests per install), and that stays true once the target repository is
public. Its actual use case is testing `install` against a currently-private
repository before it's published; omitting `--use-github-token` produces byte-for-byte
identical requests to a build with no token support at all, regardless of whether
`GITHUB_TOKEN` happens to be set.

Verify a `--target <dir>` install:

```bash
ls dir/.kiro/agents/*.json | wc -l          # agent count
ls -d dir/.konductor/skills/*/ | wc -l      # skill count
wc -l dir/.konductor/manifest                # manifest entries
```

Every successful `install` records (or refreshes) an entry for that target directory in
`~/.konductor/installs` — a home-level index, independent of any single target, that
`update` and `uninstall` read to discover which directories this machine has installed
Konductor into, without the caller having to already know or re-pass `--target`.

### `--link-bin`: put `konductor` itself on your `PATH`

```bash
konductor install --from <repo-root> --harness kiro-cli-v2 --link-bin
```

Symlinks the currently-running `konductor` binary to `$HOME/.local/bin/konductor` — the
same manual step described in [Putting it on your PATH](#putting-it-on-your-path) and
`make link`, now available at install time. Opt-in, not the default: unlike every other
piece of `install`'s work, the symlink lands outside `--target <dir>` at a fixed `PATH`
location, regardless of what `--target` names.

Idempotent: re-running `--link-bin` after rebuilding or relocating the binary repoints
the symlink at the current one; running it again with nothing changed is a no-op. A
pre-existing file at `$HOME/.local/bin/konductor` that is not a symlink `install` created
is never overwritten — `install` reports the conflict and leaves it alone.

`konductor uninstall` removes a symlink `--link-bin` created when the target it belongs
to is uninstalled (tracked separately, in `~/.konductor/bin-links`, since the symlink
itself lives outside any one `--target`).

---

## `update`

```bash
konductor update [--from <repo-root>] [--target <dir>] [--all]
```

Overwrites a tracked install in place: for each selected target, `update` calls the same
underlying install routine `install` itself uses, so the target's agents, skills, and
manifest end up identical to a fresh `install --target <dir>` from the given `--from`
source. There is no hash comparison, no divergence classification, and no reconciliation
— it is an unconditional overwrite, and it will silently clobber any local edits to files
under the managed destinations (`.kiro/agents/`, `.konductor/skills/`, `.konductor/manifest`).

`update` has no `--from` default of its own — omit it to reuse whatever source each
target was last installed from is **not** supported; pass `--from <repo-root>` explicitly.

### Selecting which target(s) to update

`update` resolves which tracked install(s) to act on based on how many entries
`~/.konductor/installs` has and whether `--target`/`--all` was passed:

| Tracked installs | `--target`/`--all` passed | Behavior |
| ----------------- | -------------------------- | -------- |
| 0 | neither | No-op, exit `0` |
| 0 | `--target <dir>` | Usage error, exit `64` (an explicit target must exist in the index) |
| 1 | neither | Acts on that one target directly |
| 2+ | neither | Usage error, exit `64` — ambiguous, requires `--target <dir>` or `--all` |
| any | `--target <dir>` | Acts on the matching entry, or usage error (`64`) if no entry matches |
| any | `--all` | Acts on every tracked entry |

`uninstall` (below) uses this same table for every row except "2+ tracked installs,
neither flag passed" — see its own section for that one divergence.

A target directory that no longer exists on disk (deleted since it was installed) is
reported as **stale**: `update --target <dir>` on a stale entry fails with a "stale (no
manifest found)" message rather than the target's manifest fields, since there is
nothing left to update.

---

## `uninstall`

```bash
konductor uninstall [--target <dir>] [--all] [--yes|-y]
```

Removes a tracked install's files: every path listed in that target's
`.konductor/manifest`, the manifest file itself, and any now-empty directories left
behind under the managed destinations — then removes that target's entry from
`~/.konductor/installs`. `~/.konductor/installs` itself is never deleted by `uninstall`,
even when the last tracked entry is removed from it. If that target ran
`install --link-bin` (see [above](#--link-bin-put-konductor-itself-on-your-path)), the
symlink it created at `$HOME/.local/bin/konductor` is removed too.

Uses `update`'s `--target`/`--all` selection table above, with one divergence: when
`--target` is omitted, `--all` is not passed, and 2+ installs are tracked, `uninstall`
resolves the destination to `$HOME` — the same default `install --target` and
`doctor --target` already apply when their own `--target` is omitted — instead of
requiring an explicit `--target <dir>` or `--all`.

| Tracked installs | `--target`/`--all` passed | Behavior |
| ----------------- | -------------------------- | -------- |
| 2+ | neither | Resolves the destination to `$HOME`, confirms interactively (see below), then acts on it exactly as an explicit `--target $HOME` would: uninstalls it if `$HOME` is tracked (printing a note naming every other tracked install left untouched), or fails with the same "does not match any tracked install" usage error (`64`) `--target <dir>` gives for an untracked path — now also listing every tracked install in that error |

**Confirmation prompt for the bare, $HOME-resolved, 2+-tracked-installs case only.**
Because that case picks a target implicitly rather than by an explicit `--target`/`--all`,
it asks first: `Are you sure you want to uninstall from <dir>?`, requiring an explicit
`y`/`yes` (case-insensitive) to proceed. An explicit `--target <dir>` or `--all` never
prompts — both already name their own scope.

- `--yes`/`-y` bypasses the prompt and proceeds immediately.
- Without `--yes`, `--json` mode or a non-interactive stdin (no TTY attached, e.g.
  piped input, CI, a script) aborts rather than blocking on input that can never
  arrive — exit code `4` (`EXIT_USER_ABORTED`), distinct from a plain usage error.

One further safety difference from `update`: for a **stale** target (tracked in the
index but its manifest is gone, e.g. the directory was deleted out-of-band), `uninstall`
treats this as a non-fatal prune — it removes the stale index entry and reports
`stale: true` rather than failing, since there is nothing left on disk to protect.

`uninstall` also reports how many deleted files had a hash that diverged from the
manifest's recorded hash (i.e. a file that was hand-edited after install and is about to
be deleted anyway) — a disclosure, not a safeguard that blocks deletion.

---

## `doctor`

```bash
konductor doctor                                    # checks the manifest's recorded
                                                      # source + $HOME
konductor doctor --target dir                        # ...+ dir instead
konductor doctor --from <repo-root>                  # OVERRIDE: checks <repo-root>
                                                      # + $HOME, ignoring any manifest
konductor doctor --from <repo-root> --target dir     # OVERRIDE: + dir instead
konductor doctor --all                               # runs every check against every
                                                      # tracked install in
                                                      # ~/.konductor/installs
```

Inspects a Konductor installation/checkout for problems and prints actionable
remediation guidance, reusing the exact logic `install`/`synth`/`config` already use
rather than re-implementing any validation.

| Check                   | What it checks                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `source`                | Parses the source tree with `synth`'s own parser, including cross-reference validation (agent → context/skill/SOP references must resolve). |
| `runtime`               | Which runtime(s) (Kiro CLI / Claude Code) `install` auto-detects at the target.      |
| `manifest`              | Manifest presence, completion status, and per-file hash drift against what's on disk. |
| `config`                | `.konductor/config.yml` loads and validates, via `config`'s own loader.             |
| `container_runtime`     | Probes `docker`/`podman`/`nerdctl`/`finch` on PATH, in that order — informational only. |
| `index_status`          | Compares `~/.konductor/installs`'s cached status for the target against that target's real manifest status — catches an install/update interrupted between the two writes. |

A few forward-looking checks (`gitignore`, `provider_model_access`, `role_allowlists`)
exist in the code and are unit-tested, but are not yet wired into live `doctor` output
— they're dormant until the features they'd validate (run-state persistence, the
override mechanism, provider/model-access, role-scoped allowlists) actually exist.

`source`/`config` validate the **repo checkout/project config**, which only has a real
answer when a local `--from` checkout exists — useful for catching an authoring
mistake before/after an install. `manifest`/`runtime`/`index_status` answer "is my
installation healthy" regardless of install method, since they only inspect the
installed destination (and, for `index_status`, its index entry). Anyone installing
from a published release artifact (no local checkout) should expect a benign `info`
fallback from `source`/`config`, not a sign of a broken install. `container_runtime` is
always `info`/informational; `index_status` is `info` for a target that isn't tracked
in the index at all (not every install needs to be tracked — e.g. one predating the
index).

Each check reports one of five statuses, each non-`ok` line followed by an indented
`fix:` hint:

- `ok` — no problem found.
- `info` — nothing installed/configured yet, or a benign fallback occurred and still
  checked out clean.
- `warn` — a hygiene issue that isn't a broken install: an unreadable manifest falling
  back to an **unvalidated cwd** with no known relationship to the install (flagged
  with a `WARNING: ... UNVALIDATED cwd ...` marker), or `index_status` finding the
  install index and manifest disagree on completion status.
- `failed` — something is broken: a source parse error, invalid config, a manifest
  stuck `InProgress`, a corrupt manifest, or a manifest from an incompatible
  `konductor` version (remediation there points at upgrading `konductor`, never at
  re-running `install`).
- `stale` — installed content has drifted from the manifest (hash mismatch or missing
  file) — needs a re-install, not necessarily a bug.

`-v`/`--verbose` prints full detail per check; `--json` emits a compact object instead
(see [`--json` output](#--json-output) below).

### Checking every tracked install with `--all`

`--all` runs the full check suite (all six checks above) against **every** target in
`~/.konductor/installs`, one at a time — the same "act on every tracked entry"
semantics `update --all`/`uninstall --all` use, applied to diagnostics instead of a
write operation. Plain-text output is grouped per target under a `== <target_dir> ==`
header; `--json` collects every target into one batched document (`{"command":
"doctor", "ok": ..., "targets": [...]}`, each entry carrying that target's own
`ok`/`warnings`/`checks` fields plus its `target_dir`) rather than emitting one JSON
document per target. Zero tracked installs is a no-op, exit `0`. The overall exit code
is `1` (`EXIT_HALTED`) if **any** target has a `failed`/`stale` check, `0` otherwise.

`--all` is mutually exclusive with `--from` and `--target`: a single source/destination
override doesn't make sense across multiple targets that may have recorded different
sources, so passing either alongside `--all` is a usage error (exit `64`) at parse
time, mirroring `update`/`uninstall`'s own `--target`/`--all` conflict.

### Source resolution (`source`/`config` checks)

Like `runtime`/`manifest`, these two default to validating what was actually
**installed**, not whatever `--from`/cwd happens to be when `doctor` runs:

1. **Explicit `--from <repo-root>`** — always wins outright, independent of any
   manifest.
2. **No `--from`: the manifest's recorded `source`**, read from the install
   destination (`--target`/`$HOME`), if present.
3. **No `--from`, no usable recorded source: falls back to the cwd**, with an explicit
   note — never silent. Three sub-cases, in increasing risk:
   - No manifest exists at all → `info`.
   - Manifest is readable but has no recorded source (predates the field, or an
     unsupported `schema_version` from a newer binary — the `manifest` check reports
     that separately) → `info`.
   - Manifest exists but couldn't be read at all (corrupt JSON / I/O error) → `warn`,
     with the `UNVALIDATED cwd` marker.

Example (default, all healthy):

```
$ konductor doctor
ok: source — source tree at /home/user/konductor-checkout parses cleanly (11 agent(s), 75 skill(s), 17 SOP(s), 1 context file(s))
ok: runtime — detected runtime(s) under /home/user: kiro-cli
ok: manifest — manifest at /home/user/.konductor/manifest is Complete and every recorded file matches (93 file(s))
ok: config — config loads cleanly (tier 'minor', default_severity 'MEDIUM')
info: container_runtime — detected container runtime on PATH: docker
    fix: no action needed -- only relevant if you plan to use a container-based sandbox mode
```

Example (problem found — manifest hash drift):

```
$ konductor doctor
stale: manifest — 2 file(s) under /home/user no longer match the manifest recorded at install time
    fix: re-run `konductor install` to refresh the installed content
```

The overall run exits `1` whenever any check is `failed`/`stale`, even if other checks
are `warn`/`info`/`ok`.

### `--json` output

`--json` emits one compact object instead of the human-readable report:

```json
{
  "command": "doctor",
  "ok": true,
  "warnings": false,
  "checks": [
    { "name": "source", "status": "ok", "summary": "..." },
    { "name": "runtime", "status": "ok", "summary": "..." },
    { "name": "manifest", "status": "ok", "summary": "..." },
    { "name": "config", "status": "ok", "summary": "..." },
    { "name": "container_runtime", "status": "info", "summary": "..." },
    { "name": "index_status", "status": "ok", "summary": "..." }
  ]
}
```

- `ok` — `true` unless at least one check is `failed`/`stale` (mirrors the exit code).
- `warnings` — `true` if at least one check is `warn`. **Distinct from `ok`**: a `warn`
  never fails the run on its own, so a report can have `ok: true` and `warnings: true`
  at the same time.
- `checks[].detail` — present only on a non-`ok` check; every individual problem found,
  plus the fallback note (if any) as its first entry.
- `checks[].remediation` — present only when the check has one (never on `ok`).

With `--all`, this same object shape is nested once per target under a top-level
`targets` array instead — see [Checking every tracked install with `--all`](#checking-every-tracked-install-with---all).

Exit codes: `0` when every check is `ok`/`info`/`warn`; `1` (`EXIT_HALTED`) when at
least one is `failed`/`stale`; `64` on a usage error. Never exit code 2 — see
[Conventions](#conventions).

### `--json` error envelope (`install`/`synth`/`doctor`)

Distinct from the status report above, `--json` also gates a shared *error* envelope
on early usage-error paths in `install`, `synth`, and `doctor` (and, previously,
`uninstall`/`update`). On a non-zero exit, instead of a plain-text
`konductor <command>: <message>` line to stderr, the command prints one JSON object to
stdout instead:

```json
{ "command": "install", "error": "no install strategy matched this target (...)" }
```

- `command`/`error` are guaranteed on every envelope, regardless of which command
  produced it.
- Some call sites attach extra, command-specific fields (e.g. `target_dir` on
  `uninstall`/`update`). These are not part of the stable cross-command contract —
  only rely on an extra field once you already know which command produced it.
- The envelope always prints to stdout, matching every other `--json` document these
  commands emit on success, so a `--json` consumer only has to read one stream to see
  every outcome, success or failure.

---

## Using the orchestrator

Agents installed with `--target <dir>` are discovered by a **cwd-relative scan** — they
only show up in `kiro-cli agent list` when your shell is inside `<dir>` (labeled
`Workspace`). A default install (no `--target`) puts them under `$HOME/.kiro/agents/`
(labeled `Global`), visible from anywhere.

```bash
kiro-cli agent list                                  # confirm discovery
kiro-cli chat --agent konductor                      # start a session
```

Skill bodies load lazily via the `fs_read` tool: an interactive session prompts for
approval the first time an agent reads a skill, and a `--no-interactive` run needs
`--trust-tools=fs_read` (or `--trust-all-tools`) to read skills without prompting.

---

## Conventions

- **Unified error prefix.** Every error line the CLI prints in plain-text mode sits
  under one greppable prefix family: `konductor <command>: <message>` for a
  per-command error (`install`, `uninstall`, `update`, `doctor`, `synth`, `init`,
  `config`), or `konductor: <message>` for the handful of command-agnostic paths (no
  subcommand resolved yet, or the shared working-directory resolution run before
  dispatch). This matters when output from multiple `konductor` invocations is
  interleaved in a CI log or terminal session alongside other tools' output.
- **Exit code 64 for CLI usage errors.** A bad flag, unknown command, or missing required
  argument exits **64** (`EX_USAGE`), not the more common default of 2 — exit code 2 is
  reserved by the exit-code contract for "unresolved CRITICAL gate" (the CI-failing
  signal), so a malformed invocation is never mistaken for a gate failure.
- **Exit-code contract** (the conductor that emits these for its own paused-verdict
  workflow is post-launch — but two codes are already reused, each for its own distinct
  local meaning, by real commands ahead of that conductor existing):
  | Code | Meaning |
  |------|---------|
  | 0 | All passed |
  | 1 | Halted (timeout / runtime error / parse error) — reused by `doctor` for "at least one check failed/stale" |
  | 2 | Unresolved CRITICAL gate — CI-failing signal (**never** used for usage errors) |
  | 3 | Budget / turn limit exceeded |
  | 4 | User aborted a paused verdict — reused by `uninstall` for "the interactive confirmation prompt (bare invocation, 2+ tracked installs, resolved to `$HOME`) was declined" |
  | 65 | Unsupported manifest/index `schema_version` (state/verification failure, distinct from a `64` usage error) |
- **Unknown-command suggestions.** An unknown command suggests a close match from the
  real command set.

---

## Current state

- **Done:** the CLI command surface; the declarative contract (gate/config schemas —
  `severity-schema.yml`, `scope-table.yml`, `config.yml`, `run-state.json` — plus the
  config loader); `init` scaffolding a real `.konductor/` directory with a starter
  `config.yml`; `config get`/`config list`/`config set` reading and writing the
  effective (project-over-preset) configuration; `install` copying synthed agents/skills
  into `$HOME/.kiro/` (or `--target <dir>/.kiro/`) and writing a manifest beside the
  installed tree; `update` overwriting a tracked install in place from a source tree;
  `uninstall` removing a tracked install's files and manifest; `synth` transforming
  source content into runtime-native output; `doctor` inspecting a source tree/install
  destination via `synth`/`install`/`config`'s own logic and reporting per-check
  ok/info/failed/stale status with remediation guidance.
- **Stubs:** `metrics` still prints "not yet implemented."
- **Not yet started:** the run-engine/conductor (which will read/write
  `.konductor/run-state.json`-shaped documents and is responsible for exit code 2's
  "unresolved CRITICAL gate" signal), and `.konductor/runs/` storage.

## Current limitations

- No **working** remote/published-release install yet — the CLI-side fetch→verify→install
  wiring exists (`install::github`, `install::remote_orchestrate`) and is wired into
  `konductor install`'s no-`--from` path, but it won't succeed against a real release
  until a separate, already-in-progress fix to `.github/workflows/release.yml` lands to
  publish assets in the shape this fetcher expects (a per-platform, versioned tarball plus
  a `.sha256` sidecar) instead of today's single fixed-name `konductor-release.zip`. See
  [Installing without `--from`: the GitHub-release / main-branch-`dist/` fallback chain](#installing-without---from-the-github-release--main-branch-dist-fallback-chain)
  for the exact failure mode and two further caveats (GitHub API rate limiting; no
  GPG/sigstore provenance check — SHA-256 transport-integrity only). `--from <repo-root>`
  remains the only way to install today.
- SOPs are synthed into `dist/kiro-cli-v2/sops/` but are not installed anywhere; there is
  no runtime discovery path for them yet.
- `metrics` is a stub (see above).
- `update` and `uninstall` have no same-target concurrency protection: running two
  `konductor` invocations against the same target directory at once is unsupported and
  can corrupt the manifest, index, or on-disk files. Serialize invocations per target.
- `doctor` does not check Claude Code-specific environment state, compare installed
  vs. available versions, or validate metrics/gate-tier data (no supporting mechanism
  exists in-repo yet for the latter two).
