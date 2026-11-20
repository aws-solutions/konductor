const test = require('node:test');
// Merged so that wiring and backfill basics count once each: a half-done change that writes the migration but
// leaves the repository untouched cannot reach the 40 ceiling on them alone (owner ruling D-118).

async function part1() { // was old-migrations-present.test.js: the twelve existing migration files remain present
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  for (let n = 1; n <= 12; n++) {
    const prefix = String(n).padStart(3, '0');
    assert.equal(fs.readdirSync('migrations').some((file) => file.startsWith(`${prefix}-`)), true);
  }
}

async function part2() { // was migration-file.test.js: the new numbered migration exports both directions
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const file = path.join(process.cwd(), 'migrations', '013-split-customer-address.js');
  assert.ok(fs.existsSync(file));
  const migration = require(file);
  assert.equal(typeof migration.up, 'function');
  assert.equal(typeof migration.down, 'function');
}

async function part3() { // was cli.test.js: migration CLI reports up and down results as JSON
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-cli-'));
  const db = path.join(dir, 'cli.db');
  try {
    const up = spawnSync(process.execPath, ['src/migrate.js', 'up', '--db', db], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(up.status, 0, up.stderr);
    assert.deepEqual(JSON.parse(up.stdout).applied.slice(-1), [13]);
    const down = spawnSync(process.execPath, ['src/migrate.js', 'down', '--db', db], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(down.status, 0, down.stderr);
    assert.deepEqual(JSON.parse(down.stdout).applied, [13]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function part4() { // was runner-repeat.test.js: running the full migration command twice records version thirteen once
  const assert = require('node:assert/strict');
  const { DatabaseSync } = require('node:sqlite');
  const { migrateUp, appliedVersions } = require('../migrations/runner');
  const db = new DatabaseSync(':memory:');
  assert.deepEqual(migrateUp(db), Array.from({ length: 13 }, (_, i) => i + 1));
  assert.deepEqual(migrateUp(db), []);
  assert.deepEqual(appliedVersions(db), Array.from({ length: 13 }, (_, i) => i + 1));
  db.close();
}

test('the migration is wired in: twelve old files kept, the new file exports both directions, the CLI reports JSON, and a second full run records version thirteen once', async () => {
  await part1();
  await part2();
  await part3();
  await part4();
});
