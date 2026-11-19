const { addDays, formatDate, monthRange, overlaps } = require('./date-range');

function monthlySummary(bookings, year, month) {
  const range = monthRange(year, month);
  const days = [];
  for (let cursor = range.start; cursor < range.end; cursor = addDays(cursor, 1)) {
    const date = formatDate(cursor);
    const next = addDays(cursor, 1);
    const dayBookings = bookings.filter(booking => overlaps(booking.start, booking.end, date, next));
    days.push({
      date,
      bookingIds: dayBookings.map(booking => booking.id),
      occupied: dayBookings.length > 0
    });
  }
  return {
    month: `${year}-${String(month).padStart(2, '0')}`,
    totalNights: days.reduce((total, day) => total + (day.occupied ? 1 : 0), 0),
    days
  };
}

module.exports = { monthlySummary };
