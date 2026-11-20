const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp, migrateDown, appliedVersions } = require('../migrations/runner');
const { createCustomer, getCustomer, updateCustomer } = require('../src/customer-repository');

test('migration backfills an address and leaves an empty customer without a row', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  db.prepare('INSERT INTO customers (name, email, address_line1, address_city) VALUES (?, ?, ?, ?)').run('Has Address', 'has@example.test', '10 Main', 'York');
  db.prepare('INSERT INTO customers (name, email) VALUES (?, ?)').run('No Address', 'none@example.test');
  migrateUp(db);
  assert.deepEqual(db.prepare('SELECT customer_id, line1, city FROM addresses ORDER BY customer_id').all().map((row) => ({ ...row })), [{ customer_id: 1, line1: '10 Main', city: 'York' }]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM addresses WHERE customer_id = 2').get().n, 0);
  db.close();
});

test('repository writes and reads the split address relation', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db);
  const customer = createCustomer(db, { name: 'New Person', email: 'new@example.test', address: { line1: '2 River Road', postalCode: 'R1' } });
  assert.deepEqual(customer.address, { line1: '2 River Road', line2: null, city: null, region: null, postalCode: 'R1', country: null });
  assert.equal(getCustomer(db, customer.id).address.line1, '2 River Road');
  updateCustomer(db, customer.id, { address: {} });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM addresses WHERE customer_id = ?').get(customer.id).n, 0);
  db.close();
});
