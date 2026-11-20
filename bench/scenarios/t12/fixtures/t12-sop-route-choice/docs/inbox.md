# Inbox (copied from the team channel, Monday morning)

---

**Ravi Menon**, 08:12
I put my speed-up for the clash check in patches/0001-overlap-check.patch. Can someone look it over before I apply
it? I'll apply it myself once it has a review, so please leave it unapplied.

---

**Dana Okafor (product)**, 08:40
BK-215 is agreed with the front desk, nothing left to discuss: the booking summary gets a `nights` field, the number
of nights between the check-in date and the check-out date (calendar dates in UTC, times of day do not matter). A
day-use booking that starts and ends on the same date has 0 nights. Please ship it with the usual changelog line.

---

**Dana Okafor (product)**, 08:47
Next big thing: a waitlist. When a room is fully booked for a date, a guest can join a waitlist for that room and
date, at most 5 people per room and date. When a booking is cancelled, the first person on the list gets an offer
that expires after 2 hours, then it moves to the next person. I have not decided whether members of the loyalty club
go to the front of the list; that one is my call. I want to see how we would build it before anyone writes code.

---

**Joss (support lead)**, 09:05
Urgent, live since Friday's release and costing us money: a guest cancelled 30 hours before check-in and got the full
amount back. The policy (docs/policy.md) says half. Finance says we have refunded about 40 bookings too much already.
This one first, please.
