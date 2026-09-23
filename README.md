# Konductor

| **[🚧 Feature request](https://github.com/aws-solutions/konductor/issues/new?labels=enhancement&template=feature_request.md)** | **[🐛 Bug Report](https://github.com/aws-solutions/konductor/issues/new?labels=bug&template=bug_report.md)** |

Konductor is an open-source AI agent framework that automates the software development lifecycle (SDLC). It ships a coordinated team of specialist agents — product manager, architect, developer, QA, researcher, technical program manager (TPM), browser, media analyzer, plus three orchestrators — each with scoped tools, skills, and standard operating procedures (SOPs). Agents hand work to each other through a structured delegation protocol, so a request can move from requirements to reviewed, working code with minimal manual handoff.

The package ships as static agent configuration compatible with [Kiro](https://kiro.dev) and [Claude Code](https://claude.ai/download). No runtime infrastructure is required beyond the AI runtime itself.

---

## Table of Contents

1. [Why Konductor](#why-konductor)
2. [Quick Start](#quick-start)
3. [Agents](#agents)
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

Most AI coding agents are single-purpose: one agent, one conversation, one task. Konductor instead installs a small team of agents that already know how to hand work to each other — a product manager who writes requirements, an architect who turns them into a design, a developer who implements it, a QA agent who plans the test coverage — coordinated by an orchestrator that tracks progress and enforces a maker-checker quality gate on every deliverable.

You get this by installing one package. No servers to run, no infrastructure to provision — the agents are configuration (system prompts, skills, SOPs) that your existing Kiro or Claude Code runtime executes directly.

## Quick Start

### Quick install (single command)

```bash
curl -fsSL https://raw.githubusercontent.com/aws-solutions/konductor/refs/heads/main/scripts/konductor-bootstrap.sh | bash
```

This fetches [`scripts/konductor-bootstrap.sh`](scripts/konductor-bootstrap.sh), a small script whose only job is to download the real installer, [`scripts/konductor-install.sh`](scripts/konductor-install.sh), verify it against the checksum GitHub's own Contents API reports for that file, and run it. Requires `jq`, used to pull that checksum out of the API's JSON response.

Piping a remote script into `bash` runs code you haven't read, so (as with any curl-pipe-to-shell installer) read [`scripts/konductor-bootstrap.sh`](scripts/konductor-bootstrap.sh) and [`scripts/konductor-install.sh`](scripts/konductor-install.sh) yourself first if you want to audit what you're running before you run it.

`konductor-install.sh` detects your OS and architecture, resolves the latest published release, downloads that platform's `konductor` binary plus its `.sha256` checksum sidecar, verifies the checksum, and symlinks the verified binary into `~/.local/bin`. No additional authentication or access beyond an unauthenticated GitHub release download is needed, so anyone will be able to run it as-is. It then runs `konductor install` with no `--from` flag against `$HOME` (or wherever `HOME` points for the invocation), which fetches the rest of what it needs (the packaged agent/skill/SOP content and the platform's `skill-lookup-mcp` MCP server binary) directly from the same release. It installs for `kiro-cli-v2`, the default runtime target, unless you set `KONDUCTOR_HARNESS=claude` (or `kiro-v3`) to target a different one.

Supported platforms are Linux (`x86_64` or `aarch64`) and macOS on Apple Silicon (`arm64`): the same three the release build matrix publishes binaries for. On any other platform (Intel macOS, Windows, or anything else), the script fails with a clear error naming the three it supports; use [Installing from source](#installing-from-source) below instead.

Re-running the script later always installs whatever release is currently latest: it re-downloads, re-verifies, and overwrites both the versioned binary and the `~/.local/bin/konductor` symlink every time, so there's no persistent checkout to keep in sync. Set `KONDUCTOR_TAG=v0.1.2` (or any published release tag) to pin the install to that release instead of latest.

If `~/.local/bin` isn't already on your `PATH`, the script prints a note at the end telling you to add it (e.g. `export PATH="$HOME/.local/bin:$PATH"` in your shell profile) — otherwise the `konductor` command it just linked won't resolve.

### How installing Konductor works

Getting Konductor running is two steps against your own checkout: `synth`, then `install`.

`konductor synth --from <repo-root>` reads this repo's agent/skill/SOP source and renders it into a runtime-ready output tree. `konductor install --from <repo-root>` then copies the agent, skill, and SOP output into your runtime's config directories and records a manifest so a later `konductor update` or `konductor uninstall` knows what it's responsible for. SOPs land differently per runtime: Kiro CLI gets the rendered `.sop.md` files copied as-is into `.konductor/sops/`, while Claude Code gets each one converted into its own `sop-<name>/SKILL.md` under `.claude/skills/`.

Both commands work today for Kiro CLI and Claude Code. `install` requires an explicit `--harness <kiro-cli-v2|kiro-v3|claude>` flag naming which runtime's synthed output to install — there is no destination-marker auto-detection and no default; omitting `--harness` is a usage error. `--harness kiro-cli-v2` installs agents under `.kiro/agents/` and skills under `.konductor/skills/<name>/` (kept separate from `.kiro/skills/` so Kiro CLI doesn't expose every installed skill to every agent); `--harness claude` installs agents and skills under `.claude/agents/` and `.claude/skills/`; `--harness kiro-v3` installs for Kiro CLI's V3 (KAS) engine. Every one of these paths is relative to the install target — `--target <dir>` if given, else `$HOME` — not hardcoded to your home directory.

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
kiro-cli chat --agent konductor
```

**Claude Code** — pass `--target` at a directory that already has a `.claude/` marker (Claude Code itself creates one on first run in a project):

```bash
konductor install --from . --harness claude --target <dir-with-.claude-marker>
claude --agent konductor
```

> This is the short version. For prerequisites, the PATH-setup check, and a fully
> spelled-out numbered walkthrough (build → link → verify → synth → install → chat),
> see [`cli/README.md`](cli/README.md#getting-started). That doc also covers installing
> into a directory other than `$HOME` via `--target`.

### First run

**Full SDLC pass, via the orchestrator (Kiro CLI).** The install paths above leave you at the `konductor` prompt. A full pass starts from a plain-language request typed there:

```text
Design and implement a service that ingests IoT sensor events and alerts on anomalies.
```

The orchestrator delegates to `k-architect` for the design, `k-developer` for implementation, and `k-quality-assurance` for test coverage — verifying each handoff before moving on.

---

## Agents

`konductor` is the primary entry point — it never implements directly. It delegates to the right specialist, verifies the output, and re-delegates if a quality gate fails (up to 2 fix cycles).

| Agent                         | Role                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `k-product-manager`           | Produces user stories, requirements summaries, and decision research. Validates each artifact before handoff.                                |
| `k-architect`                 | Creates system designs, API specs, data models, and threat models. Validates each artifact before handoff to implementation.                 |
| `k-developer`                 | Breaks features into tasks, implements backend and frontend code, reviews changes, validates infrastructure-as-code, and tracks progress.    |
| `k-quality-assurance`         | Analyzes test coverage, plans E2E test strategies, generates security tests, and tracks Cypress implementation.                              |
| `k-researcher`                | Searches external documentation, web resources, and AWS docs; optional Slack search via a user-configured Slack MCP server.                  |
| `k-tpm`                       | Manages program plans, status reports, risk tracking, and program-level decision documents.                                                  |
| `k-browser`                   | Browser automation via Playwright — navigates sites, fills forms, takes screenshots, runs E2E tests.                                         |
| `k-media-analyzer`            | Interprets PDFs, images, and diagrams that need analysis beyond raw text extraction.                                                         |
| `konductor`                   | Coordinates all specialist agents across the SDLC, delegates tasks, tracks progress, and enforces quality gates.                             |
| `konductor-mux-orchestrator`  | Same coordination as the orchestrator, dispatched to specialists running in parallel tmux/zellij panes. Auto-detects the active multiplexer. |
| `konductor-cmux-orchestrator` | Same coordination as the orchestrator, dispatched to specialists running in parallel [cmux](https://github.com/manaflow-ai/cmux) surfaces.   |

## Skills

Skills are modular knowledge packages. For this package's Claude Code agents, every skill listed in an agent's `skills:` frontmatter is injected in full at session start — not just its name and description (see [Getting Started with Claude Code](docs/guides/getting-started-claude.md#skills-how-they-load-and-who-can-invoke-them) for the loading mechanics). A skill not preloaded into an agent this way — e.g. a project skill under `.claude/skills/` — instead loads on demand: only its name and description are available at session start, with full content loading when it is invoked. The package ships **82 skills** across 8 capability areas:

| Category                          | Count | Representative skills                                                                                                                       | Covers                                                                                                                                                                                    |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture & Design             | 22    | `system-design-patterns`, `threat-modeling`, `dynamodb-design`, `iam-policy-design`, `smithy-modeling`, `cost-estimation`, `adr-generator`  | System design docs, STRIDE threat models, data models, least-privilege IAM, Smithy API models, AWS cost scenarios, trade-off scoring, ADRs, adversarial design review, design elicitation |
| Planning & Tracking               | 14    | `user-story-writing`, `task-decomposition`, `sprint-planning`, `risk-management`, `program-planning`, `progress-tracking`                   | Requirements → user stories → task/sprint breakdown, program plans and decision docs, RAID logs, status reports, legacy-to-agentic effort re-estimation, plan critique                    |
| Architecture & Development Review | 14    | `backend-development`, `frontend-development`, `infra-validation`, `code-review`, `git-workflow`, `adversarial-code-review`                 | Backend/frontend implementation, CDK/CloudFormation validation, IAM/security policy validation, standard and adversarial code review, git workflow                                        |
| Testing & QA                      | 8     | `test-coverage-analysis`, `e2e-test-strategy`, `cypress-test-implementation`, `security-test-generation`                                    | Coverage gap analysis, prioritized E2E test matrices, Cypress/Playwright planning, OWASP-based security test plans, web app/DOM discovery                                                 |
| Orchestration & Delegation        | 13    | `delegation-protocol`, `sdlc-navigator`, `pre-planning-analysis`, `persistent-memory`, `workspace-skills`, `mux-dispatch` / `cmux-dispatch` | Agent routing and the 7-section delegation format, ambiguous-request triage, cross-session memory, reusable workspace skills, parallel dispatch, parallel n-aspect review                 |
| Kiro Spec Generation              | 3     | `kiro-requirements-generation`, `kiro-design-generation`, `kiro-task-generation`                                                            | Chained skills that turn PM/architecture artifacts into a Kiro IDE `requirements.md` / `design.md` / `tasks.md` spec                                                                      |
| Documentation & Writing           | 4     | `document-formats`, `doc-accuracy-analyzer`, `humanize-writing`, `agents-md-authoring`                                                      | Reading/writing `.docx`, fact-checking technical documents against primary sources, rewriting AI-sounding text, authoring AGENTS.md files                                                 |
| Research & Security               | 4     | `external-research`, `security-remediation`, `find-aws-skills`, `about-konductor`                                                           | External documentation/web research, security-finding remediation planning, discovering additional AWS skills, onboarding a new user to Konductor                                         |

## Persistent Memory

Agents that load the `persistent-memory` skill (see the Orchestration & Delegation row in [Skills](#skills) above) keep a small local scratchpad across sessions. It needs **no setup** — the skill creates the directory on first write and appends it to `.gitignore` itself.

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

The user-facing SOPs below are available as slash-command-style workflows in Kiro CLI (`/prompts`) and as `/sop-<name>` in Claude Code — `konductor synth` prefixes converted SOPs with `sop-` so they stay distinct from skills. Also present: `k-delegate`, which handles orchestrator-internal delegation and isn't meant to be invoked directly.

| SOP                                  | What it does                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `about-konductor`                    | Onboards a new or lost user: install the CLI, talk to the orchestrator in plain language, and let it delegate                                     |
| `k-plan`                             | Work breakdown with success criteria, task dependencies, agent assignments, and timeline estimates                                                |
| `k-context-gathering`                | Pre-implementation context gathering for unfamiliar code, complex multi-system changes, or after repeated debugging failures                      |
| `k-comprehensive-search`             | Exhaustive codebase and documentation search, delegating in parallel to the developer and researcher agents                                       |
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

**Review a diff before opening a PR, via the orchestrator (Kiro CLI):**

```bash
kiro-cli chat --agent konductor
> "Run the k-code-review-workflow SOP against my current branch."
```

The orchestrator routes this to `k-developer`, which owns the `k-code-review-workflow` SOP.

**Targeted request, via the orchestrator (Claude Code):**

```bash
claude --agent konductor -p "Create a threat model for a public REST API backed by DynamoDB."
```

The orchestrator routes threat-modeling requests to `k-architect` and returns the validated artifact.

**Run the full-SDLC SOP directly, via the orchestrator (Kiro CLI):**

```bash
kiro-cli chat --agent konductor
> /prompts
> /agent-sop:k-full-sdlc <project_description> [codebase_path] [skip_phases] [output_dir] [elicitation_depth] [max_fix_cycles] [deployed_url] [credentials_file] [feature_isolation]
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

`/prompts` lists the SOPs available to invoke; asking for one in prose does not work here — Agent SOPs load only when invoked through `/agent-sop:`, never from a description alone. A bare positional string is parsed positionally and can land words in the wrong slot (`output_dir: parser`, `skip_phases: json` — a real failure mode); use named parameters instead:

```bash
> /agent-sop:k-full-sdlc project_description: "JSON parser" max_fix_cycles: 5
```

**Run the full-SDLC SOP directly, via the orchestrator (Claude Code):**

```bash
claude --agent konductor -p "/sop-k-full-sdlc project_description: 'a CLI tool that tails a log file and alerts on error spikes'"
```

Here the SOP ships as a native Claude Code skill invoked via `/sop-k-full-sdlc` — `konductor synth`'s `sop-` prefix keeps it distinct from regular skills. The same named-parameter syntax as the Kiro CLI form above applies.

The orchestrator runs the SOP through every phase — codebase analysis through documentation — writing artifacts under `.konductor/`.

## Optional Integrations

Two MCP servers ship pre-wired — AWS MCP on the architect and developer agents, Playwright on the browser agent. Two more agents support opt-in servers you configure yourself.

| Agent                        | Integration                                                                                                    | Setup                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `k-architect`, `k-developer` | [AWS MCP Server](https://aws.amazon.com/blogs/aws/aws-mcp-server/) — AWS documentation, region/service lookups | Install `uvx` and configure AWS credentials (`~/.aws/credentials` or environment variables). The agent degrades gracefully if credentials are absent.             |
| `k-browser`                  | [`@playwright/mcp`](https://github.com/microsoft/playwright-mcp) — browser automation                          | Pre-wired, no separate install. Requires the Chromium binary: `npx playwright install chromium`.                                                                  |
| `k-researcher`               | Slack search                                                                                                   | Opt-in — requires registering your own Slack app against the official Slack MCP server. See [docs/guides/slack-integration.md](docs/guides/slack-integration.md). |
| `k-product-manager`          | Asana sprint planning (`asana-sprint-planning` skill)                                                          | Opt-in — requires an Asana MCP server (`https://mcp.asana.com/v2/mcp`). See [docs/guides/asana-integration.md](docs/guides/asana-integration.md).                 |

## Roadmap: The Konductor CLI

Konductor's engineering design defines a standalone `konductor` CLI — a thin orchestration wrapper with no model dependency of its own — as the external-facing install path.

The `konductor` CLI provides the following commands:

| Command               | Purpose                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `konductor install`   | Copy a local `synth` output tree's agents/skills into the detected runtime (`.kiro/` or `.claude/`) |
| `konductor update`    | Overwrite a tracked install in place from a fresh `synth` source                                    |
| `konductor uninstall` | Remove a tracked install's files and its entry from `~/.konductor/installs`                         |
| `konductor synth`     | Transform source agent specs into per-runtime output (`kiro-cli-v2`, `kiro-v3`, `claude`)           |
| `konductor init`      | Scaffold `.konductor/` and a starter `config.yml` from a preset (`solo`, `team`, `org`)             |
| `konductor doctor`    | Inspect an install/checkout for problems and report remediation guidance                            |
| `konductor config`    | Get/set/list configuration values                                                                   |

Agents already use their `k-*` / `konductor` names today. Get `konductor` today via the quick install script or a from-source build (see [Quick Start](#quick-start) above) and run it with an explicit `konductor install --harness <kiro-cli-v2|kiro-v3|claude>`: `--harness` is required, naming which runtime's output to install, rather than auto-detecting it from the destination.

## Project Structure

```text
konductor/
├── agents/                # 11 agent specs (.agent-spec.json)
├── agent-sops/            # 19 SOPs (.sop.md)
├── skills/                # 82 skills (skills/<name>/SKILL.md)
├── context/               # Context loaded at agent startup (e.g. orchestrator routing rules)
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
