# FMT-9: long dates on printed invoices

Printed invoices need dates in words. Add a style argument: `formatDate(iso, 'long')` gives the day without a
leading zero, the English month name and the year, for example `formatDate('2026-03-02', 'long')` is
`2 March 2026`. `formatDate(iso)` and `formatDate(iso, 'iso')` keep returning the ISO text. Any other style throws
a `RangeError`. The date is a calendar date: the result must not depend on the machine's time zone.

Done when: both styles work, a bad style throws, a test covers it, and the Unreleased section of CHANGELOG.md has a
line that starts with `- FMT-9:`.
