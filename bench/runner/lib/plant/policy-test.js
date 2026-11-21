// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench plant-policy-test`: runs the gateway-only truth table against a release. A policy test, never a counted result.

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TRUTH_TABLE_RUN = path.join(__dirname, '..', '..', '..', 'physical', 'controls', 'truth_table_run.py');

/** The `{file, args}` that run the truth table for unpacked release `release` with interpreter `python`. */
function policyTestCommand({ release, python }) {
  return { file: python, args: ['-I', TRUTH_TABLE_RUN, '--release', path.resolve(release), '--python', python] };
}

/**
 * The command handler. `opts.release` is the unpacked release dir; `opts.python` the interpreter with cedarpy
 * (default `python3`). Sets the exit code: 0 when every cell passes, 1 when one fails, 2 on a usage error.
 */
function cmdPlantPolicyTest(opts, run = spawnSync) {
  if (!opts.release || opts.release === true) {
    console.error('plant-policy-test: --release DIR is required');
    process.exitCode = 2;
    return;
  }
  const python = opts.python && opts.python !== true ? opts.python : 'python3';
  const { file, args } = policyTestCommand({ release: opts.release, python });
  // PATH plus the dynamic-linker search path when set, so an arm release's gateway can load libffi for mujoco.
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin' };
  if (process.env.LD_LIBRARY_PATH) env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH;
  const result = run(file, args, { stdio: 'inherit', env });
  process.exitCode = result.status ?? 1;
}

module.exports = { cmdPlantPolicyTest, policyTestCommand };
