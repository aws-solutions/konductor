const path = require('node:path');
const { openDatabase } = require('./db');
const { migrateUp, migrateDown } = require('../migrations/runner');
const { readConfig } = require('./config');

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function main(args = process.argv.slice(2)) {
  const direction = args.find((arg) => arg === 'up' || arg === 'down') || 'up';
  const config = readConfig();
  const filename = option(args, '--db', config.database);
  const db = openDatabase(path.resolve(filename));
  try {
    const result = direction === 'up' ? migrateUp(db) : migrateDown(db);
    console.log(JSON.stringify({ direction, applied: result }));
  } finally { db.close(); }
}

if (require.main === module) main();
module.exports = { main };
