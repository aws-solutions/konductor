'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBooking, firstError } = require('../src/validation');

const valid = { name: 'Mina', email: 'mina@example.com', checkIn: '2025-07-01', checkOut: '2025-07-04', note: 'Window seat' };

test('valid booking data has no errors', () => {
  const result = validateBooking(valid);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, {});
  assert.equal(firstError(result), null);
});

test('required booking fields report messages', () => {
  const result = validateBooking({});
  assert.equal(result.valid, false);
  assert.equal(result.errors.name, 'Name is required');
  assert.equal(result.errors.email, 'Email is required');
  assert.equal(result.errors.checkIn, 'Check-in date is required');
  assert.equal(firstError(result), 'Name is required');
});

test('a normal email and date format are accepted', () => {
  const result = validateBooking({ ...valid, email: 'a.b+trip@example.co.uk', checkIn: '2025-07-01' });
  assert.equal(result.valid, true);
});
