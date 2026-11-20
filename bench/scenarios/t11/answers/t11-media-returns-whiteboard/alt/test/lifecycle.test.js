'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReturn, applyEvent, STATES } = require('../src/returns/lifecycle');
test('the lifecycle module keeps its public record shape', () => { const item = createReturn({ id: 'alt-visible', orderId: 'ord-alt', lineId: 'line-alt', amountCents: 800, opened: false, daysSinceDelivery: 3 }); assert.equal(item.state, STATES.REQUESTED); assert.equal(item.inspectionAttempts, 0); });
test('the basic route reaches the inspection work queue', () => { let item = createReturn({ id: 'alt-route', orderId: 'ord-route', lineId: 'line-route', amountCents: 800, opened: false, daysSinceDelivery: 3 }); for (const event of ['dispatch','scan','openCase']) item = applyEvent(item, event); assert.equal(item.state, STATES.INSPECTING); });
