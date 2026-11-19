const test = require('node:test');
const assert = require('node:assert/strict');
const { BookingService } = require('../src/services/booking-service');

function store() {
  const data = [];
  return { all: () => data.slice(), get: id => data.find(x => x.id === id) || null, insert: x => (data.push(x), x), remove: id => { const i = data.findIndex(x => x.id === id); if (i < 0) return false; data.splice(i, 1); return true; } };
}

test('service rejects an invalid booking', () => {
  assert.throws(() => new BookingService(store()).create({}), /room is required/);
});

test('service removes a booking', () => {
  const service = new BookingService(store());
  const booking = service.create({ room: 'Oak', date: '2025-06-22', owner: 'Nia' });
  service.remove(booking.id);
  assert.deepEqual(service.list(), []);
});
