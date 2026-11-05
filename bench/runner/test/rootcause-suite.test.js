// SPDX-License-Identifier: Apache-2.0
'use strict';

// The rootcause suite takes tasks from bench/tasks and from the extra directory its suite file names. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTasks, loadSuite, suiteExtraDirs, mergeExtraDirs, SUITE_NAMES, benchMask, BENCH_DIR } = require('../lib/tasks.js');

const ROOTCAUSE = path.join(BENCH_DIR, 'rootcause');
const manifest = JSON.parse(fs.readFileSync(path.join(BENCH_DIR, 'suites', 'rootcause.manifest.json'), 'utf8'));

test('rootcause is a registered suite with three arms, two replicates and one run at a time', () => {
  assert.ok(SUITE_NAMES.includes('rootcause'));
  const s = loadSuite('rootcause', loadTasks(BENCH_DIR, { extraDirs: [ROOTCAUSE] }), BENCH_DIR);
  assert.deepEqual(s.arms, ['vanilla', 'v1.2.0', 'main']);
  assert.equal(s.replicates, 2);
  assert.equal(s.parallel, 1);
});

test('the suite resolves its extra task directory without the flag, and every suite task id loads', () => {
  const dirs = suiteExtraDirs('rootcause', BENCH_DIR);
  assert.deepEqual(dirs, [ROOTCAUSE]);
  const tasks = loadTasks(BENCH_DIR, { extraDirs: dirs });
  const s = loadSuite('rootcause', tasks, BENCH_DIR);
  assert.equal(s.taskIds.length, 16);
  for (const id of s.taskIds) assert.ok(tasks.has(id), id);
  assert.deepEqual([...s.taskIds].sort(), Object.values(manifest.tasksByEntryAgent).flat().filter((id, i, a) => a.indexOf(id) === i).sort());
});

test('passing the same directory with --extra-tasks does not load it twice', () => {
  const dirs = mergeExtraDirs(suiteExtraDirs('rootcause', BENCH_DIR), ['bench/rootcause'].map((d) => path.resolve(BENCH_DIR, '..', d)));
  assert.deepEqual(dirs, [ROOTCAUSE]);
  assert.doesNotThrow(() => loadTasks(BENCH_DIR, { extraDirs: dirs }));
});

test('the extra directory is hidden from the agent, and suites without extraTasks add nothing', () => {
  assert.ok(benchMask(BENCH_DIR, suiteExtraDirs('rootcause', BENCH_DIR)).includes(ROOTCAUSE));
  for (const name of SUITE_NAMES.filter((n) => n !== 'rootcause')) assert.deepEqual(suiteExtraDirs(name, BENCH_DIR), [], name);
  assert.deepEqual(suiteExtraDirs('no-such-suite', BENCH_DIR), []);
});
