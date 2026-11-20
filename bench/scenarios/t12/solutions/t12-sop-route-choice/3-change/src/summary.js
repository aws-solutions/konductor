'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (t) => Math.floor(new Date(t).getTime() / DAY_MS);

/** The booking summary shown in the confirmation email and on the front desk screen. */
function summary(booking) {
  return {
    room: booking.room,
    guest: booking.guest,
    from: booking.start,
    to: booking.end,
    guests: booking.guests ?? 1,
    // BK-215: nights between the check-in and check-out dates (UTC); a same-day booking has 0.
    nights: utcDay(booking.end) - utcDay(booking.start),
  };
}

module.exports = { summary };
