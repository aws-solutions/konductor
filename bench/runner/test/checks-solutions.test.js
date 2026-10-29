// SPDX-License-Identifier: Apache-2.0
'use strict';

// Runs the runner's own runChecks over every reference solution overlay. A check
// that fails here would also fail an agent that did the task correctly.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runChecks } = require('../lib/checks.js');
const { copyFixture } = require('../lib/sandbox.js');
const { buildCheckEnv } = require('../lib/env.js');
const { loadTasks, BENCH_DIR } = require('../lib/tasks.js');

const SOLUTIONS = path.join(BENCH_DIR, 'tasks', 'solutions');

for (const [id, task] of loadTasks(BENCH_DIR)) {
  if (id.startsWith('_') || !fs.existsSync(path.join(SOLUTIONS, id))) continue;
  test(`reference solution passes every runner check: ${id}`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sol-'));
    try {
      copyFixture(task.fixtureDir, dir);
      fs.cpSync(path.join(SOLUTIONS, id), dir, { recursive: true });
      const { env } = buildCheckEnv(process.env, { home: path.join(dir, '.home') });
      fs.mkdirSync(env.TMPDIR, { recursive: true });
      const failed = runChecks(dir, task.checks, { pristineDir: task.fixtureDir, env, hiddenDir: task.hiddenDir }).filter((c) => !c.passed);
      assert.deepEqual(failed, []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
