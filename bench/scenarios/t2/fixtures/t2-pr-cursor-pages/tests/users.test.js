'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUserHandlers } = require('../src/api/users');
const { fixtureStore } = require('./test-fixtures');

test('users are sorted by name', () => {
  const users = createUserHandlers(fixtureStore()).list();
  assert.deepEqual(users.map((user) => user.name), ['Ari Stone', 'Morgan Lee']);
});
