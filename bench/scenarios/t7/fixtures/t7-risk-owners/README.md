# Mobile re-platform working folder

As of date: **2027-06-01**. This is the date that counts as today for this folder. Dates are calendar dates in 2027.

Files:
- `roadmap.md`: launch milestones and release dates.
- `ticket-export.json`: the work-item export. Each ticket has `id`, `title`, `status`, `assignee`, `team`, `component`, `estimate_points`, `depends_on`, `due_date`, `created_at`, and `comments`.
- `capacity.csv`: sprint capacity and committed points by team.
- `vendor-contract.md`: the current provider agreement summary.
- `org-chart.md`: program roles and named owners.
- `meeting-notes/`: dated notes from program and delivery meetings.
- `release-checklist.md`: the ordinary launch handoff checklist.
- `design-decisions.md`: small product and platform decisions already recorded.

Ticket columns: `id` is the stable work-item identifier; `title` is its short summary; `status` is its workflow state; `assignee` is the named person doing the work; `team` is the delivery group; `component` is the product area; `estimate_points` is the relative size estimate; `depends_on` lists prerequisite ticket IDs; `due_date` is the recorded target date; `created_at` is the creation date; and `comments` holds the export's free-text note. Capacity columns: `sprint` is the cadence label; `start` and `end` bound the sprint; `team` is the group; `nominal_points` is the listed capacity before commitments; `committed_points` is the planned load; `public_holiday` is a listed non-working date; and `notes` is the sheet comment.

Ticket conventions: statuses `Open`, `In Progress`, `Ready`, `Review`, and `Blocked` are open work. `Done`, `Closed`, and `Cancelled` are not open work. A blank assignee means no owner is assigned, and a blank estimate has no point value. Dependency values are ticket IDs. Names match case-insensitively after trimming spaces.

Capacity conventions: sprint boundaries in `capacity.csv` are inclusive Monday-to-Friday work weeks. Listed public holidays are non-working days and contribute zero capacity. A ticket's due date is a calendar date; no work is assumed on a public holiday. The export includes closed and cancelled historical work as well as current work.
