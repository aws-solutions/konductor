const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp } = require('../migrations/runner');

test('up does not create a row for a customer with no address', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  db.prepare('INSERT INTO customers (name, email, address_line1, address_city) VALUES (?, ?, ?, ?)').run('Blank', 'blank@example.test', '', '   ');
  migrateUp(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM addresses').get().count, 0);
  db.close();
});
