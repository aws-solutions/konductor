// SPDX-License-Identifier: Apache-2.0
'use strict';

// The delegation sections of the run report: review compliance on tasks whose konductor rules require a review.
// Fixture run directories only, no model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { loadRun } = require('../../report/load.js');
const { enrichOrch } = require('../../report/orch.js');
const dl = require('../../report/delegation.js');

const v3call = (id, subtaskId, task) => ({ type: 'sessionUpdate', data: { sessionId: 'root', update: { sessionUpdate: 'tool_call', toolCallId: id, title: 'Sub-agent: k-developer', rawInput: { name: 'k-developer', prompt: `TASK: ${task}` }, _meta: { kiro: { kind: 'agent-subtask', agentSubtaskId: subtaskId } } } } });
const start = { type: 'metadata', data: { sessionId: 'root' } };

function writeStream(dir, events) {
  write(path.join(dir, 'stream.jsonl'), [start, ...events].map((e) => JSON.stringify(e)).join('\n') + '\n');
}

// runs: [{ arm, rep, events, task }]
function setup(runs) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, runs.map((r) => ({ arm: r.arm, rep: r.rep, task: r.task ?? 't1', credits: 5, ...(r.over || {}) })));
  for (const r of runs) writeStream(path.join(runDir, r.arm, r.task ?? 't1', String(r.rep)), r.events ?? []);
  return { root, runDir, dirOf: (r) => path.join(runDir, r.arm, r.task ?? 't1', String(r.rep)), done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const RULES = { rules: [{ id: 'threat-model', why: 'a threat model', targetSkills: ['threat-modeling'] }, { id: 'auth', why: 'auth change', taskIds: ['t9'] }] };

test('a task needs a review when a rule names one of its target skills or its id', () => {
  assert.equal(dl.requiredReview({ id: 't1', targetSkills: ['threat-modeling'] }, RULES)?.id, 'threat-model');
  assert.equal(dl.requiredReview({ id: 't9', targetSkills: [] }, RULES)?.id, 'auth');
  assert.equal(dl.requiredReview({ id: 't2', targetSkills: ['code-review'] }, RULES), null);
  assert.equal(dl.requiredReview(undefined, RULES), null);
});

test('the shipped review rules load and name the threat-model and IAM tasks of STANDARD', () => {
  const rules = dl.loadReviewRules();
  assert.ok(rules.rules.length >= 1);
  assert.ok(dl.requiredReview({ id: 'x', targetSkills: ['iam-policy-design'] }, rules));
  assert.ok(dl.requiredReview({ id: 't4-threat-model-webhooks', targetSkills: ['threat-modeling'] }, rules));
  assert.equal(dl.requiredReview({ id: 'x', targetSkills: ['code-review'] }, rules), null);
});

test('review compliance counts the required runs with a reviewer spawn and names the ones without', () => {
  const s = setup([
    { arm: 'a', rep: 1, events: [v3call('c1', 's1', 'Review the threat model')] },
    { arm: 'a', rep: 2, events: [] },
    { arm: 'b', rep: 1, events: [v3call('c1', 's1', 'Write the threat model')] },
  ]);
  try {
    const run = loadRun(s.runDir);
    enrichOrch(run);
    const tasks = new Map([['t1', { id: 't1', targetSkills: ['threat-modeling'] }]]);
    const rows = dl.reviewCompliance(run, tasks, RULES);
    assert.deepEqual(rows.find((r) => r.arm === 'a'), { arm: 'a', required: 2, reviewed: 1, missing: ['t1#2'] });
    assert.deepEqual(rows.find((r) => r.arm === 'b'), { arm: 'b', required: 1, reviewed: 0, missing: ['t1#1'], }, 'a maker spawn is not a review');
    const md = JSON.stringify(dl.complianceBlocks(rows, RULES));
    assert.match(md, /Review compliance/);
    assert.match(md, /t1#2/);
    assert.deepEqual(dl.reviewCompliance(run, new Map([['t1', { id: 't1', targetSkills: [] }]]), RULES), [], 'no required task: no rows');
  } finally { s.done(); }
});

test('the written run report and its json carry the review compliance of a required task', () => {
  const s = setup([{ arm: 'base', rep: 1 }, { arm: 'base', rep: 2 }, { arm: 'head', rep: 1, events: [v3call('c1', 's1', 'Review the IAM policy')] }, { arm: 'head', rep: 2 }]);
  try {
    const { loadTasks } = require('../lib/tasks.js');
    const { generateRunReport } = require('../../report/generate.js');
    const tasks = loadTasks(path.join(s.root, 'bench'));
    tasks.get('t1').targetSkills = ['iam-policy-design'];
    const out = path.join(s.root, 'out');
    const r = generateRunReport({ run: loadRun(s.runDir), tasks, baseline: 'base', out, detail: 'full', format: 'md', defaultDir: s.runDir });
    const md = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
    assert.match(md, /## Review compliance/);
    assert.match(md, /\| head \| 2 \| 1 \| 50% \| t1#2 \|/);
    assert.deepEqual(r.json.reviewCompliance.find((x) => x.arm === 'head').missing, ['t1#2']);
  } finally { s.done(); }
});
