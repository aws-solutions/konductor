'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { listCustomers, getCustomer } = require('../src');

const dataDir = path.join(__dirname, '..', 'data');

test('all customers are listed in file order', () => {
  const all = listCustomers(dataDir);
  assert.equal(all.length, 12);
  assert.equal(all[0].id, 'c1');
});

test('getCustomer finds one by id or returns null', () => {
  assert.equal(getCustomer(dataDir, 'c3').name, 'Ben Okafor');
  assert.equal(getCustomer(dataDir, 'zz'), null);
});

test('a missing data directory is an empty list', () => {
  assert.deepEqual(listCustomers('/nonexistent-dir'), []);
});
