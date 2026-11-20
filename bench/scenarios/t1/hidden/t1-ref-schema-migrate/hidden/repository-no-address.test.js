const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp } = require('../migrations/runner');
const { createCustomer, listCustomers } = require('../src/customer-repository');

test('repository returns null address without manufacturing a row', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db);
  createCustomer(db, { name: 'No Street', email: 'nostreet@example.test' });
  assert.equal(listCustomers(db)[0].address, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM addresses').get().count, 0);
  db.close();
});
