'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { customerKey, compactInvoice } = require('../src/normalization');

test('customer keys normalize surrounding whitespace and case', () => assert.equal(customerKey('  CUS_7 '), 'cus_7'));
test('compact invoice keeps the support fields', () => assert.deepEqual(compactInvoice({ id: 'i', customerId: ' C ', totalCents: 9, status: 'open', lines: [] }), { id: 'i', customerId: 'c', totalCents: 9, status: 'open' }));
