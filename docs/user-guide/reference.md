<!-- SPDX-License-Identifier: Apache-2.0 -->

# CLI reference

[← Back to guide index](README.md)

Complete tables for the command surface, configuration schema, exit-code contract, and repository
layout.

For the agents and skills themselves, see the [Agents reference](agents.md) and
[Skills catalog](skills.md).

---

## Contents

- [Command table](#command-table)
- [Global flags](#global-flags)
- [Per-command flags and arguments](#per-command-flags-and-arguments)
- [Configuration file](#configuration-file)
- [Exit-code contract](#exit-code-contract)
- [Invocation log](#invocation-log)
- [`synth` output](#synth-output)
- [Repository layout](#repository-layout)
- [Agent roster](#agent-roster)
- [SOP roster](#sop-roster)


---

## Command table

Seven commands.

| Command | Purpose |
| --- | --- |
| `konductor install` | Register agents, skills, SOPs, and context files with the harness named by `--harness` (required) |
| `konductor update` | Unconditionally overwrite a tracked install in place from `--from`; `--dry-run` previews it |
| `konductor uninstall` | Remove a tracked install's files and its index entry; `--dry-run` previews it |
| `konductor doctor` | Check the runtime, the installed content, the project config, and available updates |
| `konductor init` | Create `.konductor/` and write a starter `config.yml` |
| `konductor synth` | Parse `agents/`, `skills/`, and `agent-sops/` and write per-runtime output to `<source>/dist/` |
| `konductor metrics` | Show quality trends from recent runs |

`update` and `uninstall` both accept `--target <dir>`, `--all`, and `--dry-run`, and share one
target-selection table — see [Update an installation](tasks/update.md#choosing-which-install-to-update).
Neither prompts for confirmation: `--dry-run` is the only preview, and it is the only way to see
**which** files carry local edits that a real run would destroy.

`konductor metrics` is a **stub** in this release — it prints "not yet implemented."

**`install` fetches its content from a GitHub Release, and whether it succeeds depends on one
being published.** It looks for one asset — `konductor-v<version>.tar.gz` — plus a `.sha256`
sidecar, and `.github/workflows/release.yml` publishes exactly that pair and gates on its
presence before publishing. It is **not** a per-platform tarball; the per-platform assets are the
raw binaries. If no release carrying those assets exists, the fetch reports a missing-asset error
and exits `64`. `main`'s `dist/` tarball is the automatic fallback, verified the same way.

Two caveats apply to the remote path regardless: GitHub API rate limiting, and SHA-256 transport
integrity only — there is no GPG or sigstore provenance check.

**SOPs are installed.** `install`'s phase list (`cli/konductor-rs/src/cli/install/phases.rs`) runs
`SopInstallPhase`, which copies every `.sop.md` verbatim into `<target>/.konductor/sops/`. On
Claude Code each one is additionally converted into `<target>/.claude/skills/sop-<name>/SKILL.md`,
a slash-invokable skill with `disable-model-invocation: true` — so `/sop-<name>` reaches it.
Context files install too, into `<target>/.kiro/context/`.

`konductor help [COMMAND]` prints help for a command, and `--help` works at every level.

**The CLI does not run SDLC workflows.** There is no `konductor review` or `konductor design` — the
workflows are driven by the agents inside your runtime session. The CLI handles setup, content build,
lifecycle, and diagnostics.


## Global flags

Accepted before or after a subcommand.

| Flag | Type | Default | Effect |
| --- | --- | --- | --- |
| `-v`, `--verbose` | flag | off | Print additional detail about what the command is doing |
| `--json` | flag | off | Emit machine-readable JSON instead of human text |
| `--version` | flag | — | Print the CLI version and exit `0`. Top-level only |
| `--no-color` | flag | off | Disable ANSI colour in output |
| `-h`, `--help` | flag | — | Print help and exit `0` |


## Per-command flags and arguments

| Command | Flag / argument | Type | Required | Values |
| --- | --- | --- | --- | --- |
| `install` | `--harness <NAME>` | enum | **Yes** | `kiro-cli-v2` (Kiro CLI v2, CLI only), `kiro-v3` (Kiro v3, CLI and IDE unified), `claude`. No default and no auto-detection |
| `install` | `--from <PATH>` | path | No | Install from a local repo root with already-synthed content instead of fetching a release. A maintainer path — the documented workflows all install from a release |
| `install` | `--target <DIR>` | path | No | Destination. Defaults to `$HOME` |
| `install` | `--link-bin` | flag | No | Symlink `konductor` into `$HOME/.local/bin` |
| `install` | `--no-telemetry` | flag | No | Suppress telemetry for this invocation |
| `install` | `--use-github-token` | flag | No | Authenticate the release fetch with a GitHub token |
| `update` | `--from <PATH>` | path | No | Source repo root. No default — pass it every time |
| `update` | `--target <DIR>` | path | No | Which tracked install to update. Conflicts with `--all` |
| `update` | `--all` | flag | No | Update every tracked install. Conflicts with `--target` |
| `update` | `--dry-run` | flag | No | Report what would be overwritten, per path, flagging local edits. Writes nothing |
| `update` | `--harness <NAME>` | enum | No | Narrow the selection to one harness |
| `uninstall` | `--target <DIR>` | path | No | Which tracked install to remove. Conflicts with `--all` |
| `uninstall` | `--all` | flag | No | Remove every tracked install. Conflicts with `--target` |
| `uninstall` | `--dry-run` | flag | No | Report what would be removed, per path, flagging local edits. Writes nothing |
| `uninstall` | `--harness <NAME>` | enum | No | Narrow the selection to one harness |
| `doctor` | `--from <PATH>` | path | No | Source tree to check. Conflicts with `--all` |
| `doctor` | `--target <DIR>` | path | No | Install directory to check. Defaults to `$HOME`. Conflicts with `--all` |
| `doctor` | `--all` | flag | No | Check every tracked install. Conflicts with `--from` and `--target` |
| `init` | `--preset <PRESET>` | enum | No | `solo`, `team`, `org` |
| `init` | `--force` | flag | No | Overwrite an existing `.konductor/` instead of failing |
| `synth` | `--from <PATH>` | path | No | Synthesize this source tree instead of the current directory. Output goes to `<PATH>/dist/` |
| `metrics` | `--since <WINDOW>` | string | No | Limit the report to runs within a time window. `metrics` is a stub in this release |


## Configuration file

**Path:** `.konductor/config.yml`, relative to the current working directory. `konductor init`
writes it and `konductor doctor` validates it; edit it by hand.
**Format:** a YAML mapping at the top level, with flat scalar keys. Nested dotted keys are not
supported.

### Schema

| Key | Type | Valid values | Default |
| --- | --- | --- | --- |
| `version` | integer | `1` — any other value is rejected | `1` |
| `severities_source` | string | A path, relative to the CLI's policy directory, to the file defining finding severities | `severity-schema.yml` |
| `tiers_source` | string | A path, relative to the CLI's policy directory, to the file defining change tiers | `scope-table.yml` |
| `tier` | string | The active change tier: `trivial`, `bugfix`, `minor`, `major`, or `full` | `minor` |
| `default_severity` | string | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, or `INFO` — applied to a finding that does not specify its own severity | `MEDIUM` |
| `fail_on_severity_at_or_above` | string | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, or `INFO` — the lowest severity treated as blocking | `CRITICAL` |

Unrecognized extra keys are ignored.

### Minimal valid file

```yaml
version: 1
```

Every other field falls through to the user layer and then the CLI defaults.

### Precedence

Three layers, merged **shallow and per-field**. Later layers win per field; a field absent from a
layer falls through.

| Order | Layer | Path | Missing is an error? |
| --- | --- | --- | --- |
| 1 (lowest) | CLI defaults | Compiled into the binary | Never missing |
| 2 | User config | `~/.konductor/config.yml`, resolved from `$HOME` | No |
| 3 (highest) | Project config | `<cwd>/.konductor/config.yml` | No |

### Config error messages

All exit `64`.

| Message | Cause |
| --- | --- |
| `config version <n> is not supported by this CLI (expected 1)` | `version` is not `1` |
| `config file <path> is not valid YAML: …` | Syntax error, or a value of the wrong type for its field |
| `config file <path> is not valid YAML: invalid type: sequence, expected struct RawConfig` | The top level is a list rather than key-value pairs |
| `<path> already exists. Re-run with --force to overwrite it.` | `init` on an existing `.konductor/` |

An **empty** `config.yml` is not an error — every field falls through to its default.


## Exit-code contract

| Code | Constant | Meaning |
| --- | --- | --- |
| `0` | — | Success |
| `1` | `EXIT_HALTED` | A command ran correctly and reported failure — today that is `doctor` with one or more `failed`/`stale` checks |
| `2` | — | **Reserved** for the run-engine's "unresolved CRITICAL gate" signal. The run-engine is not yet built, so nothing emits `2` today — and a bad invocation never will |
| `6` | `EXIT_SUCCESS_WITH_WARNINGS` | Everything the command was responsible for succeeded, but something peripheral did not — today, `uninstall` when a tracked `--link-bin` symlink could not be removed |
| `64` | `EXIT_USAGE_ERROR` | Usage error (`EX_USAGE`, BSD `sysexits.h`) — a bad flag, unknown command, missing argument, invalid value, or an invalid config |
| `65` | `EXIT_VERIFY_FAILED` | A verification failed — a checksum mismatch on a fetched install source, or an unsupported `~/.konductor/installs` schema version |

### Why `64` and not `2`

Most command-line tools use `2` for a usage error. Konductor uses `64` — the BSD `sysexits.h`
`EX_USAGE` value — and reserves the low codes so a malformed invocation can never be confused with a
substantive failure signal. If you script against the CLI, treat `64` as *you typed something wrong*
rather than lumping every non-zero code together.

`--help` and `--version` are not usage errors and exit `0`.

### Everything that exits `64`

| Situation | Example |
| --- | --- |
| No command given | `konductor` |
| Unknown subcommand | `konductor instal` |
| Unknown flag | `konductor --bogus` |
| Missing required argument | `konductor install` without `--harness` |
| Invalid enum value | `konductor init --preset enterprise` |
| Malformed config on load | Any command, against a broken `.konductor/config.yml` |
| `init` without `--force` on an existing `.konductor/` | `konductor init` |
| `synth` parse failure | A malformed `agents/*.agent-spec.json` |
| Current directory cannot be resolved | — |

### Unknown-command suggestions

An unknown subcommand suggests close matches from the real command set:

```bash
konductor instal
```

```text
error: unrecognized subcommand 'instal'

  tip: some similar subcommands exist: 'init', 'uninstall', 'install'

Usage: konductor [OPTIONS] [COMMAND]

For more information, try '--help'.
```

Exit `64`.


## Invocation log

| Property | Value |
| --- | --- |
| Path | `~/.konductor/logs/konductor.log` |
| Directory mode | `0700` — owner only |
| File mode | `0600` — owner read/write only |
| One line per | CLI invocation, including failures |
| Line format | `<ISO-8601 UTC timestamp> argv=[...] exit_code=<n>` |
| Rotation | None. Grows without bound. |
| On write failure | **Fail-open.** The command's own exit code is never affected. |

Example lines:

```text
2026-08-13T20:13:52Z argv=["konductor", "install"] exit_code=0
2026-08-13T20:14:11Z argv=["konductor", "doctor"] exit_code=0
2026-08-13T20:15:02Z argv=["konductor", "doctor"] exit_code=0
```

The restrictive permissions are deliberate: argument vectors can contain paths and config keys
you may consider sensitive. Modes are re-pinned on every call, so a pre-existing world-readable
file is tightened on first use.

---

## `synth` output

`konductor synth` parses the source tree and runs every registered transformer.

**What it reads:**

| Directory | Files | Rules |
| --- | --- | --- |
| `agents/` | `*.agent-spec.json` | Aborts on the first parse failure. Duplicate names rejected. |
| `skills/` | `<name>/SKILL.md` | Names validated against `^[a-z0-9]+(-[a-z0-9]+)*$`. Auxiliary files over 1 MiB are rejected before being read. |
| `agent-sops/` | `*.sop.md` | Duplicate names rejected. |

Each collection is sorted alphabetically by name so output is reproducible.

**What it writes:** four directories under `<source>/dist/<harness>/` — `agents/`, `skills/`,
`sops/`, and `context/`. Agent files land at `agents/<agent-name>.json`, one per spec, in
Kiro's own agent-config format.

Each file has this shape:

```text
name, description, prompt, model, tools, allowedTools,
toolsSettings, mcpServers, hooks, resources
```

Field names follow Kiro's agent-config format rather than the source spec's naming.

**Behaviour worth knowing:**

- Output always goes to `<source>/dist/`, **never the process working directory** — so
  `--from <dir>` writes to `<dir>/dist/`.
- `dist/` is gitignored — it is generated output.
- Success prints **nothing** and exits `0`.
- A source tree with no `agents/` directory exits `0` and writes nothing. Silence alone does not
  prove your specs were validated — check that files appeared.
- A parse failure names the file and reason, and exits `64`:

```text
konductor synth: /path/to/agents/broken.agent-spec.json: invalid JSON: key must be a string at line 1 column 3
```

- Skills and SOPs are parsed and validated before anything is written, so a bad skill name or a
  duplicate SOP fails the whole run rather than producing a partial tree.

---

## Repository layout

```text
konductor/
├── agents/                       11 agent specs (*.agent-spec.json)
├── agent-sops/                   19 SOPs (*.sop.md)
├── skills/                       82 skills (<name>/SKILL.md, plus optional helper files)
├── context/                      Loaded at agent startup
│   └── k-orchestrator-routing-rules.md
├── cli/                          The Konductor CLI
│   ├── README.md                 CLI-specific docs
│   └── gate-config/              Declarative policy shipped with the CLI
│       ├── config.yml            Default configuration
│       ├── severity-schema.yml   Finding severities
│       └── scope-table.yml       Change tiers
├── mcp/                          MCP servers the CLI installs alongside the agents
│   ├── lib/                      Shared crates: skill-lookup-core, telemetry-net
│   └── servers/skill-lookup/     Serves skills to Kiro CLI sessions
├── docs/
│   ├── guides/                   Integration guides
│   │   ├── getting-started-claude.md
│   │   ├── slack-integration.md
│   │   └── asana-integration.md
│   └── user-guide/               This guide
├── .github/                      Issue and PR templates
├── AGENTS.md                     Agent-facing project instructions
├── CLAUDE.md                     Claude Code entry point (includes AGENTS.md)
├── CHANGELOG.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── LICENSE.txt                   Apache-2.0
├── NOTICE.txt                    third-party attributions, generated from Cargo data
└── README.md
```

The four content directories are the ones to know: **`agents/`**, **`agent-sops/`**, **`skills/`**,
and **`context/`**. Everything Konductor does behaviourally is defined there, and all four are plain
JSON or Markdown you can read and change — see
[Contributing and customizing](appendix/contributing.md).

### Paths created at run time

| Path | Created by | Gitignored? |
| --- | --- | --- |
| `.konductor/config.yml` | `konductor init` | No |
| `dist/` | `konductor synth` | **Yes** |
| `~/.konductor/logs/konductor.log` | Every CLI invocation | Outside the repo |
| `~/.konductor/config.yml` | You, by hand | Outside the repo |
| `.konductor/handoff/<name>.md` | The `k-context-gathering` SOP, for large findings | No |
| `.agents/scratchpad/critique-NNN.md` | The `k-pre-cr-critique` SOP | No |
| `.kiro/specs/<feature>/` | The `kiro-spec-workflow` SOP | No |


## Agent roster

All 11, with the model each declares and the SOPs it makes available. For write and shell access
per runtime, delegation targets, and the full per-agent breakdown, see the
[Agents reference](agents.md).

| Agent | Model | SOPs declared | Skills | MCP registry |
| --- | --- | --- | --- | --- |
| `konductor` | `claude-sonnet-5` | `kiro-spec-workflow`, `k-delegate`, `k-plan`, `k-context-gathering`, `k-verify`, `k-light-ui-testing`, `k-comprehensive-search`, `k-full-sdlc`, `k-e2e-test-generation`, `about-konductor` | 13 | — |
| `konductor-mux-orchestrator` | `claude-sonnet-5` | `kiro-spec-workflow`, `k-plan`, `k-context-gathering`, `k-verify`, `k-comprehensive-search`, `k-full-sdlc`, `k-e2e-test-generation`, `k-light-ui-testing`, `about-konductor` | 10 | — |
| `konductor-cmux-orchestrator` | `claude-sonnet-5` | `kiro-spec-workflow`, `k-plan`, `k-context-gathering`, `k-verify`, `k-comprehensive-search`, `k-full-sdlc`, `k-e2e-test-generation`, `k-light-ui-testing`, `about-konductor` | 10 | — |
| `k-architect` | `claude-sonnet-5` | `k-design-doc-creation`, `k-existing-design-review`, `k-principal-engineer-design-review`, `k-adversarial-pull-request-review` | 38 | `aws-mcp` |
| `k-developer` | `claude-sonnet-5` | `k-code-cleanup`, `k-pre-cr-critique`, `k-codebase-analysis`, `k-code-review-workflow` | 27 | `aws-mcp` |
| `k-quality-assurance` | `claude-sonnet-5` | `k-test-coverage-review` | 12 | — |
| `k-product-manager` | `claude-sonnet-5` | — | 16 | — |
| `k-tpm` | `claude-sonnet-5` | — | 14 | — |
| `k-researcher` | `claude-sonnet-5` | — | 8 | — |
| `k-browser` | `claude-sonnet-5` | — | 4 | `playwright-mcp` |
| `k-media-analyzer` | `claude-sonnet-5` | — | 1 | — |

Every agent runs `claude-sonnet-5`. The SOP column is each spec's
`dependencies.agentSops.agentSopNames`; the skill count is
`clientConfig.claudeCli.skills`, which matches `dependencies.skills.skillNames` for every
agent except `konductor` — that one declares `claude-teams-behavior` for Claude Code only,
so its shared count is 12 and its Claude Code count is 13. Every skill is catalogued in the
[Skills catalog](skills.md).

Only the three orchestrators declare a context file
(`context/k-orchestrator-routing-rules.md`).

### MCP registry entries

| Entry | Declared by | Definition |
| --- | --- | --- |
| `aws-mcp` | `k-architect`, `k-developer` | `command: uvx`, args `mcp-proxy-for-aws@latest`, `https://aws-mcp.us-east-1.api.aws/mcp`, `--metadata`, `AWS_REGION=us-east-1` |
| `playwright-mcp` | `k-browser` | args `-y`, `@playwright/mcp@latest` |

In Claude Code these agents request the corresponding tools via globs — `mcp__aws-mcp__*` and
`mcp__playwright-mcp__*` — rather than launching the servers themselves.

---

## SOP roster

All 19, with owning agent and required parameters. Detail and flowcharts:
[SOP workflows](sop-workflows/README.md). End-to-end walkthroughs: [Use cases](use-cases/README.md).

| SOP | Owner(s) | Required parameters |
| --- | --- | --- |
| `k-plan` | orchestrators | `objective` |
| `k-context-gathering` | orchestrators | `target` |
| `k-verify` | orchestrators | `source_dir` |
| `k-delegate` | `konductor` | `task_description`, `target_agent` |
| `kiro-spec-workflow` | orchestrators | `feature_name`, `feature_scope_path`, `user_stories_path`, `design_artifacts_path` |
| `k-design-doc-creation` | `k-architect` | `topic` |
| `k-existing-design-review` | `k-architect` | `design_dir` |
| `k-adversarial-pull-request-review` | `k-architect` | `diff_input` (always; `pr_url` is context-only) |
| `k-code-review-workflow` | `k-developer` | `source_dir` |
| `k-code-cleanup` | `k-developer` | `source_dir` |
| `k-pre-cr-critique` | `k-developer` | none — all parameters have defaults |
| `k-codebase-analysis` | `k-developer` | none — all parameters have defaults |
| `k-test-coverage-review` | `k-quality-assurance` | `source_dir`, `test_dir` |
| `k-principal-engineer-design-review` | `k-architect` | `doc_input` |
| `k-e2e-test-generation` | orchestrators | `url`, `output_mode` (+ `project_mode`/`project_dir` for the spec modes) |
| `k-light-ui-testing` | orchestrators | `url`, `features` |
| `k-full-sdlc` | orchestrators | `project_description` |
| `k-comprehensive-search` | orchestrators | `search_target` |
| `about-konductor` | orchestrators | none — `question` is optional |

---


---

[← Back to guide index](README.md) · [Next: Troubleshooting →](troubleshooting.md)
