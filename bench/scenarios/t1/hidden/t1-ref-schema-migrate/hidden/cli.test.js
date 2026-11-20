const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('migration CLI reports up and down results as JSON', () => {
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
});
