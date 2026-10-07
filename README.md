# Konductor and Fuse

| **[🚧 Feature Request](https://github.com/aws-solutions/konductor/issues/new?labels=enhancement&template=feature_request.md)** | **[🐛 Bug Report](https://github.com/aws-solutions/konductor/issues/new?labels=bug&template=bug_report.md)** |

**Konductor** is an open-source package of skills, standard operating procedures (SOPs) and workflows that automate the software development cycle.

**Fuse-Konductor** is an evolution of Konductor with two main differences:
- Fuse-Konductor turns Konductor's elements into a reusable library of modules, aimed at users who tweak the pre-packaged workflows and assemble their own.
- Fuse-Konductor replaces Konductor's suite of specialist agent personas and orchestration rules with a workflow engine operated by your harness's default agent.

Fuse-Konductor is a set of [agent skills](https://agentskills.io/home), plus a block of "always-on" instructions installed in your [AGENTS.md](https://agents.md/) (global or project-specific).
The workflow engine ships as TypeScript code that runs on `bun` and keeps its state in local Markdown files on your machine.

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

By default, AI coding sessions improvise their process. Konductor gives the session a written one: guides that say how to write requirements, design a system, review a design, split features, write specs, implement, review code, plan tests and document, each with its own checker, and workflows that produce these artifacts in order with human or agentic quality gates.

You get this by installing one package. No servers to run and no infrastructure to provision: the skills, guides and workflows are files that your existing coding agent reads directly.

## Quick Start

### Installing

Clone the `fuse` branch and run `install.sh`, either into one project or for yourself across all projects:

```bash
git clone -b fuse https://github.com/aws-solutions/konductor.git fuse-konductor
cd fuse-konductor
./install.sh --project /path/to/your/project
./install.sh --global ~/.claude/CLAUDE.md
```

[INSTALL.md](INSTALL.md) covers every supported harness, updating, uninstalling and custom forks.

### Tutorial

Start an agent session in any project. Prompt the agent with "Start the fuse tutorial", or run the command `/fuse-tutorial`.

### Feature development with Fuse-Konductor

Prompt your agent with "Use fuse-feature-development to build <...>", giving an initial description of your feature.
This can be a few words or several paragraphs. The agent will take it from there, guiding you through the workflow and eliciting the details you haven't provided yet.

---

## Workflows

The workflow definitions in [`fuse/flow/workflows/`](fuse/flow/workflows/) are the entry points for multi-phase work.
Pick one by naming it to your agent, or let the agent pick the best fit for the work at hand.
If none of the pre-packaged workflows matches your needs, start an agent session in the Konductor repository to let the agent help you modify a workflow or build your own.
Optionally, you can use the Komposer UI (a React app running on a local dev server) to visualize and modify workflows yourself.

| Workflow                   | Steps                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_k-full-sdlc.yml`         | Elicitation, codebase analysis, requirements, design, design review, feature splitting, specs, implementation, code review, testing, documentation and a final summary, with owner gates between phases. |
| `_k-phase-chain.yml`       | The lighter chain: requirements, design, feature splitting, specs, implementation, code review and QA, with no owner gates.                                                |
| `fuse-development/fuse-feature-development.yml` | One feature in an existing codebase: intake, design, implementation and code review. Agent review of the spec and of the whole branch comes before the owner approves the spec and lands the branch. |
| `fuse-development/fuse-system-development.yml` | A new system, or a new module that needs its own architecture: intake, requirements, optional prototypes, a system design with a principal engineer review by an agent, and a build order, with agent review before each owner decision. Each feature in the build order is then built with `fuse-feature-development`. |
| `examples/custom-example-*.yml` | Examples of project-specific workflows at different sizes.                                                                                                       |
| `examples/superpowers/superpowers.yml` | Spec-driven development after obra/superpowers: design, plan, branch and baseline, test-first implementation with a whole-branch review, and the owner's choice of integration. Needs no Superpowers skills installed. |

For a single task, ask the session to use a skill directly; see [Usage Examples](#usage-examples).

You can edit these workflows or add your own in the same folder. Personal workflows that you do not want to share go in `fuse/flow/workflows/personal/`, which is gitignored. To share workflows with a group but not with everybody, keep them in a separate repository and add a symlink to it named `fuse/flow/workflows/team`, which is gitignored too. fuse-flow finds a workflow by name in any folder below `fuse/flow/workflows/`; [`fuse/flow/README.md`](fuse/flow/README.md) gives the lookup order.

## Skills and guides

Skills are modular knowledge packages that a session loads automatically when the agent thinks that a task needs them.
Their structure is defined by the [agent skills standard](https://agentskills.io/home), which all mainstream coding agents support.
While the implementation of skill activation can differ from harness to harness,
keep in mind that activation is based on each skill's `name` and `description` frontmatter, and is generally left to the agent's judgment rather than enforced.

Instructions that Konductor wants to pass to an agent deterministically (e.g. how to write a system-design.md document)
are therefore not built as skills, but as plain .md files that the workflow engine instructs the agent to use at a certain
step in the workflow. We call these instruction files "guides" rather than skills.
Guides have no frontmatter that gets loaded into every agent session, which keeps your agent's context clean.


## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to report bugs, request features, and submit pull requests. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards.

## Security

See [SECURITY.md](SECURITY.md) for how to report a security vulnerability.

## License

Licensed under the Apache License, Version 2.0 — see [LICENSE.txt](LICENSE.txt). Third-party attribution is in [NOTICE.txt](NOTICE.txt).

## Data Collection

Fuse-Konductor collects no data. The installer sends nothing over the network. fuse-flow downloads its two dependencies, zod and yaml, from the npm registry when they are missing from `fuse/flow/node_modules` in your clone, normally only the first time it runs; otherwise it sends nothing. Offline, that run fails and names the install command to run.

---

Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at <http://www.apache.org/licenses/LICENSE-2.0>

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
