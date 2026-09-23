# AGENTS.md

Guidance for custom agents on Kiro CLI or Claude Code. This file is loaded into agent
context at session start. Follow these instructions for the duration of the session.

## Context Loading (MUST follow at session start)

Before starting work, load available project context:

- You MUST read `.konductor/memory/*.md` if present: persistent workspace facts, decisions, and preferences.

If a path does not exist, skip it silently and continue.

## Project Overview

Konductor is an open-source multi-agent orchestration framework that provides a coordinated suite of specialist
AI agents automating the full software development lifecycle. Agents collaborate through a structured
delegation protocol. The package ships as static agent configuration files compatible with Kiro CLI and
Claude Code — no runtime infrastructure required.

## Project Structure

```
agents/        # Agent definitions (.agent-spec.json, one per agent)
skills/        # Skill definitions (SKILL.md + optional scripts)
agent-sops/    # Standard operating procedures (user-invoked workflows)
context/       # Context files loaded at agent startup (system prompts, routing rules)
cli/           # Konductor CLI; see cli/README.md
```

## Setup & Commands

```bash
# Kiro CLI
konductor install
kiro-cli chat --agent konductor

# Claude Code
claude --agent konductor
```

Run from the repo root (`make synth`'s `konductor synth` defaults its source tree to
the current working directory, and the `build/cli/konductor` path below is relative
to it):

```bash
# Build cli/ + mcp/, synth agent/skill content, then install from this checkout
make build
make synth
build/cli/konductor install --from . --harness kiro-cli-v2
```

`make build` first is required, not optional: `make synth` on its own only builds
`cli/` (it needs the `konductor` binary, nothing from `mcp/`), so skipping this step
and going straight to `make synth` leaves `mcp/`'s MCP server binary unbuilt --
`install` auto-discovers that binary and silently skips it if missing (no error),
producing agents that can't load skills at runtime.

See [`cli/README.md`](cli/README.md) for the full build, PATH setup, and install
instructions.

## Code Style & Conventions

- Agent specs are JSON; keep them formatted (2-space indent).
- Skills are markdown with YAML frontmatter (`name`, `description`). A `description` may take a
  trigger-clause form ("Use when...") or a behavior-summary form ("Does X"); either is fine as
  long as a reader, human or model, can tell when the skill applies from the text alone. Do not
  convert a description from one form to the other for consistency alone. Fix a description
  that gives no activation condition at all. You may broaden an existing condition (for example,
  add a disjunct) when the skill's actual scope grew, but do not churn the form otherwise.
- Orchestrators are named `konductor`, `konductor-mux-orchestrator`, and `konductor-cmux-orchestrator`; 
  every specialist uses a `k-*` name. Skills are unprefixed unless avoiding a known collision.
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

## Pull Requests

Use [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) for every pull request.
GitHub pre-fills the PR body with it automatically. Complete every section, or delete it if it does
not apply — do not leave a section untouched with its placeholder text still in place.

## Konductor CLI (`cli/`)

The `cli/` tree is the Konductor CLI: the command-line utility for installing, configuring,
and diagnosing a Konductor-managed repository, covering an 8-command surface.
**Read `cli/README.md` before working on it** (commands, conventions, current state).

Non-negotiable conventions:

- **Usage errors exit `64` (`EX_USAGE`)**; exit code `2` is reserved for the "unresolved
  CRITICAL gate" signal and must never be emitted for a bad CLI invocation.
- When changing the command surface, keep `cli/README.md`'s command list in sync.

## Authoring Agents & Skills

See the `agents-md-authoring` skill for creating and maintaining AGENTS.md files.

## Memory

Local memory persistence is provided by the `persistent-memory` skill. Facts persist across sessions in
`.konductor/memory/MEMORY.md` (project facts) and `.konductor/memory/USER.md` (preferences), validated against
limits and an optional URL allowlist configured in `.konductor/memory-config.json`.
