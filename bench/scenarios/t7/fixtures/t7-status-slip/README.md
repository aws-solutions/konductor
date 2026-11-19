# Payments and checkout launch export

This folder is a working export for the week ending **2027-06-14**. `tickets.csv` is the main input. `roadmap.md` gives the launch scope, dates, sprint calendar and the planning velocity used by the team. `team-capacity.csv` is the two-week capacity sheet; its `capacity_points` values are normalized planning points available from one person during one two-week sprint. `holidays.csv` lists individual absences, `people.csv` is a directory snapshot, and `last-week-status.md` and `release-notes.md` are context from the previous update.

## Ticket columns

`id` is the stable ticket identifier; `title` is the work item name; `epic` is its product grouping; `team` and `assignee` identify ownership; `status` is the workflow state; `priority` is the recorded priority; `estimate_points` is the estimate and may be blank; `sprint` is the planned two-week sprint; `depends_on` is a semicolon-separated list of prerequisite IDs; `created` and `due` are ISO dates; `reopened` records whether an item returned after closure; `status_history` is a short export of state changes; and `comments` contains free-text notes.

## Other files and columns

`team-capacity.csv` has `sprint`, `team`, `assignee`, `capacity_points`, `workdays`, and free-text `notes`. `holidays.csv` has the absence `date`, `assignee`, and `reason`. `people.csv` has the directory `assignee`, `team`, and `timezone`. `export-metadata.txt` records export details. `last-week-status.md` and `release-notes.md` are context documents.

## Reporting conventions

- The four sprint names and their Monday-to-Sunday dates are in `roadmap.md`. The date at the top of this file is today for this update.
- An open ticket is one with status `To Do`, `In Progress`, or `Blocked`. `Done` and `Cancelled` are closed. Blank estimates are excluded from point totals.
- A listed holiday removes one tenth of that person's two-week capacity for the sprint containing the holiday. Capacity is summed by person after that adjustment. Duplicate-looking names are matched after trimming outer spaces.
