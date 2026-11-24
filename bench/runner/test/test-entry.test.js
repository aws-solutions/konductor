// SPDX-License-Identifier: Apache-2.0
// bench/scripts/test.sh, the one test entry point (FW-23, DEBT D-217), run against a fake repo: the Python tests show
// as TAP lines, and an arm test that skips while an arm Python is present fails the run (the skip trap, debt review
// F1). The fake arm Python answers the mujoco/cedarpy import probe and runs everything else with python3. No model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BENCH = path.join(__dirname, '..', '..');
const SCRIPT = path.join(BENCH, 'scripts', 'test.sh');

/** A fake repo with one node test (`nodeBody` is its test call) and one Python test module (`pyBody`). */
function fakeRepo(t, { nodeBody, pyBody }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test-entry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const d of ['bench/runner/test', 'bench/skilleval/test', 'bench/physical/test', 'bench/scripts']) fs.mkdirSync(path.join(root, d), { recursive: true });
  const nodeTest = `const test = require('node:test');\n${nodeBody}\n`;
  fs.writeFileSync(path.join(root, 'bench/runner/test/a.test.js'), nodeTest);
  fs.writeFileSync(path.join(root, 'bench/skilleval/test/b.test.js'), "require('node:test')('b', () => {});\n");
  fs.writeFileSync(path.join(root, 'bench/physical/test/test_fake.py'), `import unittest\n\n\nclass Fake(unittest.TestCase):\n${pyBody}\n`);
  fs.copyFileSync(path.join(BENCH, 'scripts', 'unittest-tap.py'), path.join(root, 'bench/scripts/unittest-tap.py'));
  const armPy = path.join(root, 'arm-python');
  fs.writeFileSync(armPy, '#!/bin/sh\n[ "$1" = -c ] && exit 0\nexec python3 "$@"\n', { mode: 0o755 });
  return { root, armPy };
}

function run(root, extraEnv = {}) {
  const env = { ...process.env, R: root, ...extraEnv };
  delete env.BENCH_REQUIRE_ARM;
  if (!('KONDUCTOR_WS' in extraEnv)) delete env.KONDUCTOR_WS;
  if (!('BENCH_ARM_PYTHON' in extraEnv)) delete env.BENCH_ARM_PYTHON;
  if (!('BENCH_STRANDS_PYTHON' in extraEnv)) delete env.BENCH_STRANDS_PYTHON;
  // HOME is the fake repo, so the default Strands venv (~/.cache/konductor-strands) of the real host is never found.
  if (!('HOME' in extraEnv)) env.HOME = root;
  return spawnSync('bash', [SCRIPT, '--tap'], { env, encoding: 'utf8', timeout: 60000 });
}

const PY_OK = '    def test_one(self):\n        self.assertTrue(True)';
const NODE_OK = "test('a', () => {});";

