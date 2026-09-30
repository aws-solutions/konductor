---
name: konductor-help
description: Answers questions about an existing Konductor install or checkout -- which CLI flags exist, whether the install is healthy, and which SOPs/workflows are available. Use after konductor-setup has run, whenever the user asks how to configure Konductor, reports something looks broken, or asks what workflows/SOPs ship. Also documents which commands (metrics, config, __telemetry-hook) look real in `konductor --help`'s underlying schema but are not.
---

# konductor-help

Help and diagnostics for a Konductor install or checkout, once
`konductor-setup` has run. This documents today's implementation --
reading the live CLI schema and running the real CLI commands directly --
and the exact caveats those answers need. See "What's implemented vs.
deferred" at the bottom for why this is CLI-level today rather than a
dedicated MCP tool.

Every command below shows `konductor` for readability. In practice,
resolve the absolute path `konductor-setup` linked (`~/.local/bin/
konductor`) rather than trusting a bare `konductor` off `PATH` -- PATH
could resolve to a different, unrelated `konductor` installed elsewhere on
the same machine. If `command -v konductor` doesn't point at
`~/.local/bin/konductor`, use the full path explicitly.

## "How do I configure/run this?" -> read the live schema, not stale prose

```bash
konductor __dump_schema
```

This walks the real `clap::Command` tree (`schema.rs`) rather than a
hand-maintained copy, so flags and defaults can never drift from the
binary the way prose documentation can. Prefer this over remembering or
guessing a flag's exact name or default.

**Three hidden entries leak into this dump alongside the real 7-command
public surface** (`install`, `update`, `uninstall`, `synth`, `init`,
`doctor`, `metrics`). The dump's own exclusion list only removes
`__dump_schema` and `help` -- nothing else. Never present any of these
three as a working command the user can just run:

- **`metrics` -- a stub.** It parses arguments and validates input
  correctly, but performs no real work; running it prints "not yet
  implemented" and exits 0. Tell the user it isn't implemented yet, not
  that it's a working command.
- **`config` -- implemented, but withheld, not stubbed.** Its `get`/
  `set`/`list` subcommands have complete, tested logic, but a normal,
  unmodified `konductor config` invocation is gated behind an
  internal-only escape hatch (`KONDUCTOR_ALLOW_CONFIG=1`, exact string
  match, not a documented user-facing flag) and returns a "not currently
  available" usage error otherwise. Tell the user `config` is not
  currently available on this build -- never walk them through `config
  get`/`set`/`list` as something they can run today.
- **`__telemetry-hook` -- internal, not public at all.** Used to observe
  agent/sub-agent invocation events; not one of the public commands under
  any circumstance. Anything prefixed `__` in the dump (matching
  `__dump_schema` itself) is internal tooling, full stop, regardless of
  whether the exclusion list happens to catch it.

`init` scaffolds `.konductor/` with a starter `config.yml` derived from a
single embedded preset (`cli/gate-config/config.yml` at compile time) --
there is currently no `solo`/`team`/`org` preset choice, whatever a future
roadmap section elsewhere might describe.

## "Is my install broken?" -> `konductor doctor`

```bash
konductor doctor --target <dir>
```

Runs the real logic `install`/`synth`/`config` already use -- never a
re-implementation -- and reports each of these nine checks as
`ok`/`info`/`warn`/`failed`/`stale`, with an indented `fix:` hint on every
non-`ok` line:

| Check | What it checks |
| --- | --- |
| `source` | Parses the source tree with `synth`'s own parser, including cross-reference validation |
| `runtime` | Which runtime(s) `install` auto-detects at the target |
| `manifest` | Manifest presence, completion status, per-file hash drift against disk |
| `config` | `.konductor/config.yml` loads and validates -- the config **file**, not the hidden `config` **command** above; the two share a name and nothing else |
| `container_runtime` | Probes `docker`/`podman`/`nerdctl`/`finch` on `PATH` -- informational only |
| `index_status` | Compares `~/.konductor/installs`'s cached status against the target's real manifest |
| `telemetry_state` | Whether telemetry reporting is effectively on for this target -- ANDs the per-target opt-out (`install-info.json`) against the machine-wide consent record; `ok` only when both allow it, `warn` when a machine-wide decline is silently suppressing an otherwise-opted-in target, `info` for "nothing to report yet"/never-installed. Never `failed`/`stale`. |
| `cli_version` | Machine-wide, runs once even under `--all`; compares the running binary against latest |
| `content_version` | Per-target; compares that target's installed content version against latest |

