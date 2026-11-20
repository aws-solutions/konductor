# Design: room waitlist

A new module owns the queues, keyed by room and date. The cancellation code tells it when a place frees up, after the
refund is computed; it then creates an offer with a two-hour deadline (R3, R4). A timer sweeps lapsed offers and
offers the place to the next guest. Accepting goes through the usual booking and clash check, so double bookings stay
impossible. The queue order sits behind one comparison so the loyalty decision, whichever way it goes, changes one
place.
