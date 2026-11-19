# Shared deployment program inputs

These exports are as of **2027-04-12**, which is the working date for this folder. Dates use ISO format. Quarter labels are calendar quarters.

## Files

- `leadership-memo.md`: the request, scope, required staffing, retention and sign-in requirements, and suggested checkpoints.
- `atlas-tools.csv`, `beacon-tools.csv`, `cedar-tools.csv`: one inventory per team. Columns are tool name, version, owning team, environments, audit retention in days, sign-in mode, lifecycle status, and a free-text note.
- `atlas-roadmap.md`, `beacon-roadmap.md`, `cedar-roadmap.md`: each team's planned work. Table columns are quarter, work, owner, status, and a recorded dependency.
- `open-requests.csv`: request export. Columns are id, title, status, votes, requester, team, estimate points, created date, updated date, and comment. Empty estimate cells mean no estimate was recorded.
- `headcount.csv`: current staffing. `engineering_headcount` is the team total; `available_program_engineers` is the number available for this program during the stated period.
- `capacity-2027.csv`: remaining engineer-days by sprint. Sprints run Monday through Friday for two weeks, and the listed holiday removes one working day from each team's capacity. Blank holiday cells mean no listed holiday.

For request triage, `Open`, `In Progress`, and `Waiting` are active statuses. `Closed`, `Done`, and `Cancelled` are historical and are not active requests. Votes are the count recorded by the source system.

The exports include comments, blank cells, old rows, and spelling variations because they came from separate team systems. Match team names case-insensitively and do not infer missing estimates.
