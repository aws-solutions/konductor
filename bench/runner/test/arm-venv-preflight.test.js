// SPDX-License-Identifier: Apache-2.0
// When the plant or arm Python does not run at all (a venv whose base Python was removed, as a Kiro Crew update once
// did), the bench stops before any trial with the exact command that rebuilds the venv
// (bench/ops/workspace/rebuild-arm-venv.sh). The ops script's own stub test runs here too. No model call, no download.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { mkScratch } = require('./scratch.js');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkGatewayModules, rebuildHint } = require('../lib/python-pin.js');

const BENCH = path.join(__dirname, '..', '..');
const ARM_TASK = { environment: { kind: 'arm-sim' } };

/** A venv in a temp dir whose bin/python is a link to a base Python that is gone. */
function brokenVenv(t) {
  const root = mkScratch('arm-venv-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'venv', 'bin'), { recursive: true });
  fs.symlinkSync(path.join(root, 'gone', 'python3.12'), path.join(root, 'venv', 'bin', 'python'));
  fs.writeFileSync(path.join(root, 'venv', 'pyvenv.cfg'), `home = ${path.join(root, 'gone')}\n`);
  return path.join(root, 'venv');
}

test('rebuildHint names the venv of a venv python, and nothing for a bare interpreter', (t) => {
  const venv = brokenVenv(t);
  assert.equal(rebuildHint(path.join(venv, 'bin', 'python')), `bash bench/ops/workspace/rebuild-arm-venv.sh --venv ${venv}`);
  assert.equal(rebuildHint('/usr/bin/python3.12'), null);
});

test('a plant Python that does not run is refused with the rebuild command, not a pip line', (t) => {
  const venv = brokenVenv(t);
  const python = path.join(venv, 'bin', 'python');
  assert.throws(() => checkGatewayModules(python, [ARM_TASK], { PATH: '/usr/bin:/bin' }), (e) => {
    assert.match(e.message, /does not run/);
    assert.ok(e.message.includes(`bash bench/ops/workspace/rebuild-arm-venv.sh --venv ${venv}`), e.message);
    assert.doesNotMatch(e.message, /pip install/);
    return true;
  });
});

test('the arm test preflight under BENCH_REQUIRE_ARM=1 names the rebuild command for a venv that does not run', (t) => {
  const venv = brokenVenv(t);
  const r = spawnSync(process.execPath, ['-e', "require('./arm-python.js')"], {
    cwd: __dirname, encoding: 'utf8', env: { ...process.env, BENCH_ARM_PYTHON: path.join(venv, 'bin', 'python'), BENCH_REQUIRE_ARM: '1' },
  });
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes(`bash bench/ops/workspace/rebuild-arm-venv.sh --venv ${venv}`), r.stderr);
});

test('rebuild-arm-venv.sh: its stub test passes', () => {
  const r = spawnSync('bash', [path.join(BENCH, 'ops', 'workspace', 'test-rebuild-arm-venv.sh')], { encoding: 'utf8', env: { ...process.env, KIROCREW_SCRATCH: os.tmpdir() } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /all cases pass/);
});
