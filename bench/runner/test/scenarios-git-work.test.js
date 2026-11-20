// SPDX-License-Identifier: Apache-2.0
'use strict';

// The shared worker-task grader (bench/scenarios/lib/hidden/git-work.js) and T12's scripted git agents (play() in
// bench/scenarios/t12/scenario.config.js), run through the one dry run on a real T12 task: tickets done on worker
// branches and merged score full marks, half the tickets score a third, and one agent fixing everything straight on
// main scores nothing, because the grader reads only the repository.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const { loadConfig } = require('../../scenarios/lib/config.js');
const { dryRun } = require('../../scenarios/lib/dry-run.js');

test('worker branches merged and cleaned up score; one agent fixing it all on main does not', { timeout: 300000 }, () => {
  const root = tmp();
  const was = process.env.TMPDIR;
  process.env.TMPDIR = root;
  try {
    const cfg = loadConfig(path.join(__dirname, '..', '..', 'scenarios', 't12', 'scenario.config.js'));
    const res = dryRun('t12-delegated-worker-fix', cfg, { repeat: 1 });
    assert.deepEqual(res.scores, { reference: 100, stub: 0, lazy: 33.3, alt: 100, shallow: 0 });
    assert.equal(res.pass, true);
    assert.deepEqual(fs.readdirSync(root).filter((n) => n.startsWith('git-work-')), [], 'snapshots are removed');
  } finally {
    process.env.TMPDIR = was;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
