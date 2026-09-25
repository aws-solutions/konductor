---
name: sdlc-navigator
description: Use when someone asks which agent to use next, what the next step in the workflow is, or how artifacts connect across SDLC phases. Gives routing guidance across the Konductor agents.
version: 1.0.0
tags: [skill, navigation, workflow, sdlc, agents, phases]
---

# SDLC Navigator

## Overview

Guides users through the SDLC workflow — which agent to use, when to use it, and how outputs from one phase become inputs to the next.

## Usage

Use this skill when:

- User asks "what should I do next?"
- User asks "which agent should I use for X?"
- User asks how phases connect
- User needs to understand the overall workflow

## Core Concepts

### Persona Agents

Each agent covers an SDLC role or supporting capability, with domain skills that activate on demand. Agents spawn each other as subagents for cross-role work.

### Phase Flow

Requirements (PM) → Design (Architect) → Feature Splitting (Developer) → Per-Feature Kiro Specs → Implementation (Developer) → Testing (QA). Each phase's outputs become the next phase's inputs.

## Available Agents

| Agent                 | Role                      | Key Skills                                                                                    |
| --------------------- | ------------------------- | --------------------------------------------------------------------------------------------- |
| `k-product-manager`   | Product Manager           | User stories, requirements extraction, decision research, sprint planning (Asana)             |
| `k-tpm`               | Technical Program Manager | Program planning, status reporting, risk management, program decisions, sprint planning       |
| `k-architect`         | Solutions Architect       | System design, APIs, data models, threat models, security policies, diagrams, cost estimation |
| `k-developer`         | Software Engineer         | Feature planning, backend/frontend implementation, code review, infrastructure validation     |
| `k-researcher`        | Researcher                | External documentation search, web research, AWS docs                                         |
| `k-quality-assurance` | Quality Assurance         | Test coverage, E2E strategy, security testing, UI text validation                             |
| `k-media-analyzer`    | Media Analyst             | PDF/image/diagram interpretation                                                              |
| `k-browser`           | Browser Automation        | Web scraping, E2E test execution (Playwright), form automation, screenshots                   |

## SDLC Workflow

```
Requirements & Planning (k-product-manager)
  customer needs → product brief → user stories → requirements extraction
                                                              ↓
Design & Architecture (k-architect)
  requirements → system design / HLD → APIs → data models → threat model → security policies → diagrams
                                                              ↓
Feature Splitting (k-developer: task-decomposition)
  user stories + HLD → split into independent features (minimize overlap between engineers)
                                                              ↓
                              ┌──────────────────────────────────────────────┐
                              │  Per-Feature Kiro Spec Workflow              │
                              │  (for each split feature):                   │
                              │  requirements.md → design.md → tasks.md      │
                              │  Context: HLD + user stories + feature scope │
                              └──────────────────────────────────────────────┘
                                                              ↓
Implementation (k-developer)
  Execute tasks with HLD, user stories, requirements.md, design.md in context
                                                              ↓
Testing & QA (k-quality-assurance)
  implementation → test gap analysis → E2E strategy → security tests → UI text validation
```

## Phase Handoffs

**Requirements → Design:**
PM runs `requirements-extraction` skill to produce `business-context.md`, `requirements-summary.md`, `user-stories-extract.md`. Architect uses these as inputs.

**Design → Feature Splitting:**
Architect produces system design / HLD. Developer uses `task-decomposition` skill to split user stories + HLD into independent features that can be developed by individual engineers with minimal overlap and dependency.

**Feature Splitting → Kiro Specs (per feature):**
For each split feature, run `kiro-spec-workflow` SOP to produce `{spec_dir}/requirements.md` (EARS), `design.md` (per-feature low-level design), and `tasks.md` (Kiro format), where `spec_dir` defaults to `.kiro/specs/{feature-name}/`. Each spec is scoped to one feature and one engineer.

**Kiro Specs → Implementation:**
Developer executes tasks from `{spec_dir}/tasks.md` with HLD, user stories, requirements.md, and design.md in context. In Kiro IDE, add these as steering files or reference them explicitly.

**Implementation → Testing:**
SDE produces working code. QA runs test gap analysis, then E2E strategy, then security tests.

## Invocation

To switch to a different agent:

- Kiro CLI: `kiro-cli chat --agent k-architect`
- Kiro IDE: `@k-architect`
- Or ask the current agent to spawn the next agent as a subagent
