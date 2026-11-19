'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { handle } = require('../src/api');

test('invoice creation route responds successfully', () => {
  const service = { createInvoice: () => ({ id: 'inv_api' }) };
  assert.equal(handle({ method: 'POST', path: '/invoices', body: {} }, service).status, 201);
});
