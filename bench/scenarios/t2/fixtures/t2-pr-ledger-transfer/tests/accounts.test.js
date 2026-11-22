'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../src/store');
const { createAccount, getBalance } = require('../src/accounts');

test('creates and reads an account', () => {
  const store = createStore();
  createAccount(store, { id: 'acct_new', label: 'New' });
  assert.equal(getBalance(store, 'acct_new'), 0);
});

test('rejects an account with an unapproved id', () => {
  assert.throws(() => createAccount(createStore(), { id: 'wallet_new' }), /invalid/);
});
