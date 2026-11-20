const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp } = require('../migrations/runner');

test('identical address values for different customers remain separate rows', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  const insert = db.prepare('INSERT INTO customers (name, email, address_line1, address_city) VALUES (?, ?, ?, ?)');
  insert.run('One', 'one@example.test', '7 Shared Lane', 'Bath');
  insert.run('Two', 'two@example.test', '7 Shared Lane', 'Bath');
  migrateUp(db);
  assert.deepEqual(db.prepare('SELECT customer_id FROM addresses ORDER BY customer_id').all().map((row) => ({ ...row })), [{ customer_id: 1 }, { customer_id: 2 }]);
  assert.equal(db.prepare('SELECT COUNT(DISTINCT line1 || city) AS count FROM addresses').get().count, 1);
  db.close();
});
