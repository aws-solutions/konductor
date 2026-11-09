// SPDX-License-Identifier: Apache-2.0
'use strict';

// --replicate-offset: numbering of planned replicates, option parsing, and the overwrite count. No runner start.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { planRuns, existingResults } = require('../lib/orchestrate.js');
const { replicateOffsetOpt } = require('../lib/run-cmd.js');
const { parseArgs } = require('../bench.js');
const { mkScratch } = require('./scratch.js');

const tasks = [{ id: 't1' }, { id: 't2' }];
const arms = [{ id: 'a' }, { id: 'b' }];

test('planRuns numbers replicates from 1 by default and from offset+1 with an offset', () => {
  const reps = (plan) => [...new Set(plan.map((p) => p.replicate))].sort((x, y) => x - y);
  assert.deepEqual(reps(planRuns(tasks, arms, 3, 7)), [1, 2, 3]);
  assert.deepEqual(reps(planRuns(tasks, arms, 3, 7, 0)), [1, 2, 3]);
  const plan = planRuns(tasks, arms, 2, 7, 5);
  assert.deepEqual(reps(plan), [6, 7]);
  assert.equal(plan.length, 8);
  for (const rep of [6, 7]) assert.equal(plan.filter((p) => p.replicate === rep).length, 4);
});

test('planRuns with offset 0 is identical to the plan without an offset', () => {
  const key = (plan) => plan.map((p) => `${p.task.id}/${p.arm.id}/${p.replicate}`).join(',');
  assert.equal(key(planRuns(tasks, arms, 3, 9)), key(planRuns(tasks, arms, 3, 9, 0)));
});

test('replicateOffsetOpt defaults to 0, accepts non-negative integers and rejects the rest', () => {
  assert.equal(replicateOffsetOpt({}), 0);
  assert.equal(replicateOffsetOpt({ 'replicate-offset': '0' }), 0);
  assert.equal(replicateOffsetOpt({ 'replicate-offset': '12' }), 12);
  for (const bad of ['-1', '1.5', 'abc', '', true, '1e2', ' 3']) {
    assert.throws(() => replicateOffsetOpt({ 'replicate-offset': bad }), /--replicate-offset must be a non-negative integer/, `rejects ${JSON.stringify(bad)}`);
  }
});

test('the flag reaches the option parser as a value, and a bare flag parses as true and is rejected', () => {
  assert.equal(replicateOffsetOpt(parseArgs(['run', '--replicate-offset', '4'])), 4);
  assert.throws(() => replicateOffsetOpt(parseArgs(['run', '--replicate-offset'])), /non-negative integer/);
  assert.throws(() => replicateOffsetOpt(parseArgs(['run', '--replicate-offset', '-2'])), /non-negative integer/);
});

test('existingResults counts only planned cells that already hold a result.json', () => {
  const out = mkScratch('rep-offset-');
  for (const dir of ['a/t1/1', 'a/t2/2', 'b/t1/3']) {
    fs.mkdirSync(path.join(out, dir), { recursive: true });
    fs.writeFileSync(path.join(out, dir, 'result.json'), '{}');
  }
  fs.mkdirSync(path.join(out, 'b/t2/1'), { recursive: true });
  assert.equal(existingResults(planRuns(tasks, arms, 2, 1), out).length, 2);
  assert.equal(existingResults(planRuns(tasks, arms, 2, 1, 2), out).length, 1);
  assert.equal(existingResults(planRuns(tasks, arms, 2, 1, 10), out).length, 0);
});
