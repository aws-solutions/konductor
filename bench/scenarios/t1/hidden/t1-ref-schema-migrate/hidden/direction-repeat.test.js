const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp } = require('../migrations/runner');

const LEGACY = ['address_line1', 'address_line2', 'address_city', 'address_region', 'address_postal_code', 'address_country'];

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

function tableCount(db) {
  return db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'addresses'").get().count;
}

test('calling down twice leaves the legacy columns and values in place', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  db.prepare('INSERT INTO customers (name, email, address_line1, address_city) VALUES (?, ?, ?, ?)').run('Twice', 'twice@example.test', '1 Main', 'Oslo');
  const migration = require('../migrations/013-split-customer-address');
  migration.up(db);
  migration.down(db);
  migration.down(db);
  assert.equal(tableCount(db), 0);
  for (const name of LEGACY) assert.ok(columns(db, 'customers').includes(name), name);
  const row = db.prepare('SELECT address_line1, address_city FROM customers WHERE email = ?').get('twice@example.test');
  assert.deepEqual({ ...row }, { address_line1: '1 Main', address_city: 'Oslo' });
  db.close();
});

test('calling down before up is harmless', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  db.prepare('INSERT INTO customers (name, email, address_line1) VALUES (?, ?, ?)').run('Early', 'early@example.test', '9 Early St');
  require('../migrations/013-split-customer-address').down(db);
  assert.equal(tableCount(db), 0);
  assert.equal(db.prepare('SELECT address_line1 FROM customers WHERE email = ?').get('early@example.test').address_line1, '9 Early St');
  db.close();
});

test('calling up twice keeps the one address row per customer', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  db.prepare('INSERT INTO customers (name, email, address_line1, address_country) VALUES (?, ?, ?, ?)').run('Once', 'once@example.test', '5 Once Rd', 'NO');
  const migration = require('../migrations/013-split-customer-address');
  migration.up(db);
  migration.up(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM addresses').get().count, 1);
  for (const name of LEGACY) assert.equal(columns(db, 'customers').includes(name), false, name);
  db.close();
});
