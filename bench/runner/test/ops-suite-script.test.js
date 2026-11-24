// SPDX-License-Identifier: Apache-2.0
'use strict';

// The counted full-suite script's own stub test (bench/ops/workspace/test-run-full-suite-twice-v2.sh) runs here, so a
// change to the script or to the env it needs breaks the suite at once. It went unrun after the move into bench/ops and
// failed on the new KONDUCTOR_WS rule with nobody seeing it (2026-11-23).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'ops', 'workspace', 'test-run-full-suite-twice-v2.sh');

test('run-full-suite-twice-v2.sh: every stub case passes (reading, arm skips, counted set, settled leaks)', { timeout: 300000 }, () => {
  const env = { ...process.env };
  for (const k of ['KONDUCTOR_WS', 'PLANT_CS', 'R', 'SUITE_CMD', 'LEAK_DIR', 'LEAK_SETTLE']) delete env[k];
  const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8', env, timeout: 280000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /all cases pass/);
});

test('run-overnight.sh: the stub cases pass (step order, stop at a failing step, give-up after the wait limit)', { timeout: 120000 }, () => {
  const env = { ...process.env };
  for (const k of ['KONDUCTOR_WS', 'OVERNIGHT_WAIT_PAT', 'OVERNIGHT_POLL_S', 'MAX_WAIT_MIN']) delete env[k];
  const r = spawnSync('bash', [path.join(__dirname, '..', '..', 'ops', 'workspace', 'test-run-overnight-stub.sh')], { encoding: 'utf8', env, timeout: 110000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /all cases pass/);
});
