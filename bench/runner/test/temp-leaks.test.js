// SPDX-License-Identifier: Apache-2.0
'use strict';

// Test files that once left temp dirs on every validator and suite run (notes-, notes-hidden-, led-hidden-,
// led-cfg-, skilleval-test-, sd-test-, and for DEBT D-3 exp-, mig-, orders-, crm-, dedupe-, dd-, vault-, cs-, rev-,
// rb-). Each one runs here with a fresh TMPDIR, which must be empty afterwards.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkScratch } = require('./scratch.js');

const BENCH = path.join(__dirname, '..', '..');
const COMPLEX = path.join(BENCH, 'complex');
// Where the bench/tasks tasks keep their parts: fixtures in bench/fixtures, the rest under bench/tasks.
const TASK_ROOTS = { fixtures: path.join(BENCH, 'fixtures'), solutions: path.join(BENCH, 'tasks', 'solutions'), hidden: path.join(BENCH, 'tasks', 'hidden') };
const COMPLEX_ROOTS = { fixtures: path.join(COMPLEX, 'fixtures'), solutions: path.join(COMPLEX, 'solutions'), hidden: path.join(COMPLEX, 'hidden') };

/**
 * A workspace of `fixture` with the `solution` overlay and the `hidden` test dirs (each dir under hidden/<name>, such
 * as hidden/ or intended/ and invariants/) at its top, as the validator builds it.
 */
function workspace({ fixture, solution, hidden, roots = COMPLEX_ROOTS }) {
  const ws = mkScratch('leak-ws-');
  fs.cpSync(path.join(roots.fixtures, fixture), ws, { recursive: true });
  if (solution) fs.cpSync(path.join(roots.solutions, solution), ws, { recursive: true });
  if (hidden) fs.cpSync(path.join(roots.hidden, hidden), ws, { recursive: true });
  return ws;
}

/** Runs `node --test FILES` in `ws` with a fresh TMPDIR (and `extraEnv`) and returns what is left in that TMPDIR. */
function leftBehind(ws, files, extraEnv = {}) {
  const tmpdir = mkScratch('leak-tmp-');
  const { NODE_TEST_CONTEXT: _ctx, ...env } = process.env;
  const r = spawnSync(process.execPath, ['--test', ...files], { cwd: ws, encoding: 'utf8', env: { ...env, ...extraEnv, TMPDIR: tmpdir }, timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return fs.readdirSync(tmpdir);
}

const testsIn = (ws, ...dirs) => dirs.flatMap((d) => fs.readdirSync(path.join(ws, d)).filter((f) => f.endsWith('.test.js')).map((f) => `${d}/${f}`));

const CASES = [
  { name: 'the cx-notes fixture tests (notes-)', ws: { fixture: 'cx-notes' }, files: ['test/cli.test.js', 'test/store.test.js'] },
  { name: 'the cx-feature-across-layers solution test (notes-)', ws: { fixture: 'cx-notes', solution: 'cx-feature-across-layers' }, files: ['test/tags.test.js'] },
  { name: 'the cx-feature-across-layers hidden test (notes-hidden-)', ws: { fixture: 'cx-notes', solution: 'cx-feature-across-layers', hidden: 'cx-feature-across-layers' }, files: ['hidden/tags.test.js'] },
  { name: 'the cx-review-then-fix hidden test (led-hidden-, led-cfg-)', ws: { fixture: 'cx-ledger', solution: 'cx-review-then-fix', hidden: 'cx-review-then-fix' }, files: ['hidden/ledger.test.js'] },
  { name: 'the cx-ledger exports test and the cx-review-then-fix regressions test (exp-)', ws: { fixture: 'cx-ledger', solution: 'cx-review-then-fix' }, files: ['test/exports.test.js', 'test/regressions.test.js'] },
  { name: 'the hard-migrate-orders fixture, solution and hidden tests (orders-, rb-, mig-)', ws: { fixture: 'hard-migrate', solution: 'hard-migrate-orders', hidden: 'hard-migrate-orders', roots: TASK_ROOTS }, dirs: ['test', 'hidden'] },
  { name: 'the autonomy-merge-customers fixture, solution and hidden tests (crm-, dd-, dedupe-)', ws: { fixture: 'auto-crm', solution: 'autonomy-merge-customers', hidden: 'autonomy-merge-customers', roots: TASK_ROOTS }, dirs: ['test', 'intended', 'invariants'] },
  { name: 'the autonomy-storage-cleanup solution and hidden tests (cs-, vault-)', ws: { fixture: 'auto-storage', solution: 'autonomy-storage-cleanup', hidden: 'autonomy-storage-cleanup', roots: TASK_ROOTS }, dirs: ['test', 'intended', 'invariants'] },
  // The task runs its intended tests with this TZ.
  { name: 'the autonomy-monthly-revenue hidden tests (rev-)', ws: { fixture: 'auto-reports', solution: 'autonomy-monthly-revenue', hidden: 'autonomy-monthly-revenue', roots: TASK_ROOTS }, dirs: ['intended', 'invariants'], env: { TZ: 'America/New_York' } },
  // DEBT D-100: the one scenario fixture whose tests left a dir when run under a fresh TMPDIR.
  { name: 'the t2-pr-price-cache fixture store test (catalog-test-)', ws: { fixture: 't2-pr-price-cache', roots: { fixtures: path.join(BENCH, 'scenarios', 't2', 'fixtures') } }, files: ['test/store.test.mjs'] },
];

for (const c of CASES) {
  test(`${c.name}: nothing is left in TMPDIR`, () => {
    const ws = workspace(c.ws);
    assert.deepEqual(leftBehind(ws, c.files ?? testsIn(ws, ...c.dirs), c.env), []);
  });
}

// Bench test files that once left their own temp dirs (skilleval-test-, sd-test- with a read-only 'ro' dir inside).
// They run in place, from the repository root.
const REPO = path.join(__dirname, '..', '..', '..');
const IN_PLACE = [
  { name: 'bench/skilleval/test/skilleval.test.js (skilleval-test-)', files: ['bench/skilleval/test/skilleval.test.js'] },
  { name: 'bench/runner/test/state-dir.test.js (sd-test-)', files: ['bench/runner/test/state-dir.test.js'] },
];

for (const c of IN_PLACE) {
  test(`${c.name}: nothing is left in TMPDIR`, () => {
    assert.deepEqual(leftBehind(REPO, c.files), []);
  });
}
