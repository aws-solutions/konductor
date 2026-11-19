# Release planning input

This folder is a snapshot **as of 2027-02-01**, which is the date to use as today. Dates use ISO `YYYY-MM-DD`; story points are whole points unless an estimate cell is empty. The snapshot contains deliberately ordinary board noise, including completed, cancelled, duplicate, and blank-status rows.

Files:

- `release-trains.csv`: release-train calendar. Columns are train ID, version, branch date, release date, source branch, and label.
- `sprint-calendar.csv`: two-week sprint dates and listed company holidays.
- `throughput-history.csv`: the last twelve sprints, with accepted points, row kind, and a short comment.
- `remaining-work.csv`: ticket export. Columns are ticket ID, title, status, estimate, workstream, initiative, optional parent ticket, dependencies, created and updated dates, and a board comment.
- `review-and-stabilisation.md`: review, estimate, dependency, branching, flag, and forecast conventions.
- `roadmap.md`: initiative descriptions and boundaries.
- `team-capacity.csv`: capacity context for the snapshot window. `team`, `person`, and `role` identify the assignment; `from_date` and `to_date` bound it; `people_days_per_week` and `allocation` give availability; `comment` gives context.
- `ticket-comments.csv`: selected review comments. `ticket_id` identifies the row; `comment_date`, `comment`, and `author_alias` give the comment record.
- `change-log.csv`: selected ticket field edits. `changed_date`, `ticket_id`, and `field` identify an edit; `old_value`, `new_value`, and `reason` describe it.
- `status-codes.md`: meanings of status and grouping columns.

Use the ticket export as the current work list. The separate comment and change files provide context but do not replace the current row.
