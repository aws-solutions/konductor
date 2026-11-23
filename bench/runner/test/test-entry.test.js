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
  if (!('BENCH_ARM_PYTHON' in extraEnv)) delete env.BENCH_ARM_PYTHON;
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
