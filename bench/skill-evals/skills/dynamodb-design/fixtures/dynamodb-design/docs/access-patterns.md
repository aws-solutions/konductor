# Booking service: data requirements

Entities: Venue, Booking, Customer.

| # | Access pattern | Frequency |
|---|----------------|-----------|
| 1 | Get booking by bookingId | 3,000 reads/s |
| 2 | List a customer's bookings, newest first, paginated | 800 reads/s |
| 3 | List bookings for a venue on a given date | 400 reads/s |
| 4 | List all bookings with status PENDING_PAYMENT older than 15 minutes (expiry sweeper) | 1 query/min |
| 5 | "List all bookings" in the admin UI, newest first, paginated | 2 reads/s |
| 6 | Create / cancel booking | 300 writes/s, peaks 1,200 writes/s on ticket drops |

Constraints:
- Booking status values: PENDING_PAYMENT, CONFIRMED, CANCELLED.
- Pending bookings that never get paid should disappear after 24 hours.
- Must recover from accidental deletes in production.
- Average item size 1.5 KB.
