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

test('booking ending at midnight allows next day booking', () => {
  const midnightBooking = [{ id: 'b', room: 'cedar-1', start: '2025-04-15', end: '2025-04-16' }];
  assert.equal(isAvailable(midnightBooking, '2025-04-16T09:00:00', '2025-04-16T10:00:00', 'cedar-1'), true);
});

test('availableDays includes both requested endpoints', () => {
  const result = availableDays([], '2025-05-01', '2025-05-05', 'cedar-1');
  assert.deepEqual(result, ['2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05']);
});
