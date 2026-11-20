const test = require('node:test');
const assert = require('node:assert/strict');
const { isEvent } = require('../src/utils/validation');

test('event validation accepts the dashboard record shape', () => {
  assert.equal(isEvent({ id: 'evt-9', type: 'charge', amount: 10, currency: 'usd' }), true);
});

test('signature parsing rejects empty header', () => {
  const { parseSignature } = require('../src/handlers/webhook');
  assert.equal(parseSignature(''), null);
});
