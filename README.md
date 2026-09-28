# Konductor

| **[🚧 Feature request](https://github.com/aws-solutions/konductor/issues/new?labels=enhancement&template=feature_request.md)** | **[🐛 Bug Report](https://github.com/aws-solutions/konductor/issues/new?labels=bug&template=bug_report.md)** |

Konductor is an open-source package of skills, standard operating procedures (SOPs) and workflows that automate the software development lifecycle (SDLC). A single agent session in Kiro CLI or Claude Code runs a workflow one step at a time and loads the skill each step names, so a request can move from requirements through design, specs, implementation, code review, testing and documentation with the same quality gates at every step.

> **Note:** Konductor used to ship agent specs: eight specialists and three orchestrators that routed work between them. They were removed, together with the skills and the SOP that only routed work to subagents; see [docs/research/2026-09-26-orchestration-skills-and-sops.md](docs/research/2026-09-26-orchestration-skills-and-sops.md). The user guide under [`docs/user-guide/`](docs/user-guide/), its HTML bundles in `docs/`, and the integration guides under [`docs/guides/`](docs/guides/) still describe the agent-based layout and have not been rewritten yet.

The package ships as static configuration compatible with [Kiro](https://kiro.dev) and [Claude Code](https://claude.ai/download). No runtime infrastructure is required beyond the AI runtime itself.

---

## Table of Contents

1. [Why Konductor](#why-konductor)
2. [Quick Start](#quick-start)
3. [Workflows](#workflows)
4. [Skills](#skills)
5. [Persistent Memory](#persistent-memory)
6. [SOPs](#sops-standard-operating-procedures)
7. [Usage Examples](#usage-examples)
8. [Optional Integrations](#optional-integrations)
9. [Roadmap: The Konductor CLI](#roadmap-the-konductor-cli)
10. [Project Structure](#project-structure)
11. [Contributing](#contributing)
12. [Security](#security)
13. [License](#license)
14. [Data Collection](#data-collection)

---

## Why Konductor

Most AI coding sessions improvise their process. Konductor gives the session a written one: skills that say how to write requirements, design a system, review a design, split features, write specs, implement, review code, plan tests and document, each with its own checker, and workflows that run those skills in order with gates where the owner signs off.

You get this by installing one package. No servers to run and no infrastructure to provision: the skills, SOPs and workflows are files that your existing Kiro or Claude Code runtime reads directly.

## Quick Start

### Quick install (single command)

```bash
curl -fsSL https://raw.githubusercontent.com/aws-solutions/konductor/refs/heads/main/scripts/konductor-bootstrap.sh | bash
```

This fetches [`scripts/konductor-bootstrap.sh`](scripts/konductor-bootstrap.sh), a small script whose only job is to download the real installer, [`scripts/konductor-install.sh`](scripts/konductor-install.sh), verify it against the checksum GitHub's own Contents API reports for that file, and run it. Requires `jq`, used to pull that checksum out of the API's JSON response.

Piping a remote script into `bash` runs code you haven't read, so (as with any curl-pipe-to-shell installer) read [`scripts/konductor-bootstrap.sh`](scripts/konductor-bootstrap.sh) and [`scripts/konductor-install.sh`](scripts/konductor-install.sh) yourself first if you want to audit what you're running before you run it.

`konductor-install.sh` detects your OS and architecture, resolves the latest published release, downloads that platform's `konductor` binary plus its `.sha256` checksum sidecar, verifies the checksum, and symlinks the verified binary into `~/.local/bin`. No additional authentication or access beyond an unauthenticated GitHub release download is needed, so anyone will be able to run it as-is. It then runs `konductor install` with no `--from` flag against `$HOME` (or wherever `HOME` points for the invocation), which fetches the rest of what it needs (the packaged skill and SOP content and the platform's `skill-lookup-mcp` MCP server binary) directly from the same release. It installs for `kiro-cli-v2`, the default runtime target, unless you set `KONDUCTOR_HARNESS=claude` (or `kiro-v3`) to target a different one.

Supported platforms are Linux (`x86_64` or `aarch64`) and macOS on Apple Silicon (`arm64`): the same three the release build matrix publishes binaries for. On any other platform (Intel macOS, Windows, or anything else), the script fails with a clear error naming the three it supports; use [Installing from source](#installing-from-source) below instead.

Re-running the script later always installs whatever release is currently latest: it re-downloads, re-verifies, and overwrites both the versioned binary and the `~/.local/bin/konductor` symlink every time, so there's no persistent checkout to keep in sync. Set `KONDUCTOR_TAG=v0.1.2` (or any published release tag) to pin the install to that release instead of latest.

If `~/.local/bin` isn't already on your `PATH`, the script prints a note at the end telling you to add it (e.g. `export PATH="$HOME/.local/bin:$PATH"` in your shell profile) — otherwise the `konductor` command it just linked won't resolve.

### How installing Konductor works

Getting Konductor running is two steps against your own checkout: `synth`, then `install`.

`konductor synth --from <repo-root>` reads this repo's agent/skill/SOP source and renders it into a runtime-ready output tree. `konductor install --from <repo-root>` then copies the agent, skill, and SOP output into your runtime's config directories and records a manifest so a later `konductor update` or `konductor uninstall` knows what it's responsible for. SOPs land differently per runtime: Kiro CLI gets the rendered `.sop.md` files copied as-is into `.konductor/sops/`, while Claude Code gets each one converted into its own `sop-<name>/SKILL.md` under `.claude/skills/`.

Both commands work today for Kiro CLI and Claude Code. `install` requires an explicit `--harness <kiro-cli-v2|kiro-v3|claude>` flag naming which runtime's synthed output to install — there is no destination-marker auto-detection and no default; omitting `--harness` is a usage error. `--harness kiro-cli-v2` installs skills under `.kiro/skills/<name>/`, where Kiro CLI discovers them (a package that ships agent specs installs agents under `.kiro/agents/` and skills under `.konductor/skills/<name>/` instead, so Kiro CLI doesn't expose every installed skill to every agent); `--harness claude` installs agents and skills under `.claude/agents/` and `.claude/skills/`; `--harness kiro-v3` installs for Kiro CLI's V3 (KAS) engine. Every one of these paths is relative to the install target — `--target <dir>` if given, else `$HOME` — not hardcoded to your home directory.

A target directory tracks a single strategy once installed: re-running `install` with a different `--harness` value against an already-tracked target is refused rather than silently switching strategies, since that would overwrite the manifest and drop the original strategy's files from tracking. Install a second harness into a separate target directory instead.

`konductor install` also works without `--from`, fetching a published GitHub release directly — including the platform-specific `skill-lookup-mcp` MCP server binary the CLI's own skill lookups depend on (Linux x86_64/aarch64 and Apple Silicon macOS; a platform with no published binary degrades gracefully, install still succeeds, only skill lookups are unavailable). Either install path's summary reports the installed content's version. See [`cli/README.md`](cli/README.md#installing-without---from-the-github-release--main-branch-dist-fallback-chain) for the exact fallback chain and its caveats.

### Installing from source

Choose this over the quick install above when you want a pinned commit rather than the latest release, need a platform the release build matrix doesn't publish a binary for (Intel macOS, Windows), or want to build or audit the source before installing it.

The CLI itself has no dependency that only runs inside Amazon to build or run — once you have a checkout, it's a plain `cargo build`, nothing else required. This sequence works with a plain `git clone` of the public repo. Build and `synth` are the same regardless of which runtime you're targeting; `install` and the verification step differ, so they're split out below.

[`scripts/konductor-clone-install.sh`](scripts/konductor-clone-install.sh) is a convenience one-liner that does what this section's walkthrough does by hand (clone, build, link the binary onto your `PATH`, `synth`, `install`) in a single command, updating a persistent checkout under `~/.konductor/git/konductor` on each re-run instead of re-cloning from scratch. It takes the same `KONDUCTOR_HARNESS` environment variable as `scripts/konductor-install.sh` above.

```bash
git clone https://github.com/aws-solutions/konductor.git
cd konductor
make build
make link
konductor synth --from .
```

**Kiro CLI** — no `--target` is needed against a fresh, empty target:

```bash
konductor install --from . --harness kiro-cli-v2
kiro-cli chat
```

**Claude Code** — pass `--target` at a directory that already has a `.claude/` marker (Claude Code itself creates one on first run in a project):

```bash
konductor install --from . --harness claude --target <dir-with-.claude-marker>
claude
```

> This is the short version. For prerequisites, the PATH-setup check, and a fully
> spelled-out numbered walkthrough (build → link → verify → synth → install → chat),
> see [`cli/README.md`](cli/README.md#getting-started). That doc also covers installing
> into a directory other than `$HOME` via `--target`.

### First run

**Full SDLC pass with fuse-flow.** The workflow runner lives in this repository under [`fuse/flow/`](fuse/flow/README.md) and needs [Bun](https://bun.sh) or Node 22.18+, 23.6+ or 24+ (see [`fuse/flow/README.md`](fuse/flow/README.md) for the dependency install). It is not part of the installed package, so run it from your checkout:

```bash
cd <your-project>
<konductor-checkout>/fuse/flow/fuse-flow start my-feature --workflow _k-full-sdlc
```

Then, in a Kiro CLI or Claude Code session in that project, ask:

```text
Run `<konductor-checkout>/fuse/flow/fuse-flow next my-feature` and do what it says. Each `done`
prints the next step. Repeat until the workflow is complete. Stop at each owner gate and show me
the artifact.
```

Each step names its skill and the artifact it must produce under `.konductor/`. `fuse-flow done` refuses a step until its artifacts exist, and a gated step waits until you approve it with `fuse-flow gate my-feature <step> --owner-approved`. fuse-flow finds skills in `FUSE_SKILLS_DIR`, `skills/`, `.kiro/skills/`, `.konductor/skills/`, `.claude/skills/`, `~/.kiro/skills/`, `~/.konductor/skills/` and `~/.claude/skills/`, so an install into `$HOME` is found without extra setup.

---

## Workflows

The workflow definitions in [`fuse/flow/workflows/`](fuse/flow/workflows/) are the entry points for multi-phase work.

| Workflow                   | Steps                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_k-full-sdlc.yml`         | Elicitation, codebase analysis, requirements, design, design review, feature splitting, specs, implementation, code review, testing, documentation and a final summary, with owner gates between phases. |
| `_k-phase-chain.yml`       | The lighter chain: requirements, design, feature splitting, specs, implementation, code review and QA, with no owner gates.                                                |
| `custom-example-*.yml`     | Examples of project-specific workflows at different sizes.                                                                                                                 |

For a single task, invoke a SOP or ask the session to use a skill directly; see [Usage Examples](#usage-examples).

## Skills

Skills are modular knowledge packages that a session loads when a task needs them. On Claude Code, installed skills live in `.claude/skills/`: only their names and descriptions are in context at session start, and the full content loads when a skill is invoked. On Kiro CLI, skills are installed to `.kiro/skills/`, where Kiro CLI's native skill discovery finds them. (A package that ships agent specs installs its skills under `.konductor/skills/` instead, so that each agent sees only the skills it declares; this package ships none.) The package ships **79 skills** across 8 capability areas:

| Category                          | Count | Representative skills                                                                                                                       | Covers                                                                                                                                                                                    |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture & Design             | 22    | `system-design-patterns`, `threat-modeling`, `dynamodb-design`, `iam-policy-design`, `smithy-modeling`, `cost-estimation`, `adr-generator`  | System design docs, STRIDE threat models, data models, least-privilege IAM, Smithy API models, AWS cost scenarios, trade-off scoring, ADRs, adversarial design review, design elicitation |
| Planning & Tracking               | 14    | `user-story-writing`, `task-decomposition`, `sprint-planning`, `risk-management`, `program-planning`, `progress-tracking`                   | Requirements → user stories → task/sprint breakdown, program plans and decision docs, RAID logs, status reports, legacy-to-agentic effort re-estimation, plan critique                    |
| Architecture & Development Review | 14    | `backend-development`, `frontend-development`, `infra-validation`, `code-review`, `git-workflow`, `adversarial-code-review`                 | Backend/frontend implementation, CDK/CloudFormation validation, IAM/security policy validation, standard and adversarial code review, git workflow                                        |
| Testing & QA                      | 8     | `test-coverage-analysis`, `e2e-test-strategy`, `cypress-test-implementation`, `security-test-generation`                                    | Coverage gap analysis, prioritized E2E test matrices, Cypress/Playwright planning, OWASP-based security test plans, web app/DOM discovery                                                 |
| Orchestration & Delegation        | 9     | `sdlc-navigator`, `pre-planning-analysis`, `persistent-memory`, `workspace-skills`, `sop-state-management`, `asdlc-aspect-review`          | SDLC phase flow, ambiguous-request triage, cross-session memory, reusable workspace skills, resumable SOP state, parallel n-aspect review                                                 |
| Kiro Spec Generation              | 3     | `kiro-requirements-generation`, `kiro-design-generation`, `kiro-task-generation`                                                            | Chained skills that turn PM/architecture artifacts into a Kiro IDE `requirements.md` / `design.md` / `tasks.md` spec                                                                      |
| Documentation & Writing           | 4     | `document-formats`, `doc-accuracy-analyzer`, `humanize-writing`, `agents-md-authoring`                                                      | Reading/writing `.docx`, fact-checking technical documents against primary sources, rewriting AI-sounding text, authoring AGENTS.md files                                                 |
| Research & Security               | 5     | `external-research`, `security-remediation`, `find-aws-skills`, `aws-mcp-usage`, `about-konductor`                                          | External documentation/web research, security-finding remediation planning, discovering additional AWS skills, AWS MCP confirmation rules, onboarding a new user to Konductor             |

## Persistent Memory

Sessions that load the `persistent-memory` skill (see the Orchestration & Delegation row in [Skills](#skills) above) keep a small local scratchpad across sessions. It needs **no setup** — the skill creates the directory on first write and appends it to `.gitignore` itself.

Two files, split by what they hold:

| File                          | Holds                                    |
| ----------------------------- | ---------------------------------------- |
| `.konductor/memory/MEMORY.md` | Project, codebase, and environment facts |
| `.konductor/memory/USER.md`   | Personal preferences and working style   |

An optional `.konductor/memory-config.json` lets you tune two things: the per-file character limits and a URL allowlist restricting which external domains can appear in an entry. Copy the template to get started:

```bash
mkdir -p .konductor && cp skills/persistent-memory/memory-config.json.template .konductor/memory-config.json
```

Every write is checked by a validator script — an entry that exceeds a limit or fails the allowlist is rejected and reported back to you, never silently dropped.

## SOPs (Standard Operating Procedures)

`konductor install` converts each SOP below into a `sop-<name>` skill: in Claude Code it is invoked as `/sop-<name>`, and in Kiro CLI it is installed to `.kiro/skills/sop-<name>/SKILL.md`, next to the ordinary skills. The `sop-` prefix keeps SOPs distinct from ordinary skills.

| SOP                                  | What it does                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `about-konductor`                    | Onboards a new or lost user: install the CLI, then find and run the skills, SOPs and workflows                                                   |
| `k-plan`                             | Work breakdown with success criteria, task dependencies, skill assignments, and timeline estimates                                                |
| `k-context-gathering`                | Pre-implementation context gathering for unfamiliar code, complex multi-system changes, or after repeated debugging failures                      |
| `k-comprehensive-search`             | Exhaustive codebase and documentation search, with code and documentation searches run in parallel where the runtime offers subagents            |
| `k-verify`                           | Comprehensive completion verification with collected evidence — run before declaring any task done                                                |
| `k-design-doc-creation`              | Five-phase workflow producing a PE-ready design document: requirements grilling, outside-in structure, quality gates, adversarial review loop     |
| `k-existing-design-review`           | 10-dimension evaluation of _existing_ design artifacts before implementation (superseded for new docs by `k-design-doc-creation`)                 |
| `k-principal-engineer-design-review` | Pre-submission quality gate on a design doc — slop detection, architecture principles evaluation, and an adversarial review loop before PE review |
| `k-test-coverage-review`             | Test gap identification, E2E test planning, and security test plan generation in sequence                                                         |
| `k-e2e-test-generation`              | Deployed-app discovery via browser automation, generating unit test prompts or executable Cypress/Playwright specs                                |
| `k-light-ui-testing`                 | Live discovery and prompt-driven UI testing for pages not yet ready for full functional test generation                                           |
| `k-code-review-workflow`             | Multi-skill review across backend, frontend, and infrastructure files with false-positive critique and a consolidated report                      |
| `k-pre-cr-critique`                  | Lightweight, strictly read-only pre-submission critique of local changes                                                                          |
| `k-code-cleanup`                     | Removes AI-generated slop from code before review submission                                                                                      |
| `k-codebase-analysis`                | Deep-dive architecture, design-pattern, and technical-debt assessment for onboarding or refactor planning                                         |
| `kiro-spec-workflow`                 | Chains the three `kiro-*-generation` skills into a complete Kiro IDE spec (`requirements.md` + `design.md` + `tasks.md`)                          |
| `k-adversarial-pull-request-review`  | Adversarial review of a pull request/CR diff — classifies findings as CRITICAL/IMPORTANT/MINOR before merge                                       |
| `k-full-sdlc`                        | End-to-end SDLC pass — codebase analysis through documentation — chaining the SOPs above per feature                                              |

## Usage Examples

**Review a diff before opening a PR (Claude Code):**

```bash
claude
> /sop-k-code-review-workflow
```

**The same in Kiro CLI:**

```bash
kiro-cli chat
> Read .kiro/skills/sop-k-code-review-workflow/SKILL.md and run it against my current branch.
```

**Targeted request that uses one skill (Claude Code):**

```bash
claude -p "Use the threat-modeling skill to create a threat model for a public REST API backed by DynamoDB."
```

**Run the full-SDLC SOP (Claude Code):**

```bash
claude
> /sop-k-full-sdlc <project_description> [codebase_path] [skip_phases] [output_dir] [elicitation_depth] [max_fix_cycles] [deployed_url] [credentials_file] [feature_isolation]
```

`<>` = required, `[]` = optional:

| Parameter             | Required? | Default           | Notes                                                                                                                                                                                     |
| --------------------- | --------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project_description` | required  | —                 | the project or feature to build                                                                                                                                                           |
| `codebase_path`       | optional  | current directory |                                                                                                                                                                                           |
| `skip_phases`         | optional  | none              | comma-separated: `elicitation`, `codebase-analysis`, `requirements`, `design`, `design-review`, `feature-splitting`, `specs`, `implementation`, `code-review`, `testing`, `documentation` |
| `output_dir`          | optional  | `.konductor/`     |                                                                                                                                                                                           |
| `elicitation_depth`   | optional  | `standard`        | `quick`, `standard`, `deep`                                                                                                                                                               |
| `max_fix_cycles`      | optional  | `2`               |                                                                                                                                                                                           |
| `deployed_url`        | optional  | none              | only used by the UI/functional test phase                                                                                                                                                 |
| `credentials_file`    | optional  | none              | same phase                                                                                                                                                                                |
| `feature_isolation`   | optional  | `branch`          | `branch`, `worktree`                                                                                                                                                                      |

A bare positional string is parsed positionally and can land words in the wrong slot (`output_dir: parser`, `skip_phases: json` is a real failure mode), so use named parameters:

```bash
claude -p "/sop-k-full-sdlc project_description: 'a CLI tool that tails a log file and alerts on error spikes' max_fix_cycles: 5"
```

The SOP runs every phase, codebase analysis through documentation, and writes its artifacts under `.konductor/`. In Kiro CLI, ask the session to read `.kiro/skills/sop-k-full-sdlc/SKILL.md` and run it with the same parameters, or use the `_k-full-sdlc.yml` workflow described in [First run](#first-run).

## Optional Integrations

Konductor registers none of these MCP servers for you. Register each one you need in your harness's own MCP configuration.

| Used by                                                         | Integration                                                                                                    | Setup                                                                                                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aws-mcp-usage`, `aws-service-validator`, `find-aws-skills`     | [AWS MCP Server](https://aws.amazon.com/blogs/aws/aws-mcp-server/): AWS documentation, region/service lookups  | Register it as `aws-mcp` with a pinned version and a read-only profile, and pre-approve only its read-only tools. The `aws-mcp-usage` skill has the exact configuration. |
| `app-discovery`, `k-e2e-test-generation`, `k-light-ui-testing`  | [`@playwright/mcp`](https://github.com/microsoft/playwright-mcp): browser automation                           | Register `npx @playwright/mcp@latest` as an MCP server and install the Chromium binary: `npx playwright install chromium`.                                       |
| `external-research`                                             | Slack search                                                                                                   | Opt-in; requires registering your own Slack app against the official Slack MCP server. See [docs/guides/slack-integration.md](docs/guides/slack-integration.md). |
| `asana-sprint-planning`                                         | Asana sprint planning                                                                                          | Opt-in; requires an Asana MCP server (`https://mcp.asana.com/v2/mcp`). See [docs/guides/asana-integration.md](docs/guides/asana-integration.md).                  |

## Roadmap: The Konductor CLI

Konductor's engineering design defines a standalone `konductor` CLI — a thin orchestration wrapper with no model dependency of its own — as the external-facing install path.

The `konductor` CLI provides the following commands:

| Command               | Purpose                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `konductor install`   | Copy a local `synth` output tree's skills and SOPs into the detected runtime (`.kiro/` or `.claude/`) |
| `konductor update`    | Overwrite a tracked install in place from a fresh `synth` source                                    |
| `konductor uninstall` | Remove a tracked install's files and its entry from `~/.konductor/installs`                         |
| `konductor synth`     | Transform source skills and SOPs into per-runtime output (`kiro-cli-v2`, `kiro-v3`, `claude`)       |
| `konductor init`      | Scaffold `.konductor/` and a starter `config.yml` from a preset (`solo`, `team`, `org`)             |
| `konductor doctor`    | Inspect an install/checkout for problems and report remediation guidance                            |
| `konductor config`    | Get/set/list configuration values                                                                   |

Get `konductor` today via the quick install script or a from-source build (see [Quick Start](#quick-start) above) and run it with an explicit `konductor install --harness <kiro-cli-v2|kiro-v3|claude>`: `--harness` is required, naming which runtime's output to install, rather than auto-detecting it from the destination.

## Project Structure

```text
konductor/
├── agent-sops/            # 18 SOPs (.sop.md)
├── skills/                # 79 skills (skills/<name>/SKILL.md)
├── fuse/flow/             # fuse-flow workflow runner and workflow definitions
├── docs/guides/           # Getting-started and integration guides
├── cli/                   # Konductor CLI
├── .github/               # Issue and PR templates
├── CHANGELOG.md
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE.txt            # Apache-2.0
├── NOTICE.txt             # Third-party attribution
├── SECURITY.md
├── aim.json               # Package/plugin build metadata
└── README.md
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to report bugs, request features, and submit pull requests. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards.

## Security

See [SECURITY.md](SECURITY.md) for how to report a security vulnerability.

## License

Licensed under the Apache License, Version 2.0 — see [LICENSE.txt](LICENSE.txt). Third-party attribution is in [NOTICE.txt](NOTICE.txt).

## Data Collection

`konductor` sends operational metrics to AWS about how this solution is used. This is not anonymous: every event carries a persistent identifier.

**What's collected.** Seven event types: `agent_invocation`, `subagent_invocation`, `mcp_tool_call`, `cli_error`, `package_installed`, `package_version_updated`, `package_uninstalled`. Each event carries an agent or sub-agent name, the CLI subcommand that failed (for errors), which harness ran it (`kiro-cli-v2`, `kiro-v3`, or `claude`), the CLI's own version, and — for install/update events — the installed content's own version. A session identifier is included when the harness exposes one (Claude Code; Kiro CLI does not), but never the raw value — it's hashed together with that project's own per-install identifier first, so the same underlying session ID produces a different value on a different install. Project paths, directory names, and file contents are never collected. See [`docs/telemetry-schema.json`](docs/telemetry-schema.json) for the exact schema.

**The identifier is machine-scoped, not per-project.** The first time Konductor successfully reports a telemetry event anywhere on a machine — typically the first `konductor install` that isn't run with `--no-telemetry` — it mints one UUID and stores it at `$HOME/.konductor/telemetry.json`. That same UUID is then sent on every event from every project you install Konductor into on that machine — a receiving service can tell that events from several different projects came from the same machine, even though it can't tell which projects.

**Opting out.** `konductor install --no-telemetry` disables reporting for that install — the identity file it would otherwise write is never created, and no telemetry event is ever sent for that target. This is per-project: it applies to the specific target directory that install ran against, not the whole machine.

To decline for the whole machine, edit `$HOME/.konductor/telemetry.json` and set `"telemetry_consent": false`. This file is created the first time any telemetry event actually gets reported on the machine (a successful install, an agent invocation, and so on — never a `--no-telemetry` install, which reports nothing) — if it doesn't exist yet, there's nothing to edit. Once it exists, just flip that one field; Konductor reads this file but never resets an existing value, so a consent you set by hand stays in place across later installs and updates on that machine. A record missing any of its four fields (`schema_version`, `UUID`, `created_at`, `telemetry_consent`) or carrying a `UUID` that isn't exactly 64 lowercase hex characters is treated as unreadable — but it does not get replaced. Konductor never deletes or overwrites this file once it exists, so a malformed record is permanent: every subsequent event silently drops to an untraceable placeholder identifier and no consent flag is read until you repair the JSON or delete the file by hand.

Reporting for any given install requires both the per-project flag and this machine-level setting to allow it; either one being off is enough to suppress it. `konductor doctor` reports which of these is in effect for the current install, including whether a machine-level decline is the reason a project that never opted out isn't reporting.

This solution sends operational metrics to AWS (the "Data") about the use of this solution. We use this Data to better understand how customers use this solution and related services and products. AWS's collection of this Data is subject to the [AWS Privacy Notice](https://aws.amazon.com/privacy/).

To opt out, pass `--no-telemetry` to `konductor install`/`konductor update`, set `telemetry.enabled: false` in `.konductor/config.yml`, or set `KONDUCTOR_TELEMETRY=off` in your environment.

---

Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at <http://www.apache.org/licenses/LICENSE-2.0>

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
