'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReturn, applyEvent, STATES } = require('../src/returns/lifecycle');
test('creates a line return in the requested state', () => { const ret = createReturn({ id: 'visible-1', orderId: 'ord-1', lineId: 'line-1', amountCents: 800, opened: false, daysSinceDelivery: 3 }); assert.equal(ret.state, STATES.REQUESTED); assert.equal(ret.inspectionAttempts, 0); });
test('the visible smoke path can reach inspection', () => { let ret = createReturn({ id: 'visible-2', orderId: 'ord-2', lineId: 'line-2', amountCents: 800, opened: false, daysSinceDelivery: 3 }); ret = applyEvent(ret, 'dispatch'); ret = applyEvent(ret, 'scan'); ret = applyEvent(ret, 'openCase'); assert.equal(ret.state, STATES.INSPECTING); });
