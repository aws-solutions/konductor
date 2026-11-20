const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp } = require('../migrations/runner');
const { registerCustomer, validateCustomer } = require('../src/customer-service');

test('service validates basic customer input', () => {
  assert.throws(() => validateCustomer({ name: 'A', email: 'a@b.test' }), /two characters/);
  assert.throws(() => validateCustomer({ name: 'Able', email: 'invalid' }), /valid email/);
});

test('service registers a valid customer', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 13);
  const record = registerCustomer(db, { name: 'Able Example', email: 'able@example.test' });
  assert.equal(record.status, 'active');
  db.close();
});
