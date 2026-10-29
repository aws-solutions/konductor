// SPDX-License-Identifier: Apache-2.0
'use strict';

// The whole check pipeline on the real tasks, inside the namespace a run uses (host copies of the projects masked,
// no network): the upstream fix must score full marks and the base tree must score zero on FAIL_TO_PASS.
// It needs the upstream cache (node bench/real/fetch.js) and takes about a minute and a half, so it only runs
// with BENCH_REAL_E2E=1.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const reallib = require('../../real/lib.js');
const { loadTasks, benchMask } = require('../lib/tasks.js');
const real = require('../lib/real.js');
const { runChecks } = require('../lib/checks.js');
const { buildCheckEnv } = require('../lib/env.js');
const { makeIso } = require('../lib/run-one.js');
const { probeUnshare } = require('../lib/isolate.js');
const { makeScratchRoot } = require('../lib/sandbox.js');

const cache = reallib.resolveCache();
const probe = probeUnshare();
const skip = process.env.BENCH_REAL_E2E !== '1' ? 'set BENCH_REAL_E2E=1 to run' : !probe.ok ? `namespace unavailable: ${probe.reason}` : !fs.existsSync(cache) ? `no cache at ${cache}` : false;

function score(task, root, scratch) {
  const iso = makeIso({ isolation: { mode: 'unshare' }, realCache: cache, hide: [], mask: benchMask(), keyRoots: [] }, { vanilla: true }, scratch, task, { offline: true });
  const home = path.join(scratch, 'home');
  fs.mkdirSync(path.join(home, 'tmp'), { recursive: true });
  const { env } = buildCheckEnv(process.env, { home, konductor: false });
  return runChecks(root, task.checks, {
    env, hiddenDir: task.hiddenDir, scratchDir: path.join(scratch, 'check-scratch'), real: real.testSpec(task),
    pristineDir: real.pristineDir(task, { cache }), wrapCmd: (cmd) => iso.wrap('sh', ['-c', cmd]),
  });
}

for (const task of loadTasks(path.join(__dirname, '../..')).values()) {
  if (!task.real) continue;
  test(`${task.real}: the upstream fix passes every listed test and the base tree fails FAIL_TO_PASS`, { skip }, () => {
    const scratch = makeScratchRoot();
    try {
      const base = path.join(scratch, 'base');
      real.materializeInto(task, base, { cache });
      const before = score(task, base, scratch).find((c) => c.type === 'tests');
      assert.equal(before.tests.passed, 0, `base: ${before.detail}`);
      assert.equal(before.regression.passed, before.regression.total, `base: ${before.detail}`);

      const fixed = path.join(scratch, 'fixed');
      real.materializeInto(task, fixed, { cache });
      const patch = real.fixPatchText(task, { cache });
      const applied = spawnSync('git', ['apply', '--whitespace=nowarn', '-'], { cwd: fixed, input: patch, encoding: 'utf8' });
      assert.equal(applied.status, 0, applied.stderr);
      const after = score(task, fixed, scratch);
      const t = after.find((c) => c.type === 'tests');
      assert.equal(t.passed, true, t.detail);
      assert.equal(t.tests.passed, t.tests.total);
      assert.equal(t.regression.passed, t.regression.total);
      assert.equal(after.find((c) => c.type === 'fixture_unchanged').passed, true, 'applying the fix does not touch existing tests');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
}
