const path = require('node:path');
const { openDatabase } = require('./db');
const { migrateUp } = require('../migrations/runner');
const { createCustomer } = require('./customer-repository');
const { readConfig } = require('./config');

const records = [
  { name: 'Ada Lovelace', email: 'ada@example.test', address: { line1: '12 Analytical Way', city: 'London', country: 'UK' } },
  { name: 'Grace Hopper', email: 'grace@example.test', address: { line1: '18 Compiler Street', city: 'Arlington', region: 'VA', postalCode: '22201', country: 'US' } }
];

function main() {
  const filename = process.argv.includes('--db') ? process.argv[process.argv.indexOf('--db') + 1] : readConfig().database;
  const db = openDatabase(path.resolve(filename));
  try { migrateUp(db); for (const record of records) createCustomer(db, record); console.log(`seeded ${records.length} customers`); } finally { db.close(); }
}
if (require.main === module) main();
module.exports = { records, main };
