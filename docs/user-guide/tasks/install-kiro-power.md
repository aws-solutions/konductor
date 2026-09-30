<!-- SPDX-License-Identifier: Apache-2.0 -->

# Install via Kiro Power

[← Task guides](README.md) · [Guide index](../README.md)

A [Power](https://kiro.dev/docs/powers/) is Kiro's distributable, keyword-activated install
unit, and this repository ships one at [`powers/konductor/`](../../../powers/konductor/). This
page covers the third way to get Konductor running, alongside
[Install for Kiro CLI](install-kiro-cli.md) and [Install for Claude Code](install-claude-code.md),
for anyone already working inside Kiro IDE or Kiro CLI's v3 engine who would rather click
"Install" than run commands by hand.

**Time required:** about 2 minutes on a supported platform (Linux x86_64/aarch64, or Apple
Silicon), longer on Intel Mac, where the Power builds `konductor` from source instead of
downloading it.

Unlike the other two install paths, you do not type `konductor install` yourself here. This
Power's onboarding skill (`konductor-setup`) runs the equivalent commands for you, inside
whichever project you invoke it in, after showing you the exact plan and getting one
confirmation.

---

## Prerequisites

| Requirement | Verify with | Notes |
| --- | --- | --- |
| Kiro IDE, or Kiro CLI on the v3 engine | N/A | Powers only run on Kiro's v3 engine and the unified Kiro IDE that shares it, never `kiro-cli-v2`. |
| `curl` | `curl --version` | Used to download the pinned `konductor` binary and its checksum sidecar. |
| `jq` | `jq --version` | Used internally to read this Power's own pinned version out of `plugin.json`. |
| `git` | `git --version` | Only needed on the Intel Mac fallback, to clone the repository. |
| A Rust toolchain (`cargo`) | `cargo --version` | Only needed on Intel Mac (`x86_64-apple-darwin`): no binary is published for that platform, so this Power builds one locally. |

---

## Step 1: Add the Power

1. Open the Powers panel in Kiro (the lightning-bolt icon) and choose **Add Custom Power**.
2. Choose **Import power from GitHub**.
3. Enter `https://github.com/aws-solutions/konductor/tree/main/powers/konductor`.
   [`powers/konductor/`](../../../powers/konductor/) on `main` already has `plugin.json` at its
   own root and `skills/` alongside it, the flat shape Kiro's GitHub import expects, so there is
   no separate branch or build step to wait on.
4. Choose **Install**.

Installing only registers the Power's manifest; nothing runs yet.

> **Cloned the repository directly instead?** Point Kiro's **Import power from a folder** option
> at your local `powers/konductor/` directory rather than using a GitHub URL. No build step is
> needed there either, since that directory is already the importable tree. If you've just
> edited [`scripts/kiro-power.template.json`](../../../scripts/kiro-power.template.json) or
> bumped `VERSION`, run `make kiro-power` first (see [`Makefile`](../../../Makefile)) to
> re-render `powers/konductor/plugin.json` before importing from a folder.

---

## Step 2: Try the Power

Either say "konductor", "install konductor", or "set up konductor" in a chat session, or use the
**Try power** action in the installed Powers list. Both trigger the same onboarding skill,
`konductor-setup`.

### The consent prompt

Before anything is downloaded or written, the skill states the plan in plain language and waits
for one explicit confirmation:

- Your detected platform, and which install path that implies: download a verified binary,
  build from source, or "not supported natively, use WSL."
- The exact GitHub repository and release tag it will fetch: **this Power's own pinned
  version** (a `v`-prefixed tag read from its `plugin.json`, e.g. `v1.0.0`) from the default
  repository (`aws-solutions/konductor`). Never "whatever is newest on GitHub," and never a
  different repository or tag unless you have explicitly said to use one.
- Where files land: the `konductor` binary symlinked to `~/.local/bin/konductor`, and agents,
  skills, and SOPs under the current project directory, never `$HOME`.
- That installing enables Konductor's usage telemetry for this project by default. See
  "Telemetry" below.

Nothing is fetched or written before you answer that one prompt. Once you confirm, the rest of
the flow runs without asking again.

### What gets downloaded and verified

On a supported platform, the skill downloads the pinned release's `konductor-<tag>-<triple>`
binary plus its `.sha256` sidecar directly from a GitHub release asset URL, and refuses to run
or link the binary until the checksum matches. This is SHA-256 transport-integrity verification
only: it proves the downloaded bytes match what was published alongside them, not that the
publisher's account was never compromised. There is no GPG or sigstore signature check on these
release assets today.

### The install itself

After the binary is verified (or built) and symlinked onto your `PATH`, the skill runs, in your
current project directory:

```bash
konductor install --harness kiro-v3 --target <current-project-dir> --version <pinned-tag>
```

`--target` is always the project you invoked the Power in; this flow never installs to
`install`'s own `$HOME` default. `--harness kiro-v3` is not a per-run choice: Powers only run on
Kiro CLI's v3 engine and the unified Kiro IDE, so it is always the right harness here.

### Verifying with `doctor`

The skill finishes by running:

```bash
konductor doctor --target <current-project-dir>
```

and showing you all **nine** checks: `source`, `runtime`, `manifest`, `config`,
`container_runtime`, `index_status`, `telemetry_state`, `cli_version`, and `content_version`,
each reported as `ok`/`info`/`warn`/`failed`/`stale`. `telemetry_state` reports whether telemetry
reporting is effectively on for this target; see [FAQ](../faq.md) and the root
[README.md](../../../README.md#data-collection) for what is and is not collected. If
`doctor` reports a `failed` or `stale` check, the skill stops and shows you exactly what it
printed. It does not retry silently or move on.

### Telemetry

Installing enables Konductor's usage telemetry for this project **by default**; the consent
prompt above says so before anything is written. If you decline, the skill passes
`--no-telemetry` to the underlying `konductor install` call. Running the flow directly rather
than through chat, add the same flag yourself:

```bash
konductor install --harness kiro-v3 --target <current-project-dir> --version <pinned-tag> \
  --no-telemetry
```

To switch telemetry off later, after an install already happened without `--no-telemetry`:

- **`KONDUCTOR_TELEMETRY=off`** as an environment variable: a fleet-wide override that takes
  priority over everything below it.
- **`telemetry:` `enabled: false`** in `<your-project>/.konductor/config.yml`: scoped to that
  one project, and it survives a later `konductor install`/`update` run, since neither command
  writes to `config.yml`, so nothing re-enables it behind your back.
- **`telemetry_consent: false`** in `~/.konductor/telemetry.json`: machine-wide, disabling
  reporting for every project on that machine, not just this one.

`konductor doctor`'s `telemetry_state` check does **not** currently reflect a project's own
`config.yml` opt-out. It only reads the per-target install record and the machine-wide file
above. If you set `telemetry.enabled: false` in `config.yml` and then run `doctor`, the result
may not mention it either way; that is a known gap in `telemetry_state` itself, not a sign the
opt-out failed to take effect.

See the root [README.md](../../../README.md#data-collection) for what is actually collected.

---

## What success looks like

- [ ] The Powers panel shows Konductor as installed.
- [ ] `konductor doctor --target <your-project>` reports every check `ok`/`info`/`warn` and exits
      `0`.
- [ ] Starting a Kiro session in that project offers the `konductor` and `k-*` agents.

If installation ran but a check came back `failed` or `stale`, read that specific check's `fix:`
line rather than treating the run as one undifferentiated failure. See
[Troubleshooting](#troubleshooting) below.

---

## Supported platforms

| Platform | What happens |
| --- | --- |
| Linux x86_64 | Downloads and checksum-verifies a prebuilt binary. |
| Linux aarch64 | Downloads and checksum-verifies a prebuilt binary. |
| macOS, Apple Silicon (`arm64`) | Downloads and checksum-verifies a prebuilt binary. |
| macOS, Intel (`x86_64-apple-darwin`) | No binary is published for this platform. The Power clones `aws-solutions/konductor` at the pinned tag and runs `make build` instead; this needs a Rust toolchain (`cargo`) on `PATH`. If one is not found, the flow stops with a message pointing at <https://rustup.rs> rather than installing one for you. |
| Windows (native) | **Not supported in v1.** The skill detects this via `uname -s`'s `MINGW`/`MSYS`/`CYGWIN` prefix and stops with a message pointing at WSL. Under WSL, `uname -s` reports `Linux` and the normal Linux path above applies. |

---

## Updating

Upgrade only when `doctor`'s `content_version` check reports the target's installed content as
behind current (a separate signal from `cli_version`, which tracks the `konductor` binary
itself). From the Powers panel, choose **Check for updates**, then **Install updates**; in chat,
this runs:

```bash
konductor update --target <your-project>
```

Always against an explicit `--target`, never a bare `konductor update`: a project where you have
tried this Power more than once has more than one entry in `~/.konductor/installs`, and the CLI
treats a bare invocation against two or more tracked installs as a usage error. In chat, the
Power's own `scripts/run-update.sh` goes one step further for exactly this multi-project case.
The `konductor` binary symlinked onto `PATH` is shared by every project this Power has ever
onboarded, so before running `update` it verifies that shared binary still matches THIS target's
own recorded CLI binary, falling back to this target's own cached binary, or refusing outright,
rather than risk running a mismatched CLI binary against this target.

That per-target record lives in `<target>/.konductor/power-cli.json`, this Power's own file,
separate from the CLI's own `<target>/.konductor/install-info.json`. The two track genuinely
independent things: `install-info.json`'s `agent_version` is the installed **content**'s own
version (agents/skills/SOPs), while `power-cli.json`'s `cli_version` is the **CLI binary**'s own
version. `konductor update --version <tag>` (the content-only override `run-update.sh` also
accepts) changes only the former, on whichever CLI binary is already correct, and never touches
the latter. `run-update.sh` refreshes `power-cli.json` after each successful run so it always
reflects the exact binary that actually ran.

Like every `update`, this **overwrites** the target's agents, skills, and SOPs unconditionally:
any local edit under the managed destinations is destroyed. See [Update an installation](update.md)
for the full behavior, including `--dry-run` to preview what would be clobbered.

---

## Uninstalling

```bash
konductor uninstall --target <your-project> --dry-run
```

Review what that reports, then run it again without `--dry-run` to actually remove the files.
This is always a separate, explicitly confirmed step, never bundled into a "start over" action
that also reinstalls. In chat, the Power's own onboarding skill enforces that separation
mechanically: its `scripts/run-uninstall.sh` requires a distinct `--confirmed` flag before a real
removal runs (`--dry-run` itself is never gated, since it never touches the filesystem). The
skill always shows you the dry-run list and gets an explicit yes before passing it.

A real removal also deletes this target's own `<your-project>/.konductor/power-cli.json`, the
Power's own per-target record of which CLI binary it uses (see "Updating" above), since
`konductor uninstall` has no knowledge of that file at all. `--dry-run` leaves it untouched, like
everything else. Uninstalling leaves your project configuration (`.konductor/config.yml`) alone;
see [Uninstall](uninstall.md) for what is and is not removed, and how to clear everything.

---

## MCP servers: bring your own

Two agent specs declare MCP servers: `aws-mcp` on `k-architect` and `k-developer`, and
`playwright-mcp` on `k-browser`. **Neither is wired up automatically for Kiro today.**
`konductor synth`'s Kiro output (both `kiro-cli-v2` and `kiro-v3`, so this applies the same way
whether you install via this Power or directly) does not read `dependencies.mcpRegistry` at all;
that field is only rendered into agent frontmatter for the Claude Code harness. Installing via
this Power does not start either server, regardless of platform.

- **`playwright-mcp`** is bring-your-own by design, and that is not expected to change: the
  Power installs no browser binaries or MCP servers of its own.
- **`aws-mcp`**, the [Agent Toolkit for AWS](https://github.com/aws/agent-toolkit-for-aws)'s
  managed AWS MCP server, needs configuring yourself in the meantime if `k-architect` or
  `k-developer` needs AWS documentation lookups.

Configure both by hand in an `mcp.json`, at either scope:

| Scope | Path | Applies to |
| --- | --- | --- |
| Workspace | `.kiro/settings/mcp.json` | Only the project you place it in |
| User (global) | `~/.kiro/settings/mcp.json` | Every workspace |

If both files define the same server name, the workspace entry wins. Use the exact server key
below: `aws-mcp`, matching the toolkit's own getting-started page. It has to match the bare
`@aws-mcp` server grant the agent specs already declare
(`agents/k-architect.agent-spec.json`, `agents/k-developer.agent-spec.json`), or the tool grant
resolves to nothing; `playwright-mcp` matches `agents/k-browser.agent-spec.json`'s own
`@playwright-mcp` reference the same way. The block below is copied verbatim from the [Agent
Toolkit for AWS](https://github.com/aws/agent-toolkit-for-aws)'s own recommended Kiro
config; that project, not this one, is the upstream source of truth for this server's key,
package, and args:

```json
{
  "mcpServers": {
    "aws-mcp": {
      "command": "uvx",
      "args": [
        "mcp-proxy-for-aws-cli@latest",
        "https://aws-mcp.us-east-1.api.aws/mcp",
        "--metadata",
        "AWS_REGION=us-east-1"
      ]
    },
    "playwright-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@playwright/mcp@latest",
        "--output-dir",
        "browser-output"
      ]
    }
  }
}
```

`aws-mcp` needs `uvx` on `PATH` (installed via [`uv`](https://docs.astral.sh/uv/)) plus AWS
credentials: `~/.aws/credentials` or environment variables. Both `k-architect` and
`k-developer` work without credentials, just without AWS lookups. `playwright-mcp` needs the
Chromium binary:

```bash
npx playwright install chromium
```

MCP support has to be turned on in Kiro's settings, and a saved `mcp.json` takes effect the next
time you save it: no restart required.

**All eight AWS MCP tools are granted; five are pre-approved, three prompt.**
`k-architect`/`k-developer`'s own `clientConfig.kiroCli.tools` lists a bare `@aws-mcp` entry
(verified directly against `agents/k-architect.agent-spec.json` and
`agents/k-developer.agent-spec.json`), which is a whole-server collection grant covering every
tool the server exposes, not just a named subset. `allowedTools` then pre-approves five of them
by name: `aws___search_documentation`, `aws___retrieve_skill`, `aws___read_documentation`,
`aws___list_regions`, `aws___get_regional_availability`. Those run with no confirmation
prompt. The remaining three, `aws___run_script`, `aws___get_presigned_url`, `aws___get_tasks`,
are already reachable through that same `@aws-mcp` entry in `tools`; they are not unreachable and
nothing needs adding to the agent spec to use them, they simply are not pre-approved, so each one
prompts for confirmation on first use. There is no `aws___call_aws` tool at all on this
server; don't invent one if asked. Once granted, the request still runs under your own IAM
credentials. Use the `aws:ViaAWSMCPService` (boolean) and `aws:CalledViaAWSMCP` (string,
`aws-mcp.amazonaws.com` for this server) global IAM condition keys to scope or audit what an
agent can do through the MCP server specifically; see [Understanding IAM for managed AWS MCP
servers](https://aws.amazon.com/blogs/security/understanding-iam-for-managed-aws-mcp-servers/).

**Alternative for Kiro CLI 2.11+:** `kiro-cli mcp add --name aws-mcp --url
https://aws-mcp.us-east-1.api.aws/mcp` connects directly over OAuth, with no local `uvx`
process. The `--name aws-mcp` here matches the agent specs' own `@aws-mcp/aws___<tool>` grants
directly, so there's no key mismatch to work around. See the toolkit's [Setting up the AWS MCP
Server](https://docs.aws.amazon.com/agent-toolkit/latest/userguide/getting-started-aws-mcp-server.html)
guide (also covers `npx skills add aws/agent-toolkit-for-aws/skills` for the toolkit's own
skills, a separate, opt-in skill catalog from this Power's own `konductor-setup`/
`konductor-help`, installable alongside them with no conflict).

---

## Troubleshooting

### Checksum failure

```text
error: checksum verification failed for konductor-v1.0.0-x86_64-unknown-linux-musl -- the
download may be corrupted or tampered with. Not installing.
```

**Cause.** The downloaded binary does not match its own published `.sha256` sidecar, usually a
corrupted download, occasionally a mid-transfer network issue.

**Fix.** Re-run the Try-power action. Every re-run re-downloads and re-verifies from scratch, so
a transient corruption on one attempt does not persist. If it fails the same way repeatedly on a
stable connection, treat that as worth reporting rather than retrying indefinitely.

### Tag not found

```text
error: release v1.0.0 of aws-solutions/konductor does not publish a
'konductor-v1.0.0-x86_64-unknown-linux-musl' asset (the release tag may not exist, or no binary
is published for x86_64-unknown-linux-musl on this release). Not retrying against 'latest'.
```

**Cause.** This Power's own `plugin.json` names a version whose matching GitHub release tag
(`v<version>`) does not actually exist, or does not carry the expected asset. The skill never
falls back to "latest" here, since that would install a version this Power was never validated
against.

**Fix.** Check the repository's release list for the tag the error names. If you are running the
underlying scripts directly rather than through the chat skill, `KONDUCTOR_POWER_VERSION=<x.y.z>`
overrides the version read from `plugin.json`; `--tag <v...>` on `run-onboarding.sh` takes
precedence over it if both are given. Either override is a deviation from `plugin.json`'s own
default and is treated the same way a non-default `--repo` is: `run-onboarding.sh` refuses to
proceed unless `--allow-non-default-repo` is also passed, after printing exactly what it would
fetch instead. Only pass that flag once you, the person running these scripts directly, have
confirmed the override tag is the one you actually intend; the chat skill applies this same rule
before ever adding the flag on your behalf.

### GitHub API rate limit (403)

The onboarding flow's install step (`konductor install --harness kiro-v3 --target <dir>
--version <tag>`) resolves that release by hitting `api.github.com`, which is subject to
GitHub's normal unauthenticated rate limit, more likely to bite on a shared IP (a corporate NAT,
a CI runner) than on a home connection. `konductor update`'s own call hits the same API and can
hit the same limit.

**Fix.** `scripts/run-onboarding.sh` and `scripts/run-update.sh` both accept `--use-github-token`,
which reads `GITHUB_TOKEN` from your environment and forwards it to the underlying `konductor
install`/`update` call's own `--use-github-token` flag:

```bash
GITHUB_TOKEN=<your token> scripts/run-onboarding.sh --target <current-project-dir> --confirmed \
  --use-github-token
```

If you hit this through the chat skill, say a `GITHUB_TOKEN` will be sent before it retries with
this flag; `konductor-setup/SKILL.md`'s "If you hit a GitHub rate limit" section covers the
exact retry message the script prints when it detects this signature. `--use-github-token` is a
real, documented flag on both scripts and on the underlying CLI; see
[`cli/README.md`](../../../cli/README.md#github_token-optional-authenticated-access-to-the-github-api).
Without it, `GITHUB_TOKEN` is never read even if it is set in your shell: it is opt-in, not
ambient, on this Power's scripts and on the CLI flag they forward to.

`konductor doctor` has no `--use-github-token` flag at all. If `doctor`'s own `cli_version`/
`content_version` checks hit this same limit, pass `--no-version-check` instead to skip the
network call rather than authenticate it; see `konductor-help/SKILL.md`'s rate-limit
troubleshooting note for why these are not interchangeable.

### An unsupported platform

If `detect-platform.sh` cannot classify your platform at all (an architecture other than
`x86_64`/`aarch64` on Linux, for instance, not the same case as Intel Mac, which has its own
source-build fallback), the flow stops with a message naming exactly what it supports: Linux
x86_64, Linux aarch64, macOS (Apple Silicon or Intel), and Windows via WSL. There is no further
fallback inside this Power for anything outside that list.

**Fix.** Use the repository's manual install paths instead: the quick-install script or the
from-source walkthrough in the root [README.md](../../../README.md#quick-start), which are not
limited to this Power's three prebuilt-binary triples.

### Diagnosing with `doctor`

For anything not covered above:

```bash
konductor doctor --target <your-project>
```

Read the specific failing check's own `fix:` line rather than treating a non-zero exit as one
undifferentiated problem. `doctor` exits `1` if **any** of its nine checks is `failed`/`stale`,
even when every other check is fine. See [Diagnose problems](diagnose-problems.md) for a
systematic walk-through, and the general [Troubleshooting](../troubleshooting.md) page for
symptoms not specific to this install path.

---

## Getting help: the `konductor-help` skill

Once `konductor-setup` has run, a second skill, `konductor-help`, answers ongoing questions
about the install: which CLI flags exist, whether it is healthy, and which SOPs are available. It
works by reading the live CLI schema (`konductor __dump_schema`) and running the real CLI
commands directly, rather than from a fixed script, so its answers cannot drift from the binary
the way hand-written prose can. It also documents which entries in that schema dump look like
real commands but are not: `metrics` (a stub), `config` (implemented but withheld behind an
internal-only flag), and `__telemetry-hook` (internal only).

A dedicated help and diagnostics **MCP server**, with structured tools such as
`describe_commands`, `doctor`, `list_sops`, and `get_sop`, is part of this Power's design, but
does not exist in this repository yet; there is no committed date for it. Until it ships,
`konductor-help` is CLI-level: the same underlying facts, answered directly against the running
binary and the installed SOP files, with no separate server in between.

---

## Related

- [Install for Kiro CLI](install-kiro-cli.md) · [Install for Claude Code](install-claude-code.md):
  the other two install paths
- [Diagnose problems](diagnose-problems.md): a systematic walk-through when `doctor` reports
  something not `ok`
- [Update an installation](update.md) · [Uninstall](uninstall.md): the underlying CLI behavior
  this Power's update/uninstall actions call
- [CLI reference](../reference.md): the full command, flag, and exit-code contract

---

[← Install for Claude Code](install-claude-code.md) · [Task guides](README.md) ·
[Next: Initialize a project →](initialize-a-project.md)
