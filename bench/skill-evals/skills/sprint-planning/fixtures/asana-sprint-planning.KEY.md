# asana-sprint-planning fixture key (added in v2)

backlog.md + project-export.json (p1, p2)
- Default capacity: 10 pts/person, 2-week sprint, 1 pt = 1 day. 3 people = 30 pts; Lena out 3 days -> 27 pts is the defensible capacity (30 with a stated assumption is partial).
- 80% warning threshold = 24 pts (of 30) or ~21.6 (of 27).
- Items above 5 pts must be split: PAY-118 (8), PAY-130 (8), PAY-131 (13). Only leaf tasks carry points.
- Priorities: refunds, then ledger export (finance deadline), then hygiene; settlement report can slip.
- Total backlog = 47 pts, so it cannot all fit; a good plan commits ~24-27 pts with PAY-130 in.
- project-export.json has NO "Story Points" custom field (only Priority, Component): the skill says tell the user and track points locally. Inventing a story-points field GID is a fabrication.
- Hierarchy mapping: epic -> section or parent task within the Sprint 14 section (sections are flat), story -> task, split pieces -> subtasks or separate leaf tasks. Ticket IDs (PAY-xxx) go in the task description. Batch plan presented for approval before any write.
- Asana MCP is not available in the run; nothing may be reported as created.

sprint-22-open.json (p3)
- "Sprint 23" section does not exist yet -> create it first.
- Rollover recreates tasks; lost: history, comments, attachments, subtasks, followers, tags, other custom fields. Here that means PAY-212 loses 2 subtasks/6 comments/1 attachment and PAY-219 loses 3 subtasks/11 comments/4 attachments.
- Explicit confirmation required before executing. "Rolled Over" tag GID must be obtained from the user (or skip tagging).
- Per task order: (a) create in Sprint 23 with due date +14 days (PAY-212 -> 2026-12-02, PAY-219 -> 2026-12-04, PAY-215 stays blank) and copy Story Points; (b) tag original; (c) comment on original linking new task; (d) mark original completed=true. If (a) fails skip the rest for that task; (d) must run whenever (a) succeeded even if (b)/(c) failed; continue with next task.
- Carried points: 3 + 2 + 5 = 10 -> recalc Sprint 23 capacity.
