'use strict';

/** The existing bookings that clash with `candidate`: same room and overlapping time. Back-to-back bookings are fine. */
function conflicts(bookings, candidate) {
  const start = new Date(candidate.start).getTime();
  const end = new Date(candidate.end).getTime();
  return bookings.filter((b) => b.room === candidate.room
    && new Date(b.start).getTime() < end
    && start < new Date(b.end).getTime());
}

module.exports = { conflicts };