test('no arm Python: node and Python tests run, the Python ones as TAP lines, exit 0', (t) => {
  const { root } = fakeRepo(t, { nodeBody: NODE_OK, pyBody: PY_OK });
  const r = run(root);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /# no arm Python/);
  assert.match(r.stdout, /^ok 1 - a/m);
  assert.match(r.stdout, /^ok 1 - py: test_fake\.Fake\.test_one$/m);
  assert.match(r.stdout, /^# py tests 1$/m);
  assert.match(r.stdout, /^# arm skips 0$/m);
});

test('the skip trap: an arm Python is present and a node arm test skips, so the run fails', (t) => {
  const { root, armPy } = fakeRepo(t, { nodeBody: "test('arm', { skip: 'no Python with mujoco and cedarpy' }, () => {});", pyBody: PY_OK });
  const r = run(root, { BENCH_ARM_PYTHON: armPy });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^# arm skips 1$/m);
  assert.match(r.stderr, /1 arm test\(s\) skipped/);
});

test('the skip trap: an arm Python is present and a Python arm test skips, so the run fails', (t) => {
  const pyBody = '    @unittest.skip("MuJoCo is not installed in this Python")\n    def test_arm(self):\n        pass';
  const { root, armPy } = fakeRepo(t, { nodeBody: NODE_OK, pyBody });
  const r = run(root, { BENCH_ARM_PYTHON: armPy });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^ok 1 - py: test_fake\.Fake\.test_arm # SKIP MuJoCo is not installed in this Python$/m);
  assert.match(r.stdout, /^# arm skips 1$/m);
});

test('an arm Python with no skips: the node test sees BENCH_REQUIRE_ARM=1, exit 0', (t) => {
  const nodeBody = "test('env', () => { if (process.env.BENCH_REQUIRE_ARM !== '1') throw new Error('no BENCH_REQUIRE_ARM'); });";
  const { root, armPy } = fakeRepo(t, { nodeBody, pyBody: PY_OK });
  const r = run(root, { BENCH_ARM_PYTHON: armPy });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^# arm skips 0$/m);
});

test('a Python failure is a not-ok TAP line and fails the run', (t) => {
  const { root } = fakeRepo(t, { nodeBody: NODE_OK, pyBody: '    def test_bad(self):\n        self.assertEqual(1, 2)' });
  const r = run(root);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^not ok 1 - py: test_fake\.Fake\.test_bad$/m);
  assert.match(r.stderr, /AssertionError/);
});

test('with KONDUCTOR_WS set, a plain workspace copy of a bench/ops script fails the run (D-236)', (t) => {
  const { root } = fakeRepo(t, { nodeBody: NODE_OK, pyBody: PY_OK });
  fs.mkdirSync(path.join(root, 'bench/ops/workspace'), { recursive: true });
  fs.copyFileSync(path.join(BENCH, 'ops', 'make-launchers.sh'), path.join(root, 'bench/ops/make-launchers.sh'));
  fs.writeFileSync(path.join(root, 'bench/ops/workspace/run-x.sh'), 'echo versioned\n');
  const ws = path.join(root, 'ws');
  fs.mkdirSync(path.join(ws, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'reports', 'next-experiment-2026-11-22'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'scripts', 'run-x.sh'), 'echo an edited copy\n');
  const bad = run(root, { KONDUCTOR_WS: ws });
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /^not ok 1 - ops: every workspace owner script is a launcher into bench\/ops$/m);
  assert.match(bad.stdout, /^# plain copy of bench\/ops\/workspace\/run-x\.sh/m);
  const launch = spawnSync('bash', [path.join(root, 'bench/ops/make-launchers.sh'), ws, '--replace'], { encoding: 'utf8' });
  assert.equal(launch.status, 0, launch.stdout);
  const good = run(root, { KONDUCTOR_WS: ws });
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /^ok 1 - ops: /m);
});

test('an arm venv whose base Python is gone stops the run with the rebuild command, not a skip', (t) => {
  const { root } = fakeRepo(t, { nodeBody: NODE_OK, pyBody: PY_OK });
  const venv = path.join(root, 'armvenv');
  fs.mkdirSync(path.join(venv, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(venv, 'pyvenv.cfg'), 'home = /gone\n');
  fs.symlinkSync(path.join(root, 'gone', 'python3.12'), path.join(venv, 'bin', 'python'));
  const r = run(root, { BENCH_ARM_PYTHON: path.join(venv, 'bin', 'python') });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.ok(r.stderr.includes(`Rebuild its venv: bash bench/ops/workspace/rebuild-arm-venv.sh --venv ${venv}`), r.stderr);
});

// Strands: with a Strands Python (BENCH_STRANDS_PYTHON, else ~/.cache/konductor-strands/bin/python) the node tests get
// it and the Python test_strands_*.py files run with it as "strands py:" lines; a Strands test that still skips fails
// the run. With none, the run says so and prints the count of skipped Strands tests, so the reading can count them.
const STRANDS_SKIP = "test('st', { skip: 'set BENCH_STRANDS_PYTHON to an interpreter with strands-agents' }, () => {});";
function strandsPy(root) {
  const p = path.join(root, '.cache', 'konductor-strands', 'bin', 'python');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '#!/bin/sh\n[ "$1" = -c ] && exit 0\nexec python3 "$@"\n', { mode: 0o755 });
  return p;
}

test('a Strands Python in the default place: node tests see it, test_strands_*.py run with it, 0 skips, exit 0', (t) => {
  const nodeBody = "test('env', () => { if (!process.env.BENCH_STRANDS_PYTHON) throw new Error('no BENCH_STRANDS_PYTHON'); });";
  const { root } = fakeRepo(t, { nodeBody, pyBody: PY_OK });
  fs.writeFileSync(path.join(root, 'bench/physical/test/test_strands_fake.py'), `import unittest\n\n\nclass S(unittest.TestCase):\n${PY_OK}\n`);
  strandsPy(root);
  const r = run(root);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ok 1 - strands py: test_strands_fake\.S\.test_one$/m);
  assert.match(r.stdout, /^# strands py tests 1$/m);
  assert.match(r.stdout, /^# strands skips 0$/m);
});

test('a Strands Python is present and a Strands test skips: the run fails', (t) => {
  const { root } = fakeRepo(t, { nodeBody: STRANDS_SKIP, pyBody: PY_OK });
  const r = run(root, { BENCH_STRANDS_PYTHON: strandsPy(root) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^# strands skips 1$/m);
  assert.match(r.stderr, /1 Strands test\(s\) skipped/);
});

test('no Strands Python: the run says so and counts the skipped Strands tests, exit 0', (t) => {
  const { root } = fakeRepo(t, { nodeBody: STRANDS_SKIP, pyBody: PY_OK });
  const r = run(root);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^# no Strands Python \(.*\): the Strands tests skip$/m);
  assert.match(r.stdout, /^# strands skips 1$/m);
});
