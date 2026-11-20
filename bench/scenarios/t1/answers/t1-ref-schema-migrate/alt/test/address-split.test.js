const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp, migrateDown, appliedVersions } = require('../migrations/runner');
const repo = require('../src/customer-repository');

test('migration 013 creates the addresses table', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  
  // Verify address columns exist before migration
  const beforeColumns = db.prepare('PRAGMA table_info(customers)').all().map(c => c.name);
  assert.ok(beforeColumns.includes('address_line1'));
  
  migrateUp(db, 13);
  
  // Verify addresses table exists
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='addresses'").get();
  assert.ok(table);
  
  // Verify address columns removed from customers
  const afterColumns = db.prepare('PRAGMA table_info(customers)').all().map(c => c.name);
  assert.ok(!afterColumns.includes('address_line1'));
  
  db.close();
});

test('migration 013 migrates existing address data', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  
  // Insert customer with address data directly
  db.prepare(`INSERT INTO customers (name, email, status, address_line1, address_city) VALUES (?, ?, ?, ?, ?)`).run('Test', 'test@example.test', 'active', '123 Main St', 'Boston');
  
  migrateUp(db, 13);
  
  // Verify address was migrated
  const addr = db.prepare('SELECT * FROM addresses WHERE customer_id = ?').get(1);
  assert.equal(addr.line1, '123 Main St');
  assert.equal(addr.city, 'Boston');
  
  db.close();
});

test('migration 013 skips blank addresses', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  
  // Insert customer with blank address
  db.prepare(`INSERT INTO customers (name, email, status, address_line1, address_city) VALUES (?, ?, ?, ?, ?)`).run('Test', 'test@example.test', 'active', '   ', '');
  
  migrateUp(db, 13);
  
  // Verify no address row created for blank data
  const count = db.prepare('SELECT COUNT(*) as count FROM addresses').get();
  assert.equal(count.count, 0);
  
  db.close();
});

test('migration 013 rollback restores address columns and data', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 13);
  
  // Create a customer with address
  repo.createCustomer(db, { name: 'Test User', email: 'test@example.test', address: { line1: '456 Oak Ave', city: 'Seattle' } });
  
  // Roll back migration
  migrateDown(db);
  
  // Verify columns restored
  const columns = db.prepare('PRAGMA table_info(customers)').all().map(c => c.name);
  assert.ok(columns.includes('address_line1'));
  assert.ok(columns.includes('address_city'));
  
  // Verify data restored
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(1);
  assert.equal(row.address_line1, '456 Oak Ave');
  assert.equal(row.address_city, 'Seattle');
  
  // Verify addresses table dropped
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='addresses'").get();
  assert.ok(!table);
  
  db.close();
});

test('running migration up twice is harmless', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 13);
  
  // Try running up again directly
  const migration = require('../migrations/013-split-customer-address');
  migration.up(db); // Should not throw
  
  // Verify only one addresses table exists
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='addresses'").all();
  assert.equal(tables.length, 1);
  
  db.close();
});

test('running migration down twice is harmless', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 13);
  
  migrateDown(db);
  
  // Try running down again directly
  const migration = require('../migrations/013-split-customer-address');
  migration.down(db); // Should not throw
  
  db.close();
});

test('version 013 is not recorded twice in migration history', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 13);
  
  const versions = appliedVersions(db);
  const count013 = versions.filter(v => v === 13).length;
  assert.equal(count013, 1);
  
  db.close();
});

test('repository creates customer with address in split tables', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 13);
  
  const customer = repo.createCustomer(db, { 
    name: 'Jo Example', 
    email: 'jo@example.test', 
    address: { line1: '1 Test Road', city: 'Leeds' } 
  });
  
  assert.equal(customer.name, 'Jo Example');
  assert.equal(customer.address.city, 'Leeds');
  assert.equal(customer.address.line1, '1 Test Road');
  
  db.close();
});

test('repository creates customer without address', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 13);
  
  const customer = repo.createCustomer(db, { name: 'No Address', email: 'no@example.test' });
  assert.equal(customer.address, null);
  
  // Verify no address row was created
  const count = db.prepare('SELECT COUNT(*) as count FROM addresses').get();
  assert.equal(count.count, 0);
  
  db.close();
});

test('repository updates customer address', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 13);
  
  const customer = repo.createCustomer(db, { name: 'Test', email: 'test@example.test' });
  assert.equal(customer.address, null);
  
  const updated = repo.updateCustomer(db, customer.id, { address: { line1: 'New Address', city: 'New City' } });
  assert.equal(updated.address.line1, 'New Address');
  assert.equal(updated.address.city, 'New City');
  
  db.close();
});

test('repository clears customer address', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 13);
  
  const customer = repo.createCustomer(db, { name: 'Test', email: 'test@example.test', address: { line1: '123 Main' } });
  assert.ok(customer.address);
  
  const updated = repo.updateCustomer(db, customer.id, { address: null });
  assert.equal(updated.address, null);
  
  db.close();
});

test('repository deletes customer and associated address', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 13);
  
  const customer = repo.createCustomer(db, { name: 'Test', email: 'test@example.test', address: { line1: '123 Main' } });
  repo.deleteCustomer(db, customer.id);
  
  const count = db.prepare('SELECT COUNT(*) as count FROM addresses').get();
  assert.equal(count.count, 0);
  
  db.close();
});
