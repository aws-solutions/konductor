'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createReturn, applyEvent, STATES } = require(path.join(__dirname, 'src/returns/lifecycle'));
function make(overrides = {}) { return createReturn({ id: 'return-' + (overrides.id || 'alpha'), orderId: overrides.orderId || 'order-77', lineId: overrides.lineId || 'line-4', amountCents: overrides.amountCents ?? 2400, opened: overrides.opened ?? false, daysSinceDelivery: overrides.daysSinceDelivery ?? 12 }); }
function reachInspecting(overrides = {}) { let ret = make(overrides); ret = applyEvent(ret, 'dispatch'); ret = applyEvent(ret, 'scan'); return applyEvent(ret, 'openCase'); }
function reachApproved(overrides = {}) { return applyEvent(reachInspecting(overrides), 'pass'); }
function assertInvalid(fn) { assert.throws(fn, (error) => error && error.code === 'INVALID_TRANSITION'); }
test('creates a complete line return record', () => { const ret = make({ amountCents: 731, opened: true, daysSinceDelivery: 4 }); assert.deepEqual(ret, { id: 'return-alpha', orderId: 'order-77', lineId: 'line-4', amountCents: 731, opened: true, daysSinceDelivery: 4, state: STATES.REQUESTED, inspectionAttempts: 0 }); });
test('preserves caller identifiers and values instead of using fixed data', () => { const ret = make({ id: 'bravo', orderId: 'order-901', lineId: 'line-z', amountCents: 98765, daysSinceDelivery: 1 }); assert.equal(ret.id, 'return-bravo'); assert.equal(ret.orderId, 'order-901'); assert.equal(ret.lineId, 'line-z'); assert.equal(ret.amountCents, 98765); });
test('dispatches a return delivered thirty days ago', () => { assert.equal(applyEvent(make({ daysSinceDelivery: 30 }), 'dispatch').state, STATES.IN_TRANSIT); });
test('expires a return delivered beyond the day limit', () => { assert.equal(applyEvent(make({ daysSinceDelivery: 31 }), 'dispatch').state, STATES.EXPIRED); });
test('rejects dispatch from a state that cannot dispatch', () => { const ret = applyEvent(make(), 'dispatch'); assertInvalid(() => applyEvent(ret, 'dispatch')); });
test('scans an in-transit return into received', () => { const ret = applyEvent(make(), 'dispatch'); assert.equal(applyEvent(ret, 'scan').state, STATES.RECEIVED); });
test('opens a received return for inspection', () => { const ret = applyEvent(applyEvent(make(), 'dispatch'), 'scan'); assert.equal(applyEvent(ret, 'openCase').state, STATES.INSPECTING); });
test('recheck keeps inspection state and increments its counter without mutation', () => { const ret = reachInspecting(); const next = applyEvent(ret, 'recheck'); assert.equal(next.state, STATES.INSPECTING); assert.equal(next.inspectionAttempts, 1); assert.equal(ret.inspectionAttempts, 0); assert.equal(applyEvent(next, 'recheck').inspectionAttempts, 2); });
test('passes the exact approval amount directly', () => { assert.equal(reachApproved({ amountCents: 50000 }).state, STATES.APPROVED); });
test('sends an amount above the approval limit to manager review', () => { assert.equal(reachApproved({ amountCents: 50001 }).state, STATES.MANAGER_REVIEW); });
test('fails inspection into rejected', () => { assert.equal(applyEvent(reachInspecting(), 'fail').state, STATES.REJECTED); });
test('manager pass moves a high value return to approved', () => { const ret = reachApproved({ amountCents: 50001 }); assert.equal(applyEvent(ret, 'managerPass').state, STATES.APPROVED); });
test('manager pass is invalid before manager review', () => { assertInvalid(() => applyEvent(reachApproved({ amountCents: 50000 }), 'managerPass')); });
test('refunds an unopened item in integer cents with no fee', () => { const ret = applyEvent(reachApproved({ amountCents: 4200, opened: false }), 'refund'); assert.equal(ret.state, STATES.REFUNDED); assert.equal(ret.restockingFeeCents, 0); assert.equal(ret.refundCents, 4200); });
test('charges the percentage fee for an opened item above the minimum', () => { const ret = applyEvent(reachApproved({ amountCents: 40000, opened: true }), 'refund'); assert.equal(ret.restockingFeeCents, 6000); assert.equal(ret.refundCents, 34000); });
test('charges the minimum fee when the percentage is smaller', () => { const ret = applyEvent(reachApproved({ amountCents: 1000, opened: true }), 'refund'); assert.equal(ret.restockingFeeCents, 300); assert.equal(ret.refundCents, 700); });
test('rejects the crossed-out reinspection event', () => { assertInvalid(() => applyEvent(reachApproved(), 'reinspect')); });
test('archives a refunded return as closed', () => { const refunded = applyEvent(reachApproved(), 'refund'); assert.equal(applyEvent(refunded, 'archive').state, STATES.CLOSED); });
