'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toCsv, COLUMNS } = require('../src/export/csv');
const { validate } = require('../src/models/invoice');

const inv = { id: 'I-1', customer: 'Ada', amountCents: 500, issuedOn: '2026-11-02' };

test('CSV export lists the model fields', () => {
  assert.equal(toCsv([{ ...inv, currency: 'USD' }]), 'id,customer,amountCents,issuedOn,currency\nI-1,Ada,500,2026-11-02,USD\n');
});

test('invoice currency defaults to EUR and must be an ISO 4217 code', () => {
  assert.equal(validate(inv).currency, 'EUR');
  assert.throws(() => validate({ ...inv, currency: 'Euro' }), /ISO 4217/);
});

test('currency is the last CSV column and the earlier columns keep their places', () => {
  assert.deepEqual(COLUMNS, ['id', 'customer', 'amountCents', 'issuedOn', 'currency']);
  assert.equal(toCsv([inv]).split('\n')[1], 'I-1,Ada,500,2026-11-02,EUR');
});
