const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { addBooking, hasConflict } = require('../src/bookings');

test('finds a conflict in the same room', () => {
  const existing = [{ id: 'a', room: 'cedar-1', start: '2025-04-14T09:00:00', end: '2025-04-14T10:00:00' }];
  assert.equal(hasConflict({ id: 'b', room: 'cedar-1', start: '2025-04-14T09:30:00', end: '2025-04-14T11:00:00', name: 'call' }, existing), true);
});

test('writes a new booking to a file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-booking-'));
  try {
    const file = path.join(dir, 'bookings.json');
    fs.writeFileSync(file, '[]\n');
    addBooking(file, { id: 'b', room: 'cedar-1', start: '2025-04-15T09:00:00', end: '2025-04-15T10:00:00', name: 'call' });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
