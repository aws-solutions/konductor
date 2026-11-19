const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBooking } = require('../src/utils/validation');

test('validation accepts a complete booking', () => {
  assert.equal(validateBooking({ room: 'Atlas', date: '2025-06-20', owner: 'Pat' }), null);
});

test('validation reports missing fields', () => {
  assert.match(validateBooking({ room: 'Atlas' }), /date is required/);
});
