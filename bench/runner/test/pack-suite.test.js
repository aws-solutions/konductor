// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/suites/pack.json lists the whole scenario pack (DEBT D-77): it matches the task files, every id loads with the
// suite's own extra directories, and `--level lite` picks from it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { packSuite, render, SUITE_FILE } = require('../../scenarios/pack-suite.js');
const { loadTasks, loadSuite, suiteExtraDirs, SUITE_NAMES } = require('../lib/tasks.js');
const { planLevel } = require('../../scenarios/levels.js');

test('bench/suites/pack.json is the generated file (run node bench/scenarios/pack-suite.js after adding a task)', () => {
  assert.equal(fs.readFileSync(SUITE_FILE, 'utf8'), render(packSuite()));
});

test('the pack suite loads every task and --level lite picks from it', () => {
  assert.ok(SUITE_NAMES.includes('pack'));
  const extraDirs = suiteExtraDirs('pack');
  const all = loadTasks(undefined, { extraDirs });
  const suite = loadSuite('pack', all);
  assert.ok(suite.taskIds.length > 100);
  assert.deepEqual(suite.taskIds.filter((id) => !all.has(id)), []);
  const plan = planLevel({ level: 'lite' }, { candidates: suite.taskIds.map((id) => all.get(id)), extraDirs });
  assert.ok(plan.sel.ids.length > 0 && plan.sel.ids.every((id) => suite.taskIds.includes(id)));
});
