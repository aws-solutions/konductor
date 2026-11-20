'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReturn, applyEvent } = require('../src/returns/lifecycle');
test('does not mutate the return passed to an event', () => { const original = createReturn({ id: 'copy-check', orderId: 'order-copy', lineId: 'line-copy', amountCents: 900, opened: false, daysSinceDelivery: 2 }); const next = applyEvent(original, 'dispatch'); assert.equal(original.state, 'REQUESTED'); assert.notEqual(next, original); });
