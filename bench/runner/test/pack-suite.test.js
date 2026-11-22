// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/suites/pack.json lists the whole scenario pack (DEBT D-77): it matches the task files, every id loads with the
// suite's own extra directories, and `--level lite` picks from it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('scenarios lint on the pack fails on a stale pack.json with the command to run, and passes on a fresh one (D-164)', () => {
  const { packSuiteProblem } = require('../../scenarios/cli.js');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pack-guard-'));
  try {
    const packDir = path.join(root, 'scenarios');
    const suiteFile = path.join(root, 'suites', 'pack.json');
    fs.mkdirSync(path.join(packDir, 't1'), { recursive: true });
    fs.mkdirSync(path.dirname(suiteFile), { recursive: true });
    const real = path.join(__dirname, '..', '..', 'scenarios', 't1', 't1-bug-cache-ttl.json');
    fs.copyFileSync(real, path.join(packDir, 't1', 't1-bug-cache-ttl.json'));
    const opts = { packDir, benchDir: root, suiteFile };
    fs.writeFileSync(suiteFile, render(packSuite(packDir, root)));
    assert.equal(packSuiteProblem(packDir, opts), null, 'a fresh pack.json passes');
    const t = JSON.parse(fs.readFileSync(real, 'utf8'));
    fs.writeFileSync(path.join(packDir, 't1', 't1-added.json'), JSON.stringify({ ...t, id: 't1-added' }));
    assert.match(packSuiteProblem(packDir, opts), /run node bench\/scenarios\/pack-suite\.js and commit bench\/suites\/pack\.json/, 'a task added without regenerating fails');
    assert.equal(packSuiteProblem(path.join(root, 'elsewhere'), opts), null, 'another task dir is not the pack');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
