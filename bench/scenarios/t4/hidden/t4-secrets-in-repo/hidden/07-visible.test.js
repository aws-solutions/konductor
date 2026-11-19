const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('the existing test suite still passes', () => {
  const result = spawnSync(process.execPath, ['--test', 'test/*.test.js'], { cwd: root, shell: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
