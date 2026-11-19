const { readBookings } = require('../src/bookings');
const { dataPath } = require('../src/config');
for (const booking of readBookings(dataPath())) {
  if (!booking.id || !booking.room) process.exitCode = 1;
}
