const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createCustomer, updateCustomer } = require('../src/customer-repository');

test('repository updates and clears a split address', () => {
  const db = new DatabaseSync(':memory:');
  const { migrateUp } = require('../migrations/runner');
  migrateUp(db);
  const customer = createCustomer(db, { name: 'Update Person', email: 'update@example.test', address: { line1: 'Old' } });
  updateCustomer(db, customer.id, { address: { line1: 'New', country: 'US' } });
  assert.deepEqual(({ ...db.prepare('SELECT line1, country FROM addresses WHERE customer_id = ?').get(customer.id) }), { line1: 'New', country: 'US' });
  updateCustomer(db, customer.id, { address: {} });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM addresses WHERE customer_id = ?').get(customer.id).count, 0);
  db.close();
});
