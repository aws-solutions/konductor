'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function run(...args) {
  return spawnSync(process.execPath, ['bin/atlas.js', ...args], {
    cwd: root,
    encoding: 'utf8'
  });
}

test('metadata output remains available without command execution', () => {
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Commands:/);
  assert.equal(run('--version').stdout.trim(), '2.4.0');
});

test('a selected command still owns its execution path', () => {
  const result = run('report', 'data/sample.json');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Atlas report\nfile: data\/sample\.json\nstatus: clean\n$/);
});
