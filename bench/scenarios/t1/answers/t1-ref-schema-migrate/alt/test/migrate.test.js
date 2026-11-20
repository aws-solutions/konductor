const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp, migrateDown, appliedVersions } = require('../migrations/runner');

test('the existing migration set reaches version twelve', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  assert.deepEqual(appliedVersions(db), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customers'").get());
  db.close();
});

test('one migration can be rolled back', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  assert.deepEqual(migrateDown(db), [12]);
  assert.equal(appliedVersions(db).at(-1), 11);
  db.close();
});
