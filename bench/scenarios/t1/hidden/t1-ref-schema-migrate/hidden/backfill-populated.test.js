const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp } = require('../migrations/runner');

test('up copies every populated address field', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  db.prepare('INSERT INTO customers (name, email, address_line1, address_line2, address_city, address_region, address_postal_code, address_country) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('Full Address', 'full@example.test', '1 First St', 'Suite 4', 'Bristol', 'Avon', 'BS1', 'UK');
  migrateUp(db);
  assert.deepEqual(({ ...db.prepare('SELECT line1, line2, city, region, postal_code, country FROM addresses').get() }), { line1: '1 First St', line2: 'Suite 4', city: 'Bristol', region: 'Avon', postal_code: 'BS1', country: 'UK' });
  db.close();
});
