'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReturn, STATES } = require('../src/returns/lifecycle');
test('creates the original small return record', () => {
  const ret = createReturn({ id: 'ret-visible', orderId: 'ord-visible', amountCents: 800 });
  assert.equal(ret.state, STATES.NEW);
  assert.equal(ret.amountCents, 800);
});
