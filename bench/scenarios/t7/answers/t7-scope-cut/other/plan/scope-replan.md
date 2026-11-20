# Scope replan for the 2027-07-16 launch

**Keep 2027-07-16. Take 12 points out: PRJ-1162 (7) and PRJ-1114 (5).**

## What product added

Six active tickets came in after the 2027-05-07 lock. Three have no `scope-added` label and are found only through the
request notes and their created dates.

| Ticket | Points | Request | Labelled scope-added? |
| --- | ---: | --- | --- |
| PRJ-1008 | 3 | A, 2027-05-09 | no |
| PRJ-1031 | 5 | B, 2027-05-11 | no |
| PRJ-1064 | 8 | B | yes |
| PRJ-1097 | 5 | B | yes |
| PRJ-1128 | 5 | C, 2027-05-26 | no |
| PRJ-1156 | 3 | C | yes |
| **Total** | **29** | | |

PRJ-1019 (3) and PRJ-1073 (2) were also created after the lock, but they are bug splits. Their points were moved out of
PRJ-1004 and PRJ-1022, whose estimates went down by the same amount, so they add nothing.

## Room we have

| Sprint | Capacity | Holiday | Committed | Slack |
| --- | ---: | ---: | ---: | ---: |
| S12 | 44 | 0 | 37 | 7 |
| S13 | 48 | 4 | 41 | 3 |
| S14 | 45 | 2 | 36 | 7 |
| | | | | **17** |

29 - 17 = 12 points must go.

## Why this cut is safe

The two stretch items PRJ-1162 and PRJ-1114 add up to exactly 12 and nothing depends on them.

PRJ-1046 is also tagged stretch, but must-have PRJ-1102 depends on it. Cutting it would break a must-have, so it stays.
PRJ-1008 is the customer commitment in Request A; it cannot be traded, now or in a later round. PRJ-1102 itself is
must-have.

The plan uses the slack exactly, with no buffer. If any In Progress estimate grows (PRJ-1008, PRJ-1064, PRJ-1128),
we need another cut, and it cannot come from PRJ-1008 or PRJ-1046.

```replan
{
  "date": "2027-07-16",
  "added_points": 29,
  "slack_points": 17,
  "points_to_cut": 12,
  "added_after_lock": ["PRJ-1031", "PRJ-1128", "PRJ-1008", "PRJ-1156", "PRJ-1064", "PRJ-1097"],
  "cut": ["PRJ-1162", "PRJ-1114"],
  "keep_despite_optional": ["PRJ-1046"],
  "cannot_cut": ["PRJ-1008", "PRJ-1102"]
}
```
