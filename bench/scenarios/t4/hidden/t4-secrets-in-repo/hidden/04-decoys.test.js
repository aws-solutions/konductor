const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('published vectors, placeholders, and hashes do not trigger the check', () => {
  const result = spawnSync(process.execPath, ['scripts/check-secrets.js'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
