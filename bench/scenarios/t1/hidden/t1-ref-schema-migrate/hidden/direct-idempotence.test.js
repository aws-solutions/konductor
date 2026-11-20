const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp } = require('../migrations/runner');

test('calling the address migration module twice is safe', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  const migration = require('../migrations/013-split-customer-address');
  migration.up(db);
  migration.up(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'addresses'").get().count, 1);
  db.close();
});
