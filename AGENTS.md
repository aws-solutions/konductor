# AGENTS.md

Guidance for custom agents on Kiro CLI or Claude Code. This file is loaded into agent
context at session start. Follow these instructions for the duration of the session.

## Context Loading (MUST follow at session start)

Before starting work, load available project context:

- You MUST read `.konductor/memory/*.md` if present: persistent workspace facts, decisions, and preferences.

If a path does not exist, skip it silently and continue.

## Project Overview

Konductor is an open-source package of skills, SOPs and workflows that automate the software development lifecycle. It ships as static configuration files compatible with Kiro CLI and Claude Code, with no runtime infrastructure required. The package ships no agent specs: an agent runs a workflow step by step and loads each step's skill directly (see `fuse/flow/`).

## Project Structure

```
skills/        # Skill definitions (SKILL.md + optional scripts)
agent-sops/    # Standard operating procedures (user-invoked workflows)
fuse/flow/     # fuse-flow workflow runner and workflow definitions; see fuse/flow/README.md
install.sh     # Installer; see INSTALL.md
AGENTS.fuse.md # Always-on block that install.sh writes into harness instruction files
```

## Setup & Commands

Run every test suite from the repository root with `bun run test`.

## Code Style & Conventions

- Skills follow the [Agent Skills specification](https://agentskills.io/specification). Write
  each `description` as the [optimizing-descriptions](https://agentskills.io/skill-creation/optimizing-descriptions)
  guide describes, opening with when to use the skill ("Use when ...") and then saying briefly
  what it does, in at most 1024 characters. Write the body by the
  [best practices](https://agentskills.io/skill-creation/best-practices).
- SOPs use a `k-*` name, except the older `kiro-spec-workflow` and `about-konductor`. Skills are unprefixed unless avoiding a known collision.
- **License headers:** All code files must carry an SPDX short-form identifier as the very first line
  (before any docstring or comment block), matching the project's declared Apache-2.0 license.
  `Apache-2.0` is the only permitted SPDX identifier in this package. Do not introduce any other
  identifier (MIT, BSD, ISC, a dual-license expression, or any other SPDX string).
  Exception: scripts that require a shebang (`#!`) line must place the SPDX header on **line 2**,
  immediately after the shebang, so the OS interpreter directive remains the literal first line.
  Use the native single-line comment syntax for the language:
  - Rust: `// SPDX-License-Identifier: Apache-2.0`
  - Python: `# SPDX-License-Identifier: Apache-2.0`
  - JS/TS, Go: `// SPDX-License-Identifier: Apache-2.0`
  - Shell, YAML: `# SPDX-License-Identifier: Apache-2.0`

  Formats that have no comment syntax at all (JSON and similar) cannot carry a header and are exempt -- do not add one and do not treat its absence as a violation.

## Pull Requests

Write commit messages and pull request titles as [Conventional Commits](https://www.conventionalcommits.org):
`type(scope): summary`, for example `fix(skills): tighten a skill description`. Use a component name
(`skills`, `agents`, `fuse-flow`) as the scope where one applies. Skills, agent specs, SOPs and
context files are shipped product: use `feat` or `fix` when they change agent behavior and
`refactor` when they do not, never `docs`. Changes to this file or `CLAUDE.md` are `chore`.
This convention is inferred from the existing history and is not enforced by CI.

Use [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) for every pull request.
GitHub pre-fills the PR body with it automatically. Complete every section, or delete it if it does
not apply — do not leave a section untouched with its placeholder text still in place.

## Branching

`fuse` is the integration branch; every pull request targets it. Its history stays clean and
linear, which is why merge commits are disabled. Commit as often as you like while working, but
squash before landing: either the whole pull request into one well-named commit, or related
commits within it. Five commits in a row editing the same file become one, whose message
describes the result.

- **Targeted changes** (anything that should land in `fuse` for sure) are built on a short-lived
  branch named for the change type: `feature/<slug>`, `fix/<slug>`, `chore/<slug>`,
  `refactoring/<slug>`, or `agent/<slug>` for agent-driven work. Each lands through a pull
  request that replays its commits on top of `fuse`; merge commits are disabled on the
  repository, and the branch is deleted on landing. Rebase onto the current `fuse` before
  requesting review, so the reviewed commits are the ones that land.
- **Candidates** are experimental, wide-scoped changes that alter agent behavior significantly
  and are meant to be benchmarked against `fuse` and against each other. They live on
  `candidates/<NAME>`. A candidate is not an incremental change and is never merged piecemeal:
  most candidates are discarded, and a selected candidate replaces `fuse` as a whole. Replacing
  `fuse` is the owner's call; tag the previous tip first (`git tag fuse-before-<NAME> fuse`) so it
  stays reachable.

## Authoring Agents & Skills

See the `agents-md-authoring` skill for creating and maintaining AGENTS.md files.

## Memory

Local memory persistence is provided by the `persistent-memory` skill. Facts persist across sessions in
`.konductor/memory/MEMORY.md` (project facts) and `.konductor/memory/USER.md` (preferences), validated against
limits and an optional URL allowlist configured in `.konductor/memory-config.json`.
