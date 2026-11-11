# Sprint planning in Asana

Read this when the team tracks sprints in Asana. It adds the Asana steps to the workflow in `SKILL.md`; where a rule here differs from a rule there, this one applies. It requires an Asana MCP server (see `docs/guides/asana-integration.md`).

## Asana MCP Detection

Before starting, verify Asana tools are available:

1. Use the Asana identity/current-user capability (to verify connectivity and get the workspace) — if this succeeds, the Asana MCP is configured. Extract the **workspace GID** from the response. If the user belongs to multiple workspaces, present the list and ask which one to use.
2. If the call fails or the capability is not found, STOP and inform the user:
   > "Asana MCP is not configured. See `docs/guides/asana-integration.md` for setup instructions."

## Session Start

Run these before the Session Start steps in `SKILL.md`:

1. Use the **workspace GID** obtained during Asana MCP Detection above
2. Ask the user which project to plan the sprint in. Then use the Asana search capability (search projects/tasks in the workspace) with the project name and resource type `project` to find matching projects. Alternatively, browse portfolios and their items to let the user select.
3. List the project's sections (columns) for the target project

Then confirm the sprint parameters and team size as `SKILL.md` describes, and present a project/section/capacity summary for confirmation.

If there is no connection yet or the user said not to ask, read the workspace, project, sections, members and custom fields from any export the user supplied, and use those GIDs. Never make up a GID; where one is unknown, name the lookup that will resolve it at execution time.

**Note:** Asana sprint/iteration setup (date ranges, custom fields for story points) must be configured in the Asana UI. Use the capabilities to read project details and list the project's sections to discover existing sprint sections.

## Task Hierarchy

Asana supports: **Project > Section > Task > Subtask**

Standard project hierarchy levels map to Asana as follows:

| Concept    | Asana Equivalent         | How                                                                                       |
| ---------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| Goal       | Portfolio                | Browse portfolios and their items to navigate                                             |
| Initiative | Project                  | Use the Asana search capability (search projects/tasks in the workspace) to find projects |
| Epic       | Section, or parent task  | A section when the project groups by epic; a parent task when sections are sprints       |
| Story      | Task                     | Create a task via the Asana MCP                                                           |
| Task       | Task or Subtask          | Create a task via the Asana MCP with a `parent` param for subtasks                        |
| Subtask    | Subtask                  | Nest the task under a parent (subtask)                                                    |

Rules:

- Create parent tasks first, then nest children by creating a task with a parent GID or by nesting the task under a parent (subtask)
- Use **sections** to group tasks by epic, sprint, or workflow stage. Sections are flat and a task sits in one section per project, so when the sections are sprints (`Sprint 14`), make each epic a parent task in the sprint section with its stories as subtasks. Do not record the epic only in a text custom field. Keep it to two levels: when you split an oversized story, make the pieces subtasks of the epic and keep the ticket ID in their names (`PAY-130a`, `PAY-130b`).
- Only leaf tasks carry story points; a parent task created for an epic or a split item carries none
- Asana has no explicit task "type" field — hierarchy is controlled via sections and parent/subtask relationships, not a type attribute. The `SKILL.md` rule to always set a type does not apply.

## Story Points

- Set story points via Asana custom fields (use the capability to update the task's fields/custom fields to set custom field values), not an Estimate attribute
- To check if a story points custom field exists, read project details with `opt_fields=custom_fields` and look for a numeric field named "Story Points" or similar
- If no story point custom field exists on the project, tell the user, track points locally, and put a `Story Points: N` line at the top of each leaf task's notes so the number survives until a field is added. Offer to add the field in the Asana UI.

## Task Creation Rules

- Create a task via the Asana MCP with: project GID, section GID, name, notes, assignee GID, due date. Subtasks take the parent task's GID; in a plan written before execution, refer to the parent by its write number.
- Put the source ticket ID (for example `PAY-130`) in the task name or the first line of the notes
- Apply a tag/label to the task for categorization
- Add a comment to the task to link to source tickets or context
- To link a task to a code review, use the Asana task URL

## Sprint Rollover

This replaces the rollover steps in `SKILL.md`, because the Asana MCP cannot move a task to another section.

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
   d. Close the original task by updating the task's fields/custom fields with `completed=true` — this step is critical and must always run if (a) succeeded, regardless of whether (b) or (c) failed. If (d) fails, report both the original and new task GIDs to the user so they can reconcile manually
6. Recalculate capacity for the new sprint based on carried-over points

In a rollover plan written for someone to run later, put the confirmation in its own step before the first write, write step 5 out per task as a, b, c, d, and repeat the rule that (d) runs whenever (a) succeeded.

**Note:** The Asana API supports moving tasks between sections, but the Asana MCP tool sets available today do not consistently expose this endpoint. The workaround above recreates tasks in the target section. Be aware this loses task history, comments, attachments, subtasks, followers, tags, and other custom fields from the original task.
