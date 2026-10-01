---
name: sdlc-navigator
description: Use when someone asks which skill or workflow to use next, what the next step in the workflow is, or how artifacts connect across SDLC phases. Gives routing guidance across Konductor skills and fuse-flow workflows.
version: 1.0.0
tags: [skill, navigation, workflow, sdlc, skills, phases]
---

# SDLC Navigator

## Overview

Guides users through the SDLC workflow: which skill or workflow to use, when to use it, and how outputs from one phase become inputs to the next.

## Usage

Use this skill when:

- User asks "what should I do next?"
- User asks "which skill or workflow should I use for X?"
- User asks how phases connect
- User needs to understand the overall workflow

## Core Concepts

### Skills and Workflows

Skills provide focused guidance for one capability. The fuse-flow runner coordinates a complete phase chain inside a single agent session, and tells the agent which skill to load for each step.

### Phase Flow

Requirements → Design → Feature Splitting → Per-Feature Kiro Specs → Implementation → Testing. Each phase's outputs become the next phase's inputs.

## SDLC Workflow

| Phase | Skills | Output |
| --- | --- | --- |
| Requirements and planning | `user-story-writing`, then `requirements-extraction` | Product brief, user stories, and design inputs |
| Design and architecture | `system-design-patterns` plus API, data-model, threat-model, policy, diagram, and cost skills as needed | System design / HLD and supporting artifacts |
| Feature splitting | `task-decomposition` | Independent feature scopes |
| Per-feature Kiro specs | `kiro-requirements-generation`, then `kiro-design-generation`, then `kiro-task-generation` | `requirements.md`, `design.md`, and `tasks.md` per feature |
| Implementation | Backend, frontend, and infrastructure implementation skills as appropriate, then `code-review` | Working code and review findings |
| Testing and QA | `test-coverage-analysis`, `e2e-test-strategy`, `security-test-generation`, and `ui-text-validation` | Test gaps, strategies, and validation findings |

```
Requirements & Planning
  customer needs → product brief → user stories → requirements extraction
                                                              ↓
Design & Architecture
  requirements → system design / HLD → APIs → data models → threat model → security policies → diagrams
                                                              ↓
Feature Splitting (task-decomposition)
  user stories + HLD → split into independent features (minimize overlap between engineers)
                                                              ↓
                              ┌──────────────────────────────────────────────┐
                              │  Per-Feature Kiro Spec Workflow              │
                              │  (for each split feature):                   │
                              │  requirements.md → design.md → tasks.md      │
                              │  Context: HLD + user stories + feature scope │
                              └──────────────────────────────────────────────┘
                                                              ↓
Implementation
  Execute tasks with HLD, user stories, requirements.md, design.md in context
                                                              ↓
Testing & QA
  implementation → test gap analysis → E2E strategy → security tests → UI text validation
```

## Phase Handoffs

**Requirements → Design:**
Run `requirements-extraction` to produce `business-context.md`, `requirements-summary.md`, and `user-stories-extract.md`. Use these as design inputs.

**Design → Feature Splitting:**
The design phase produces the system design / HLD. Run `task-decomposition` to split user stories + HLD into independent features that can be developed with minimal overlap and dependency.

**Feature Splitting → Kiro Specs (per feature):**
For each split feature, run `kiro-requirements-generation`, `kiro-design-generation` and `kiro-task-generation` in turn to produce `{spec_dir}/requirements.md` (EARS), `design.md` (per-feature low-level design), and `tasks.md` (Kiro format), where `spec_dir` defaults to `.kiro/specs/{feature-name}/`. Each spec is scoped to one feature.

**Kiro Specs → Implementation:**
Execute tasks from `{spec_dir}/tasks.md` with HLD, user stories, requirements.md, and design.md in context. In Kiro IDE, add these as steering files or reference them explicitly.

**Implementation → Testing:**
After working code and its review are complete, run test gap analysis, then E2E strategy, security tests, and UI text validation.

## Invocation

For one phase, ask the current session to load the named skill by reading its installed `SKILL.md`. Claude Code reads skills from `.claude/skills/`, Kiro CLI from `.kiro/skills/`, and Codex, Cursor and OpenCode from `.agents/skills/` in a project install; a global install puts them in `skills/` next to the harness's user-level instruction file.

For the complete chain in one agent session, use fuse-flow with either `fuse/flow/workflows/_k-full-sdlc.yml` or the lighter `fuse/flow/workflows/_k-phase-chain.yml`. Run the script by its path, `<konductor-checkout>/fuse/flow/fuse-flow`; the commands below abbreviate it:

```bash
fuse-flow start <slug> --workflow <name or path>
fuse-flow continue <slug> [--artifact <path>]
fuse-flow continue <slug> --owner-approved
fuse-flow status <slug>
```

fuse-flow searches `FUSE_SKILLS_DIR`, the repository's `skills/`, `.kiro/skills`, `.konductor/skills`, `.claude/skills` and `.agents/skills`, then `SKILLS_HOME` and the same directories under the home directory plus `~/.codex/skills` and `~/.config/opencode/skills` for each workflow step's skill.
