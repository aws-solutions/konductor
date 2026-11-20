'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReturn, applyEvent } = require('../src/returns/lifecycle');
test('event application returns a separate record', () => { const before = createReturn({ id: 'alt-copy', orderId: 'alt-order', lineId: 'alt-line', amountCents: 900, opened: false, daysSinceDelivery: 2 }); const after = applyEvent(before, 'dispatch'); assert.equal(before.state, 'REQUESTED'); assert.notEqual(before, after); });
