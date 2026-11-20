'use strict';

/** The booking summary shown in the confirmation email and on the front desk screen. */
function summary(booking) {
  return {
    room: booking.room,
    guest: booking.guest,
    from: booking.start,
    to: booking.end,
    guests: booking.guests ?? 1,
  };
}

module.exports = { summary };
