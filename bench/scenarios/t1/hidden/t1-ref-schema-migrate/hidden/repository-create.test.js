const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp } = require('../migrations/runner');
const { createCustomer, getCustomer } = require('../src/customer-repository');

test('the repository writes new customers through addresses', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db);
  const customer = createCustomer(db, { name: 'Repo Person', email: 'repo@example.test', address: { line1: '4 New Street', city: 'Plymouth' } });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM addresses').get().count, 1);
  assert.deepEqual(getCustomer(db, customer.id).address, { line1: '4 New Street', line2: null, city: 'Plymouth', region: null, postalCode: null, country: null });
  db.close();
});
