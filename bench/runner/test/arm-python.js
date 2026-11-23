// SPDX-License-Identifier: Apache-2.0
'use strict';

// The plant Python for the arm (mujoco, cedarpy) and toy-release (cedarpy) tests: BENCH_ARM_PYTHON, else <repo>/.venv.
// Without one the tests skip. BENCH_REQUIRE_ARM=1 (set by the counted full suite) makes a missing one an error at load,
// so a suite run where every arm test would skip fails instead of reading clean (review 2026-11-23 F1).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PYTHON = process.env.BENCH_ARM_PYTHON || path.join(__dirname, '..', '..', '..', '.venv', 'bin', 'python');
const imports = (mods) => fs.existsSync(PYTHON) && spawnSync(PYTHON, ['-c', `import ${mods}`]).status === 0;
const HAS_ARM = imports('mujoco, cedarpy');
const HAS_CEDAR = HAS_ARM || imports('cedarpy');

if (process.env.BENCH_REQUIRE_ARM === '1' && !HAS_ARM) {
  throw new Error(`BENCH_REQUIRE_ARM=1 but ${PYTHON} cannot import mujoco and cedarpy; set BENCH_ARM_PYTHON (and LD_LIBRARY_PATH for libffi)`);
}

const HOW = '(set BENCH_ARM_PYTHON; BENCH_REQUIRE_ARM=1 fails instead)';
/** Test options: `arm` needs mujoco and cedarpy, `cedar` needs cedarpy only. */
const arm = { skip: !HAS_ARM && `no Python with mujoco and cedarpy ${HOW}` };
const cedar = { skip: !HAS_CEDAR && `no Python with cedarpy ${HOW}` };

module.exports = { PYTHON, HAS_ARM, HAS_CEDAR, arm, cedar };
