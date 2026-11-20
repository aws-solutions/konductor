'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toCsv } = require('../src/export/csv');
const { validate } = require('../src/models/invoice');

test('CSV export lists the model fields, currency last', () => {
  const csv = toCsv([{ id: 'I-1', customer: 'Ada', amountCents: 500, issuedOn: '2026-11-02', currency: 'NZD' }]);
  assert.equal(csv, 'id,customer,amountCents,issuedOn,currency\nI-1,Ada,500,2026-11-02,NZD\n');
});

test('old records without a currency export as EUR', () => {
  const csv = toCsv([{ id: 'I-0', customer: 'Bo', amountCents: 100, issuedOn: '2025-01-02' }]);
  assert.equal(csv.split('\n')[1], 'I-0,Bo,100,2025-01-02,EUR');
});

test('a currency that is not an ISO 4217 code is refused', () => {
  assert.throws(() => validate({ id: 'I-2', customer: 'Cy', amountCents: 1, issuedOn: '2026-11-02', currency: 'euro' }), /ISO 4217/);
});
