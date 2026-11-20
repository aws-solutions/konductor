const fs = require('node:fs');
const path = require('node:path');

function migrationFiles() {
  return fs.readdirSync(__dirname).filter((file) => /^\d{3}-.*\.js$/.test(file)).sort();
}

function loadMigrations() {
  return migrationFiles().map((file) => {
    const match = file.match(/^(\d+)-(.+)\.js$/);
    return { version: Number(match[1]), name: match[2], file, module: require(path.join(__dirname, file)) };
  });
}

function ensureTable(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
}

function appliedVersions(db) {
  ensureTable(db);
  return db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version);
}

function migrateUp(db, target = Infinity) {
  ensureTable(db);
  const applied = new Set(appliedVersions(db));
  const completed = [];
  for (const migration of loadMigrations()) {
    if (migration.version > target || applied.has(migration.version)) continue;
    migration.module.up(db);
    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
    completed.push(migration.version);
  }
  return completed;
}

function migrateDown(db) {
  ensureTable(db);
  const row = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1').get();
  if (!row) return [];
  const migration = loadMigrations().find((item) => item.version === row.version);
  if (!migration) throw new Error(`missing migration ${row.version}`);
  migration.module.down(db);
  db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(row.version);
  return [row.version];
}

module.exports = { loadMigrations, migrateUp, migrateDown, appliedVersions };
