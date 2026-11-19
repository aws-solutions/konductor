const { readBookings } = require('../src/bookings');
const { dataPath } = require('../src/config');
console.log(readBookings(dataPath()).map(booking => `${booking.room}: ${booking.name}`).join('\n'));
