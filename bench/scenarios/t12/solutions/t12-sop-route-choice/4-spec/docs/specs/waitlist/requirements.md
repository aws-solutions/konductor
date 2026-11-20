# Waitlist: requirements

Status: draft for Dana's sign-off. No code until it is signed off.

## Stories

1. As a guest, when the room I want is fully booked for a date, I can join the waitlist for that room and date.
2. As a guest on a waitlist, when a booking for my room and date is cancelled and I am first, I get an offer.
3. As the front desk, I can see who is waiting for each room and date, in order.

## Acceptance criteria

- WL-1: Joining is only possible when the room is fully booked for that date.
- WL-2: A waitlist holds at most 5 people per room and date; a sixth guest is told the list is full.
- WL-3: The list is first come, first served (see the open question on loyalty members).
- WL-4: When a booking for that room and date is cancelled, the first person on the list gets an offer.
- WL-5: An offer expires after 2 hours. When it expires or is declined, the next person gets the offer.
- WL-6: Accepting an offer books the room through the normal booking path, so the clash check and the refund rules
  apply as for any booking.
- WL-7: A guest can leave the waitlist at any time.

## Open questions

- Do members of the loyalty club go to the front of the list? Decides: Dana Okafor (product).
