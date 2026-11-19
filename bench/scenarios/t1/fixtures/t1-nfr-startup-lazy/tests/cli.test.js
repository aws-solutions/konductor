'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function cli(...args) { return spawnSync(process.execPath, ['bin/atlas.js', ...args], { cwd: root, encoding: 'utf8' }); }

test('help and version are stable', () => {
  const help = cli('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: atlas/);
  const version = cli('--version');
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), '2.4.0');
});

test('unknown commands fail clearly', () => {
  const result = cli('unknown');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown command/);
});
