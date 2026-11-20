'use strict';

// BK-215: whole nights between two UTC calendar dates.
function nightsBetween(start, end) {
  const date = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
  return Math.round((date(end) - date(start)) / 86400000);
}

/** The booking summary shown in the confirmation email and on the front desk screen. */
function summary(booking) {
  return {
    room: booking.room,
    guest: booking.guest,
    from: booking.start,
    to: booking.end,
    guests: booking.guests ?? 1,
    nights: nightsBetween(booking.start, booking.end),
  };
}

module.exports = { summary };
