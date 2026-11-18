'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dedupe } = require('../src/dedupe');
const { makeContacts } = require('../src/contacts');

test('the first contact of each email is kept, whatever its case and spaces', () => {
  const rows = [{ id: 1, email: 'a@x.com' }, { id: 2, email: ' A@X.COM' }, { id: 3, email: 'b@x.com' }];
  assert.deepEqual(dedupe(rows).map((r) => r.id), [1, 3]);
});

test('the generator is the same for the same seed and repeats some emails', () => {
  assert.deepEqual(makeContacts(50, 7), makeContacts(50, 7));
  assert.ok(dedupe(makeContacts(500, 7)).length < 500);
});
