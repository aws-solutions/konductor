# Requirements for the design

## Functional

- REQ-1: Members see which tools are available, by name and category, from a phone or computer.
- REQ-2: Checkout at the kiosk by scanning a member card and a tool label.
- REQ-3: Staff add, retire and repair-flag tools; changes show in member search within a minute (US-6).
- REQ-4: Loans last 7 days and can be renewed once.
- REQ-5: A late fee per day. The rate is undecided (the board decides).
- REQ-6: Reservations up to 30 days ahead. Conflicts with US-3, which says next day only.
- REQ-7: A text reminder 1 day before the due date through the city's SMS provider; one message per loan, in the morning (US-5).

## Constraints and non-functional

- REQ-8: Membership comes from the city's CSV file, delivered nightly. The library does not own member identity.
- REQ-9: Personal data is deleted within 30 days of a request; photo ID is never stored; loan history is kept without the name (US-7).
- REQ-10: The kiosk meets WCAG 2.1 AA with touch targets of at least 44 pixels.
- REQ-11: Peak load of 150 checkouts an hour on Saturday between 9:00 and 12:00.
- REQ-12: Online payments and online fee collection are out of scope; fees are paid at the desk (US-8).
- From US-4: the kiosk keeps checking tools out for at least 8 hours without a network and sends its loans when the connection returns.
