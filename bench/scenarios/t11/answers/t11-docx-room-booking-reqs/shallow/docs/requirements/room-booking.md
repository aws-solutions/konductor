# Meeting-room booking requirements

## Requirements

- **RB-001** A person must have an active Harborview library card and a verified online-services account to place a reservation. **Priority:** must. **Source:** Eligibility and accounts.
- **RB-002** Members may book up to 21 calendar days in advance. **Priority:** should. **Source:** Booking limits.
- **RB-003** The shortest booking is 30 minutes. **Priority:** should. **Source:** Booking limits.
- **RB-004** The longest booking is 4 hours. **Priority:** should. **Source:** Booking limits.
- **RB-005** A member may keep two active future reservations. **Priority:** should. **Source:** Booking limits.
- **RB-006** Willow Room has capacity 4. **Priority:** must. **Source:** Rooms and capacities.
- **RB-007** Cedar Room has capacity 8. **Priority:** must. **Source:** Rooms and capacities.
- **RB-008** Lantern Room has capacity 12. **Priority:** must. **Source:** Rooms and capacities.
- **RB-009** The booking form must ask for an expected attendee count and must not offer a room whose capacity is lower than that count. **Priority:** must. **Source:** Rooms and capacities.
- **RB-010** A member may cancel or change a reservation through the portal until two hours before its start time. **Priority:** must. **Source:** Changes and cancellation.
- **RB-011** The service sends a confirmation email immediately after a reservation is created or changed. **Priority:** must. **Source:** Changes and cancellation.
- **RB-012** A reservation is a no-show when nobody has checked in within 15 minutes after the scheduled start. **Priority:** must. **Source:** No-show policy.
- **RB-013** Two no-shows in a rolling 60-day period suspend new room bookings for 7 calendar days. **Priority:** must. **Source:** No-show policy.
- **RB-014** Staff with the room-management role may override limits and must record a reason. **Priority:** must. **Source:** Staff controls.
- **RB-015** The booking form must provide an accessibility-needs field where a member can request features. **Priority:** must. **Source:** Accessibility.
- **RB-016** The service sends an email reminder 24 hours before the reservation begins. **Priority:** must. **Source:** Notifications.

## Open questions

- None.

```json
{
  "requirements": [
    {
      "id": "RB-001",
      "text": "A person must have an active Harborview library card and a verified online-services account to place a reservation.",
      "priority": "must",
      "source": "Eligibility and accounts"
    },
    {
      "id": "RB-002",
      "text": "Members may book up to 21 calendar days in advance.",
      "priority": "should",
      "source": "Booking limits"
    },
    {
      "id": "RB-003",
      "text": "The shortest booking is 30 minutes.",
      "priority": "should",
      "source": "Booking limits"
    },
    {
      "id": "RB-004",
      "text": "The longest booking is 4 hours.",
      "priority": "should",
      "source": "Booking limits"
    },
    {
      "id": "RB-005",
      "text": "A member may keep two active future reservations.",
      "priority": "should",
      "source": "Booking limits"
    },
    {
      "id": "RB-006",
      "text": "Willow Room has capacity 4.",
      "priority": "must",
      "source": "Rooms and capacities"
    },
    {
      "id": "RB-007",
      "text": "Cedar Room has capacity 8.",
      "priority": "must",
      "source": "Rooms and capacities"
    },
    {
      "id": "RB-008",
      "text": "Lantern Room has capacity 12.",
      "priority": "must",
      "source": "Rooms and capacities"
    },
    {
      "id": "RB-009",
      "text": "The booking form must ask for an expected attendee count and must not offer a room whose capacity is lower than that count.",
      "priority": "must",
      "source": "Rooms and capacities"
    },
    {
      "id": "RB-010",
      "text": "A member may cancel or change a reservation through the portal until two hours before its start time.",
      "priority": "must",
      "source": "Changes and cancellation"
    },
    {
      "id": "RB-011",
      "text": "The service sends a confirmation email immediately after a reservation is created or changed.",
      "priority": "must",
      "source": "Changes and cancellation"
    },
    {
      "id": "RB-012",
      "text": "A reservation is a no-show when nobody has checked in within 15 minutes after the scheduled start.",
      "priority": "must",
      "source": "No-show policy"
    },
    {
      "id": "RB-013",
      "text": "Two no-shows in a rolling 60-day period suspend new room bookings for 7 calendar days.",
      "priority": "must",
      "source": "No-show policy"
    },
    {
      "id": "RB-014",
      "text": "Staff with the room-management role may override limits and must record a reason.",
      "priority": "must",
      "source": "Staff controls"
    },
    {
      "id": "RB-015",
      "text": "The booking form must provide an accessibility-needs field where a member can request features.",
      "priority": "must",
      "source": "Accessibility"
    },
    {
      "id": "RB-016",
      "text": "The service sends an email reminder 24 hours before the reservation begins.",
      "priority": "must",
      "source": "Notifications"
    }
  ],
  "openQuestions": []
}
```
