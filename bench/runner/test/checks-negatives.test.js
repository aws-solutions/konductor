// SPDX-License-Identifier: Apache-2.0
'use strict';

// Loosened checks must accept the phrasings seen in real outputs and still reject wrong answers.
// The same cases run in tasks/validate-tasks.js; this keeps them in `node --test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runChecks } = require('../lib/checks.js');
const { copyFixture } = require('../lib/sandbox.js');
const { buildCheckEnv } = require('../lib/env.js');
const { loadTasks, suiteExtraDirs, BENCH_DIR } = require('../lib/tasks.js');
const { loadCases, checkCases, MIN_NEGATIVES } = require('../lib/negatives.js');
const { mkScratch } = require('./scratch.js');

const EXTRA = suiteExtraDirs('rootcause', BENCH_DIR);
const tasks = loadTasks(BENCH_DIR, { extraDirs: EXTRA });
// bench/tasks plus every extra directory a suite declares; each keeps negatives and solutions beside its task files.
const ROOTS = [path.join(BENCH_DIR, 'tasks'), ...EXTRA];

for (const root of ROOTS) {
  const NEGATIVES = path.join(root, 'negatives');
  const SOLUTIONS = path.join(root, 'solutions');
  for (const file of fs.readdirSync(NEGATIVES).filter((f) => f.endsWith('.json')).sort()) {
    const id = file.replace(/\.json$/, '');
    test(`negative and positive cases hold: ${id}`, () => {
      const task = tasks.get(id);
      assert.ok(task, `unknown task ${id}`);
      const problems = checkCases({
        task, spec: loadCases(NEGATIVES, id),
        makeWorkspace: () => {
          const dir = mkScratch('neg-');
          copyFixture(task.fixtureDir, dir);
          fs.cpSync(path.join(SOLUTIONS, id), dir, { recursive: true });
          return dir;
        },
        evalOne: (dir, check) => {
          const { env } = buildCheckEnv(process.env, { home: path.join(dir, '.home') });
          return runChecks(dir, [check], { pristineDir: task.fixtureDir, env })[0].passed;
        },
      });
      assert.deepEqual(problems, []);
    });
  }
}

test('checkCases reports a case that disagrees with its expectation and a loosened check without enough negatives', () => {
  const task = { id: 't', checks: [{ type: 'contains', path: 'a.txt', pattern: 'x' }] };
  const make = () => mkScratch('neg-');
  const evalOne = (dir, c) => runChecks(dir, [c])[0].passed;
  const spec = {
    loosened: [0],
    cases: [
      { name: 'wrong expectation', check: 0, type: 'contains', expect: 'fail', files: { 'a.txt': 'x' } },
      { name: 'good', check: 0, type: 'contains', expect: 'pass', files: { 'a.txt': 'x' } },
    ],
  };
  const problems = checkCases({ task, spec, makeWorkspace: make, evalOne });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /passed, expected fail/);
  assert.match(problems[1], new RegExp(`needs at least ${MIN_NEGATIVES} negative`));
});

test('checkCases rejects a case whose type does not match the check at that index', () => {
  const task = { id: 't', checks: [{ type: 'contains', path: 'a.txt', pattern: 'x' }] };
  const problems = checkCases({
    task, spec: { cases: [{ name: 'c', check: 0, type: 'cmd', expect: 'pass', files: {} }] },
    makeWorkspace: () => mkScratch('neg-'), evalOne: () => true,
  });
  assert.match(problems[0], /check 0 is contains, case says cmd/);
});

test('the 7-day versus 5-day pattern is the same in every task that uses it', () => {
  const win = (id, idx) => {
    const c = tasks.get(id).checks[idx];
    if (c.pattern) return c.pattern;
    return JSON.parse(c.cmd.match(/new RegExp\(("(?:[^"\\]|\\.)*")/)[1]);
  };
  const base = win('design-hold-service', 1);
  assert.equal(win('sop-plan', 6), base);
  assert.equal(win('sop-spec-workflow', 14), base);
});
