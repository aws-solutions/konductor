---
name: asana-sprint-planning
description: Use when planning a sprint, creating or estimating tasks, or managing sprint capacity in Asana. Covers task hierarchy, story point sizing, and capacity tracking; requires an Asana MCP server (see docs/guides/asana-integration.md). For other tools, use sprint-planning.
version: 2.1.0
tags:
  [skill, sprint-planning, asana-sprint-planning, asana, scrum, agile, capacity]
---

# Sprint Planning (Asana)

Extends the `sprint-planning` skill. Load it for sprint parameters, task hierarchy, story-point sizing, and capacity tracking. The steps below are Asana-specific.

## Instructions

### Asana MCP Detection

Before starting, verify Asana tools are available:

1. Use the Asana identity/current-user capability (to verify connectivity and get the workspace). If this succeeds, the Asana MCP is configured. Extract the **workspace GID** from the response. If the user belongs to multiple workspaces, present the list and ask which one to use.
2. If the call fails or the capability is not found, STOP and inform the user:
   > "Asana MCP is not configured. See `docs/guides/asana-integration.md` for setup instructions."

### Session Start

1. Use the **workspace GID** obtained during Asana MCP Detection above
2. Ask the user which project to plan the sprint in. Then use the Asana search capability (search projects/tasks in the workspace) with the project name and resource type `project` to find matching projects. Alternatively, browse portfolios and their items to let the user select.
3. List the project's sections (columns) for the target project
4. Confirm sprint parameters with user:
   - Sprint capacity: **10 points per person** (default)
   - Sprint duration: **2 weeks** (default)
   - 1 point = **1 work day** (default)
5. Ask for the number of team members in the sprint
6. Calculate total sprint capacity: `capacity_per_person × team_size` (e.g., 10 pts × 3 people = 30 pts)
7. Present project/section/capacity summary for confirmation

**Note:** Asana sprint/iteration setup (date ranges, custom fields for story points) must be configured in the Asana UI. Use the capabilities to read project details and list the project's sections to discover existing sprint sections.

### Task Hierarchy

Asana supports: **Project > Section > Task > Subtask**

Standard project hierarchy levels map to Asana as follows:

| Concept    | Asana Equivalent         | How                                                                                       |
| ---------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| Goal       | Portfolio                | Browse portfolios and their items to navigate                                             |
| Initiative | Project                  | Use the Asana search capability (search projects/tasks in the workspace) to find projects |
| Epic       | Section within a project | List the project's sections                                                               |
| Story      | Task                     | Create a task via the Asana MCP                                                           |
| Task       | Task or Subtask          | Create a task via the Asana MCP with a `parent` param for subtasks                        |
| Subtask    | Subtask                  | Nest the task under a parent (subtask)                                                    |

Rules:

- Create parent tasks first, then nest children by creating a task with a parent GID or by nesting the task under a parent (subtask)
- Use **sections** to group tasks by epic, sprint, or workflow stage (sections are flat; they cannot be nested)
- Only leaf-level tasks (Tasks/Subtasks) should carry story point estimates
- Asana has no explicit task "type" field. Hierarchy is controlled via sections and parent/subtask relationships, not a type attribute
- Always set an explicit assignee and due date when available

### Story Point Sizing

- Tasks above 5 points should be broken down
- Set story points via Asana custom fields (use the capability to update the task's fields/custom fields to set custom field values)
- To check if a story points custom field exists, read project details with `opt_fields=custom_fields` and look for a numeric field named "Story Points" or similar
- If no story point custom field exists on the project, note this to the user and track points locally

### Capacity Tracking

- Compute total sprint capacity from team size × per-person capacity
- Track running total of points as tasks are added
- Warn when approaching capacity (≥80%)
- Alert when exceeding capacity
- Display remaining capacity after each task added: `Sprint: {used}/{capacity} pts ({remaining} remaining)`

### Task Creation Rules

- Create a task via the Asana MCP with: project GID, section GID, name, notes, assignee, due date
- Tag tasks with source ticket ID in the description when applicable
- Apply a tag/label to the task for categorization
- For tasks sourced from external tickets: include the ticket ID and URL in the Asana task description
- Add a comment to the task to link to source tickets or context

### CR Integration

Link tasks to code reviews by including the Asana task URL in the commit message or pull request description.

### Sprint Rollover

To roll over incomplete work to the next sprint:

<!-- prettier-ignore -->
1. Use the Asana search capability (search projects/tasks in the workspace) with filters for the current project, current sprint section, and `completed=false` to find incomplete tasks in the current sprint section
2. Verify the next sprint's section exists by listing the project's sections. If it doesn't, create a section in the project
3. Present the rollover plan:
   a. List the incomplete tasks found in step 1 (name, assignee, points)
   b. **Warn the user about data loss:** because the Asana MCP tool set does not expose a move-between-sections capability, rollover must _recreate_ tasks in the new section. The following are **lost** on the new task:
      - Task history / activity log
      - Comments
      - Attachments
      - Subtasks
      - Followers
      - Tags
      - Custom fields (other than story points, which are copied in step 4)
   c. Ask the user for explicit confirmation before proceeding
4. Resolve the "Rolled Over" tag GID before starting the loop: ask the user for the GID (they can find it in the Asana UI under tag settings). If the tag doesn't exist yet, instruct them to create one in Asana (Tags → + New Tag) and provide the GID. If the user declines, skip tagging for all tasks and use comment links only. Cache the tag GID for subsequent rollovers in the same session
5. For each incomplete task, perform the following in order. If (a) fails, skip (b)–(d) for that task, report the failure, and continue with the next task:
   a. Create the replacement task in the new sprint's section via the Asana MCP with the same name, description, assignee, and due date offset forward by the sprint duration (if the original has no due date, leave it blank). If a story points custom field exists on the project, update the task's fields/custom fields to copy the value to the new task. If points are tracked locally (no custom field), carry the point value into the new sprint's local capacity tracking and note it in the new task's description
   b. If a tag GID was resolved in step 4, apply a tag/label to the original task. If this fails, note the failure but continue
   c. Add a comment to the original task linking to the new task. If this fails, note the failure but continue
   d. Close the original task by updating the task's fields/custom fields with `completed=true`. This step is critical and must always run if (a) succeeded, regardless of whether (b) or (c) failed. If (d) fails, report both the original and new task GIDs to the user so they can reconcile manually
6. Recalculate capacity for the new sprint based on carried-over points

**Note:** The Asana API supports moving tasks between sections, but the Asana MCP tool sets available today do not consistently expose this endpoint. The workaround above recreates tasks in the target section. Be aware this loses task history, comments, attachments, subtasks, followers, tags, and other custom fields from the original task.

### Batch Approval

Present the full create plan for batch approval before executing writes. Users can approve the batch rather than being prompted for each individual write operation.
