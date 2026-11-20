const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp, migrateDown } = require('../migrations/runner');

test('down restores legacy columns and address values', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  db.prepare('INSERT INTO customers (name, email, address_line1, address_city, address_country) VALUES (?, ?, ?, ?, ?)').run('Restore Me', 'restore@example.test', '9 Back Way', 'Cardiff', 'UK');
  migrateUp(db);
  assert.deepEqual(migrateDown(db), [13]);
  const row = ({ ...db.prepare('SELECT address_line1, address_city, address_country FROM customers').get() });
  assert.deepEqual(row, { address_line1: '9 Back Way', address_city: 'Cardiff', address_country: 'UK' });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='addresses'").get().count, 0);
  db.close();
});