**`telemetry_state` is real and live in the actual v1.0.2 binary, but is
not in `cli/README.md`'s own `doctor` table (it currently lists eight
checks, not nine) -- verified directly against a real installed target's
`doctor` output and against `doctor.rs`'s own source, not assumed.** Treat
this table, not `cli/README.md`'s, as current. If you're the one
maintaining `cli/README.md`, this is the one correction worth carrying
back upstream.

**`telemetry_state` does NOT read `<target>/.konductor/config.yml`** --
confirmed directly against `doctor.rs`'s own `check_telemetry_state`,
which reads only the per-target `install-info.json` record and the
machine-wide `~/.konductor/telemetry.json` file, never `config.yml`. A
user who opted out via `telemetry: enabled: false` in their own
`config.yml` (see `konductor-setup/SKILL.md`'s "Telemetry" section) will
still see whatever `telemetry_state` reports from those other two sources
-- it will not mention the `config.yml` opt-out at all, in either
direction. Say so if asked whether `doctor` shows the full telemetry
picture; it currently does not.

`cli_version` and `content_version` are fully independent checks with no
shared logic -- `konductor-setup`'s upgrade step keys off `content_version`
alone, never `cli_version`.

The overall run exits `1` if any check is `failed`/`stale`, even when
every other check is `ok`/`info`/`warn` -- read the specific failing
check's own `fix:` line rather than treating a nonzero exit as one
undifferentiated problem. Add `--json` for a machine-readable object
instead of the human-readable report. Add `--no-version-check` to skip the
network call `cli_version`/`content_version` make (this call carries no
telemetry UUID and is unaffected by any telemetry opt-out -- gated only by
this flag).

## Troubleshooting: GitHub rate limits

`doctor`'s `cli_version`/`content_version` checks (above) each make a
GitHub API call to resolve the latest release. On a shared or
heavily-used network this can fail with `HTTP status 401/403`
(GitHub's unauthenticated API limit is 60 requests/hour per source IP) --
the fetch failure degrades to an `info`-level result rather than failing
`doctor` itself, but if you want the version-check to actually succeed,
there are exactly two ways to react, and they are NOT interchangeable:

- **`konductor install`/`update` DO have `--use-github-token`.** If a
  `GITHUB_TOKEN` is available, re-run with that flag to authenticate the
  call and raise the rate limit -- see `konductor-setup/SKILL.md`'s "If
  you hit a GitHub rate limit" section for the full consent requirement
  (a token must never be sent without saying so first).
- **`konductor doctor` has NO `--use-github-token` flag at all** --
  confirmed directly against `cli.rs`'s `Commands::Doctor` variant, which
  declares only `from`/`target`/`all`/`no_version_check`. Passing
  `--use-github-token` to `doctor` is a usage error (clap rejects an
  unrecognized flag), not a way to authenticate it. **`--no-version-check`
  is doctor's own way around this** -- it skips the network call entirely
  rather than authenticating it. Reach for that instead, every time
  `doctor` (not `install`/`update`) is the command hitting this.

One more wrinkle worth knowing about: `doctor`'s own error text for this
failure still says "...pass --use-github-token" even though `doctor`
itself has no such flag (confirmed directly: both `install`'s and
`doctor`'s HTTP-status error messages share the same hint-rendering code,
which has no way to know which command is calling it). Don't repeat that
suggestion verbatim for a `doctor` failure -- give `--no-version-check`
instead, per above.

## "What workflows/SOPs are available?" -> read the SOPs directly

SOPs are markdown files with no frontmatter, so derive a title from the
first heading and a purpose from the first paragraph when summarizing one.

- **In a source checkout:** read `agent-sops/*.sop.md` directly.
- **In an installed target:** read `<target>/.konductor/sops/*.sop.md` --
  **this is installed, contrary to one stale line some copies of
  `cli/README.md` still carry** ("synthed into `dist/kiro-cli-v2/sops/` but
  not installed anywhere"). The real install code copies SOPs to
  `<target>/.konductor/sops/` for both `kiro-cli-v2` and `kiro-v3`. Don't
  repeat the stale claim.
- **For Kiro's own `/prompts` discovery:** a separate, parallel conversion
  additionally writes each SOP to
  `<target>/.kiro/skills/sop-<name>/SKILL.md` for both Kiro harnesses.
  Under the `claude` harness specifically, SOPs land at
  `<target>/.claude/skills/sop-<name>/SKILL.md` instead, as that harness's
  primary path -- and, when installing `kiro-v3` alongside a project that
  already has Claude Code content (a pre-existing `.claude` marker), an
  *additional*, additive-only copy also lands under `.claude/skills/`.
  Don't assume every SOP-to-skill conversion lands under `.claude/skills/`
  regardless of harness -- for Kiro it does not.
- **This closes a real discovery gap in Claude Code:** `/prompts` does not
  exist there, so without reading `.konductor/sops/`/`.claude/skills/
  sop-*/` directly, a Claude Code user has no SOP discovery at all today.

## "How do I get AWS docs lookups / browser automation working?" -> MCP servers, bring your own

`k-architect` and `k-developer` request AWS documentation-lookup tools; `k-browser` requests
Playwright tools. Neither MCP server is wired up automatically for Kiro today -- `konductor
synth`'s Kiro output (both `kiro-cli-v2` and `kiro-v3`) does not read `dependencies.mcpRegistry`
at all; that field is only rendered into agent frontmatter for the Claude Code harness. Tell the
user to configure `mcpServers` themselves in `.kiro/settings/mcp.json` (workspace) or
`~/.kiro/settings/mcp.json` (user), per the full walkthrough on the project docs site at
<https://aws-solutions.github.io/konductor/> -- the "Install via Kiro Power" page's own "MCP
servers: bring your own" section (deliberately not a deep link here: this repo's docs site is
still being built out page by page, and a specific page/anchor URL is not yet a stable target to
hardcode into an installed skill). Do not attempt to configure this on the user's behalf --
point them at that doc.

The facts below are the ones worth stating correctly if asked directly, verified against the
[Agent Toolkit for AWS](https://github.com/aws/agent-toolkit-for-aws) (the upstream source of
truth for this server) rather than assumed:

- **The server key is `aws-mcp`**, matching the toolkit's own getting-started page.
  `k-architect`/`k-developer`'s own agent specs declare a bare `@aws-mcp` tool-grant reference;
  an `mcp.json` entry under any other key resolves to nothing against that grant.
- **All eight tools are granted; five are pre-approved, three prompt.** Verified directly
  against `agents/k-architect.agent-spec.json` and `agents/k-developer.agent-spec.json`: their
  `clientConfig.kiroCli.tools` carries a bare `@aws-mcp` entry -- a whole-server collection
  grant, not a named subset -- so every tool the server exposes is reachable. `allowedTools`
  then pre-approves five of them by name -- `aws___search_documentation`,
  `aws___retrieve_skill`, `aws___read_documentation`, `aws___list_regions`,
  `aws___get_regional_availability` -- so those run with no confirmation prompt.
  `aws___run_script`, `aws___get_presigned_url`, and `aws___get_tasks` are already reachable
  through that same `@aws-mcp` grant; they are not unreachable and nothing needs adding to the
  agent spec to use them, they just are not pre-approved, so each one prompts for confirmation
  on first use. There is no `aws___call_aws` tool on this server at all -- don't invent one if
  asked.
- **IAM guardrails exist independently of the tool grant.** A granted call still runs under the
  user's own IAM credentials; `aws:ViaAWSMCPService` (boolean) and `aws:CalledViaAWSMCP` (string,
  `aws-mcp.amazonaws.com` for this server) are the global IAM condition keys that scope or audit
  what the agent can do through the MCP server specifically.
- **An OAuth alternative exists on Kiro CLI 2.11+** (`kiro-cli mcp add --name aws-mcp --url
  https://aws-mcp.us-east-1.api.aws/mcp`, no local `uvx` process) -- `--name aws-mcp` matches the
  agent specs' own `@aws-mcp/aws___<tool>` grants directly, no key mismatch to work around.
- **The toolkit ships its own, separate skill catalog** (`npx skills add
  aws/agent-toolkit-for-aws/skills`) -- unrelated to and installable alongside this Power's own
  `konductor-setup`/`konductor-help`, no conflict either way.
- **Playwright (`playwright-mcp`) stays bring-your-own by design** -- not expected to change; this
  Power installs no browser binaries or MCP servers of its own.

## What's implemented vs. deferred

This skill documents CLI-level answers you can act on **today** --
`konductor __dump_schema`, `konductor doctor`, and reading SOP files
directly all work right now, with no missing infrastructure. A dedicated
help/diagnostics **MCP server** is planned (`describe_commands`, `doctor`,
`list_sops`, `get_sop` as structured tools, plus a deferred
`find_docs`/`get_doc_section` pair for a larger document corpus). That
server -- and the `mcp/lib/` shared-core extraction it depends on -- does
not exist in this repo yet; building it is real, separate engineering
work, not something this skill can shim around by itself. Until it
ships, this skill's own guidance above is the
implementation: the same underlying facts (the nine `doctor` checks, the
three hidden-schema caveats, where SOPs actually live) that the future MCP
tools would also need to get right.

## If none of this answers the question

The project docs site, <https://aws-solutions.github.io/konductor/>, is
the next place to check before guessing -- prefer it over speculating
about a flag or behavior this skill doesn't cover.
