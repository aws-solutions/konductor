# Migration planning export

As of **2027-02-12**. This is a working-folder export for the data-platform migration.

## Files

- `tickets.json`: the ticket export. Each object has an id, title, status, team, owner, point estimate, dependency ids, planned sprint, optional due date, timestamps, and a free-text comment.
- `release-calendar.csv`: dated alpha, beta, release-candidate, feature-freeze, and final milestones.
- `sprints.csv`: Monday-to-Friday two-week sprint windows and their ten ordinary working days.
- `capacity.csv`: one row per person per sprint. `nominal_points` is that person's capacity for a full sprint before holidays or leave; `working_days` is the ordinary ten-day window.
- `pto.csv`: inclusive planned leave dates.
- `holidays.csv`: holidays that remove a working day for every listed contributor.
- `team-calendar.csv`: ordinary workdays and the weekdays on which each team accepts a cross-team handoff.
- `status-codes.csv`: the status vocabulary and whether each value counts as open work. The export contains a few capitalization and spelling inconsistencies.

## Conventions

Statuses marked `yes` in `status-codes.csv` are open; `Closed` and `Cancelled` are not. Blank point estimates are unknown rather than zero. A holiday or a day of inclusive PTO removes one point of capacity for that person for that day, and an overlap is counted once. Names match after trimming spaces and ignoring letter case.

The sprint dates and weekday names in `sprints.csv` are authoritative. `planned_sprint` is the roadmap placement in the export, not a guarantee that work finishes there. Dependencies point from a ticket to work that must be accepted before it can start. `due_date`, when present, is the date requested by the consuming work. A team can do ordinary work on its listed workdays, but a cross-team handoff waits for an acceptance weekday in the receiving team's row.

All dates use ISO format. The target under discussion is March 31, 2027; the release calendar is the source for the freeze and final dates.
