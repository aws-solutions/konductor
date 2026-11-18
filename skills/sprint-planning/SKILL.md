---
name: sprint-planning
description: Sprint planning — task hierarchy, story point sizing, capacity tracking, and sprint workflow. Use when planning sprints, including teams that track sprints in Asana, creating tasks from tickets/docs, estimating work, or managing sprint capacity.
version: 1.2.0
tags: [skill, sprint-planning, scrum, agile, capacity, asana]
---

# Sprint Planning

## Overview

Interactive sprint planning. Organizes work into hierarchies, estimates with story points, tracks sprint capacity, and creates tasks using available project management tools.

Open `references/asana.md` (relative to this file) when the team uses Asana, before Session Start. It covers the Asana MCP check, the Asana tool calls, how the hierarchy and story points map onto Asana, and the Asana rollover procedure. Where it differs from a rule below, follow the reference. It needs an Asana MCP server; see `docs/guides/asana-integration.md`.

If `references/asana.md` cannot be opened, tell the user and stop before any Asana write. Do not fall back to the generic rules below.

## Usage

When users need to:

- Plan a sprint from tickets, docs, or conversation
- Estimate work with story points
- Track sprint capacity and workload
- Roll over incomplete work to next sprint

## Instructions

### Session Start

If the user mentions Asana, links an Asana project, or the session has Asana MCP tools, open `references/asana.md` now and run its MCP check before step 1.

1. Confirm sprint parameters with user:
   - Sprint capacity: **10 points** per person (default)
   - Sprint duration: **2 weeks** (default)
   - 1 point = **1 work day** (default)
2. Ask how many people are in the sprint, and compute total capacity as `capacity_per_person × team_size` (for example, 10 pts × 3 people = 30 pts)
3. Present sprint/capacity summary for confirmation

If the user cannot be asked (they said not to ask, or you are writing a plan for later), take the team, time off, project and sections from the files they gave you, state each value as an assumption, and keep going. Count time off against capacity: a person with 3 days off has 7 points. Not asking questions does not remove approval: a plan written for later still needs an explicit go-ahead before its first write, and it should say so in a step of its own.

### Task Hierarchy

Supported hierarchy: **Goal > Initiative > Epic > Story > Task > Subtask**

Rules:

- Create parents first, nest children via task management tool with parent task ID
- Only **Tasks and Subtasks** get assigned to a sprint — Initiatives/Epics/Stories spanning multiple sprints should NOT be sprint-assigned
- When adding a task to a sprint, all nested subtasks are auto-added
- In a tracker with a task type field, always set the type, defaulting to **Task**
- Keep an epic as a real container (a parent item, or whatever grouping the tracker offers), not a label in a free-text field, so its work rolls up
- Set an explicit assignee and due date when they are known

### Story Point Sizing

| Points | Scope     | Examples                                                            |
| ------ | --------- | ------------------------------------------------------------------- |
| 1      | Trivial   | Config update, minor bug fix, small doc edit                        |
| 2      | Small     | Add API field, write unit test suite, update runbook                |
| 3      | Medium    | New API endpoint with tests, refactor module, investigate+fix bug   |
| 5      | Large     | New feature with API+UI, cross-package refactor, design+implement   |
| 8      | Too large | Multi-service integration, major migration: **split before scheduling** |

- Split any item above 5 points that goes into the sprint into leaf tasks of 5 or fewer, even when you have to propose the split boundaries yourself. Say the split is a proposal. A deadline is not a reason to keep an 8-point item whole; splitting is what lets two people share it.
- Items you defer stay whole in the backlog. Do not create placeholder subtasks for work that is not in this sprint.
- Only leaf-level work (Tasks and Subtasks) carries story points; the parent carries none
- Store points in the tracker's estimate field, not the description, where one exists
- Only if the team asks for AI-adjusted estimates, apply the `legacy-to-agentic-estimate` skill and use its mid-band for capacity tracking

### Capacity Tracking

- Track running total of points as tasks are added
- Warn when approaching capacity (≥80%)
- Alert when exceeding capacity
- Display remaining capacity after each task added: `Sprint: {used}/{capacity} pts ({remaining} remaining)`
- In a written plan, show that tally line by line in the order tasks are added, mark the task where usage first reaches 80%, and check each person's load against their own capacity as well as the team total
- Leave a little slack: stop around 80 to 90% and list the next items as stretch work, unless the user asks to fill the sprint

### Task Creation

- For a task sourced from an external ticket, put the ticket ID and URL in the task description
- To link a task to a code review, put the task URL in the commit message or pull request description

### Sprint Rollover

For a sprint tracked in Asana, follow the rollover procedure in `references/asana.md` instead.

1. Find the incomplete tasks in the current sprint
2. Check that the next sprint exists; create it if it does not
3. Present the rollover plan (task name, assignee, points) and ask the user to confirm
4. Move each incomplete task, with its subtasks, to the next sprint
5. Recalculate the next sprint's capacity, counting the carried-over points

### Batch Approval

Present the full create plan for batch approval before executing writes. Users can approve the batch rather than being prompted for each individual write operation.

Write a create plan as one numbered list of writes, parents before their children, comments last. A rollover plan is different: keep its writes grouped per task, in the order the rollover steps give, so a failure on one task never leaves another half done. Give each write every value the call needs, copied in full from the source data: container or section ID, parent, assignee ID, due date, points, and the source ticket ID in the notes. Spread due dates across the sprint and set a deadline item's date before its deadline. Count the writes from that list once, at the end. Say plainly that nothing has been written yet.
