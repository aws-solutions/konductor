const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp, appliedVersions } = require('../migrations/runner');

test('running the full migration command twice records version thirteen once', () => {
  const db = new DatabaseSync(':memory:');
  assert.deepEqual(migrateUp(db), Array.from({ length: 13 }, (_, i) => i + 1));
  assert.deepEqual(migrateUp(db), []);
  assert.deepEqual(appliedVersions(db), Array.from({ length: 13 }, (_, i) => i + 1));
  db.close();
});
