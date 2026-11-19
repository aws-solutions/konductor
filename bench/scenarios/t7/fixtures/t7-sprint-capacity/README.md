# Three-sprint planning inputs

As of: **2027-04-02**. Dates in this folder are in 2027. The next three sprint dates are in `sprint_calendar.csv`.

Files:
- `backlog_export.csv`: the 130-row ticket export. Columns are ticket ID, title, priority, estimate in points, dependency IDs, skill, status, and a free-text comment.
- `team_roster.csv`: person, one skill tag, focus factor, and normal points per working day.
- `sprint_calendar.csv`: inclusive sprint names and start/end dates.
- `holidays.csv`: dates that are not working days.
- `on_call.csv`: on-call person and inclusive Monday-to-Friday rotation week.
- `director_note.md`: the request and beta timing.
- `roadmap.md`: directional beta scope.
- `status_legend.md`: status and empty-cell conventions for the export.
- `capacity_policy.md`: the capacity and assignment conventions.
- `team_aliases.csv`: older name spellings from a separate export.
- `release_checklist.csv`: small, noisy checklist export; it is not the backlog.

The backlog contains historical rows, cancelled rows, comments, empty cells, and inconsistent capitalization typical of an export. Use the ticket ID as the stable identifier.
