# Release tracking folder

As of date: **2027-04-30**. The release under review is 27.05, scheduled for **Thursday 2027-05-06**. Dates and timestamps are UTC unless a file states otherwise.

## Files

- `release_blockers.csv`: the issue export. Columns are ticket ID, title, status, labels, owner, component, main commit, whether the commit is on the release branch, opened and closed dates, estimate points, and the last comment. `Closed` means closed on the main branch; the separate branch column is authoritative for branch contents. `Reverted` means the intended change was backed out. Blank estimates are unestimated.
- `cherry_pick_queue.csv`: requested cherry-picks. Columns are ticket ID, commit, approval status, approval time, calendar deadline, target branch, and requester. Approval status is one of proposed, approved, merged, rejected, or cancelled.
- `ci_signal_summary.json`: required and optional jobs for the release branch. Each job reports runs, passes, a seven-day pass rate in percent, its first failure commit when known, and a short observed failure pattern.
- `release_calendar.json`: planned release slots, freeze times, cherry-pick deadlines, validation windows, and blackout dates. The weekday and ISO date in each slot are both part of the calendar record.
- `release_notes_draft.md`: the current draft notes, with ticket IDs attached to claims.
- `triage_notes.csv`: the latest triage disposition for selected tickets. `active` remains in the release review; `demoted` is handled in the normal maintenance queue; `cancelled` is no longer planned.
- `team_roster.csv`: owner names, teams, backups, and time zones for matching names in the export.
- `handoff_log.md`: dated handoff entries and the timestamp convention.

The issue export can contain cancelled and closed work, empty cells, comments, and case or spacing variations from the source systems. `Open` and `In Progress` are unresolved; `Closed` is closed on main only; `Cancelled` is not planned; and `Reverted` means the intended change was backed out. Treat ticket IDs as the stable join key. A required job is a release signal even when its issue list is otherwise quiet. The current release slot is the first slot in the calendar; later slots are planned alternatives.
