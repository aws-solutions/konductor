const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp, migrateDown } = require('../migrations/runner');

test('a second down after version thirteen has been removed is harmless', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db);
  assert.deepEqual(migrateDown(db), [13]);
  assert.deepEqual(migrateDown(db), [12]);
  db.close();
});
