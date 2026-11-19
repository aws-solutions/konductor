# Conference launch planning inputs

This folder contains the working exports used for the 2027 conference launch cut. The data is current as of **2027-07-26**; that is the date that counts as today. Dates use ISO format and all names are fictional.

- `launch-brief.md`: the launch audience, outcome, conference date, and the small set of launch outcomes requested by product leadership.
- `backlog.csv`: the product backlog. Columns are `id` (stable feature identifier), `title`, `status`, `priority`, `estimate_points` (engineering points, blank means not estimated), `value_score` (1 low to 10 high), `dependencies` (comma-separated feature IDs that must be ready first), `customer_evidence`, `owner`, and `notes`.
- `roadmap.csv`: the current roadmap export. It includes historical and future entries and is not a promise that every row fits this launch window.
- `sales-commitments.md`: commitments made to named accounts, including the requested delivery window and the backlog IDs used in the deal notes.
- `team-capacity.csv`: the engineering team's sprint capacity. `capacity_points` is the usable team total for the sprint after the listed holiday dates. A holiday date is a working day with zero capacity. The four sprints run Monday through Friday on their listed dates; weekends do not consume capacity.
- `interviews/interview-*.md`: short customer conversations. The segment and account context in each note are part of the evidence; a note is not a commitment unless it says so.

Backlog status is case-insensitive. `Backlog`, `Ready`, and `In Progress` are open for planning; `Closed` and `Cancelled` are not available work. A blank estimate is not schedulable until it is estimated. Feature IDs are matched exactly, ignoring case and surrounding spaces. The capacity sheet is the source for available points; do not add points from closed or cancelled backlog rows.
