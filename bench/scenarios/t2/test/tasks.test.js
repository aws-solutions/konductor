// SPDX-License-Identifier: Apache-2.0
'use strict';

// Every T2 task names its grader in .bench-lib.json (bench/scenarios/lib/hidden) and commits no copy of it; its key,
// fixture and reference are where the task file says.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { sharedHelpers } = require('../../../runner/lib/hidden-lib.js');

const T2 = path.join(__dirname, '..');
const tasks = () => fs.readdirSync(T2).filter((n) => /^t2-.*\.json$/.test(n)).map((n) => JSON.parse(fs.readFileSync(path.join(T2, n), 'utf8')));

test('every task file has its hidden key, its shared grader and its reference', () => {
  for (const task of tasks()) {
    const hidden = path.join(T2, 'hidden', task.hidden);
    const key = task.controlKind === 'twin' ? 'twin-key.json' : 'key.json';
    assert.ok(fs.existsSync(path.join(hidden, 'hidden', key)), `${task.id}: ${key}`);
    const helpers = sharedHelpers(hidden).map(([rel]) => rel);
    assert.ok(helpers.includes(task.controlKind === 'twin' ? 'hidden/twin.test.cjs' : 'hidden/findings.test.cjs'), `${task.id}: .bench-lib.json`);
    for (const rel of helpers) assert.ok(!fs.existsSync(path.join(hidden, rel)), `${task.id}: committed copy of ${rel}`);
    assert.ok(fs.existsSync(path.join(T2, 'solutions', task.id)), `${task.id}: solution`);
    assert.ok(fs.existsSync(path.join(T2, 'fixtures', task.fixture)), `${task.id}: fixture`);
  }
});

test('every design review carries an expert key whose items name their public source', () => {
  for (const task of tasks().filter((t) => t.phase === 'design-review' && t.controlKind !== 'twin')) {
    assert.ok(task.expertKey, `${task.id}: expertKey`);
    for (const it of task.expertKey.items) assert.match(it.source, /^\S.*, https?:\/\//, `${task.id} ${it.id}`);
  }
});
