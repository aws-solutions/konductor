'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toV2 } = require('../src/schema');

test('converts a typical schema 1 record', () => {
  const rec = toV2({ id: 'o-1', customer: 'Ann', total: 5, placed: '03/14/2024', status: 'PAID', address: '12 Main St, Springfield, IL 62704', note: 'x' });
  assert.deepEqual(rec, {
    schema: 2, id: 'o-1', customer: 'Ann', totalCents: 500, placedAt: '2024-03-14', status: 'paid',
    address: { street: '12 Main St', city: 'Springfield', region: 'IL', postalCode: '62704' }, note: 'x',
  });
});

test('DONE becomes delivered', () => {
  assert.equal(toV2({ id: 'o', customer: 'c', total: 1, placed: '01/02/2024', status: 'DONE', address: 'a, b, CA 90210' }).status, 'delivered');
});
