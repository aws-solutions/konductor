# CMX-1: reading times show "0m" and "60m"

A two-hour audiobook shows as `(2h 0m)` in the list, and one of 119.6 minutes (the publisher's figure) shows as
`(1h 60m)`.

What we want:

- Round to the nearest minute first, then split into hours and minutes: 119.6 minutes is `2h`, 44.4 is `44m`.
- Whole hours show the hours only: 60 is `1h`, 120 is `2h`, 600 is `10h`.
- Everything else stays as it is: 90 is `1h 30m`, 45 is `45m`, 0 is `0m`.
