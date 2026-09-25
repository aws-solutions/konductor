---
name: sprint-planning
description: Use when planning a sprint, creating tasks from tickets or documents, estimating work, or managing sprint capacity. Covers task hierarchy, story point sizing, and capacity tracking with whatever project tool is available; for Asana, use asana-sprint-planning.
version: 1.0.0
tags: [skill, sprint-planning, scrum, agile, capacity]
---

# Sprint Planning

## Overview

Interactive sprint planning. Organizes work into hierarchies, estimates with story points, tracks sprint capacity, and creates tasks using available project management tools.

## Usage

When users need to:

- Plan a sprint from tickets, docs, or conversation
- Estimate work with story points
- Track sprint capacity and workload
- Roll over incomplete work to next sprint

## Instructions

### Session Start

1. Confirm sprint parameters with user:
   - Sprint capacity: **10 points** (default)
   - Sprint duration: **2 weeks** (default)
   - 1 point = **1 work day** (default)
2. Present sprint/capacity summary for confirmation

### Task Hierarchy

Supported hierarchy: **Goal > Initiative > Epic > Story > Task > Subtask**

Rules:

- Create parents first, nest children via task management tool with parent task ID
- Only **Tasks and Subtasks** get assigned to a sprint. Initiatives/Epics/Stories spanning multiple sprints should NOT be sprint-assigned
- When adding a task to a sprint, all nested subtasks are auto-added
- Always set explicit type, never leave as None. Default to **Task**.

### Story Point Sizing

| Points | Scope     | Examples                                                            |
| ------ | --------- | ------------------------------------------------------------------- |
| 1      | Trivial   | Config update, minor bug fix, small doc edit                        |
| 2      | Small     | Add API field, write unit test suite, update runbook                |
| 3      | Medium    | New API endpoint with tests, refactor module, investigate+fix bug   |
| 5      | Large     | New feature with API+UI, cross-package refactor, design+implement   |
| 8      | Too large | Multi-service integration, major migration, **flag for splitting** |

- Tasks above 5 points should be broken down
- Set the **Estimate** attribute for story points, never put estimates in description
- To convert a raw story-point estimate into an AI-adjusted (agentic) effort band, apply the `legacy-to-agentic-estimate` skill. Pass the assigned points as the legacy value and the task description; use the returned mid-band for capacity tracking.

### Capacity Tracking

- Track running total of points as tasks are added
- Warn when approaching capacity (≥80%)
- Alert when exceeding capacity
- Display remaining capacity after each task added: `Sprint: {used}/{capacity} pts ({remaining} remaining)`

