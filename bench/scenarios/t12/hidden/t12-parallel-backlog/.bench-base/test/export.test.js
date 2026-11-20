'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toCsv } = require('../src/export/csv');

test('CSV export lists the model fields', () => {
  const csv = toCsv([{ id: 'I-1', customer: 'Ada', amountCents: 500, issuedOn: '2026-11-02' }]);
  assert.equal(csv, 'id,customer,amountCents,issuedOn\nI-1,Ada,500,2026-11-02\n');
});
