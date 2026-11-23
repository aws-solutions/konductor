// SPDX-License-Identifier: Apache-2.0
'use strict';

// arm-python.js picks the plant Python for the arm and cedarpy tests. Review 2026-11-23 F1: the counted full suite ran
// with no arm Python, so every arm test skipped and the run still read clean. BENCH_REQUIRE_ARM=1 turns that skip
// into a failure.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HELPER = path.join(__dirname, 'arm-python.js');
const probe = (env) => spawnSync(process.execPath, ['-e', `const a = require(${JSON.stringify(HELPER)}); process.stdout.write(JSON.stringify({ arm: a.arm.skip, cedar: a.cedar.skip, python: a.PYTHON }))`],
  { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });

test('with no arm Python the arm and cedar tests skip, and say how to make them run or fail', () => {
  const r = probe({ BENCH_ARM_PYTHON: '/nonexistent/python' });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.python, '/nonexistent/python');
  assert.match(o.arm, /mujoco and cedarpy .*BENCH_ARM_PYTHON.*BENCH_REQUIRE_ARM=1/);
  assert.match(o.cedar, /cedarpy .*BENCH_ARM_PYTHON.*BENCH_REQUIRE_ARM=1/);
});

test('BENCH_REQUIRE_ARM=1 makes a missing arm Python a failure, not a skip', () => {
  const r = probe({ BENCH_ARM_PYTHON: '/nonexistent/python', BENCH_REQUIRE_ARM: '1' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /BENCH_REQUIRE_ARM=1 but \/nonexistent\/python cannot import mujoco and cedarpy/);
});
