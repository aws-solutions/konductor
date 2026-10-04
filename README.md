# Konductor

| **[🚧 Feature request](https://github.com/aws-solutions/konductor/issues/new?labels=enhancement&template=feature_request.md)** | **[🐛 Bug Report](https://github.com/aws-solutions/konductor/issues/new?labels=bug&template=bug_report.md)** |

Konductor is an open-source package of skills, standard operating procedures (SOPs) and workflows that automate the software development lifecycle (SDLC). A single agent session in Kiro CLI or Claude Code runs a workflow one step at a time and loads the skill each step names, so a request can move from requirements through design, specs, implementation, code review, testing and documentation with the same quality gates at every step.

> **Note:** Konductor used to ship agent specs: eight specialists and three orchestrators that routed work between them. They were removed, together with the skills and the SOP that only routed work to subagents; see [docs/research/2026-09-26-orchestration-skills-and-sops.md](docs/research/2026-09-26-orchestration-skills-and-sops.md). The user guide, which described the agents and the removed `konductor` command line tool, is not on this branch. The integration guides under [`docs/guides/`](docs/guides/) still describe the agent-based layout and have not been rewritten yet. To install, use [INSTALL.md](INSTALL.md).

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
9. [Project Structure](#project-structure)
10. [Contributing](#contributing)
11. [Security](#security)
12. [License](#license)
13. [Data Collection](#data-collection)

---

## Why Konductor

Most AI coding sessions improvise their process. Konductor gives the session a written one: skills that say how to write requirements, design a system, review a design, split features, write specs, implement, review code, plan tests and document, each with its own checker, and workflows that run those skills in order with gates where the owner signs off.

You get this by installing one package. No servers to run and no infrastructure to provision: the skills, SOPs and workflows are files that your existing Kiro or Claude Code runtime reads directly.

## Quick Start

### Installing

Clone the `fuse` branch and run `install.sh`, into one project or for yourself across projects:

```bash
git clone -b fuse https://github.com/aws-solutions/konductor.git fuse-konductor
cd fuse-konductor
./install.sh --project /path/to/your/project
./install.sh --global ~/.claude/CLAUDE.md
```

[INSTALL.md](INSTALL.md) covers every supported harness, update, uninstall and customer forks.

### First run

**Full SDLC pass with fuse-flow.** The workflow runner lives in this repository under [`fuse/flow/`](fuse/flow/README.md) and needs [Bun](https://bun.sh) or Node 22.18+, 23.6+ or 24+ with npm; it installs its own dependencies on first use. `install.sh` does not copy it, so run it from your checkout:

```bash
cd <your-project>
<konductor-checkout>/fuse/flow/fuse-flow start my-feature --workflow _k-full-sdlc
```

Then, in a Kiro CLI or Claude Code session in that project, ask:

```text
Run `<konductor-checkout>/fuse/flow/fuse-flow start my-feature` and do what it says. When a step is
done, run `continue`, which prints the next step. Repeat until the workflow is complete. Stop at
each owner gate and show me the artifact.
```

Each step names its skill and the artifact it must produce under `.konductor/`. `fuse-flow continue` refuses a step until its artifacts exist, and a gated step waits until you approve it with `fuse-flow continue my-feature --owner-approved`. fuse-flow finds skills in every directory `install.sh` writes to, so it needs no extra setup; [`fuse/flow/README.md`](fuse/flow/README.md) lists them.

---

## Workflows

The workflow definitions in [`fuse/flow/workflows/`](fuse/flow/workflows/) are the entry points for multi-phase work.

| Workflow                   | Steps                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_k-full-sdlc.yml`         | Elicitation, codebase analysis, requirements, design, design review, feature splitting, specs, implementation, code review, testing, documentation and a final summary, with owner gates between phases. |
| `_k-phase-chain.yml`       | The lighter chain: requirements, design, feature splitting, specs, implementation, code review and QA, with no owner gates.                                                |
| `examples/custom-example-*.yml` | Examples of project-specific workflows at different sizes.                                                                                                       |
| `examples/superpowers/superpowers.yml` | Spec-driven development after obra/superpowers: design, plan, branch and baseline, test-first implementation with a whole-branch review, and the owner's choice of integration. Needs no Superpowers skills installed. |

For a single task, ask the session to use a skill directly; see [Usage Examples](#usage-examples).

You can edit these workflows or add your own in the same folder. Personal workflows that you do not want to share go in `fuse/flow/workflows/personal/`, which is gitignored. To share workflows with a group but not with everybody, keep them in a separate repository and add a symlink to it named `fuse/flow/workflows/team`, which is gitignored too. fuse-flow finds a workflow by name in any folder below `fuse/flow/workflows/`; [`fuse/flow/README.md`](fuse/flow/README.md) gives the lookup order.

## Skills

Skills are modular knowledge packages that a session loads when a task needs them. On Claude Code, installed skills live in `.claude/skills/`: only their names and descriptions are in context at session start, and the full content loads when a skill is invoked. On Kiro CLI, skills are installed to `.kiro/skills/`, where Kiro CLI's native skill discovery finds them. (A package that ships agent specs installs its skills under `.konductor/skills/` instead, so that each agent sees only the skills it declares; this package ships none.) The package ships **79 skills** across 8 capability areas:

| Category                          | Count | Representative skills                                                                                                                       | Covers                                                                                                                                                                                    |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture & Design             | 22    | `system-design-patterns`, `threat-modeling`, `dynamodb-design`, `iam-policy-design`, `smithy-modeling`, `cost-estimation`, `adr-generator`  | System design docs, STRIDE threat models, data models, least-privilege IAM, Smithy API models, AWS cost scenarios, trade-off scoring, ADRs, adversarial design review, design elicitation |
| Planning & Tracking               | 13    | `user-story-writing`, `task-decomposition`, `sprint-planning`, `risk-management`, `program-planning`, `progress-tracking`                   | Requirements → user stories → task/sprint breakdown, program plans and decision docs, RAID logs, status reports, plan critique                                                            |
| Architecture & Development Review | 14    | `backend-development`, `frontend-development`, `infra-validation`, `code-review`, `git-workflow`, `adversarial-code-review`                 | Backend/frontend implementation, CDK/CloudFormation validation, IAM/security policy validation, standard and adversarial code review, git workflow                                        |
| Testing & QA                      | 8     | `test-coverage-analysis`, `e2e-test-strategy`, `cypress-test-implementation`, `security-test-generation`                                    | Coverage gap analysis, prioritized E2E test matrices, Cypress/Playwright planning, OWASP-based security test plans, web app/DOM discovery                                                 |
| Orchestration & Delegation        | 10    | `sdlc-navigator`, `pre-planning-analysis`, `persistent-memory`, `workspace-skills`, `sop-state-management`, `asdlc-aspect-review`          | SDLC phase flow, ambiguous-request triage, cross-session memory, reusable workspace skills, resumable SOP state, parallel n-aspect review, fuse-flow workflow authoring                     |
| Kiro Spec Generation              | 3     | `kiro-requirements-generation`, `kiro-design-generation`, `kiro-task-generation`                                                            | Chained skills that turn PM/architecture artifacts into a Kiro IDE `requirements.md` / `design.md` / `tasks.md` spec                                                                      |
| Documentation & Writing           | 4     | `document-formats`, `doc-accuracy-analyzer`, `humanize-writing`, `agents-md-authoring`                                                      | Reading/writing `.docx`, fact-checking technical documents against primary sources, rewriting AI-sounding text, authoring AGENTS.md files                                                 |
| Research & Security               | 5     | `external-research`, `security-remediation`, `find-aws-skills`, `aws-mcp-usage`, `about-konductor`                                          | External documentation/web research, security-finding remediation planning, discovering additional AWS skills, AWS MCP confirmation rules, onboarding a new user to Konductor             |

## Persistent Memory

Sessions that load the `persistent-memory` skill (see the Orchestration & Delegation row in [Skills](#skills) above) keep a small local scratchpad across sessions. It needs `bash` and [Bun](https://bun.sh), and no other setup: the skill creates the directory on first write and appends it to `.gitignore` itself.

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

The SOPs below live in `agent-sops/`. The installer does not install them; they are being replaced by fuse-flow workflows.

| SOP                                  | What it does                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `about-konductor`                    | Onboards a new or lost user: install, then find and use the skills and workflows                                                                  |
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

**Review a diff before opening a PR:**

```bash
claude
> Use the code-review skill to review my current branch against main.
```

**Targeted request that uses one skill:**

```bash
claude -p "Use the threat-modeling skill to create a threat model for a public REST API backed by DynamoDB."
```

**Run the full SDLC workflow:** start the `_k-full-sdlc` workflow with fuse-flow as described in [First run](#first-run), then let the session follow the steps `fuse-flow start` and `continue` print. It runs every phase, requirements through documentation, and writes its artifacts under `.konductor/`.

The same prompts work in Kiro CLI, Codex, Cursor and OpenCode sessions.

## Optional Integrations

Konductor registers none of these MCP servers for you. Register each one you need in your harness's own MCP configuration.

| Used by                                                         | Integration                                                                                                    | Setup                                                                                                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aws-mcp-usage`, `aws-service-validator`, `find-aws-skills`     | [AWS MCP Server](https://aws.amazon.com/blogs/aws/aws-mcp-server/): AWS documentation, region/service lookups  | Register it as `aws-mcp` with a pinned version and a read-only profile, and pre-approve only its read-only tools. The `aws-mcp-usage` skill has the exact configuration. |
| `app-discovery`, `k-e2e-test-generation`, `k-light-ui-testing`  | [`@playwright/mcp`](https://github.com/microsoft/playwright-mcp): browser automation                           | Register `npx @playwright/mcp@latest` as an MCP server and install the Chromium binary: `npx playwright install chromium`.                                       |
| `external-research`                                             | Slack search                                                                                                   | Opt-in; requires registering your own Slack app against the official Slack MCP server. See [docs/guides/slack-integration.md](docs/guides/slack-integration.md). |
| `asana-sprint-planning`                                         | Asana sprint planning                                                                                          | Opt-in; requires an Asana MCP server (`https://mcp.asana.com/v2/mcp`). See [docs/guides/asana-integration.md](docs/guides/asana-integration.md).                  |

## Project Structure

```text
konductor/
├── agent-sops/            # 18 SOPs (.sop.md)
├── skills/                # 78 skills (skills/<name>/SKILL.md)
├── fuse/flow/             # fuse-flow workflow runner and workflow definitions
├── docs/guides/           # Getting-started and integration guides
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

fuse-konductor collects no data. The installer sends nothing over the network. fuse-flow downloads its two dependencies, zod and yaml, from the npm registry when they are missing from `fuse/flow/node_modules` in your clone, normally only the first time it runs; otherwise it sends nothing. Offline, that run fails and names the install command to run.

---

Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at <http://www.apache.org/licenses/LICENSE-2.0>

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
