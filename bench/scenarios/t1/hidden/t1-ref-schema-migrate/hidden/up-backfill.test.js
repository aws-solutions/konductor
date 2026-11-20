const test = require('node:test');
// Merged so that wiring and backfill basics count once each: a half-done change that writes the migration but
// leaves the repository untouched cannot reach the 40 ceiling on them alone (owner ruling D-118).

async function part1() { // was schema-shape.test.js: up creates the address table and removes legacy address columns
  const assert = require('node:assert/strict');
  const { DatabaseSync } = require('node:sqlite');
  const { migrateUp } = require('../migrations/runner');
  const db = new DatabaseSync(':memory:');
  migrateUp(db);
  const columns = db.prepare('PRAGMA table_info(addresses)').all().map((row) => row.name);
  assert.deepEqual(columns, ['id', 'customer_id', 'line1', 'line2', 'city', 'region', 'postal_code', 'country']);
  const customerColumns = db.prepare('PRAGMA table_info(customers)').all().map((row) => row.name);
  for (const name of ['address_line1', 'address_line2', 'address_city', 'address_region', 'address_postal_code', 'address_country']) assert.equal(customerColumns.includes(name), false);
  db.close();
}

async function part2() { // was backfill-populated.test.js: up copies every populated address field
  const assert = require('node:assert/strict');
  const { DatabaseSync } = require('node:sqlite');
  const { migrateUp } = require('../migrations/runner');
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  db.prepare('INSERT INTO customers (name, email, address_line1, address_line2, address_city, address_region, address_postal_code, address_country) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('Full Address', 'full@example.test', '1 First St', 'Suite 4', 'Bristol', 'Avon', 'BS1', 'UK');
  migrateUp(db);
  assert.deepEqual(({ ...db.prepare('SELECT line1, line2, city, region, postal_code, country FROM addresses').get() }), { line1: '1 First St', line2: 'Suite 4', city: 'Bristol', region: 'Avon', postal_code: 'BS1', country: 'UK' });
  db.close();
}

async function part3() { // was backfill-duplicates.test.js: identical address values for different customers remain separate rows
  const assert = require('node:assert/strict');
  const { DatabaseSync } = require('node:sqlite');
  const { migrateUp } = require('../migrations/runner');
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  const insert = db.prepare('INSERT INTO customers (name, email, address_line1, address_city) VALUES (?, ?, ?, ?)');
  insert.run('One', 'one@example.test', '7 Shared Lane', 'Bath');
  insert.run('Two', 'two@example.test', '7 Shared Lane', 'Bath');
  migrateUp(db);
  assert.deepEqual(db.prepare('SELECT customer_id FROM addresses ORDER BY customer_id').all().map((row) => ({ ...row })), [{ customer_id: 1 }, { customer_id: 2 }]);
  assert.equal(db.prepare('SELECT COUNT(DISTINCT line1 || city) AS count FROM addresses').get().count, 1);
  db.close();
}

test('up creates the address table, drops the legacy columns, copies every populated field and keeps identical addresses as separate rows', async () => {
  await part1();
  await part2();
  await part3();
});
