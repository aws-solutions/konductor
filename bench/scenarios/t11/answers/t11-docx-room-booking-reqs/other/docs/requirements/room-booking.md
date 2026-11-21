# Meeting-room booking requirements

## Context

This feature adds room reservations to the Harborview member portal and the service desk. The statements below record approved behavior from the stakeholder specification. The later revision note controls where it changes an earlier table value.

## Requirements

- **RB-001** A member must have an active library card and a verified online-services account to place a reservation. **Priority:** must. **Source:** Eligibility and accounts.
- **RB-002** The service must allow a member to book up to 30 calendar days ahead. **Priority:** must. **Source:** Revision notes.
- **RB-003** Each reservation must be at least 30 minutes long. **Priority:** must. **Source:** Booking limits.
- **RB-004** Each reservation must be no longer than 3 hours (the old limit was 4 hours). **Priority:** must. **Source:** Revision notes.
- **RB-005** A member may have at most two active future reservations. **Priority:** must. **Source:** Booking limits.
- **RB-006** Willow Room must have a posted capacity of 4 people. **Priority:** must. **Source:** Rooms and capacities.
- **RB-007** Cedar Room must have a posted capacity of 8 people. **Priority:** must. **Source:** Rooms and capacities.
- **RB-008** Lantern Room must have a posted capacity of 12 people. **Priority:** must. **Source:** Rooms and capacities.
- **RB-009** The service must require an expected attendee count and must not offer a room with a lower posted capacity. **Priority:** must. **Source:** Rooms and capacities.
- **RB-010** A member may cancel or change a reservation until two hours before its start time. **Priority:** must. **Source:** Changes and cancellation.
- **RB-011** Staff must record a no-show when nobody checks in at the service desk within 15 minutes after the scheduled start. **Priority:** must. **Source:** No-show policy.
- **RB-012** Two no-shows in a rolling 60-day period must suspend new room bookings for 7 calendar days. **Priority:** should. **Source:** No-show policy.
- **RB-013** A staff member with the room-management role may override the booking limits for a library program or documented service accommodation, and must record a reason. **Priority:** should. **Source:** Staff controls.
- **RB-014** The booking form must provide an accessibility-needs field for a member to request access features. **Priority:** should. **Source:** Accessibility.
- **RB-015** The service must send a confirmation email immediately after a reservation is created or changed. **Priority:** must. **Source:** Changes and cancellation.
- **RB-016** The service must send the account holder an email reminder 24 hours before a reservation begins. **Priority:** should. **Source:** Notifications.

## Open questions

- **Q-001:** Should members under 16 be allowed to reserve with a verified account, or must they have a linked guardian account? **Sections:** Account safety; Youth access.

## Import data

```json
{
  "requirements": [
    {"id":"RB-001","text":"A member must have an active library card and a verified online-services account to place a reservation.","priority":"must","source":"Eligibility and accounts"},
    {"id":"RB-002","text":"The service must allow a member to book up to 30 calendar days ahead.","priority":"must","source":"Revision notes"},
    {"id":"RB-003","text":"Each reservation must be at least 30 minutes long.","priority":"must","source":"Booking limits"},
    {"id":"RB-004","text":"Each reservation must be no longer than 3 hours (the old limit was 4 hours).","priority":"must","source":"Revision notes"},
    {"id":"RB-005","text":"A member may have at most two active future reservations.","priority":"must","source":"Booking limits"},
    {"id":"RB-006","text":"Willow Room must have a posted capacity of 4 people.","priority":"must","source":"Rooms and capacities"},
    {"id":"RB-007","text":"Cedar Room must have a posted capacity of 8 people.","priority":"must","source":"Rooms and capacities"},
    {"id":"RB-008","text":"Lantern Room must have a posted capacity of 12 people.","priority":"must","source":"Rooms and capacities"},
    {"id":"RB-009","text":"The service must require an expected attendee count and must not offer a room with a lower posted capacity.","priority":"must","source":"Rooms and capacities"},
    {"id":"RB-010","text":"A member may cancel or change a reservation until two hours before its start time.","priority":"must","source":"Changes and cancellation"},
    {"id":"RB-011","text":"Staff must record a no-show when nobody checks in at the service desk within 15 minutes after the scheduled start.","priority":"must","source":"No-show policy"},
    {"id":"RB-012","text":"Two no-shows in a rolling 60-day period must suspend new room bookings for 7 calendar days.","priority":"should","source":"No-show policy"},
    {"id":"RB-013","text":"A staff member with the room-management role may override the booking limits for a library program or documented service accommodation, and must record a reason.","priority":"should","source":"Staff controls"},
    {"id":"RB-014","text":"The booking form must provide an accessibility-needs field for a member to request access features.","priority":"should","source":"Accessibility"},
    {"id":"RB-015","text":"The service must send a confirmation email immediately after a reservation is created or changed.","priority":"must","source":"Changes and cancellation"},
    {"id":"RB-016","text":"The service must send the account holder an email reminder 24 hours before a reservation begins.","priority":"should","source":"Notifications"}
  ],
  "openQuestions": [
    {"question":"Should members under 16 be allowed to reserve with a verified account, or must they have a linked guardian account?","sections":["Account safety","Youth access"]}
  ]
}
```
