<!-- SPDX-License-Identifier: Apache-2.0 -->

# Konductor CLI

The Konductor CLI is the command-line utility for setting up, building, and maintaining
a Konductor-managed repository. It handles installation, configuration, and diagnostics
for the agent, skill and SOP content that Konductor manages — it does not itself run
SDLC workflows (that's the Konductor Kiro agent's job).

> **Status:** `init`, `install`, `update`, `uninstall`, `synth`, `doctor`, and
> `verify-run` now perform real work (see [Current state](#current-state)). The remaining command
> (`metrics`) is still a **stub** - it parses arguments and validates input correctly,
> but does not yet perform real work.

---

## The 8 commands

`install`, `update`, `uninstall`, `synth`, `init`, `doctor`, `verify-run`, `metrics`.

Global options: `--verbose`/`-v`,
`--json`, `--version`, `--no-color`.

Set `KONDUCTOR_LOG=debug` to turn on a stream of diagnostic trace lines to stderr for
the current invocation only - which config layer supplied a value, which install
strategy matched, what path was resolved. It never prints the resolved value of a
config field flagged sensitive. Unset, or set to anything other than `debug`, produces
no additional output. This tracing is independent of `--json` (trace lines never mix
into the stdout JSON document) and of the exit code (it fires on both success and
failure).

`init` also accepts `--force`, to overwrite an existing `.konductor/` directory instead
of failing.

`install` accepts:

- `--from <repo-root>` - SOURCE: a local repo root to install previously-built (synthed)
  content from. Optional: omitting it tries a real GitHub Release fetch→verify→install
  first (against `aws-solutions/konductor`'s latest release), falling back to fetching
  `dist/`'s tarball straight from the `main` branch when the release path fails with a
  missing-asset error - see
  [Installing without `--from`: the GitHub-release / main-branch-`dist/` fallback chain](#installing-without---from-the-github-release--main-branch-dist-fallback-chain)
  below for the full fallback chain and its one remaining caveat: the `main`-branch
  `dist/` fallback isn't published yet.
- `--target <dir>` - DESTINATION: directory to install into. Defaults to `$HOME` when
  omitted.
- `--harness <kiro-cli-v2|kiro-v3|claude>` - REQUIRED: which synthed harness output to
  install. There is no default and no destination-marker auto-detection - every `install`
  invocation must say explicitly which harness it means. See [`install`](#install) below
  for the full explanation.

`doctor` accepts:

- `--from <repo-root>` - SOURCE: an explicit override. When given, `source`/`config`
  always check this tree, regardless of any manifest. When omitted (the default), those
  two checks instead resolve against the manifest's recorded install-time source (see
  the [`doctor`](#doctor) section below for the full precedence).
- `--target <dir>` - DESTINATION: install directory to check for a runtime/manifest.
  Defaults to `$HOME` when omitted, same as `install --target`.

Running an SDLC _workflow_ is **not** a CLI subcommand - that is driven by the Konductor
Kiro agent. The CLI utility handles setup, content build, lifecycle, and diagnostics only.
`verify-run` does not run a workflow either: it only checks the session file of a
finished or running one.

---

## Getting started

Prerequisites: a Rust toolchain (`cargo`/`rustc`). No minimum version is pinned by this
project - any recent stable toolchain works. If you don't have one, install via
[rustup](https://rustup.rs): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`.

Starting from a fresh clone of this repository (run from the repo root - the
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

The rest of this doc is the reference for each step - flags, destinations, and
troubleshooting.

> `make build` at the repo root also compiles `mcp/` (the root `Makefile` aggregates
> `cli/` and `mcp/`). If you only want the CLI, run `make -C cli build` and
> `make -C cli link` instead - see `make help` at the repo root for the full target list.
> Only do this if you will **not** run `konductor install` afterward: `install`
> auto-discovers a pre-built `mcp/` binary and silently skips it if missing (no error),
> so skipping the `mcp/` build here and then installing produces agents that can't load
> skills at runtime.

> If `cargo build` reports `cargo: command not found`, `~/.cargo/bin` isn't on `PATH`
> yet: `export PATH="$HOME/.cargo/bin:$PATH"`. If you have a custom `RUSTUP_HOME` set
> that doesn't match your actual rustup install, unset it first.

## Building

```bash
make build          # from the repo root; or `make -C cli build` for the CLI only
```

`make build` is the target to use, not `cargo build` directly against `cli/konductor-rs`:
the Makefile recipe runs `cargo build --release`, resolves cargo's real output directory
via `cargo metadata` (a plain `cargo build` and a wrapped build can each place the binary
somewhere different; see the Makefile's own comments), and additionally stages a copy at
`build/cli/konductor` (relative to the repo root) for downstream packaging that a bare
`cargo build` skips.

See [Getting started](#getting-started) above for the full build → link → verify
sequence.

## Putting it on your PATH

```bash
mkdir -p ~/.local/bin
ln -sf "$(pwd)/target/release/konductor" ~/.local/bin/konductor
```

`make link` does the same thing. Run it from the repo root, either as `make link` or as
`make -C cli link` (a bare `-C cli` only resolves when the shell's current directory
already is the repo root - point `-C` at wherever `cli/` actually lives otherwise). See
`make help` at either location for the full target list.

`konductor install --from <repo-root> --harness kiro-cli-v2 --link-bin` does this too,
as part of installing - see
[`install`'s `--link-bin`](#--link-bin-put-konductor-itself-on-your-path) below.

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
konductor --version    # expected: konductor 0.1.1
```

> Note: `make install` (also in `cli/`) is a different target - it runs
> `cargo install --path .`, which installs into `~/.cargo/bin`. Use the symlink/`make link`
> path above instead.

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

Each Kiro CLI v2 and v3 agent's `prompt` ends with a generated `## Your skills`
block listing the agent's declared skills with a rule for when to load one.
Skills whose description starts "MUST USE for every" (today only `constraints`)
are left out, since they claim every task. Claude Code agents get no block.

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
artifact's filename. `dist/` is gitignored - inspect the output with a
plain directory listing, e.g. `find dist -maxdepth 3`.

---

## `install`

```bash
konductor install --from <repo-root> --harness kiro-cli-v2              # installs to $HOME
konductor install --from <repo-root> --harness kiro-cli-v2 --target dir  # installs to dir instead
konductor install --from <repo-root> --harness claude                   # installs Claude Code content instead
```

`--from` is the **source** - a repo root with content already synthed (or synthed by
`install` on the fly). `--target` is the **destination** - where the installed content
lands. They are never the same path in normal use: `--from` points at your Konductor
checkout, `--target` (or the `$HOME` default) points at wherever you want the agents to
run from.

`--harness <kiro-cli-v2|kiro-v3|claude>` is **required** - which of `synth`'s harness
outputs to install (see [`synth`](#synth) above; the three values are the same
`synth::registry::TRANSFORMERS` names that `dist/<name>/` is staged under). There is no
default, and no auto-detection from an existing `.kiro`/`.claude` marker at the
destination - every invocation must say explicitly which harness it means. This is
deliberate: a destination carrying both markers at once used to be resolved silently by
registration order; requiring `--harness` removes that ambiguity. It's a real behavior
change too - even a lone foreign marker (e.g. a `.kiro/` directory left over from
unrelated Kiro CLI use) no longer steers selection, so `--harness claude` installs
Claude Code content there regardless. `kiro-v3` installs for Kiro CLI's V3 (KAS) engine,
via its own `KiroCliV3InstallStrategy`.

### `--version <v>` and `--force`: content-version tracking

Before a no-`--from` `install` writes anything, it compares the incoming release's
content version against the target's currently-recorded `agent_version` (read from that
target's existing `install-info.json`, which an install with `--no-telemetry` does not
have, so it always writes). A matching version skips the write entirely and
reports a distinct "already at version X, nothing to do" result - in both plain-text and
`--json` output - rather than a plain success indistinguishable from a real write. A
mismatched or unrecorded version proceeds with the write normally, with no
special-casing, and records the new version afterward as already happens today.

`--version <v>` selects a specific release instead of latest, applying to the content
axis on `install` (and, on `update`, either axis - see [`update`](#update) below).
Mutually exclusive with `--from`: a local source has no release-version concept, so
combining them is a usage error, exit `64`. This is a real by-tag fetch: `--version <v>`
hits `GET .../releases/tags/{tag}` (`github::fetch_release_artifact_and_mcp_asset_by_tag`)
instead of `releases/latest`, resolving the tarball and MCP-binary assets from that
specific release the same way the latest-release path does. A tag that does not name a
real release on this repository surfaces a distinct `release {tag} not found` error
(`GithubFetchError::TagNotFound`) - not the generic HTTP-status wording a non-404
metadata failure gets, and not a silent fallback to latest - and, like any other
non-checksum-verify install failure, maps to exit `64`.

`--force` bypasses the skip-if-unchanged behavior and overwrites even when the version
already matches. It has no effect when versions already differ, since the write would
have proceeded anyway in that case.

**`--from` always overwrites unconditionally, regardless of `--force`.** This is
deliberate and permanent: a local checkout has no reliable version signal to compare
against. This is not a gap to be closed later - `--from` never participates in
skip-if-unchanged, on `install` or `update`.

**`kiro-cli-v2` vs `kiro-v3` is not an IDE-vs-CLI split.** In Kiro v2, the CLI and IDE
are separate products: `kiro-cli-v2` installs CLI-only content and will not work in the
Kiro IDE at all. In Kiro v3, the CLI and IDE are unified into one product, so a single
`kiro-v3` harness covers both - there is no separate `kiro-v3-ide`/`kiro-v3-cli` split to
choose between.

| Content           | Destination                          |
| ----------------- | ------------------------------------ |
| Agents            | `<target>/.kiro/agents/`             |
| Skills            | `<target>/.konductor/skills/<name>/` |
| MCP server binary | `<target>/.konductor/bin/<name>`     |
| Manifest          | `<target>/.konductor/manifest`       |

The MCP server binary is `skill-lookup-mcp`. On a `--from <repo-root>` install it's
read from `<repo-root>/mcp/target/release/skill-lookup-mcp` (built by `make build`'s
`mcp/` step - see [Getting started](#getting-started)'s note on why skipping that step
produces agents that can't load skills at runtime). On a no-`--from` install, `install`
fetches it directly - see [Installing without `--from`](#installing-without---from-the-github-release--main-branch-dist-fallback-chain)
below.

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
usable - a missing per-platform asset on an existing release, or a 404 meaning no
release has ever been published - it automatically falls back to fetching the same
tarball straight from `main`'s `dist/` directory. Both sources read the same repository
(`aws-solutions/konductor`), just a different ref: a tagged release's assets, or the
`main` branch's `dist/` directory. There's no separate opt-in for the fallback - it
crosses the same trust boundary the release path already does. Any other release
failure (network error, non-404 status, invalid response, or a verify/unpack/install
failure once bytes were in hand) is never fallback-eligible: trying a second source on
top of a real failure risks hiding it. On success, the report names which source
produced the install (a `source` field in `--json` mode, an inline clause in the
plain-text summary), so the two are never blended together.

1. **GitHub Release (primary).** Hits GitHub's `GET
/repos/aws-solutions/konductor/releases/latest` API, looks for a release asset
   matching this host's exact expected filename (`synth::artifact_filename()`'s
   convention - a versioned tarball, no architecture or OS in the name) plus that
   filename's `.sha256` sidecar, downloads both, verifies the checksum against that
   maintainer-published sidecar, and installs through the same unpack/copy pipeline
   `--from` uses.

   **This succeeds against a real release.** `.github/workflows/release.yml` publishes
   the packaged tarball and its `.sha256` sidecar on every release, in the exact shape
   this fetcher expects. A release with no matching asset - for example, one built
   before this naming convention existed - fails cleanly with an
   `install.remote_asset_missing`-class error.

2. **`main` branch's `dist/` directory (automatic fallback).** `main`'s `dist/`
   directory carries the same pre-built tarball `synth` produces - at the same
   `<artifact_filename>` the release path expects - plus its `.sha256` sidecar, as two
   named files sitting directly under `dist/`. This source fetches each one, by exact
   filename, via one GitHub Contents API request apiece (`GET
/repos/aws-solutions/konductor/contents/dist/{filename}?ref=main`) - two requests
   total, well under GitHub's unauthenticated rate limit - then verifies the fetched
   tarball against the fetched sidecar and installs through the same pipeline. Each file
   is fetched by one direct request, with no listing step and no per-file loop, and the
   tarball is already packaged exactly as `synth` would produce it, so this source
   returns it unchanged.

   **This source has the same verification strength as the release path.** The only
   difference is WHERE the tarball+sidecar pair comes from - a release asset vs.
   `main`'s `dist/` directory - not how strongly the result is checked: both verify
   downloaded bytes against a real, independently-published sidecar. `dist/` is
   `.gitignore`d in this repo's own working tree, so this path needs a publishing step
   to place both files under `dist/` on `main` before it can succeed; until that
   publishing step exists, a missing tarball or sidecar cleanly fails with an
   `install.main_branch_dist_artifact_missing`/`install.main_branch_dist_sidecar_missing`-class
   error rather than installing something unverified. Once that publishing step lands,
   both sources will name the identical pair of published files - the same tarball and
   sidecar, just reachable from two different paths (a repo path vs. a release asset
   URL).

### MCP server binary fetch (no-`--from` install)

Alongside the tarball above, a no-`--from` install also fetches the `skill-lookup-mcp`
MCP server binary for the running host's own platform, verifies it against its own
`.sha256` sidecar the same way the tarball is verified, and installs it to
`<target>/.konductor/bin/skill-lookup-mcp` - the same destination a `--from` install's
local `mcp/target/release/skill-lookup-mcp` copy lands at (see the
[Content/Destination table](#install) above). This binary fetch is part of the GitHub
Release source (step 1 above), not a third fallback source of its own.

Only three platforms have a published binary - `x86_64-unknown-linux-musl`,
`aarch64-unknown-linux-musl`, and `aarch64-apple-darwin` - matching
`.github/workflows/release.yml`'s build matrix exactly (see that workflow's own
top-of-file comment: no free-tier Intel macOS GitHub runner, so there is no
`x86_64-apple-darwin` leg, and Windows is out of scope entirely). What happens next
depends on why the fetch didn't succeed:

- **Unsupported platform (e.g. Intel/x86_64 macOS, or Windows).** This degrades
  gracefully: `install` prints a `konductor install: warning: ...` line to stderr and
  proceeds without the MCP server binary. The rest of the install - agents, skills,
  context, manifest - still succeeds; only skill-lookup functionality is unavailable
  for that install, the same non-fatal state a local `--from` install has any time
  `mcp/` was never built (see [Getting started](#getting-started)'s note on that).
- **Supported platform, but the fetch or checksum genuinely fails.** This is a blocking
  error, since that platform is known to have a real published asset that should have
  been fetchable - a transient network failure or a corrupted asset is not something to
  silently paper over the way the "no asset exists at all" case above is.

Omitting `--harness` entirely is a usage error too (clap's own missing-required-argument
message, remapped to exit `64`), independent of either source above.

**No provenance/signing check on either source.** Verification everywhere here is
SHA-256 transport-integrity only - proving the downloaded bytes match a digest published
alongside them. It does not prove the content itself is authentic (no GPG signature, no
sigstore attestation); an attacker able to replace both an artifact and its sidecar on
GitHub's side is not caught by this check.

A checksum-verification failure on either source maps to exit `65` (`EXIT_VERIFY_FAILED`);
every other failure (network error, missing asset/sidecar, unpack/install failure) maps
to exit `64` (`EXIT_USAGE_ERROR`), consistent with every other install failure in this
doc. If BOTH sources fail, the reported error names both underlying failures distinctly - never collapsed into one message that can't be attributed to a specific source.

### `GITHUB_TOKEN`: optional authenticated access to the GitHub API

Pass `--use-github-token` to have `konductor install` (no `--from`) read `GITHUB_TOKEN`
from the environment and send `Authorization: Bearer $GITHUB_TOKEN` on its
`api.github.com` requests - the release path's metadata lookup, the release path's
asset-download requests, and the main-branch-`dist/` fallback's two Contents API
requests. Without this flag, `GITHUB_TOKEN` is never read, even if it's set in your
shell: the environment variable is opt-in, not ambient, and asset downloads instead hit
each asset's plain `browser_download_url` unauthenticated (GitHub's normal redirect to a
short-lived, pre-signed storage host that already carries its own auth). This is an
access option, not a rate-limit workaround: unauthenticated requests already comfortably
fit under GitHub's rate limits at this codebase's request volume (2-3 requests per
install), and that stays true once the target repository is public. Its actual use case
is testing `install` against a currently-private repository before it's published: a
private repo's asset download 404s unauthenticated even with a valid token, since GitHub
returns 404 rather than 401/403 for an unauthorized asset request, to avoid confirming
the asset's existence to an unauthorized caller - `--use-github-token` is what makes
that download succeed, by requesting the asset through its authenticated REST API URL
instead of its public redirect URL. Omitting `--use-github-token` produces byte-for-byte
identical requests to a build with no token support at all, regardless of whether
`GITHUB_TOKEN` happens to be set.

On success, `install`'s summary (plain-text and `--json`) reports the installed
content's own version alongside its usual counts - read back from
`.konductor/install-info.json`'s `agent_version` field, which every install that leaves
telemetry on writes from the synthed source's own `dist/VERSION` file. This is the
same field for both install paths: a `--from <repo-root>` install reads it from that repo
root's own `dist/`, and a no-`--from` install reads it from the fetched release's own
`dist/`, so either path's summary names the actual version installed. It's
`null`/omitted from the plain-text line when no `VERSION` file was found under the
source's `dist/`, or when an opted-out target left no `install-info.json` to read.

Verify a `--target <dir>` install:

```bash
ls dir/.kiro/agents/*.json | wc -l          # agent count
ls -d dir/.konductor/skills/*/ | wc -l      # skill count
wc -l dir/.konductor/manifest                # manifest entries
```

Every successful `install` records (or refreshes) an entry for that target directory in
`~/.konductor/installs` - a home-level index, independent of any single target, that
`update` and `uninstall` read to discover which directories this machine has installed
Konductor into, without the caller having to already know or re-pass `--target`.

### `--link-bin`: put `konductor` itself on your `PATH`

```bash
konductor install --from <repo-root> --harness kiro-cli-v2 --link-bin
```

Symlinks the currently-running `konductor` binary to `$HOME/.local/bin/konductor` - the
same manual step described in [Putting it on your PATH](#putting-it-on-your-path) and
`make link`, now available at install time. Opt-in, not the default: unlike every other
piece of `install`'s work, the symlink lands outside `--target <dir>` at a fixed `PATH`
location, regardless of what `--target` names.

Idempotent: re-running `--link-bin` after rebuilding or relocating the binary repoints
the symlink at the current one; running it again with nothing changed is a no-op. A
pre-existing file at `$HOME/.local/bin/konductor` that is not a symlink `install` created
is never overwritten - `install` reports the conflict and leaves it alone.

`konductor uninstall` removes a symlink `--link-bin` created when the target it belongs
to is uninstalled (tracked separately, in `~/.konductor/bin-links`, since the symlink
itself lives outside any one `--target`).

---

## `update`

```bash
konductor update [--from <repo-root>] [--target <dir>] [--all] [--use-github-token]
                 [--dry-run] [--version <v>] [--force] [--no-telemetry | --enable-telemetry]
konductor update --cli [--version <v>] [--use-github-token]
```

Overwrites a tracked install in place: for each selected target, `update` calls the same
underlying install routine `install` itself uses, so the target's agents, skills, and
manifest end up identical to a fresh `install --target <dir>` from the same source.
There is no reconciliation - it is an unconditional overwrite on the `--from` path, and
it will silently clobber any local edits to files under the managed destinations
(`.kiro/agents/`, `.konductor/skills/`, `.konductor/manifest`). Hash-based divergence
classification exists, but only under `--dry-run` (see below) - a real run instead
reports, after the fact, only an aggregate count of how many files were overwritten
while diverged; that count never gates or alters the overwrite. On the no-`--from`
path, `--version <v>` and `--force` apply - see [`--version <v>` and `--force`:
content-version tracking](#--version-v-and---force-content-version-tracking-1) below.

`update` has no `--from` default of its own - omit it and `update` tries the same real
remote fallback chain `install`'s own no-`--from` path uses (see [Installing without
`--from`](#installing-without---from-the-github-release--main-branch-dist-fallback-chain)
above): a fresh synth output tree fetched from a published release, applied through the
resolved target's own already-tracked strategy, with no `--harness` re-prompt. There is
no implicit "reuse whatever source this target was last installed from" behavior either
way - omitting `--from` always means "try the remote fallback chain," never "remember
the last `--from` value."

`--use-github-token` has the identical meaning and effect as `install --use-github-token`
(see [`GITHUB_TOKEN`: optional authenticated access to the GitHub API](#github_token-optional-authenticated-access-to-the-github-api)
above) - read `GITHUB_TOKEN` from the environment and send it on the same
`api.github.com` requests the no-`--from` path makes. It has no effect on a `--from
<repo-root>` update, which never touches GitHub's API at all.

### `--no-telemetry` and `--enable-telemetry`: sticky opt-out/opt-in

`--no-telemetry` opts a target out for this run, and durably: if the target's own
`.konductor/install-info.json` currently exists (telemetry was enabled), this run deletes
it, so the opt-out carries forward to a later plain `update` too, instead of silently
re-enabling telemetry the moment the flag is omitted. Without the flag, `update` carries
forward the target's earlier choice the same way: a missing `install-info.json` already
means opted out, with nothing left to carry forward differently. When the installed
`skill-lookup-mcp` lists `--install-info` in its `--help`, Kiro CLI agents launch the
`konductor-skills` MCP server with `--install-info .konductor/install-info.json` (or
`~/.konductor/install-info.json` for a global install into `$HOME`), and the server sends no
telemetry unless that file holds a valid record at startup. The server resolves the path the
same way as `--skills-dir`, so project agent files carry no machine-specific path. An older
server binary (v1.2.0 or earlier, from `--version` or a stale `--from` build) would reject that
flag, so it gets the per-harness `--telemetry off` instead when the target is opted out.

`--enable-telemetry` is the reverse: it forces telemetry on for this run regardless of any
carried-forward opt-out, and durably re-creates `install-info.json`, the same way a fresh
`install` without `--no-telemetry` would. A later plain `update` then also sees the target
as enabled, not just this one run. The two flags are mutually exclusive (usage error, exit
`64`, if both are passed). An `--all` batch resolves this independently per target, the
same way each target's own `.konductor/config.yml` opt-out is resolved independently.

Both flags are scoped to the **whole target directory**, not to `--harness`.
`install-info.json` is a single file per target, shared by every harness installed there,
so there is no per-harness telemetry setting. Opting out (or back in) via one harness's
`update`, for example `update --harness kiro-cli-v2 --no-telemetry`, changes the record
for every harness at that target. Only the named harness's agent files are rewritten in
that run, but every Kiro CLI harness whose skill-lookup server was launched with
`--install-info` reads the same record each time it starts, so all of them follow the new
setting. A harness without that arg (installed before it existed, or with an older server
binary) keeps its previous setting until its own next `update`. Telemetry hooks stop for
every harness as soon as the record is gone, but `--enable-telemetry` only writes hooks
into the named harness's agent files: another harness's hooks return on its own next
`update`.

`install` follows the same target-wide rule. A plain `install` (no `--no-telemetry`) at a
target whose manifest already tracks a harness, and that has no `install-info.json`, keeps
the target opted out. This holds for a second harness and for a reinstall of the only
tracked harness. It writes no record and no telemetry hooks, and prints a note that
`konductor update --target <dir> --enable-telemetry` opts the target back in. A first
install at a target writes the record as usual. A record deleted by hand reads the same as
an opt-out.

### `--dry-run`

`--dry-run` reports exactly which files would be overwritten for every selected target - flagging each individual path that currently has local edits that would be clobbered,
distinct from an unmodified tracked path, both in plain-text (`(local edits would be
destroyed)`) and `--json` (a per-path `"diverged"` boolean), not just an aggregate count - without touching the filesystem in any way: no file write, no manifest write, no
index write.

This works whether the target's real run would source from `--from <repo-root>` or from
a downloaded release: both paths report through the same preview machinery. The one
difference: a no-`--from` preview cannot know the exact file set a fresh release would
contain without fetching it, and `--dry-run` never makes a network call - so a
no-`--from` preview instead reports the currently-tracked file list and its current
divergence, noting that the exact set a real run fetches may differ once it actually
pulls a fresh release. `--use-github-token` has no effect under `--dry-run` either way,
since no network call is made.

Without `--dry-run`, a real update run proceeds directly: for every target the
selection table below resolves, `update` overwrites its tracked files immediately (or,
with no `--from`, attempts the real remote fetch immediately), with no confirmation
prompt.

### `--cli`: self-replace the CLI binary

```bash
konductor update --cli
```

`update --cli` self-replaces the single, machine-wide `konductor` binary that sits on
`PATH` from a GitHub release - a different operation from every other `update`
invocation, which overwrites installed *content* at a *target*. There is no per-target
CLI dimension: no pinning, no shim/dispatcher binary, no per-version cache directory.

`--cli` is mutually exclusive with `--from`, `--target`, `--all`, `--harness`, and
`--dry-run` - a single declarative clap conflict list. The target-selection/
content-installation concepts don't apply to a binary self-replace, and self-replace has
no preview mode to honor `--dry-run`'s non-destructive guarantee, so combining it with
`--cli` is rejected rather than silently performing the real download/rename.
`--use-github-token`, `--json`, `--verbose`, and `--no-color` remain compatible.
`--version <v>` is fully wired on this axis: `update --cli --version <v>` fetches that
specific release's CLI binary asset pair by tag (`fetch_cli_binary_asset_by_tag`, via
`GET .../releases/tags/{tag}`) instead of latest, and self-replaces with it the same way
the latest-release path does. A tag that does not name a real release surfaces the same
distinct `release {tag} not found` error the content axis produces (exit `64`); every
other fetch/verify failure maps the same as an unpinned `update --cli` run.

The self-replace mechanics: fetch the platform-matching `konductor-<version>-<target
triple>` release asset plus its `.sha256` sidecar (reusing the same GitHub-release fetch
code `install`'s no-`--from` fallback chain already uses), verify the checksum (a
mismatch is a hard failure, exit `65`), download to a temp file in the **same directory**
as the running binary's own path, smoke-test the temp file by executing it with
`--version` and confirming success and the expected version string, then atomically
`rename()` the temp file over the live binary path. This is safe on Unix even while the
live binary is the currently-running process: the kernel keeps the old inode alive (and
the running process attached to it) until that process exits, so the rename does not
disturb the process currently executing it. An unsupported platform (no asset published
for the running target triple) is a hard failure, not a graceful skip - unlike the
MCP-binary fetch, there is no meaningful partial-update outcome for a binary
self-replace.

### `--version <v>` and `--force`: content-version tracking

`--version <v>` selects a specific release instead of latest, on whichever axis this
invocation is on: the `--cli` axis (a specific CLI release) or the content axis (a
specific content release, identical in meaning to `install --version <v>` - see
[`install`](#install) above for the full skip-if-unchanged/`--force`/`--from`-always-
overwrites behavior, which applies identically here on the content path). Mutually
exclusive with `--from` on both axes: usage error, exit `64`. Both axes are real by-tag
fetches: the content axis reuses `install`'s own by-tag fetch
(`fetch_release_artifact_and_mcp_asset_by_tag`), and the `--cli` axis fetches the
matching CLI binary asset pair by tag (`fetch_cli_binary_asset_by_tag`) - both hit `GET
.../releases/tags/{tag}` and both surface the same distinct `release {tag} not found`
error (`GithubFetchError::TagNotFound`) for a tag that does not name a real release,
rather than a generic usage-error stub or a silent fallback to latest.

`--force` bypasses the content-version skip-if-unchanged behavior on both `install`'s and
`update`'s content paths: `update`'s no-`--from` content path now runs the identical
`agent_version` comparison `install.rs` does (against the explicitly requested
`--version <v>` tag when given, latest otherwise), skips the write on a match, and
`--force` bypasses that skip exactly as it does for `install`. It has no relationship
to `--cli` on either command - passing both is accepted at the clap level, but `--force`
has no effect when `--cli` is set, since the CLI axis has no version-tracking concept to
force past.

### Selecting which target(s) to update

`update` resolves which tracked install(s) to act on based on how many entries
`~/.konductor/installs` has and whether `--target`/`--all` was passed:

| Tracked installs | `--target`/`--all` passed | Behavior                                                                 |
| ---------------- | ------------------------- | ------------------------------------------------------------------------ |
| 0                | neither                   | No-op, exit `0`                                                          |
| 0                | `--target <dir>`          | Usage error, exit `64` (an explicit target must exist in the index)      |
| 1                | neither                   | Acts on that one target directly                                         |
| 2+               | neither                   | Usage error, exit `64` - ambiguous, requires `--target <dir>` or `--all` |
| any              | `--target <dir>`          | Acts on the matching entry, or usage error (`64`) if no entry matches    |
| any              | `--all`                   | Acts on every tracked entry                                              |

`uninstall` (below) uses this same table for every row except "2+ tracked installs,
neither flag passed" - see its own section for that one divergence.

A target directory that no longer exists on disk (deleted since it was installed) is
reported as **stale**: `update --target <dir>` on a stale entry fails with a "stale (no
manifest found)" message rather than the target's manifest fields, since there is
nothing left to update.

---

## `uninstall`

```bash
konductor uninstall [--target <dir>] [--all] [--dry-run]
```

Removes a tracked install's files: every path listed in that target's
`.konductor/manifest`, the manifest file itself, and any now-empty directories left
behind under the managed destinations - then removes that target's entry from
`~/.konductor/installs`. `~/.konductor/installs` itself is never deleted by `uninstall`,
even when the last tracked entry is removed from it. If that target ran
`install --link-bin` (see [above](#--link-bin-put-konductor-itself-on-your-path)), the
symlink it created at `$HOME/.local/bin/konductor` is removed too.

`uninstall` takes the same per-target lock as `install` (`.konductor/.install.lock`), so the
two never overlap on one target. When the uninstall leaves no harness tracked, it removes that
lock file; a partial uninstall and `--dry-run` leave it. The manifest's own lock file
(`.konductor/.manifest.lock`) is not removed, so `.konductor/` is not empty after a full
uninstall.

`--dry-run` reports exactly which files would be removed for every selected target,
without touching the filesystem in any way, flagging each individual path that has
diverged from its manifest-recorded hash (i.e. would have local edits destroyed) - distinct
from an unmodified tracked path, both in plain-text (`(local edits would be destroyed)`)
and `--json` (a per-path `"diverged"` boolean), not just an aggregate count. Without
`--dry-run`, a real uninstall proceeds directly, with no confirmation prompt of any kind.

Uses `update`'s `--target`/`--all` selection table above exactly, with no divergence:
a bare invocation (`--target` omitted, `--all` not passed) against 2+ tracked installs
is a usage error (`64`) naming every tracked install, exactly like `update`'s own
identical ambiguous-selection case - there is no implicit `$HOME` resolution and no
picker to disambiguate which target `--target <dir>`/`--all` means.

One further safety difference from `update`: for a **stale** target (tracked in the
index but its manifest is gone, e.g. the directory was deleted out-of-band), `uninstall`
treats this as a non-fatal prune - it removes the stale tracked install entry and
reports `stale: true` rather than failing, since there is nothing left on disk to
protect.

`uninstall` reports how many deleted files had a hash that diverged from the manifest's
recorded hash (i.e. a file that was hand-edited after install and is about to be deleted
anyway), naming the specific diverged file paths - a disclosure, not a safeguard that
blocks deletion.

Exit codes: `0` on success, `64` (`EXIT_USAGE_ERROR`) on any usage error (including the
2+-tracked-installs ambiguity case), `65` (`EXIT_VERIFY_FAILED`) on an unsupported index
schema version, `6` (`EXIT_SUCCESS_WITH_WARNINGS`) when everything this uninstall was
responsible for succeeded but a tracked `--link-bin` symlink could not be removed.

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

| Check               | What it checks                                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`            | Parses the source tree with `synth`'s own parser, including cross-reference validation (agent → context/skill/SOP references must resolve).                                |
| `runtime`           | Which runtime(s) (Kiro CLI / Claude Code) `install` auto-detects at the target.                                                                                            |
| `manifest`          | Manifest presence, completion status, and per-file hash drift against what's on disk.                                                                                      |
| `config`            | `.konductor/config.yml` loads and validates, via `config`'s own loader.                                                                                                    |
| `container_runtime` | Probes `docker`/`podman`/`nerdctl`/`finch` on PATH, in that order - informational only.                                                                                    |
| `index_status`      | Compares `~/.konductor/installs`'s cached status for the target against that target's real manifest status - catches an install/update interrupted between the two writes. |
| `orchestration`     | `orchestration.mode` in `~/.konductor/config.yml` is `auto`, `coordinator` or unset; a project-file value is reported as ignored (`warn` when it differs from the mode sessions run, `info` when it matches). Per installed harness, the session-start hook is wired, its `konductor` binary is executable, and its `--install-root` is this target; under `coordinator`, the persona files are installed. A missing piece is `failed` under `coordinator` and `warn` otherwise. A hook entry not in the form `install` writes is `warn` with its command shown. |
| `cli_version`       | Machine-wide, runs exactly once even under `--all`. Compares the running `konductor` binary's own version against the latest published GitHub release. `warn` severity only when stale - never `failed`, never affects `doctor`'s own exit code. |
| `content_version`   | Per-target, runs once per tracked target under `--all`. Compares that target's recorded content version (`agent_version` in `install-info.json`) against the latest published release. Fully independent of `cli_version` - no shared check name, summary line, or comparison logic. |

A few forward-looking checks (`gitignore`, `provider_model_access`, `role_allowlists`)
exist in the code and are unit-tested, but are not yet wired into live `doctor` output - they're dormant until the features they'd validate (run-state persistence, the
override mechanism, provider/model-access, role-scoped allowlists) actually exist.

`source`/`config` validate the **repo checkout/project config**, which only has a real
answer when a local `--from` checkout exists - useful for catching an authoring
mistake before/after an install. `manifest`/`runtime`/`index_status` answer "is my
installation healthy" regardless of install method, since they only inspect the
installed destination (and, for `index_status`, its index entry). Anyone installing
from a published release artifact (no local checkout) should expect a benign `info`
fallback from `source`/`config`, not a sign of a broken install. `container_runtime` is
always `info`/informational; `index_status` is `info` for a target that isn't tracked
in the index at all (not every install needs to be tracked - e.g. one predating the
index).

Each check reports one of five statuses, each non-`ok` line followed by an indented
`fix:` hint:

- `ok` - no problem found.
- `info` - nothing installed/configured yet, or a benign fallback occurred and still
  checked out clean.
- `warn` - a hygiene issue that isn't a broken install: an unreadable manifest falling
  back to an **unvalidated cwd** with no known relationship to the install (flagged
  with a `WARNING: ... UNVALIDATED cwd ...` marker), or `index_status` finding the
  install index and manifest disagree on completion status.
- `failed` - something is broken: a source parse error, invalid config, a manifest
  stuck `InProgress`, a corrupt manifest, or a manifest from an incompatible
  `konductor` version (remediation there points at upgrading `konductor`, never at
  re-running `install`).
- `stale` - installed content has drifted from the manifest (hash mismatch or missing
  file) - needs a re-install, not necessarily a bug.

`-v`/`--verbose` prints full detail per check; `--json` emits a compact object instead
(see [`--json` output](#--json-output) below).

### `--no-version-check`

Skips the network call `cli_version` (and `content_version`) make to determine the
latest available version. Independent of telemetry: this call carries no UUID and is
unaffected by `--no-telemetry`, `telemetry.enabled` in config, or `KONDUCTOR_TELEMETRY=off` - gated only by this flag. A version-check fetch failure (network error, etc.) never
fails `doctor` itself; it degrades to an `info`-level result explaining the fetch could
not complete.

### Checking every tracked install with `--all`

`--all` runs the full check suite (all six checks above) against **every** target in
`~/.konductor/installs`, one at a time - the same "act on every tracked entry"
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

1. **Explicit `--from <repo-root>`** - always wins outright, independent of any
   manifest.
2. **No `--from`: the manifest's recorded `source`**, read from the install
   destination (`--target`/`$HOME`), if present.
3. **No `--from`, no usable recorded source: falls back to the cwd**, with an explicit
   note - never silent. Three sub-cases, in increasing risk:
   - No manifest exists at all → `info`.
   - Manifest is readable but has no recorded source (predates the field, or an
     unsupported `schema_version` from a newer binary - the `manifest` check reports
     that separately) → `info`.
   - Manifest exists but couldn't be read at all (corrupt JSON / I/O error) → `warn`,
     with the `UNVALIDATED cwd` marker.

Example (default, all healthy):

```
$ konductor doctor
ok: source - source tree at /home/user/konductor-checkout parses cleanly (11 agent(s), 75 skill(s), 17 SOP(s), 1 context file(s))
ok: runtime - detected runtime(s) under /home/user: kiro-cli
ok: manifest - manifest at /home/user/.konductor/manifest is Complete and every recorded file matches (93 file(s))
ok: config - config loads cleanly (tier 'minor', default_severity 'MEDIUM')
info: container_runtime - detected container runtime on PATH: docker
    fix: no action needed -- only relevant if you plan to use a container-based sandbox mode
```

Example (problem found - manifest hash drift):

```
$ konductor doctor
stale: manifest - 2 file(s) under /home/user no longer match the manifest recorded at install time
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

- `ok` - `true` unless at least one check is `failed`/`stale` (mirrors the exit code).
- `warnings` - `true` if at least one check is `warn`. **Distinct from `ok`**: a `warn`
  never fails the run on its own, so a report can have `ok: true` and `warnings: true`
  at the same time.
- `checks[].detail` - present only on a non-`ok` check; every individual problem found,
  plus the fallback note (if any) as its first entry.
- `checks[].remediation` - present only when the check has one (never on `ok`).

With `--all`, this same object shape is nested once per target under a top-level
`targets` array instead - see [Checking every tracked install with `--all`](#checking-every-tracked-install-with---all).

Exit codes: `0` when every check is `ok`/`info`/`warn`; `1` (`EXIT_HALTED`) when at
least one is `failed`/`stale`; `64` on a usage error. `doctor` never emits exit code 2,
which only the gate evaluator uses; see [Conventions](#conventions).

### `--json` error envelope (`install`/`synth`/`doctor`)

Distinct from the status report above, `--json` also gates a shared _error_ envelope
on early usage-error paths in `install`, `synth`, and `doctor` (and, previously,
`uninstall`/`update`). On a non-zero exit, instead of a plain-text
`konductor <command>: <message>` line to stderr, the command prints one JSON object to
stdout instead:

```json
{
  "command": "install",
  "error": "no install strategy matched this target (...)"
}
```

- `command`/`error` are guaranteed on every envelope, regardless of which command
  produced it.
- Some call sites attach extra, command-specific fields (e.g. `target_dir` on
  `uninstall`/`update`). These are not part of the stable cross-command contract - only
  rely on an extra field once you already know which command produced it.
- The envelope always prints to stdout, matching every other `--json` document these
  commands emit on success, so a `--json` consumer only has to read one stream to see
  every outcome, success or failure.

---

## `verify-run`

```bash
konductor verify-run --session .konductor/sessions/k-full-sdlc-<timestamp>-<suffix>.yml
konductor verify-run --session <path> --allow-running   # accept a run still in progress
konductor verify-run --session <path> --root <dir>      # session and evidence must live under <dir>
konductor verify-run --session <path> --json            # one JSON object on stdout
konductor verify-run --session <path> --max-fix-cycles 2 # pin the fix-cycle budget outside the session file
```

Checks one SOP session file, the file the `sop-state-management` skill writes for a
phase-gated SOP, and reports one exit code. Today only `k-full-sdlc` lists its phases
and gate boundaries in `cli/gate-config/sop-orchestration.yml`, so only its sessions can
pass. The SOP name comes from the file name (`<sop>-<digit>...`).

It reads the session file (at most 1 MiB), checks that the evidence files the session
names exist (it never opens them), and reads the effective config (preset, then
`~/.konductor/config.yml`, then `<cwd>/.konductor/config.yml`) for
`fail_on_severity_at_or_above`. It writes nothing under the project and sends no
telemetry. Like every command, it appends one line to the invocation log under
`~/.konductor/logs/`.

The current directory is the project and the only source of policy: the threshold comes
from `<cwd>/.konductor/config.yml` layered over the user config, never from `--root`. The
output names the file that set it in a `CONFIG_SOURCE` info line (`defaults` when no file
sets it), in plain and `--json` output.

`--root <dir>` only bounds where files may resolve. It defaults to the current directory.
A relative `--root` is resolved against the current directory, and the root is
canonicalized (symlinks resolved) before any check. The session path is resolved against
the root (an absolute path is used as is); the file must be a regular file whose canonical
path is inside the root, and it must not be a symlink. Evidence paths in the session are
relative to the root and must canonicalize to a regular file inside it, spelled exactly as
on disk (a case variant is `EVIDENCE_MISSING` on every host). Unlike the session file, an
evidence path may be a symlink when it resolves inside the root; one resolving outside is
refused. Use `--root` when the session lives in an output directory outside the checkout,
for example `konductor verify-run --session <file> --root <output_dir> --allow-running`
run from the project root. A `--root` that does not exist or is not a directory is a usage
error (exit 64). The containment checks cover static paths and symlinks. They do not
protect against another process replacing files while the command runs.

The YAML is read as plain data: a local tag such as `!custom` or a non-string mapping
key rejects the file. A `!!` tag such as `!!python/object` is resolved to its untagged
value, so no object is ever constructed.

The first row that fires sets the exit; every firing reason prints.

| Row | Condition | Reason | Exit |
| --- | --- | --- | --- |
| V0 | A bad argument: a missing or unknown flag, a `--root` that is not a directory, or an unresolvable current directory | `ARGUMENT_INVALID` | 64 |
| V1 | The file is missing, unreadable, not UTF-8, a symlink, outside the root, or rejected by the YAML loader. A `config.yml` that is present but invalid | `SESSION_INVALID`, `CONFIG_INVALID` | 65 |
| V2 | `schema_version` is not 1, a status outside the skill's enums, a SOP name not in the gated list or with no `phases`, or session phases that differ from that list | `RECORD_INTEGRITY` | 65 |
| V3 | A phase `COMPLETED` after an earlier `PENDING` or `IN_PROGRESS` one, `run_status: completed` with a phase not `COMPLETED` or `SKIPPED`, or a `SKIPPED` phase with no `skip_reason` | `PHASE_ORDER`, `PHASE_INCOMPLETE`, `SKIP_UNEXPLAINED` | 65 |
| V4 | A gate phase is `COMPLETED` (per registered feature for a feature gate) with no `gate_<phase>_result`, an approval result other than `approved`, or no `gate_<phase>_evidence` naming a file in the project | `GATE_MISSING`, `APPROVAL_MISSING`, `EVIDENCE_MISSING` | 65 |
| V5 | A phase is `BLOCKED`, or a per-feature phase stays `IN_PROGRESS` after a later phase completed | `HALTED` | 1 |
| V6 | A feature's `fix_cycles_used` is above the cap: `run.data.max_fix_cycles`, or 2 when none is recorded. Also checks the run-level `doc_fix_cycles_used` | `BUDGET_EXCEEDED` | 3 |
| V7 | A check-threshold or loop-exit `gate_<phase>_result` ranks at or above the effective threshold. A word in no severity list ranks as CRITICAL | `FINDING_UNRESOLVED` | 2 |
| V8 | `run_status: completed` and nothing above fired | `PASSED` | 0, or 6 when a gate phase was skipped |
| V9 | `run_status: in_progress` and nothing above fired | `RUNNING` | 0 with `--allow-running`, otherwise 65 |

Info lines never change the exit: `SAME_TYPE_CHECKER`, `SEVERITY_UNKNOWN`,
`FINDING_BELOW_GATE`, `FIX_CYCLE_CAP_DEFAULTED` (no `max_fix_cycles` is recorded, so
the cap is 2), `PHASE_SKIPPED`, and `CONFIG_SOURCE` (which file set the threshold).

**Strict floor.** The effective threshold is the configured
`fail_on_severity_at_or_above` or `HIGH`, whichever is lower. With the preset
`CRITICAL`, an open `IMPORTANT` or `WARNING` finding (both rank `HIGH`, see
`cli/gate-config/severity-schema.yml`) at a gate exits 2. That is the intended report,
"a HIGH-or-above finding was left open at a gate", not a broken run.

Plain output prints a summary line, `konductor verify-run: <first reason> (exit <n>)`,
then one `<CODE>: <detail>` line per reason and per info note, on stdout. Control
characters in a detail print as visible escapes (`\n`, `\u{1b}`). A V1 failure prints
`konductor verify-run: <CODE>: <detail>` on stderr instead. `--json` prints one object on
stdout in every case, including argument errors clap rejects (stderr stays empty); `error`
(the first reason's detail) is present for exits 64 and 65:

```json
{
  "command": "verify-run",
  "exit": 2,
  "reasons": [{ "code": "FINDING_UNRESOLVED", "detail": "..." }],
  "info": []
}
```

It detects omission and inconsistency in the recorded session, not forgery: a session
that records false facts consistently passes.

---

## Using the orchestrator

Agents installed with `--target <dir>` are discovered by a **cwd-relative scan** - they
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

### Orchestration mode

`orchestration.mode` picks how `konductor` works: `auto` (the default, single-writer) or
`coordinator` (read-only, every change goes to a specialist). Set it by hand in the user layer:

```yaml
# ~/.konductor/config.yml
orchestration:
  mode: coordinator   # or auto (the default)
```

- Only `~/.konductor/config.yml` is read. A project `.konductor/config.yml` value is ignored, and
  the `doctor` `orchestration` check reports it: `warn` when it differs from the mode in effect,
  `info` when it matches.
- `config set` does not set this key. It writes the project layer, and it keeps an existing
  `orchestration:` section in that file intact.
- The value is exactly `auto` or `coordinator`. A change applies from the next session, with no
  reinstall; `install` and `update` never rewrite it.
- `install` wires a session-start hook for `konductor` on every harness, also under
  `--no-telemetry`: a standalone document `.kiro/hooks/konductor-orchestration-hooks.json` on
  Kiro CLI v3, a `SessionStart` block in the Claude Code hooks settings file, and an `agentSpawn`
  entry in `.kiro/agents/konductor.json` on Kiro CLI v2. `uninstall` removes them.
- Under `coordinator` the hook prints `Orchestration: coordinator`, a line telling `konductor` to
  read the installed `k-orchestrator-routing-rules.md` in full, and the short coordinator digest
  (under 2,500 bytes in total). Only the mode line and the Step 1 pointer are trusted; the summary
  lines are a preview of the file. Under `auto`, or with no setting, it prints nothing, except that on a Claude Code resume or
  compact it prints `Orchestration: auto`, so a session that changed mode sees the change.
- The hook acts only for the install that wired it: it looks for the nearest install that owns
  `konductor` for the harness that fired it from the working directory upward and in your home directory, and prints nothing
  unless that install is the one named by its own `--install-root`. `konductor` follows the rules
  file the hook names only when the install is under your home directory, or its root is the
  project root: the working directory itself or a git checkout root that contains it. For an
  install anywhere else the hook prints a fallback line (below) and the session runs as `auto`.
  Install under your home directory or the project root for coordinator mode.
- When it recognises a `konductor` session but cannot apply `coordinator` (unset `HOME` on Claude
  Code or Kiro CLI v2, an unreadable or unparsable config file, an unknown value, a missing rules
  file, or an install outside the locations above), it prints one line,
  `Orchestration: auto (fallback: <reason>)`, and the session runs as `auto`.
- The first reply of every `konductor` session states the mode: the hook's line, or
  `Orchestration: auto (default)` when no line arrived. `Orchestration: auto (default)` with
  `coordinator` set means the hook output did not reach the session; run `konductor doctor`.

Kiro CLI v3 and Claude Code installed with `konductor install` are supported. The Claude Code plugin does not wire the hook, so coordinator mode is not available there. Claude Code is wired to run the hook again on `/clear`,
`/compact` and resume (tested on resume only); Kiro CLI v3 may not after `/compact`, so start a new
session if a `coordinator` session starts writing files itself. Kiro CLI v2 is not supported: the hook is wired as above, but its
delivery is untested, and when it does not arrive the session runs as `auto` and the first reply
says `Orchestration: auto (default)`.

Alternatives considered: a separate coordinator agent that loads the routing rules as a static
resource (as the mux and cmux orchestrators do) needs no hook, no output budget and no trust
carve-out, but adds a fourth orchestrator to keep in parity and gives up switching by config under
one agent name. An install-time profile (install or update writes the agent with the routing rules
or the direct-work file as its static resource) keeps the single name and the config key but needs
`konductor update` after each change. The hook keeps the single name and switches at the next
session; the cost is the output budget, the digest and the rule 11 carve-out bounded to two context
directories.

The hook runs the hidden command `konductor __orchestration-hook`. Like `__telemetry-hook`, it is
not part of the command surface: it reads the harness payload on stdin, acts only for a
`konductor` session, exits 0 on every payload, and writes nothing to stderr. A bad flag exits 64
like any other usage error.

---

## Conventions

- **Unified error prefix.** Every error line the CLI prints in plain-text mode sits
  under one greppable prefix family: `konductor <command>: <message>` for a
  per-command error (`install`, `uninstall`, `update`, `doctor`, `synth`, `init`,
  `verify-run`), or
  `konductor: <message>` for the handful of command-agnostic paths (no
  subcommand resolved yet, or the shared working-directory resolution run before
  dispatch). This matters when output from multiple `konductor` invocations is
  interleaved in a CI log or terminal session alongside other tools' output.
- **Exit code 64 for CLI usage errors.** A bad flag, unknown command, or missing required
  argument exits **64** (`EX_USAGE`), not the more common default of 2 - exit code 2 is
  reserved by the exit-code contract for an unresolved finding at or above the effective
  severity threshold (the CI-failing signal), so a malformed invocation is never mistaken
  for a gate failure. 64 covers argument and usage problems only.
- **Exit-code contract** (the conductor that emits these for its own paused-verdict
  workflow is post-launch. `doctor`, `uninstall` and `verify-run` already emit some
  of them, as each row says):
  | Code | Meaning |
  |------|---------|
  | 0 | All passed |
  | 1 | Halted (timeout / runtime error / parse error) - reused by `doctor` for "at least one check failed/stale", and by `verify-run` for a blocked phase |
  | 2 | Unresolved finding at or above the effective severity threshold, from the gate evaluator; the CI-failing signal (**never** used for usage errors). Phase-gated SOPs never judge laxer than HIGH. Emitted by `verify-run` |
  | 3 | Fix-cycle budget exceeded: a recorded count is above `run.data.max_fix_cycles` (default 2 when the session records none; the evaluator notes that default). Emitted by `verify-run` |
  | 4 | User aborted a paused verdict |
  | 5 | Reserved, not yet emitted by any command. |
  | 6 | Success with warnings: `uninstall` when an otherwise-successful run could not remove a tracked `--link-bin` symlink; `verify-run` when a run completed with a skipped gate |
  | 64 | CLI usage error (`EX_USAGE`) - never the reserved code `2`. For `verify-run`, argument problems only, including a `--root` that is not a directory or a `--max-fix-cycles` that is not a non-negative integer |
  | 65 | Content or integrity failure, distinct from a `64` usage error: an unsupported manifest/index `schema_version`, a failed checksum, or, for a SOP session file, a corrupt or invalid session, a broken record (including a non-integer `max_fix_cycles` or counter, a recorded `max_fix_cycles` above a pinned cap (`CAP_RAISED`), or a wrong-typed gate fact), phase order (a started or completed phase after an earlier phase that is still `PENDING` or `IN_PROGRESS`, unless that earlier per-feature phase is held open by a feature, which exits `1`), an unfinished phase or an unexplained skip, missing gate facts or evidence, or, reported last and only when nothing else fired, an in-progress session without `--allow-running` |

  When several causes apply, the gate evaluator lists all of them but exits with the
  code of the first check that fires. The checks run in this order: session and
  record integrity (65), halted (1), budget (3), findings (2), then, when nothing else
  fired, skipped gate (6) or an in-progress session without `allow_running` (65). The
  words `none` (no findings) and `approved` match ignoring case and surrounding
  whitespace, like severity words. One
  exception: a malformed `max_fix_cycles` is found by the budget check, so after a
  halt the exit stays 1 and the 65 cause is only listed. A recorded cap above a pinned
  cap (`CAP_RAISED`) is not an exception: it is found with the integrity checks.
  The fix-cycle cap comes from the SOP recording
  `max_fix_cycles` in the session; only an absent key falls back to the default of 2. A
  key that is present must hold a non-negative integer: an empty value (`max_fix_cycles:`),
  a negative number, a float, a string, a bool or a list is a 65 integrity failure, never a silent default.
  Pinned cap: `verify-run --max-fix-cycles <N>` (N a non-negative integer, digits only: no
  sign, spaces or decimals; anything else is a `64` usage error) supplies the fix-cycle
  budget from outside the session file. With the flag, a recorded
  `max_fix_cycles` above N is a `65` integrity failure (reason code `CAP_RAISED`, naming
  both values) because the recorded budget was raised above the pinned one. A recorded
  value at or below N stays the cap, so a lower recorded cap is still enforced (exit `3`
  when exceeded). An absent key takes N instead of the default 2. A present but malformed
  key is still a `65` integrity failure. `CAP_RAISED` is found with the other record
  integrity checks, before the halted and budget rows, so a raised cap never turns into a
  pass or a `3`. Without the flag nothing changes: the recorded cap is trusted, and only an
  absent key defaults to 2.
  Trust boundary: the session file is plain YAML written by the orchestrating agent, and
  without the flag `verify-run` cannot tell whether the cap was edited after minting. Like
  every `gate_<phase>_*` fact, that assumes a cooperating agent. The flag protects checks
  that CI or an engineer runs with a budget they chose. It does not protect an agent that
  writes the session and also runs `verify-run`, because that agent can pass any value.
- **Unknown-command suggestions.** An unknown command suggests a close match from the
  real command set.

---

## Current state

- **Done:**
  - the CLI command surface
  - the declarative contract (gate/config schemas - `severity-schema.yml`,
    `scope-table.yml`, `config.yml`, `run-state.json` - plus the config loader)
  - `init` scaffolding a real `.konductor/` directory with a starter `config.yml`
  - `install` copying synthed agents/skills into `$HOME/.kiro/` (or
    `--target <dir>/.kiro/`) and writing a manifest beside the installed tree
  - `update` overwriting a tracked install in place from a source tree
  - `uninstall` removing a tracked install's files and manifest
  - `synth` transforming source content into runtime-native output
  - `doctor` inspecting a source tree/install destination via `synth`/`install`/`config`'s
    own logic and reporting per-check ok/info/failed/stale status with remediation
    guidance
  - `verify-run` checking a SOP session file against its gate boundaries and
    reporting one exit code, including exit code 2 for an unresolved gating finding
- **Stubs:** `metrics` still prints "not yet implemented."
- **Not yet started:** the run-engine/conductor (which will read/write
  `.konductor/run-state.json`-shaped documents), and `.konductor/runs/` storage.

## Current limitations

- The GitHub-release install path (the CLI-side fetch→verify→install wiring in
  `install::github`/`install::remote_orchestrate`, wired into `konductor install`'s
  no-`--from` path) works against a real release: `.github/workflows/release.yml`
  publishes the packaged tarball, its `.sha256` sidecar, and the platform-specific
  `skill-lookup-mcp` binaries (see [MCP server binary fetch](#mcp-server-binary-fetch-no---from-install)
  above) on every release, in the shape this fetcher expects. The `main` branch `dist/`
  fallback does not yet work - `dist/` is `.gitignore`d in this repo's own working
  tree, so there is no publishing step yet to place the tarball+sidecar under `dist/`
  on `main`; that fallback source never fetches the MCP binary either way, since it
  only ever handles the tarball+sidecar pair. See
  [Installing without `--from`: the GitHub-release / main-branch-`dist/` fallback chain](#installing-without---from-the-github-release--main-branch-dist-fallback-chain)
  for that gap plus two further caveats (GitHub API rate limiting; no GPG/sigstore
  provenance check - SHA-256 transport-integrity only). `--from <repo-root>` remains
  an alternative for installing from a local checkout.
- SOPs are synthed into `dist/kiro-cli-v2/sops/` but are not installed anywhere; there is
  no runtime discovery path for them yet.
- `metrics` is a stub (see above).
- `update` and `uninstall` have no same-target concurrency protection: running two
  `konductor` invocations against the same target directory at once is unsupported and
  can corrupt the manifest, index, or on-disk files. Serialize invocations per target.
- `doctor` does not check Claude Code-specific environment state, compare installed
  vs. available versions, or validate metrics/gate-tier data (no supporting mechanism
  exists in-repo yet for the latter two).
