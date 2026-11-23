// SPDX-License-Identifier: Apache-2.0
'use strict';

// buildRunConfig takes its inputs as three grouped objects (FW-24, DEBT D-218), not one bag of 50 names.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('buildRunConfig destructures at most three groups: flags, built and paths', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'run-cmd.js'), 'utf8');
  const m = /function buildRunConfig\(\{([^}]*)\}\)/.exec(src);
  assert.ok(m, 'buildRunConfig takes one destructured object');
  assert.deepEqual(m[1].split(',').map((s) => s.trim()).filter(Boolean), ['flags', 'built', 'paths']);
});
