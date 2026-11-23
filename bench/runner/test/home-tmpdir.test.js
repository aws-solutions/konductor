// SPDX-License-Identifier: Apache-2.0
'use strict';

// Class check for "a temp dir made under TMPDIR, then refused by a home guard" (2026-11-22: 112 cap-* and
// claude-code-* failures when the suite ran from a session scratch dir inside HOME). The test files whose code
// guards against HOME run here with HOME set to a fake home and TMPDIR inside it. They must pass and leave that
// TMPDIR empty. A new module with a home guard adds its test file to GUARDED.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkScratch } = require('./scratch.js');

const GUARDED = ['cap-variant.test.js', 'cap-studyio.test.js', 'cap-skillstudy.test.js', 'claude-code-harness.test.js', 'prepare-only.test.js', 'startup.test.js'];

test('test files with a home guard pass when TMPDIR is inside HOME, and leave nothing there', () => {
  const home = path.join(mkScratch('home-tmpdir-'), 'home');
  const tmpdir = path.join(home, 'session-scratch');
  fs.mkdirSync(tmpdir, { recursive: true });
  const files = GUARDED.map((f) => path.join(__dirname, f));
  const { NODE_TEST_CONTEXT: _ctx, ...env } = process.env;
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...files], {
    env: { ...env, HOME: home, TMPDIR: tmpdir }, encoding: 'utf8', timeout: 600_000,
  });
  const failed = (r.stdout || '').split('\n').filter((l) => l.startsWith('✖')).slice(0, 10).join('\n');
  assert.equal(r.status, 0, `${failed}\n${(r.stderr || '').slice(-2000)}`);
  assert.deepEqual(fs.readdirSync(tmpdir), []);
});
