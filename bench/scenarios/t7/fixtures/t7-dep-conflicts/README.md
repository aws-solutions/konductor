# 2027 planning review inputs

As of **2027-06-30**. Dates in the files are calendar dates in 2027.

Files in this folder:

- `roadmap.md`: quarterly milestones for Atlas, Beacon, Cinder and Delta. Its table columns are `quarter`, `team`, `milestone`, `status`, `target_date`, and `tickets`; the ticket column lists the work represented by each milestone.
- `data/ticket-export.csv`: the ticket export. Columns are `id` (ticket key), `team`, `title`, `status`, `due_date` (the current promised completion date), `points` (the estimate), `updated` (last edit date), and `comment`.
- `data/dependency-register.csv`: hand-maintained dependency rows. Its columns are `producer_ticket`, `consumer_ticket`, and `needed_by`; the producer must provide something to the consumer by that date.
- `data/capacity.csv`: sprint capacity snapshot. Its columns are `sprint`, `start_date`, `end_date`, and one points-capacity column for each team.
- `data/holiday-calendar.csv`: company closure dates. Its columns are `date` and `reason`; a closure is a non-working day for capacity planning.
- `data/release-notes.md`: ordinary notes from the last release review; it has no tabular columns.
- `data/closed-ticket-sample.csv`: a small archived export sample. Its columns are `id`, `team`, `status`, and `closed_date`.

Status spelling is not fully consistent in exports. Treat `Open`, `In progress`, `Review`, and `Blocked` as still open work after trimming whitespace and ignoring case. Treat `Done`, `Closed`, and `Cancelled` as not open. A blank estimate is unknown rather than zero. Ticket IDs are the stable join key; team and title text are not unique. Dependency needed-by dates and ticket due dates are inclusive calendar dates, and `days_late` means the calendar-day difference between the producer due date and needed-by date, with same-day equal to zero. No work is assumed on a closure date. The roadmap target date is the planned date for its milestone, not proof that all linked tickets are complete. If a dependency misses its needed-by date, its calendar-day miss carries to linked launch work; no recovery or parallelism is recorded in these inputs.
