const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp, migrateDown } = require('../migrations/runner');
const repo = require('../src/customer-repository');

test('address split migration works', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 13);
  const customer = repo.createCustomer(db, { name: 'Test User', email: 'test@example.test', address: { line1: '123 Main St', city: 'Boston' } });
  assert.equal(customer.address.line1, '123 Main St');
  assert.equal(customer.address.city, 'Boston');
  db.close();
});
