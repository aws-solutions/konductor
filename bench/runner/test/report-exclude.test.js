// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dropNeedsAgent, exclusionNote } = require('../../report/exclude.js');

const r = (armId, taskId, agent) => ({ armId, result: { taskId, agent, status: 'ok' } });
const needs = { 't12-cmux-parallel-merge': 'konductor-cmux-orchestrator' };

test('dropNeedsAgent: a task whose needed agent started no run leaves the report for every arm', () => {
  const run = { runs: [r('vanilla', 't12-cmux-parallel-merge', 'kiro_default'), r('konductor', 't12-cmux-parallel-merge', 'konductor'), r('konductor', 't1-bug-date-range', 'konductor')] };
  const ex = dropNeedsAgent(run, needs);
  assert.deepEqual(run.runs.map((x) => x.result.taskId), ['t1-bug-date-range']);
  assert.deepEqual(ex, [{ task: 't12-cmux-parallel-merge', needsAgent: 'konductor-cmux-orchestrator', runs: 2 }]);
  assert.match(exclusionNote(ex), /t12-cmux-parallel-merge.*konductor-cmux-orchestrator.*2 run/);
});

test('dropNeedsAgent: the task stays when an arm started in the needed agent', () => {
  const run = { runs: [r('vanilla', 't12-cmux-parallel-merge', 'kiro_default'), r('konductor-cmux', 't12-cmux-parallel-merge', 'konductor-cmux-orchestrator')] };
  assert.deepEqual(dropNeedsAgent(run, needs), []);
  assert.equal(run.runs.length, 2);
  assert.equal(exclusionNote([]), null);
});
