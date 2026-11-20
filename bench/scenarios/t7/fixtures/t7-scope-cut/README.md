# Workspace planning inputs

As of date: **2027-06-04**. Dates in these files use the Gregorian calendar and `YYYY-MM-DD` format. The planning horizon ends at the launch date in `roadmap.md`.

Files in this folder:

- `tickets.csv`: exported work items. Columns are ticket id, title, epic, status, created date, current remaining estimate in points, free-text labels, parent ticket, ticket dependencies, comments, and owner.
- `roadmap.md`: release milestones and the current scope notes.
- `capacity.csv`: point capacity, organization-holiday loss, and already committed points for each remaining sprint.
- `sprint-calendar.csv`: sprint boundaries and working-day notes.
- `product-requests.md`: three dated product requests and their supporting context.
- `status-guide.md`: meanings used by the ticket export.
- `team-roster.csv`: team names and working areas for interpreting owners.
- `release-readout.md`: a short, non-authoritative status snapshot included with the export.

Ticket conventions: `Open`, `In Progress`, and `Review` are active statuses; `Closed` and `Cancelled` are not active work. A blank points cell means zero remaining points for aggregate planning. Labels are free text and may be blank. `created` is the calendar date on which the ticket entered the export's system. A dependency in `depends_on` names work that must be available first. For a split bug, the parent comment records the earlier estimate and the points moved into the split; the parent row shows its current reduced estimate.

Capacity conventions: `capacity_points` is the sprint's point capacity before the listed organization holiday loss. `holiday_points_lost` is already expressed in points, and `committed_points` is the launch work committed at the 2027-05-07 scope lock; it does not include work added after the lock. All three sprints are still ahead of the as-of date. Only the listed holiday loss is deducted from capacity; there is no separate weekend deduction in these rows. The sprint calendar defines the weekday boundaries used by the sheet.
