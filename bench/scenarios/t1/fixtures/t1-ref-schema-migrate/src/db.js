const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDatabase(filename) {
  if (filename !== ':memory:') {
    const fs = require('node:fs');
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }
  return new DatabaseSync(filename);
}

function withTransaction(db, work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { openDatabase, withTransaction };
