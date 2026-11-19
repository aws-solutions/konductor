# Relay program working folder

This folder is a small working set for the Relay milestone. The usable reporting date is **2027-08-30**; dates before it are historical and dates after it are planning dates.

Files and columns:

- `roadmap.md` names the milestone, target date, scope tags, and scope-lock date.
- `data/arc-export.csv`, `data/beam-export.csv`, and `data/cove-export.csv` are raw team exports. Each row has `ticket_id`, `title`, `initiative`, `status`, `points`, `sprint`, `updated`, `links`, `depends_on`, `comments`, and `owner`. `points` is the team's estimate and may be blank. `links` and `depends_on` are not interchangeable export fields; free-text comments can also mention another ticket.
- `data/capacity.csv` gives each team's published available points by sprint. `working_days` excludes the listed holiday, and `available_points` already reflects that loss.
- `docs/program-conventions.md` records the reporting conventions. The three `docs/status-*.md` files are the teams' own one-paragraph updates.
- `docs/change-log.txt` is a small historical note included because exports often arrive with unrelated working material.

The three CSVs are separate team extracts, not a clean database. Preserve the ticket IDs as written when citing work.
