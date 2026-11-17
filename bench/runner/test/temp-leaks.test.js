// SPDX-License-Identifier: Apache-2.0
'use strict';

// Task test files that once left temp dirs on every validator and suite run (notes-, notes-hidden-, led-hidden-,
// led-cfg-). Each one runs here in its own task workspace with a fresh TMPDIR, which must be empty afterwards.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkScratch } = require('./scratch.js');

const COMPLEX = path.join(__dirname, '..', '..', 'complex');

/** A workspace of `fixture` with the `solution` overlay and the `hidden` tests in hidden/, as the validator builds it. */
function workspace({ fixture, solution, hidden }) {
  const ws = mkScratch('leak-ws-');
  fs.cpSync(path.join(COMPLEX, 'fixtures', fixture), ws, { recursive: true });
  if (solution) fs.cpSync(path.join(COMPLEX, 'solutions', solution), ws, { recursive: true });
  if (hidden) fs.cpSync(path.join(COMPLEX, 'hidden', hidden, 'hidden'), path.join(ws, 'hidden'), { recursive: true });
  return ws;
}

/** Runs `node --test FILES` in `ws` with a fresh TMPDIR and returns what is left in that TMPDIR. */
function leftBehind(ws, files) {
  const tmpdir = mkScratch('leak-tmp-');
  const { NODE_TEST_CONTEXT: _ctx, ...env } = process.env;
  const r = spawnSync(process.execPath, ['--test', ...files], { cwd: ws, encoding: 'utf8', env: { ...env, TMPDIR: tmpdir }, timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return fs.readdirSync(tmpdir);
}

const CASES = [
  { name: 'the cx-notes fixture tests (notes-)', ws: { fixture: 'cx-notes' }, files: ['test/cli.test.js', 'test/store.test.js'] },
  { name: 'the cx-feature-across-layers solution test (notes-)', ws: { fixture: 'cx-notes', solution: 'cx-feature-across-layers' }, files: ['test/tags.test.js'] },
  { name: 'the cx-feature-across-layers hidden test (notes-hidden-)', ws: { fixture: 'cx-notes', solution: 'cx-feature-across-layers', hidden: 'cx-feature-across-layers' }, files: ['hidden/tags.test.js'] },
  { name: 'the cx-review-then-fix hidden test (led-hidden-, led-cfg-)', ws: { fixture: 'cx-ledger', solution: 'cx-review-then-fix', hidden: 'cx-review-then-fix' }, files: ['hidden/ledger.test.js'] },
];

for (const c of CASES) {
  test(`${c.name}: nothing is left in TMPDIR`, () => {
    assert.deepEqual(leftBehind(workspace(c.ws), c.files), []);
  });
}
