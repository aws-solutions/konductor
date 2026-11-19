const { addDays, formatDate, overlaps, parseDate } = require('./date-range');

function isAvailable(bookings, start, end, room) {
  return !bookings.some(booking => (!room || booking.room === room) &&
    overlaps(start, end, booking.start, booking.end));
}

function availableDays(bookings, start, end, room) {
  const first = parseDate(start);
  const finish = parseDate(end);
  const result = [];
  for (let cursor = first; cursor <= finish; cursor = addDays(cursor, 1)) {
    const next = addDays(cursor, 1);
    if (isAvailable(bookings, cursor, next, room)) result.push(formatDate(cursor));
  }
  return result;
}

module.exports = { isAvailable, availableDays };
