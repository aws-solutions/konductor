'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReceipt } = require('../src/validation');

test('valid receipt passes', () => assert.equal(validateReceipt({ accountId: 'a', amountCents: 4 }).amountCents, 4));
test('missing account is rejected', () => assert.throws(() => validateReceipt({ amountCents: 4 }), { code: 'INVALID_ACCOUNT' }));
test('negative amount is rejected', () => assert.throws(() => validateReceipt({ accountId: 'a', amountCents: -1 }), { code: 'INVALID_AMOUNT' }));
test('fractional amount is rejected', () => assert.throws(() => validateReceipt({ accountId: 'a', amountCents: 1.2 }), { code: 'INVALID_AMOUNT' }));
test('too many items are rejected', () => assert.throws(() => validateReceipt({ accountId: 'a', amountCents: 1, items: Array(81) }), { code: 'INVALID_ITEMS' }));
