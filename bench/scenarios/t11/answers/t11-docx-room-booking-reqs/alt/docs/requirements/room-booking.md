# Room booking decision register

## Why this exists

This register turns the approved parts of the stakeholder document into importable statements for the member portal and service desk. The revision record is treated as the current decision when it changes a value in the earlier limits table. The youth policy remains pending rather than being guessed.

## Decision register

- **RB-013** Staff in the room-management role may override the booking limits for a library program or service accommodation, with a reason and staff identifier in the history. **Priority:** should. **Source:** Staff controls.
- **RB-006** The catalogue must show Willow Room with a maximum of 4 people. **Priority:** must. **Source:** Rooms and capacities.
- **RB-001** Only a member with an active library card and verified online-services account may place a reservation. **Priority:** must. **Source:** Eligibility and accounts.
- **RB-014** A reservation form must include an accessibility-needs field for access-feature requests. **Priority:** should. **Source:** Accessibility.
- **RB-004** A member reservation may last at most 3 hours. **Priority:** must. **Source:** Revision notes.
- **RB-010** Portal cancellation or change remains available until 2 hours before the reservation starts. **Priority:** must. **Source:** Changes and cancellation.
- **RB-008** Lantern Room must be published with capacity 12. **Priority:** must. **Source:** Rooms and capacities.
- **RB-016** An email reminder must reach the account holder 24 hours before the reservation starts. **Priority:** should. **Source:** Notifications.
- **RB-003** The service must reject a reservation shorter than 30 minutes. **Priority:** must. **Source:** Booking limits.
- **RB-011** Staff must mark a reservation as a no-show if nobody checks in within 15 minutes of its scheduled start. **Priority:** must. **Source:** No-show policy.
- **RB-007** Cedar Room must have a published capacity of 8. **Priority:** must. **Source:** Rooms and capacities.
- **RB-015** Creating or changing a reservation must trigger an immediate confirmation email. **Priority:** must. **Source:** Changes and cancellation.
- **RB-002** The member portal must offer dates through 30 calendar days ahead. **Priority:** must. **Source:** Revision notes.
- **RB-009** The booking form must record the expected number of attendees. **Priority:** must. **Source:** Rooms and capacities.
- **RB-017** The portal must hide any room whose posted capacity is below the expected attendee count. **Priority:** must. **Source:** Rooms and capacities.
- **RB-012** After 2 no-shows during a rolling 60-day period, new room booking is suspended for 7 calendar days. **Priority:** should. **Source:** No-show policy.
- **RB-005** A member may hold no more than 2 active future reservations. **Priority:** must. **Source:** Booking limits.

## Open questions

- **Q-17:** What is the final account rule for a member under 16: is a verified account enough, or is a linked guardian account required? **Sections:** Youth access; Account safety.

## Tracker payload

```json
{
  "requirements": [
    {"id":"RB-013","text":"Staff in the room-management role may override the booking limits for a library program or service accommodation, with a reason and staff identifier in the history.","priority":"should","source":"Staff controls"},
    {"id":"RB-006","text":"The catalogue must show Willow Room with a maximum of 4 people.","priority":"must","source":"Rooms and capacities"},
    {"id":"RB-001","text":"Only a member with an active library card and verified online-services account may place a reservation.","priority":"must","source":"Eligibility and accounts"},
    {"id":"RB-014","text":"A reservation form must include an accessibility-needs field for access-feature requests.","priority":"should","source":"Accessibility"},
    {"id":"RB-004","text":"A member reservation may last at most 3 hours.","priority":"must","source":"Revision notes"},
    {"id":"RB-010","text":"Portal cancellation or change remains available until 2 hours before the reservation starts.","priority":"must","source":"Changes and cancellation"},
    {"id":"RB-008","text":"Lantern Room must be published with capacity 12.","priority":"must","source":"Rooms and capacities"},
    {"id":"RB-016","text":"An email reminder must reach the account holder 24 hours before the reservation starts.","priority":"should","source":"Notifications"},
    {"id":"RB-003","text":"The service must reject a reservation shorter than 30 minutes.","priority":"must","source":"Booking limits"},
    {"id":"RB-011","text":"Staff must mark a reservation as a no-show if nobody checks in within 15 minutes of its scheduled start.","priority":"must","source":"No-show policy"},
    {"id":"RB-007","text":"Cedar Room must have a published capacity of 8.","priority":"must","source":"Rooms and capacities"},
    {"id":"RB-015","text":"Creating or changing a reservation must trigger an immediate confirmation email.","priority":"must","source":"Changes and cancellation"},
    {"id":"RB-002","text":"The member portal must offer dates through 30 calendar days ahead.","priority":"must","source":"Revision notes"},
    {"id":"RB-009","text":"The booking form must record the expected number of attendees.","priority":"must","source":"Rooms and capacities"},
    {"id":"RB-017","text":"The portal must hide any room whose posted capacity is below the expected attendee count.","priority":"must","source":"Rooms and capacities"},
    {"id":"RB-012","text":"After 2 no-shows during a rolling 60-day period, new room booking is suspended for 7 calendar days.","priority":"should","source":"No-show policy"},
    {"id":"RB-005","text":"A member may hold no more than 2 active future reservations.","priority":"must","source":"Booking limits"}
  ],
  "openQuestions": [
    {"question":"What is the final account rule for a member under 16: is a verified account enough, or is a linked guardian account required?","sections":["Youth access","Account safety"]}
  ]
}
```
