const test = require('node:test');
const assert = require('node:assert/strict');
const { credentials } = require('../src/validation/auth');
const { shiftInput } = require('../src/validation/shift');

test('credentials require an email and a long password', () => {
  assert.equal(credentials({ email: 'bad', password: 'short' }).ok, false);
  assert.equal(credentials({ email: 'a@example.test', password: 'password123' }).ok, true);
});

test('shift input supplies empty notes', () => {
  assert.deepEqual(shiftInput({ date: '2025-03-03', start: '09:00', end: '17:00', assignee: 'u-100' }).value.notes, '');
});
