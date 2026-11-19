'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('validator accepts the checked-in baseline', () => {
  const result = spawnSync(process.execPath, [path.join('src', 'validate.js')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Status: OK/);
});
