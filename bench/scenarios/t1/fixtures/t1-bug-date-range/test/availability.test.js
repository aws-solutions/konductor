const test = require('node:test');
const assert = require('node:assert/strict');
const { availableDays, isAvailable } = require('../src/availability');

const bookings = [{ id: 'a', room: 'cedar-1', start: '2025-04-15T09:00:00', end: '2025-04-15T10:00:00' }];

test('rejects a time inside a booking', () => {
  assert.equal(isAvailable(bookings, '2025-04-15T09:30:00', '2025-04-15T10:30:00', 'cedar-1'), false);
});

test('lists free days in an ordinary window', () => {
  assert.deepEqual(availableDays(bookings, '2025-04-16', '2025-04-18', 'cedar-1'), ['2025-04-16', '2025-04-17', '2025-04-18']);
});
