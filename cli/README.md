<!-- SPDX-License-Identifier: Apache-2.0 -->

# Konductor CLI

The Konductor CLI is the command-line utility for setting up, building, and maintaining
a Konductor-managed repository. It handles installation, configuration, and diagnostics
for the agent, skill and SOP content that Konductor manages — it does not itself run
SDLC workflows (that's the Konductor Kiro agent's job).

> **Status:** all commands perform real work (see [Current state](#current-state)).

---

## The 9 commands

`install`, `update`, `uninstall`, `synth`, `init`, `doctor`, `flow`, `verify-run`,
`metrics`.

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

The CLI utility handles setup, content build, lifecycle, and diagnostics, and it checks,
shows and runs workflow files with [`flow`](#flow). `flow run` runs stages on Kiro CLI or Claude Code (the
[test-only `fake` harness](#the-fake-harness-test-only) runs no agent). Other SDLC work with real agents is still
driven by the Konductor Kiro agent.
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
are left out, since they claim every task. Each Claude Code agent file ends with a
`## Skills you can load` block instead, listing only the declared skills it does not preload
(see the preload paragraph below).

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

Claude Code injects every skill in an agent's `clientConfig.claudeCli.skills` into each
subagent it spawns, so `synth` measures that preload. It prints a `konductor: warning:` line to
stderr for any agent over 32 KiB or 32 names; past 32 names it lists the skills Claude Code would
drop. The command still succeeds. `-v` adds one
`claude preload: <agent> <bytes> B, <n> skill(s)` line per agent, and `--json` carries the same
figures in a `claude_preload` array. Each agent file lists the declared skills it does not
preload, to be loaded with the `Skill` tool, so `synth` also warns when an agent has such skills
but an explicit `clientConfig.claudeCli.tools` list without `Skill`.

---

## `metrics`

```bash
konductor metrics [--since 7d] [--by agent|model|day|repo] [--json]
```

Scans local Claude Code (`~/.claude/projects`, or `$CLAUDE_CONFIG_DIR`) and Kiro
(`~/.kiro/sessions`, or `$KIRO_HOME`) session files, and keeps sessions run by a
Konductor agent. That means an agent installed by any tracked install
(`~/.konductor/installs`) or by the Claude Code marketplace plugin. Usage is reported
per harness in its native unit: tokens for Claude Code, credits for Kiro. The two are
never summed. Parsed results are cached in `~/.konductor/usage/records.jsonl` (mode
`0600`), so sessions stay counted after the harness deletes its own files. Nothing is
sent anywhere.

| Option | Default | Values |
|---|---|---|
| `--since` | `7d` | `<n>h`, `<n>d`, or `<n>w` |
| `--by` | `agent` | `agent`, `model`, `day` (UTC, by session start), `repo` |
| `--json` | off | Machine-readable output, described below |

Usage is counted per whole session. A session active at any point in the window
counts in full, and `--by day` dates it by its start, so a long session can appear on
a day before the window.

The `requests` column is harness-native and not comparable across harnesses: API
requests for Claude Code, Kiro's own request count for Kiro CLI v2, and prompt turns
for Kiro v3.

Exit codes: `0` on success, including when nothing is found; `1` when `HOME` is unset;
`64` for a bad flag value.

`--json` prints one object:

| Key | Meaning |
|---|---|
| `since`, `by` | The options used |
| `konductor_agents_known` | How many distinct Konductor agents were found installed |
| `harnesses[]` | One entry per harness with data: `harness`, `unit` (`tokens` or `credits`), `rows[]`, and `total` |
| `unparsed_files` | Session files in the window that couldn't be parsed |
| `unreadable_files` | Session files that couldn't be opened, or aren't regular files (a FIFO, device, or directory with a session file's name). These are skipped, never read |
| `stale_files` | Changed files that couldn't be re-read; their last good data is used |
| `unreadable_cache_lines` | Cache lines that couldn't be read. They are kept unchanged |

Each row and `total` has the same fields:
- `key`, `files`, `requests`, `subagent_runs`;
- the token fields: `input_tokens`, `cache_write_tokens`, `cache_read_tokens`, `output_tokens`, `thinking_tokens`, `web_search_requests`;
- `credits`.

A value the harness doesn't record is `null`, never `0`. Claude Code rows have null `credits`, Kiro rows have null token fields, and `subagent_runs` is set only for Kiro v3.

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

After a `kiro-cli-v2` install the summary is followed by one line naming the kiro-cli
versions the agents' explicit v2 tool lists were checked against (2.36.0 and 3.0.0) and
the `/tools` command that re-checks them on another version against the installed
`<target>/.kiro/agents/k-developer.json`; it informs only and gates nothing.

### Claude Code permission rules for the AWS MCP server

When a `--harness claude` install includes an agent that uses the `aws-mcp` server
(`konductor`, `k-architect` and `k-developer` today), it merges two kinds of rules into
`<target>/.claude/settings.json` (`~/.claude/settings.json` for the default `$HOME` target).
An agent uses the server when its frontmatter lists it under `mcpServers` or its `tools`
grants `mcp__aws-mcp` or any `mcp__aws-mcp__<tool>`, so a custom synth without
`--claude-bundled-mcp-servers aws-mcp` still gets the ask rules. CRLF frontmatter is read
the same way. An agent file whose frontmatter cannot be read (missing, unclosed or not
YAML) is skipped with a `konductor install: warning:` naming the file.

- An ask rule in `permissions.ask` for every `aws-mcp` tool outside the five read-only
  ones: `mcp__aws-mcp__aws___run_script`, `mcp__aws-mcp__aws___get_presigned_url` and
  `mcp__aws-mcp__aws___get_tasks`. Claude Code asks before every call to them. They act on
  AWS with your credentials (`aws___run_script` runs agent-written Python). Install takes the
  server's tools from a fixed list, not from a live call: the eight the server listed through
  `mcp-proxy-for-aws-cli` 2.0.0 when the list was last checked. The proxy relays the hosted
  server's list, so the server can add tools. `k-architect` and `k-developer` are granted only
  the listed tools by name, so a new one stays unavailable to them until it is classified.
  Claude Code checks ask rules before allow rules, so it still asks under a broad
  `mcp__aws-mcp__*` allow.
- The union of those agents' Kiro `allowedTools` for `aws-mcp` in `permissions.allow`, as
  `mcp__aws-mcp__<tool>`, so Claude Code pre-approves the same read-only tools Kiro CLI
  does. Only the five read-only tools (`aws___retrieve_skill`, `aws___search_documentation`,
  `aws___read_documentation`, `aws___list_regions`, `aws___get_regional_availability`) can
  get an allow rule: `synth` leaves any other `aws-mcp` tool out with a
  `konductor: warning:`, and install never writes one, even from a hand-edited sidecar.
  `synth` records them in `dist/claude/agents/_mcp_allowed_tools.json`. A dist
  without that file (synthed by an older konductor) gets only the ask rules, and install
  says so. Only single named tools are recorded: `synth` leaves out a whole-server
  (`@aws-mcp`) or wildcard (`@aws-mcp/*`) entry, or any name that is not letters, digits,
  `_` and `-`, and prints a `konductor: warning:` naming the agent and entry. A wildcard
  allow would also cover the ask-gated tools. Install still rejects a sidecar with such a
  name.

The merge only appends. It never removes or reorders your entries, and a reinstall that
adds nothing leaves the file untouched. If one of your entries already covers a rule (a
`deny` rule, an exact `allow` of an ask-gated tool, or an `ask` rule covering a read-only
tool), install keeps yours, leaves that rule out and prints one line naming your entry.
Install records in its manifest the entries it appended, and `uninstall` removes exactly
those. It keeps the entries you already had, the rest of `settings.json` and the file
itself, and it refuses a symlinked `.claude` or `settings.json` with a warning naming the
entries to remove by hand. A second `uninstall` changes nothing.

These rules live in that settings file's scope, so they apply to every Claude Code session
that reads it, not only to Konductor's agents: every session for the default `$HOME` install
(`~/.claude/settings.json`), and every session in the project for a `--target` install
(`<target>/.claude/settings.json`, which a team may commit). Claude Code has no per-agent
permission settings.

When the settings file cannot take the rules (a symlinked `.claude` or `settings.json`,
malformed JSON, a `permissions` that is not an object, or a `permissions.ask`, `allow` or
`deny` that is not an array), install writes none of them and still exits 0. It ends with a
block on stderr headed `konductor install: AWS MCP permission rules were NOT written` that
names the file and the reason and prints the rules as JSON to merge into the file's
`permissions` object by hand. `install --json` carries the same outcome in an `aws_mcp_rules`
field: `{"written": false, "file": ..., "reason": ..., "rules": {"permissions": {...}}}`, with
`written: true` and `reason: null` when the merge succeeded, and `null` when no installed agent
uses `aws-mcp`.

No ask rule is written for a tool when:

- Konductor is installed as a Claude Code plugin (see below).
- The settings file cannot take the rules, as above.
- One of your entries already covers the tool: a `deny` rule, or an exact `allow` of it.

Under `konductor-mux-orchestrator` and `konductor-cmux-orchestrator`,
`KONDUCTOR_DISPATCH_PERMISSION_MODE` (or the plugin's `dispatch_permission_mode` option) sets
how each Claude Code pane starts. An `interactive` pane, the default, is a normal session. A
`headless` pane runs `claude -p --permission-mode acceptEdits --permission-prompts none`, and the
opt-in `bypass` pane runs `claude --dangerously-skip-permissions -p`. Claude Code's
[permission modes](https://code.claude.com/docs/en/permission-modes) docs say an explicit ask
rule is still enforced in `bypassPermissions`, and that a `-p` run denies a call that would
prompt. So when the settings file holding the rules applies to a pane (every pane for the
default `$HOME` install, and only panes running in the target project for a `--target`
install), an `interactive` pane asks you before each call to the ask-gated tools, and a
`headless` or `bypass` pane cannot call them. Plugin installs get no rule (see below). Run work
that needs them from `konductor` or an `interactive` pane, where you can approve each call.

The Claude Code plugin cannot ship permission rules. Plugin users add
`mcp__plugin_konductor_aws-mcp__<tool>` for each ask-gated tool to `permissions.ask`
themselves (see
[Install from the Claude plugin marketplace](../docs/user-guide/tasks/install-claude-plugin-marketplace.md)).

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

`--dry-run` reports what a real run would do for every selected target, without touching
the filesystem in any way. It lists the files a real run would remove, marking a
Kiro-rewritten agent as `(rewritten by Kiro; removed)`, then the files it would keep because
they changed since install, then the matching Kiro agent backups it would leave. The
"would remove" count covers removals only. See [`uninstall --json`](#uninstall---json) for
the JSON shape. Without `--dry-run`, a real uninstall proceeds directly, with no
confirmation prompt of any kind.

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

`uninstall` keeps a tracked file whose content no longer matches the manifest's recorded
hash, prints a warning naming it, and still exits `0`. The kept file is still live (the
runtime keeps loading it) but is no longer tracked once the manifest entry is gone. For a
kept Kiro CLI v3 hook document the warning also names the Konductor hook entries to
remove, and the document's lock file is left with it. One exception covers Kiro CLI's
`kiro-cli agent upgrade`, which rewrites each `.kiro/agents/<name>.json` in place and
saves the original as `<name>.json.bak`: when that backup hashes to the manifest's
recorded hash, the rewritten agent file is removed and listed. Uninstall never deletes a
`.bak` file. It prints a warning listing, by full path, each backup that matches the
manifest (next to a rewritten or an unchanged agent file) and suggests removing them by
hand. A backup that does not match is neither touched nor listed, and `.bak` files
anywhere else are ignored. This rule cannot tell Kiro's rewrite from an edit you make
after `kiro-cli agent upgrade`: the backup still matches, so an agent file edited after
the upgrade is removed too.

Exit codes: `0` on success, `64` (`EXIT_USAGE_ERROR`) on any usage error (including the
2+-tracked-installs ambiguity case), `65` (`EXIT_VERIFY_FAILED`) on an unsupported index
schema version, `6` (`EXIT_SUCCESS_WITH_WARNINGS`) when everything this uninstall was
responsible for succeeded but a tracked `--link-bin` symlink could not be removed.

### `uninstall --json`

A real run's document (one per target, or one `succeeded` entry per target under `--all`)
carries `files_deleted`, `diverged_deleted` and `diverged_paths` (only Kiro-rewritten agent
files), `kept_changed` (a count) and `kept_changed_paths` (relative paths), `kept_backups`
(absolute paths of the matching Kiro agent backups left in place), plus `dirs_removed`,
`stale` and the `--link-bin` fields. The plain-text warnings about kept files and backups
are not printed under `--json`.

A `--dry-run` document (one per target, or one `previewed` entry per target under `--all`)
carries:

- `would_delete`: only the files a real run removes, each `{"path", "diverged"}`, where
  `diverged` is `true` only for a Kiro-rewritten agent;
- `would_keep`: the relative paths of files a real run keeps because they changed since
  install;
- `would_delete_count` and `would_keep_count`: the lengths of those two arrays;
- `kept_backups`: as in the real run.

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
| `orchestration`     | `orchestration.mode` in `~/.konductor/config.yml` is `auto`, `coordinator` or unset; a project-file value is reported as ignored (`warn` when it differs from the mode sessions run, `info` when it matches). Per installed harness, the session-start hook is wired, its `konductor` binary is executable, and its `--install-root` is this target; under `coordinator`, the persona files are installed and load within the hook's output budget (`failed` when the digest is over budget or the install path too long), and an install root outside your home that is not a git checkout root is `warn`, since a session started in a subdirectory of it falls back to `auto`. A missing piece is `failed` under `coordinator` and `warn` otherwise. A hook entry not in the form `install` writes is `warn` with its command shown. |
| `cli_version`       | Machine-wide, runs exactly once even under `--all`. Compares the running `konductor` binary's own version against the latest published GitHub release. `warn` severity only when stale - never `failed`, never affects `doctor`'s own exit code. |
| `kiro_cli_version`  | Machine-wide, runs exactly once even under `--all`. Runs `kiro-cli --version` (stopped after 5 seconds) and compares it with the lowest version that `flow run` was checked on. `warn` when the version is lower or cannot be read, `info` when `kiro-cli` is not on `PATH`. Never `failed`, never affects `doctor`'s own exit code. It uses no network, so `--no-version-check` does not skip it. |
| `claude_version`    | The same check for Claude Code: machine-wide, once even under `--all`, runs `claude --version` (stopped after 5 seconds) and compares the first three numbers with the lowest version that `flow run` was checked on. `warn` when it is lower or cannot be read, `info` when `claude` is not on `PATH`, never `failed`, never affects `doctor`'s exit code, and `--no-version-check` does not skip it. |
| `kiro_cli_acp_version` | The check of the Kiro CLI ACP adapter, `kiro-cli acp`. It reads the version of `kiro-cli` (the adapter is a subcommand of it) and compares it with the lowest version that `flow run --harness kiro-cli-acp` was checked on, 3.5.0. Machine-wide, once even under `--all`. `warn` when the version is lower or cannot be read, `info` when `kiro-cli` is not on `PATH`, never `failed`, never affects `doctor`'s exit code, and `--no-version-check` does not skip it. |
| `claude_agent_acp_version` | The same check for the Claude Code ACP adapter. It runs `claude-agent-acp --version` (stopped after 5 seconds) and compares it with the lowest version that `flow run --harness claude-acp` was checked on, 0.108.1. `warn` when it is lower or cannot be read, `info` when `claude-agent-acp` is not on `PATH`, never `failed`, never affects `doctor`'s exit code. |
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
It does not skip the runner rows, `kiro_cli_version`, `claude_version`, `kiro_cli_acp_version` and
`claude_agent_acp_version`, which make no network call.

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

### `--json` error envelope (`install`/`synth`/`doctor`/`flow`)

Distinct from the status report above, `--json` also gates a shared _error_ envelope
on early usage-error paths in `install`, `synth`, `doctor`, and `flow` (and, previously,
`uninstall`/`update`). For `flow` that is every usage error, including a name that matches no file. A failure to find
the current directory
uses `"command": "konductor"`, as it does for the other commands. On a non-zero exit, instead of a plain-text
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

## `flow`

```bash
konductor flow check <name> [--json]
konductor flow show <name> [--json]
konductor flow run <name> [--harness <kiro-cli|claude|kiro-cli-acp|claude-acp|fake>] [--fake-script <path>] [--goal "..."] [--trust <hash>] [--json]
konductor flow trust <name> [--yes]
konductor flow trust --revoke <name>
```

A workflow is a YAML file, `<name>.yml`, that lists the stages of a piece of work and the agent that does each one.
The rules for the file are in [`docs/design/workflows-spec.md`](../docs/design/workflows-spec.md), and
[`workflow-engine/examples/hello-plan.yml`](../workflow-engine/examples/hello-plan.yml) is an example. `flow check`
and `flow show` only read files. `flow run` writes only under `.konductor/`, which it makes if it is missing: the
`runs/` line of `.konductor/.gitignore`, and in `.konductor/runs/` the lock files `lock` and `claim` and one folder per
run. A run refused before that (exit `64` or `65`) writes nothing, and one that the lock refuses (exit `75`) leaves only
those files. `install`, `update` and `uninstall` never write to `.konductor/workflows/`.

A bare `<name>` is looked up in `.konductor/workflows/` of the current directory, then in `~/.konductor/workflows/`.
`flow run` and `flow trust` first find their project root. It walks up from the current directory to the git top
folder (the folder that holds `.git`) and takes the nearest folder that has `.konductor/`. If the git top folder is
`$HOME`, or there is no git folder and the current directory is `$HOME`, it exits `77` without looking for
`.konductor/` or reading anything in the home folder. `HOME` must be set to an absolute path, or it exits `74`. A git
folder with no `.konductor/` up to its top is a usage error (`64`, "no .konductor/ found, run konductor init"). With no
git folder, the current directory is the root. `HOME` is compared by path, after resolving links.
The name follows the pattern `^[a-z0-9][a-z0-9-]{0,63}$`. `library/<name>` names a shipped workflow, and none exist
yet, so it is a usage error.

The text output says which folder the file came from, as in `ok: plan (user, 2 stages)`. When a nearer file exists but
the engine passed over it (a link, a file over the size limit, a file that is not UTF-8 or cannot be read), a note on
stderr says so, and the farther file is used. The JSON report of `flow check`, and the failure report of `flow show`,
name the folder in `scope` (`project` or `user`) and list the files passed over in `skipped`, each with its `scope`
and a `reason` (`link`, `not_regular`, `too_large`, `not_utf8` or `unreadable`). The resolved workflow that `flow show`
prints has neither.

The engine reads a file only if it is a regular UTF-8 file with the expected name, of at most 262144 bytes. A link, a
directory or anything bigger is treated as not there, and a link is never followed.

- `flow check` validates the file and reports every problem with its file, line, column, code and message, and a
  suggestion when it has one. A key that a later release adds is `NOT_SUPPORTED_BY_THIS_BUILD`, and its message says
  it is not supported yet. With `--json` it prints one JSON object with the diagnostics.
- `flow show` prints the resolved workflow as JSON, with the text of each prompt. Keys are sorted, nothing in it is a
  machine path, and the bytes are the same whatever order the keys have in the file. `--json` prints the same
  document and makes a failure JSON as well.

- `flow run` runs the stages in order, each in a fresh session on the harness that `--harness` names. Each session is
  given the stage prompt, and the stage passes when the session exits 0 and its final message ends with a valid
  `KONDUCTOR_RESULT {"status": "success", "outputs": [...]}` line. Otherwise the stage is `blocked` with a reason
  (`RESULT_MISSING`, `RESULT_INVALID`, `RESULT_FAILURE`, `SESSION_FAILED` or `TIMEOUT`), the run is
  `halted`, and the later stages stay `pending`. The harness decides a time-out: a stage is `TIMEOUT` only when its
  session reports that it ran past the 30-minute limit. The time a stage took is recorded for information and never
  blocks a stage that finished. The checks in `intent.accept` are recorded as `deferred`; nothing runs
  them yet. `--goal` sets the goal, at most 2048 characters, and without it the workflow's default goal is used. A
  `--goal` that is empty or only white space is a usage error, and so is a rendered stage prompt over 100 KiB. Each
  stage prints a line such as `stage plan: passed`, and the last line is `run <run-id>: passed` or `halted`. On the
  `fake` harness that line ends with ` (harness: fake, no agent ran)`. With `--json` it prints only the run state,
  which names the harness.

  `--harness` takes `kiro-cli`, `claude`, `kiro-cli-acp`, `claude-acp` or `fake`. Without it, `flow run` uses the one
  runner harness that `~/.konductor/installs` records as installed, whatever the install's target: `kiro-cli-v2` and
  `kiro-v3` mean `kiro-cli`, and `claude` means `claude`. With both installed, or neither, `--harness` is required and
  leaving it out is a usage error (exit `64`). The two ACP harnesses are never a default either, and an adapter that is
  on `PATH` does not count as an installed runner harness. `fake` is for tests (see [the `fake`
  harness](#the-fake-harness-test-only)) and is never a default: it runs no agent and replays the reply, exit status and
  duration that a JSON script gives for each stage. The script is named by `--fake-script <path>` or by
  `KONDUCTOR_FAKE_SCRIPT`, and the flag wins. Without one, `--harness fake` is a usage error. `--fake-script` is left
  out of `--help` because it is for tests. The script format is described in
  [`workflow-engine/adapters/src/fake_harness.rs`](../workflow-engine/adapters/src/fake_harness.rs). A stage whose
  script entry has `wait_for` waits at most the 30-minute stage limit for it, then times out.

  On `kiro-cli`, each stage is one headless session, `kiro-cli chat --no-interactive --agent <id>` with the engine flag
  and the prompt, started in the project root. The agent file says which engine runs it: a file with `allowedTools` is
  Kiro CLI V2 and gets `--v2`, and a file with `permissions.rules` is V3 and gets `--v3`. The runner passes neither
  `--trust-tools` nor `--trust-all-tools`, so the agent file is the one place that says what the session may run without
  asking. The final message is the session's standard output, of which the last 1 MiB is kept. Kiro CLI finds the agent
  by the `name` in the JSON of a file under `.kiro/agents/` (any file name, any subfolder) in the project root and then
  in your home folder, and nowhere else. The summary and the session read that same file, with one lookup and one
  parse. If a stage's agent is in neither, `flow run` exits `64` before the first stage and names the agent,
  `~/.konductor/installs` and the install target that has the agent, if any. A file that is not clearly V2 or V3, two
  files that may be the agent, and a Kiro markdown agent (its tools are not read) fail the same way. A session that ends with an
  exit status other than 0, or cannot start, prints one line on stderr with the stage and the status, and under it the
  last 4 KiB of the session's own standard error, cut to printable text, so that a missing login or an unsupported flag
  shows. That text goes to the terminal only. The run state never holds it, and there is no redaction of secret-looking
  values. A session that passes the stage limit gets a terminate signal for its whole process group, then a kill after
  10 seconds, and its stage is `blocked` with `TIMEOUT`.

  The session is started under `timeout -k 10s <limit> <program> <args>`, with `gtimeout` used where that is the name
  (GNU coreutils on macOS, `brew install coreutils`). Both are looked up on `PATH`, in absolute folders only, and so is `kiro-cli` (also for `doctor`), so a file in
  the project cannot stand in for it: with none found, `flow run` exits `64`. No session starts when the `kill` program
  (`/bin/kill` or `/usr/bin/kill`) is missing. `timeout`
  is the leader of the session's process group and counts the limit itself, so, when `timeout` or `gtimeout` is on
  `PATH`, the limit holds after the owner was killed with SIGKILL. `timeout` does not use `--foreground`, so at the limit it signals the whole group and not only
  the program. With GNU `timeout` the kill after the grace period ends the whole group. With uutils `timeout` (the
  default on Ubuntu 26.04) the group gets the terminate signal, but the kill reaches only the program, so a process the
  session started that ignores the terminate signal can outlive the limit when the owner was killed. While the owner
  lives, it ends the whole group itself. The recorded group number is the process number of `timeout`. When `timeout` ends the session, it
  exits 124 (or 137 after the kill), and the runner reads that as `TIMEOUT` only when its own clock has reached the
  limit, so a program that exits 124 or 137 earlier is a failed session (`SESSION_FAILED`). If neither program is
  found, the session runs directly, `flow run` prints one `warning:` line on stderr at the start, and the limit lasts
  only while the owner does: after a SIGKILL of the owner the session has no limit until the next run ends it.

  On `claude`, each stage is one headless session, `claude -p "<prompt>" --output-format json --agent <id>
  --allowedTools "<rule>,<rule>"`, started in the project root. `--agent` runs the session as the stage's agent, with
  its prompt, model and `tools`, and the `tools` list also caps which tools the session has. The prompt comes right
  after `-p`, so `--allowedTools` cannot take it as a rule. `--allowedTools` gets one rule for each tool in the agent's
  `tools` key, so every tool the agent makes available runs without asking: `Agent(a, b)` becomes `Agent(a),Agent(b)`,
  and `Agent` and `mcp__server__*` pass through. A tool name that holds anything but letters, digits and `_ * : . -`, or
  that starts with `-`, an `Agent()` with no names, and a `tools` key that cannot be read give no `--allowedTools` at
  all, with one line on stderr. So does an agent with no `tools` key (every tool is available and none is approved) and
  an empty list. The runner passes no permission mode and no flag that skips permission checks, so a call that neither
  the flag nor your settings allow is denied, and your settings can still deny a tool in `tools`. The final message is
  the `result` field of the JSON reply. A reply that is not JSON, or has no `result`, gives an empty final message and
  one line on stderr, and the exit status decides: not 0 is `SESSION_FAILED`, and 0 is `RESULT_MISSING`. The runner
  keeps the first 64 KiB and the last 16 MiB of the output. `result` comes before the usage and denied-call fields, so
  when a reply is longer than 16 MiB and has lost its start, a session that exited 0 is read from the first 64 KiB: its
  top-level `result` string is used. If no complete `result` is in that head, the reply reads as above, and the stderr
  line says the output was truncated. A session that exited with another status stays a failure whatever the head holds.
  To go back, set `keep_head_bytes` to 0 in `claude_harness.rs` and drop the head scan. A reply with `"is_error": true`
  is `SESSION_FAILED` whatever the exit status, with its text on stderr. A failed session also shows the last 4 KiB of
  its standard error under the failure line, as on `kiro-cli`. Claude Code looks for `.claude/agents` in the project
  root, in each folder above it up to the git top folder (the nearest wins), and then in your home folder, and the
  catalog that checks the stages looks in the same places and in the same order. If a stage's agent is in none of them,
  `flow run` exits `64` before the first stage, in the same way as on `kiro-cli`, and a Kiro agent file of the same name
  does not count. The catalog finds the agent by its `name`, as Claude Code does (see Trust below).

  `kiro-cli-acp` and `claude-acp` run each stage through an ACP adapter, a program that speaks the Agent Client
  Protocol, version 1, with newline-delimited JSON on its standard input and output. The runner starts one adapter for
  each stage, in the project root and in its own process group, starts a session, sends the stage prompt, and reads the
  agent's message text from the updates. It keeps the last 1 MiB of that text and reads the `KONDUCTOR_RESULT` line from
  it as for the other harnesses. Reasoning and every other update are dropped. The engine installs no adapter:

  - `kiro-cli-acp` runs `kiro-cli acp`, so it needs `kiro-cli` on `PATH` (3.5.0 or later) and a signed-in Kiro CLI. A V2
    agent file gets `--agent <id> --agent-engine v2`, and a V3 file gets `--agent-engine v3` and runs as the session
    mode named by the agent.
  - `claude-acp` runs `claude-agent-acp`, so it needs that program on `PATH` (0.108.1 or later; the npm package is
    `@agentclientprotocol/claude-agent-acp`) and a signed-in Claude Code. It runs agents that are defined in the
    project: the adapter is told to read project settings only, so an agent in your home folder is a usage error (exit
    `64`) before the first stage. The runner sets the permission mode `default` before the first prompt, and a session
    that does not confirm it fails the stage. The settings file of the project, `.claude/settings.json`, is part of the
    tool configuration that the trust hash covers, and a rule in it can still approve a tool without a request, as it
    can on `claude`.

  The agent file is the one source of allow rules that the runner uses. When the adapter asks to use a tool
  (`session/request_permission`), the runner allows it, once, only if a rule of the agent file names that tool: the
  `allowedTools` or `permissions.rules` of a Kiro file, or an item of the `tools` of a Claude file. It picks the option
  by its kind and never one that lasts beyond the request. Any other request is refused, and the stage is `blocked` with
  `SESSION_FAILED`, the tool and the agent file whose rules decided it in the line on stderr, and the run `halted`. Kiro
  sends a request only when its own policy did not allow the tool, and the runner then answers from the agent file
  alone. The rules that Kiro holds in its own stores, and what a user chose to always allow there, are applied by Kiro
  without a request, and they were not verified: a tool that one of them allows can run although the agent file does not
  list it. A session that does not run as the agent the stage names fails the stage, and there is no default agent to
  fall back to. The agent file is read before the adapter starts and again when the stage ends, and a stage during which
  the adapter rewrote it fails, with a line that names the file and says whether it is gone or its content differs. A
  link to an agent file counts as that file, and its target is what is hashed. A rule that the runner cannot read as a
  plain tool name, such as a Kiro rule that is scoped to some commands, allows nothing. So does a tool name that starts
  with `-`, as on `claude`: it could be read as a flag, and no real tool starts with one. A rule that ends in `_*`,
  `/*`, `:*` or `.*`, such as `mcp__server__*`, allows the tools whose names start with what comes before the `*`, and a
  `*` anywhere else allows nothing. The `claude` harness hands such rules to Claude Code, which reads them itself, and
  the ACP runner has no other matcher to follow. At the time limit the runner sends `session/cancel`, waits 10 seconds,
  then ends the adapter's process group as for the CLI harnesses. Only that limit makes a stage `blocked` with
  `TIMEOUT`: any other end of an adapter is `SESSION_FAILED`, even an exit status of 124 or 137, which `timeout` uses.
  Like a CLI session, the adapter starts under `timeout` (or `gtimeout`) where there is one, with a limit set beyond the
  stage limit, the 10 second wait and the grace period, so a limit still ends the group if the owner is killed. Without
  `timeout` the limit lasts only while `flow run` does, and the warning about it is printed for the ACP harnesses too.
  The agent's message text is kept to its last 1 MiB, as the stage result is read from that end. An adapter is looked
  for in the absolute folders of `PATH` only, as `kiro-cli` and `claude` are. One that is not there is a usage error
  (exit `64`) before the first stage, as a missing `kiro-cli` or `claude` is, and there is no fallback to the CLI
  harness. An adapter that serves ACP version 2 only is refused with a message that names the version. A failed stage
  also shows the last 4 KiB of the adapter's standard error under the failure line, cut to printable text, as on the CLI
  harnesses. When the adapter wrote more than 4 KiB, the note says that only the end is shown. A future `flow view` will
  not accept the ACP harness names. For example:

  ```bash
  konductor flow run hello-plan --harness kiro-cli-acp --goal "Create a file named hello.txt that contains hello."
  # stage plan: passed
  # stage implement: passed
  # run 20261118-2223-nmwo1: passed
  ```

  Some Kiro CLI builds rewrite a writable agent file when a session starts: they add an MCP server, tools and allow
  rules to it. The 3.5.0 build this step was checked on does this, for `kiro-cli chat` too. On such a build every
  `kiro-cli-acp` stage fails with the message "the agent file `<path>` of `<id>` changed while the stage ran", because
  the stage ran with permissions that were not the ones you confirmed. The runner detects the rewrite after the stage.
  It cannot prevent it or undo what the stage did. A read-only agent file in a read-only `.kiro/agents` folder
  (`chmod 444` on the files and `chmod 555` on the folder) stops the rewrite, and the run then passes.

  The run state is `.konductor/runs/<run-id>/state.json` under the project root, replaced whole at each change. While a
  session runs the state also holds `session_group`, its process group and the start time of that group's leader, and
  the next state write after the session ends removes it. `flow run` makes sure `.konductor/.gitignore` has the line
  `runs/` (as `init` writes it) and adds it if it is missing, keeping every other line. Only one run is active in a
  workspace: the run holds an OS file lock on `.konductor/runs/lock`, which records the PID of the process that owns it,
  its start time (UTC, to the second) and the run id, and a second `flow run` exits `75` with a message that names that
  PID. The lock ends when its process ends, however it ends, so a run that such a process left `running` reads as
  `halted` on the next start. A session has its own process group, so a Ctrl-C in the terminal, a SIGTERM or a SIGHUP
  reaches the owner and not the session. On `kiro-cli`, on `claude` and on the two ACP harnesses, the owner handles SIGINT, SIGQUIT (Ctrl-\), SIGTERM and SIGHUP while the run is
  active: it prints one line that it is stopping the session, sends the terminate signal to the session's whole group (on an ACP harness, with no `session/cancel` first), waits 10
  seconds, kills what is left, marks the stage `blocked` with `SESSION_FAILED`, writes the run as `halted` and exits `1`,
  the same code as any halted run. There is no separate interrupted status. A second signal while the session is being
  ended is ignored. A signal
  that arrives between two stages starts no further session. A SIGKILL cannot be handled, so it leaves the session
  running until its limit, which `timeout` enforces. If the next `flow run` comes first, it ends the recorded group, if
  it still exists and its leader has the recorded start time, before it marks the old run `halted`, and prints `note:
  Run <id> left a session running in process group <n> (its time limit ends at <time>). It was ended.` The time is the
  deadline that the run state records with the group, in UTC to the second; a state file from before it was recorded
  has no such part. A group whose start time differs is left alone. A group whose leader has ended and left members behind cannot
  be matched to the record, so it is not ended, and it gets a `warning:` line, as does any group that cannot be ended;
  the warning is also shown under `--json`. A group is left without a leader when the owner is dead and a member
  outlives the leader: for example the program exits by itself while it has a background child (any background
  process, not only one that ignores the terminate signal), and `timeout` exits with it. The next run then drops the
  record with a warning, and the child keeps running with no limit. With GNU `timeout` and a live owner the whole group
  is ended. Matching members of such a group is tracked in #388 (https://github.com/aws-solutions/konductor/issues/388). If that run's state cannot be written, the new run still starts, and a
  `warning:` line on stderr, also under `--json`, names the run, which still reads as `running`. A lock that is held but
  whose record cannot be read, or that another start is taking at that moment, also exits `75`. Under `--json` the
  envelope's `code` tells them apart: `already_running` (with `run_id` and `pid`) or `lock_unreadable`.


- `flow trust <name>` shows what the workflow will run and asks you to confirm it. To confirm, you type the first 8
  characters of the trust hash, which the summary shows. A bare `y` does not confirm, so a key pressed before the
  summary was on screen cannot trust a workflow you have not read. On a match it records the workflow's trust hash. On a
  workflow that is already trusted at its current hash it says so and exits 0; `--yes` records it again without the
  summary or the question. `flow trust --revoke <name>` removes the record. On a workflow that needs no trust (see
  below), `flow trust` says so, exits 0 and writes nothing. There is no repo-wide form.

**Trust.** A project workflow runs only after you confirm it, once for each workflow. A user workflow needs no
confirmation, unless the repository has tool configuration files. A headless run loads some of them without asking, and
others can approve a tool or start a program: `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json`,
`.kiro/settings/mcp.json`, and the files under `.kiro/agents/`, `.claude/agents/`, `.claude/commands/`,
`.claude/skills/` and `.claude/hooks/`. Then every workflow run there needs it. Git usually ignores
`.claude/settings.local.json`, but Claude Code loads it, so it counts and an edit to it asks again. `CLAUDE.md` and the
Kiro steering and skill files are text for the model. They start nothing and pre-approve nothing, so they are not
covered. A hook in a settings file is covered by its command line, and the script it runs only when that script is under
`.claude/hooks/`.

The folders searched are the current directory and each folder above it up to the git root, and a git root that is your
home folder does not widen the search. Files that `konductor install` recorded in the repository's
`.konductor/manifest`, with the hash the install gave them and unchanged since, are left out, but only when the install
index in your home folder lists the repository as an install target, and only a markdown file whose front matter is
readable and has none of `hooks`, `mcpServers`, `permissionMode`, `tools`, `allowedTools`, `allowed-tools` or `memory`.
Every other file is counted, whatever the manifest says: the settings and MCP files, the files under `.claude/hooks/`
and `.kiro/agents/`, a script or any other file under the covered folders (a skill can pre-approve a script with
`allowed-tools`), and a markdown file whose front matter has one of those keys or cannot be read. The reason is that the
manifest is a file in the repository, so a repository that is already an install target could ship its own and vouch for
its own hook or script. The install index keeps no hash for each file yet. A hash for each file in the index in your
home folder is the follow-up that lifts this restriction. The list is taken when the run starts and is not read again,
so a stage that edits the manifest cannot hide a file it adds, and the check before each stage counts files by the same
rule.

`flow run` shows the summary and asks on a terminal. The summary has the workflow's name, path and trust hash, each
agent with the tools the runner lets it run without asking (the `allowedTools` of a Kiro agent file, or the `tools` of a
Claude agent file as written there, and for a Claude agent with no `tools` key the line "every tool is available, and
the file's tools key pre-approves none"), the file each definition came from, each `run` check command, and every file
the hash covers. Under a settings file it names the top-level keys, and under an MCP file each server with the command
it starts or the address it connects to. An agent file can also set keys that change what runs and that this build does
not read: `hooks`, `mcpServers`, `permissionMode`, `memory` (Claude Code), and `permissions`, `includeMcpJson`,
`useLegacyMcpJson`, `toolsSettings` (Kiro CLI). When one is present the summary names the key, never its value, on an
"also sets" line. A Claude agent file whose front matter has a line that is not a plain `key:`, such as a quoted key or
a space before the colon, is shown as unreadable, because a key could hide in it.

A `tools` list that this build cannot read in full is shown as `tools: unreadable` with the reason, for example an item
such as `Bash(git status)`, a quoted item in a `[...]` list, or an indented line after a `tools:` value that has text on
its own line. A list with the item `*` grants every tool and is shown as `*` alone, and an empty list pre-approves no
tool. A Claude agent file with a `memory` key and a `tools` list is shown as unreadable too, unless the `memory` value
is a plain word that is not `user`, `project` or `local`, because Claude Code gives that agent Read, Write and Edit
besides the list. The rules for each form are in [the engine
README](../workflow-engine/README.md#reading-agent-definitions). None of this changes the trust hash.

The agent is looked for in the current directory, then the folders above it up to the git root, then your home folder,
for Kiro CLI and for Claude Code. The first folder that has a file for the id wins, so a file in the repository beats
one in your home folder.

For `flow run` on `kiro-cli`, the summary, the check for an ambiguous agent and the session all use one search: the
project root, then your home folder, and nowhere else, because that is where Kiro CLI looks. The first of the two that
has the agent wins, so a file in the project root beats one in your home folder. The summary shows that file, and the
session runs it, so a file of the same name in a folder between your current directory and the project root, or above
the project root, is not shown and does not run. The engine (V2 or V3) is read from the shape of the one JSON file that
declares the agent. A Kiro markdown agent, two files that declare the id, or a file this build cannot read leave the
engine unclear, and `flow run` exits `64` before the first stage. So does a V2-style file (an `allowedTools` list) in a
subfolder of `.kiro/agents`, because Kiro 2 loads only the top-level files: move it up, or give it V3 `permissions.rules`
(Kiro 3 loads JSON files in subfolders). With `--harness fake`, and for `flow check`, the summary uses the search from
the current folder up to the git root. `flow trust` uses the Kiro search when the install index records only Kiro as a runner. In every other case (no
index, only `claude`, both runners, or neither) it uses the search from the current folder, and it compares, for every
agent of the workflow, the file that search finds with the file Kiro finds, because a later `flow run --harness
kiro-cli` needs no install record and runs the Kiro file under the same trust hash. If they differ, or either is
ambiguous, `flow trust` exits `77` with `tool_config_unreadable` and names both files and records
nothing, because the nearest file is not a superset of the files Kiro could run.

For `flow run` on `claude`, the summary, the check for an ambiguous agent and the session use one search, the one Claude
Code makes: the project root, each folder above it up to the git top folder (the nearest wins), then your home folder.
The hash scan starts at your current folder. If the search from your current folder would pick a different file for a
stage's agent, `flow run` exits `77` with the code `tool_config_unreadable` and names the agent. `flow trust` has no
`--harness`, and `flow run --harness claude` needs no install record, so whatever `~/.konductor/installs` says, `flow
trust` compares the search that built its summary with the Claude search, unless it is the Claude search, and refuses to
record a file that a Claude run would not read. The two are compared by the file they pick, not by the label they show,
so an agent that only the project root has is not refused when you start in a folder below it.

Kiro identifies an agent by the `name` in its JSON, not by the file name: the agent is the `.kiro/agents/**/*.json`
file, in a subfolder too, whose `name` is the id (a string). Kiro 3 also loads `.md` files at any depth under
`.kiro/agents/`, with the id in the front matter `name` or the file stem, and this build shows such an agent with
unknown tools. Kiro ends the front matter at the first line that starts with `---`, so a `---` inside a line does not
hide the `name`. A markdown file with no front matter block, such as the prompt file of a JSON agent, is not an agent
and is not a second declaration. Kiro loads files that a strict JSON reader refuses, such
as a trailing comma, comments, a repeated key, deep nesting or a byte that is not UTF-8. This build never shows the
tools of a file it cannot read as JSON, but when the text of such a file mentions the id, the agent is ambiguous,
whatever the file is called. So is a file named `<id>.json` with no `name`, because Kiro then takes the file name for
the id. A file that is unreadable and named `<id>.json` is shown as unreadable, and other files are not looked at. Two
files that declare the id make the agent unknown.

Claude Code identifies an agent by the exact `name` in the front matter of the `.md` files under `.claude/agents/` and
its subfolders (a link to a regular file counts as that file), with no trimming and no case folding. A file with no
front matter or no `name` is not an agent, and a plain name that is another agent blocks nothing. When the front matter
cannot be read in full, or its `name` is in a form this build does not follow (an alias, a backslash escape, a tab
before a comment), the file is an unreadable candidate if the id appears where a `name` key may be. The forms and their
rules are in [the engine README](../workflow-engine/README.md#reading-agent-definitions).

In the nearest folder that has the id, two files that declare it, or a Claude file that declares it under a name other
than `<id>.md`, make the agent unknown: `flow run` and `flow trust` exit `77` with the code `tool_config_unreadable` and
name the agent, whatever `--trust` or `--yes` says, while `flow check` still prints the hash. A file that declares
another name blocks nothing.

Some tool configuration cannot be hashed from its content, and each of these is refused with its path and the cause: a
link to a folder, or a link that leads nowhere, anywhere in the covered files and folders, and a link in place of a
folder above one of them (`.claude` or `.kiro` itself); a covered folder (`.kiro/agents`, `.claude/agents`,
`.claude/commands`, `.claude/skills` or `.claude/hooks`) with more than 512 files and folders together; a folder nested
more than 4 levels below one of them; a file over 1 MiB, or one that cannot be read; more than 16 MiB of files in all,
over every folder searched; and a name that is not UTF-8. A link to a regular file is not refused: it is read as a file,
its target bytes are hashed and its own path is part of the hash. The limits are not raised and no file is exempt from
them, because a larger scan or an exemption would shrink what the hash covers. A change behind a refused entry would not
show in the hash, so `flow run` and `flow trust` exit `77` and name the entry and the cause, and `--trust` and `--yes`
do not override that. Remove the link, reduce the folder or make the file readable. A known limit: a link to a folder
under `.claude/skills`, such as `.claude/skills/foo -> ../../.agents/skills/foo`, is refused too. Under `--json` the
`code` of that refusal is `tool_config_unreadable`. Such a repository has no trust hash: `flow check` prints
`trust hash: none` followed by each entry and its cause, and its `--json` report leaves `trust_hash` out and lists the
entries as `unreadable_config`, each with a `path` and a `reason`. A prompt file that cannot be read is a workflow
error instead, and exits `65`.

`--trust` and `KONDUCTOR_TRUST` are ignored when the workflow needs no trust.

Without a terminal, an untrusted workflow exits `77` and names the two ways to go on: `konductor flow trust <name>` in a
terminal, or `--trust <hash>` (also `KONDUCTOR_TRUST=<hash>`). The hash must equal the current trust hash, which
`flow check` prints (`trust hash:` in the text, `trust_hash` with `--json`). It permits that one run and records
nothing. A hash that does not match exits `77` and prints both hashes. The refusal for a run with no terminal does not
carry the hash, in text or under `--json`. Pass the hash of a version you reviewed. Do not set `KONDUCTOR_TRUST` from a
file that the repository controls, such as `.envrc`, a Makefile or a CI file in the repository, and do not work the hash
out in the script that runs the workflow, because then whoever writes the repository chooses what is trusted.

What the trust record does not protect against: `flow trust --yes` records trust with no terminal and no summary, so any
process that runs as you, such as a stage session, a hook of a repository or a script from a checkout you do not trust,
can grant trust that way. Any such process can also edit `~/.konductor/trust.json`, which has no integrity protection
beyond its file mode. The tool configuration is checked again before each stage starts, but not after the last stage,
and not while a session runs, so a change made by the last stage shows only at the next `flow run`, and a change made
between the scan and the start of the harness is not seen.

The trust hash is a SHA-256 over the bytes of the workflow file, of every `prompt_file` it names, and of the tool
configuration files, written as 64 lowercase hex digits. Each file is a frame of a kind byte, the length of its path as
8 bytes (big endian), the path, the length of its content as 8 bytes, and the content, after the tag `konductor-trust/1`
and a newline. The frames are the workflow (empty path), then the prompt files sorted by path, then the tool
configuration files sorted by path. A file that cannot be read has no frame, because it has no hash. The exact layout is
in [`workflow-engine/core/src/trust.rs`](../workflow-engine/core/src/trust.rs). The hash is made from the bytes the
loader parsed, so a workflow or prompt file edited after you confirmed it does not run: the run uses the bytes that were
hashed. The tool configuration files are read again before the session of each stage starts. If their hash is no longer
the one you confirmed, the stage does not start, the run halts with exit `1` and the stage reads `SESSION_FAILED`, and
the message names the first path that changed or cannot be read, and why. When the run needed no confirmation, it says
the files changed since the run started. The run state has no field for a cause, so the message is where it is shown.
So an edit made while the summary was on screen, or by an earlier stage, does not take effect under the old
confirmation.

The record is `~/.konductor/trust.json` (mode 0600), keyed by the canonical path of the git root and the workflow name.
`~/.konductor` is made with mode 0700 if it is missing. `HOME` must be an absolute path. A relative one counts as no
home folder, so nothing is trusted or recorded, and `flow trust` and `flow trust --revoke` exit `74`. The git root is
the one the tool configuration scan uses (a git root equal to your home folder does not count); with no git root the key
is the current directory. A run from a subfolder and a run from the root share one record. So do two workflows of the
same name under one git root, such as `plan` in two packages of a monorepo: trusting one replaces the hash of the other,
and each asks again when you switch. Give them different names to avoid that. The record is written to a temporary file
and renamed, under a lock. A record that cannot be read trusts nothing, and one malformed entry does not hide the
others. A record that is not valid JSON, or comes from a newer Konductor, is never replaced: `flow trust` and `flow
trust --revoke` exit `74` and name the file. Move the file aside to start a new record. `flow check` and `flow show`
never need trust.

Exit codes: `0` when the workflow has no errors (for `flow run`, when the run passed), `1` when a run halted, `64` for a
usage error (a bad name, `library/<name>`, a name that matches no file, a bad `flow run` input, no `--harness` when
none or both runner harnesses are installed, or a stage agent that the harness cannot see),
`65` when the workflow has errors, `74` when the trust record cannot be kept or changed (no usable home folder, a file
error, or a record that is damaged or from a newer Konductor; a record that cannot be read only trusts nothing), or when
`flow run` or `flow trust` needs `HOME` and it is unset or not an absolute path, `75` when the workspace lock refuses
the run, and `77` when the workflow is not trusted and you did not confirm it, there was no terminal, or `--trust` did
not match, or when the project root would be the home folder.


### The `fake` harness (test-only)

`--harness fake` runs no agent. It replays a JSON script, so a run on it can pass or halt without doing any work. It
exists for tests of the runner and of `flow run`, and the last line of such a run says so. Do not use it to do real work.

The script is named by `--fake-script <path>` or by `KONDUCTOR_FAKE_SCRIPT`, and the flag wins. Without one,
`--harness fake` is a usage error. `--fake-script` is left out of `--help` because it is for tests. For each stage the
script gives the reply, the exit status and the duration the session pretends to have, and the format is described in
[`workflow-engine/adapters/src/fake_harness.rs`](../workflow-engine/adapters/src/fake_harness.rs). A duration past the
30-minute stage limit makes the fake report that the session timed out. A stage whose script entry has `wait_for` waits
at most the 30-minute stage limit for it, then reports a time-out in the same way.

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

The session keys it reads come from `gate_facts` in the same file: `gate_<phase>_result`,
`gate_<phase>_evidence`, `gate_<phase>_checker`, and `gate_<phase>_override` for each boundary, and
`run.data.max_fix_cycles` for the fix-cycle cap. `k-full-sdlc`'s Progress Tracking section says
when it writes each one, and `make sop-orchestration-check` fails when a gated SOP stops naming
the keys of its boundaries.

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
| V4 | A gate phase is `COMPLETED` (per registered feature for a feature gate) with no `gate_<phase>_result`, an approval result other than `approved`, or no `gate_<phase>_evidence` naming a file inside the root | `GATE_MISSING`, `APPROVAL_MISSING`, `EVIDENCE_MISSING` | 65 |
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
- The mode applies to `konductor` and to any installed agent that loads the `k-direct-work.md`
  context, so a fork or custom distribution that renames the orchestrator keeps the mode. On Kiro
  CLI v2 that agent's own file gets the `agentSpawn` entry, and `doctor` checks the entry in every
  such file. An agent that loads the routing rules instead, like the mux and cmux orchestrators,
  always coordinates and gets no mode line.
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
- When it cannot apply `coordinator` to a session of a mode agent (`konductor`, or any agent that
  loads `k-direct-work.md`), it prints one line, `Orchestration: auto (fallback: <reason>)`, and
  the session runs as `auto`. The reasons: unset `HOME` on Claude Code or Kiro CLI v2, an
  unreadable or unparsable config file, an unknown value, a missing rules file, or an install
  outside the locations above. An agent file over 1 MiB, which the hook cannot check for
  `k-direct-work.md`, gets the same line.
- The first reply of every mode agent session states the mode: the hook's line, or
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
  | 1 | Halted (timeout / runtime error / parse error) - reused by `doctor` for "at least one check failed/stale", by `verify-run` for a blocked phase, and by `flow run` for a run that halted |
  | 2 | Unresolved finding at or above the effective severity threshold, from the gate evaluator; the CI-failing signal (**never** used for usage errors). Phase-gated SOPs never judge laxer than HIGH. Emitted by `verify-run` |
  | 3 | Fix-cycle budget exceeded: a recorded count is above `run.data.max_fix_cycles` (default 2 when the session records none; the evaluator notes that default). Emitted by `verify-run` |
  | 4 | User aborted a paused verdict |
  | 5 | Reserved, not yet emitted by any command. |
  | 6 | Success with warnings: `uninstall` when an otherwise-successful run could not remove a tracked `--link-bin` symlink; `verify-run` when a run completed with a skipped gate |
  | 64 | CLI usage error (`EX_USAGE`) - never the reserved code `2`. For `verify-run`, argument problems only, including a `--root` that is not a directory or a `--max-fix-cycles` that is not a non-negative integer |
  | 65 | Content or integrity failure, distinct from a `64` usage error: an unsupported manifest/index `schema_version`, a failed checksum, or, for a SOP session file, a corrupt or invalid session, a broken record (including a non-integer `max_fix_cycles` or counter, a recorded `max_fix_cycles` above a pinned cap (`CAP_RAISED`), or a wrong-typed gate fact), phase order (a started or completed phase after an earlier phase that is still `PENDING` or `IN_PROGRESS`, unless that earlier per-feature phase is held open by a feature, which exits `1`), an unfinished phase or an unexplained skip, missing gate facts or evidence, or, reported last and only when nothing else fired, an in-progress session without `--allow-running`. Also the workflow has errors (`flow check`, `flow show`, `flow run`) |
  | 74 | The trust record cannot be kept or changed (`flow run`, `flow trust`, `EX_IOERR`): no usable home folder, a file error, or a record that is damaged or from a newer Konductor. Also `flow run` or `flow trust` when `HOME` is unset or not an absolute path; under `--json` the `code` is then `home_unusable`. Nothing ran |
  | 75 | The workspace lock refuses the run (`flow run`, `EX_TEMPFAIL`): another run is active, the lock cannot be read, or other starts were taking it. Try again later |
  | 77 | Trust refusal (`flow run`, `flow trust`): the workflow is not trusted and you said no, no terminal was available, `--trust` did not match, or the repository's tool configuration cannot be read in full. Also a project root that is the home folder: the git top folder is `$HOME`, or there is no git folder and the working folder is `$HOME`; under `--json` the `code` is then `project_root_is_home` |

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
  - `flow check` and `flow show` reading workflow files through the `workflow-engine/` crates
  - `flow run` running a workflow on `kiro-cli` (Kiro CLI V2 and V3), on `claude` (Claude Code), through the ACP
    adapters of those two (`kiro-cli-acp` and `claude-acp`), or on the `fake` harness, which is for tests,
    with its run state in `.konductor/runs/` and one run at a time per workspace
  - `verify-run` checking a SOP session file against its gate boundaries and
    reporting one exit code, including exit code 2 for an unresolved gating finding
  - `metrics` reporting local token and credit usage of Konductor sessions per harness
- **Not yet started:** the run-engine/conductor (which will read/write
  `.konductor/run-state.json`-shaped documents).

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
- `metrics`: Kiro session formats are undocumented, Claude Code
  subagent output tokens are not reported (their transcripts hold placeholder values),
  and Kiro v3 subagent credits are not split from the parent session (whether the parent
  includes them is still being verified, see #289).
- `update` and `uninstall` have no same-target concurrency protection: running two
  `konductor` invocations against the same target directory at once is unsupported and
  can corrupt the manifest, index, or on-disk files. Serialize invocations per target.
- `doctor` does not check Claude Code-specific environment state, compare installed
  vs. available versions, or validate metrics/gate-tier data (no supporting mechanism
  exists in-repo yet for the latter two).
