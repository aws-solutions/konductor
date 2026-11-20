const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp } = require('../migrations/runner');
const repo = require('../src/customer-repository');

test('repository creates and reads a customer', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 13);
  const customer = repo.createCustomer(db, { name: 'Jo Example', email: 'jo@example.test', address: { line1: '1 Test Road', city: 'Leeds' } });
  assert.equal(customer.name, 'Jo Example');
  assert.equal(customer.address.city, 'Leeds');
  assert.equal(repo.listCustomers(db).length, 1);
  db.close();
});

test('repository can update and delete a customer', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 13);
  const customer = repo.createCustomer(db, { name: 'Old Name', email: 'old@example.test' });
  assert.equal(repo.updateCustomer(db, customer.id, { name: 'New Name' }).name, 'New Name');
  assert.equal(repo.deleteCustomer(db, customer.id), true);
  assert.equal(repo.getCustomer(db, customer.id), null);
  db.close();
});
