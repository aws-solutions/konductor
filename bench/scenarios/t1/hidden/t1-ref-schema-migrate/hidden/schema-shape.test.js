const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp } = require('../migrations/runner');

test('up creates the address table and removes legacy address columns', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db);
  const columns = db.prepare('PRAGMA table_info(addresses)').all().map((row) => row.name);
  assert.deepEqual(columns, ['id', 'customer_id', 'line1', 'line2', 'city', 'region', 'postal_code', 'country']);
  const customerColumns = db.prepare('PRAGMA table_info(customers)').all().map((row) => row.name);
  for (const name of ['address_line1', 'address_line2', 'address_city', 'address_region', 'address_postal_code', 'address_country']) assert.equal(customerColumns.includes(name), false);
  db.close();
});
