# Room booking requirements

## Summary

The member portal should let library members reserve rooms and receive notices. These notes capture the obvious limits from the specification for an initial implementation.

## Requirements

- **RB-001** A member with an active library card and online account can book a room. **Priority:** must. **Source:** Eligibility and accounts.
- **RB-002** Members can book up to 21 calendar days in advance. **Priority:** must. **Source:** Booking limits.
- **RB-003** Bookings last from 30 minutes to 4 hours. **Priority:** must. **Source:** Booking limits.
- **RB-004** Willow Room holds 4 people. **Priority:** must. **Source:** Rooms and capacities.
- **RB-005** Cedar Room holds 8 people. **Priority:** must. **Source:** Rooms and capacities.
- **RB-006** Lantern Room holds 12 people. **Priority:** must. **Source:** Rooms and capacities.
- **RB-007** A member can cancel two hours before the start. **Priority:** must. **Source:** Changes and cancellation.
- **RB-008** The service can send an email reminder 24 hours before a booking. **Priority:** could. **Source:** Notifications.

## Open questions

- The team should clarify the youth account policy and whether a waitlist is needed.

```json
{
  "requirements": [
    {"id":"RB-001","text":"A member with an active library card and online account can book a room.","priority":"must","source":"Eligibility and accounts"},
    {"id":"RB-002","text":"Members can book up to 21 calendar days in advance.","priority":"must","source":"Booking limits"},
    {"id":"RB-003","text":"Bookings last from 30 minutes to 4 hours.","priority":"must","source":"Booking limits"},
    {"id":"RB-004","text":"Willow Room holds 4 people.","priority":"must","source":"Rooms and capacities"},
    {"id":"RB-005","text":"Cedar Room holds 8 people.","priority":"must","source":"Rooms and capacities"},
    {"id":"RB-006","text":"Lantern Room holds 12 people.","priority":"must","source":"Rooms and capacities"},
    {"id":"RB-007","text":"A member can cancel two hours before the start.","priority":"must","source":"Changes and cancellation"},
    {"id":"RB-008","text":"The service can send an email reminder 24 hours before a booking.","priority":"could","source":"Notifications"}
  ],
  "openQuestions": [
    {"question":"Clarify the youth account policy and whether a waitlist is needed.","sections":["Eligibility"]}
  ]
}
```
