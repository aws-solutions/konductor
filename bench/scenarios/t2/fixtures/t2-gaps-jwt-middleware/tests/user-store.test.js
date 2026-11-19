const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { UserStore } = require('../src/store/user-store');

test('user store can find an active user', () => {
  const store = new UserStore(path.join(__dirname, '..', 'data', 'users.json'));
  assert.equal(store.findByEmail('morgan@example.test').id, 'u-101');
});

test('role changes are visible to later reads', () => {
  const store = new UserStore(path.join(__dirname, '..', 'data', 'users.json'));
  const original = store.findById('u-101').role;
  store.users[1].role = 'planner';
  assert.equal(store.findById('u-101').role, original);
});
