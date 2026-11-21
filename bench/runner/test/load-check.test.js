// SPDX-License-Identifier: Apache-2.0
'use strict';

// The per-run load check: which units loaded, in stream order, whether a needed unit loaded before the first file
// write, false loads, the result.json block and the selection-rate table. Pure functions on hand-made streams.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOrderOf, loadCheckOf, unitKey } = require('../lib/load-check.js');
const { extractSkills, resultFields } = require('../lib/skills.js');
const { validate, loadSchema } = require('../lib/schema.js');
const { summarizeSkills, renderSkillsMarkdown } = require('../../report/skills.js');

const call = (id, tool, input, server = 'konductor-skills') => ({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', toolCallId: id, rawInput: input, _meta: { kiro: { toolName: tool, mcpServerName: server } } } } });
const done = (id, rawOutput, status = 'completed') => ({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', toolCallId: id, status, rawOutput } } });
const body = (name) => ({ items: [{ Json: { content: [{ type: 'text', text: JSON.stringify({ name, content: `# ${name}\nbody` }) }], isError: false } }] });

const kiroStream = [
  call('a', 'get_skill', { name: 'backend-review' }), done('a', body('backend-review')),
  call('s', 'subagent', { agent_name: 'k-architect', query: 'design it' }, null), done('s', { items: [] }),
  call('w', 'fs_write', { path: 'src/a.js', command: 'create', file_text: 'x' }, null), done('w', { items: [] }),
  call('b', 'get_skill', { name: 'frontend-review' }), done('b', body('frontend-review')),
  call('c', 'get_skill', { name: 'missing-one' }), done('c', null, 'failed'),
];

const ccStream = [
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'a.js', content: 'x' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Skill', input: { skill: 'sop-k-plan' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'Launching skill: sop-k-plan' }, { type: 'text', text: 'Base directory for this skill: /x\n# plan' }] } },
];

const task = (extra = {}) => ({ id: 't', class: 'review', targets: { targetSkills: ['backend-review'], targetSop: null, targetAgent: null }, ...extra });

test('Kiro: the order puts loads and agents at their stream index and finds the first write', () => {
  const o = loadOrderOf(kiroStream, 'kiro-cli');
  assert.equal(o.firstWriteAt, 4);
  assert.deepEqual(o.order.map((c) => [c.name, c.kind, c.at, c.failed]), [
    ['backend-review', 'skill', 0, false], ['k-architect', 'agent', 2, false], ['frontend-review', 'skill', 6, false], ['missing-one', 'skill', 8, true],
  ]);
});

test('the load check reports what loaded before the first write, needed units and false loads', () => {
  const lc = loadCheckOf({ order: loadOrderOf(kiroStream, 'kiro-cli'), extraction: extractSkills(kiroStream, 'kiro-cli'), task: task({ loadCheck: { mustLoad: ['backend-review', 'frontend-review', 'k-plan'], mustNotLoad: ['frontend-review', 'missing-one'] } }), arm: { vanilla: false } });
  assert.equal(lc.source, 'loadCheck');
  assert.deepEqual(lc.loaded.map((u) => [u.unit, u.kind, u.beforeFirstWrite]), [['backend-review', 'skill', true], ['k-architect', 'agent', true], ['frontend-review', 'skill', false]]);
  assert.deepEqual(lc.mustLoad, [
    { unit: 'backend-review', loaded: true, beforeFirstWrite: true },
    { unit: 'frontend-review', loaded: true, beforeFirstWrite: false },
    { unit: 'k-plan', loaded: false, beforeFirstWrite: false },
  ]);
  assert.equal(lc.mustLoadBeforeWrite, false);
  assert.deepEqual(lc.mustNotLoaded, ['frontend-review'], 'a failed call is not a load');
});

test('without a loadCheck the task targets are the needed units; vanilla arms get null', () => {
  const args = { order: loadOrderOf(kiroStream, 'kiro-cli'), extraction: extractSkills(kiroStream, 'kiro-cli'), task: task() };
  const lc = loadCheckOf({ ...args, arm: { vanilla: false } });
  assert.equal(lc.source, 'targets');
  assert.equal(lc.mustLoadBeforeWrite, true);
  assert.equal(loadCheckOf({ ...args, arm: { vanilla: true } }), null);
  assert.equal(loadCheckOf({ ...args, task: task({ targets: {} }), arm: {} }).mustLoadBeforeWrite, null, 'no needed unit: no verdict');
});

test('Claude Code: an SOP loaded through the Skill tool after a write is late, and matches its unit without sop-', () => {
  const lc = loadCheckOf({ order: loadOrderOf(ccStream, 'claude-code'), extraction: extractSkills(ccStream, 'claude-code'), task: task({ targets: { targetSkills: [], targetSop: 'k-plan' } }), arm: {} });
  assert.equal(lc.firstWriteAt, 0);
  assert.deepEqual(lc.loaded, [{ unit: 'k-plan', kind: 'sop', firstAt: 2, beforeFirstWrite: false }]);
  assert.deepEqual(lc.mustLoad, [{ unit: 'k-plan', loaded: true, beforeFirstWrite: false }]);
});

test('Kiro: a forced SOP read of the installed k-plan.sop.md is a loaded SOP k-plan (D-52)', () => {
  for (const first of [
    call('r', 'fs_read', { operations: [{ mode: 'Line', path: '/scratch/home/.kiro/sops/k-plan.sop.md' }] }, null),
    call('r', 'execute_bash', { command: 'cat /scratch/home/.kiro/sops/k-plan.sop.md' }, null),
  ]) {
    const read = { type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'r', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: '# k-plan\nsteps' } }] } } };
    const stream = [first, read, call('w', 'fs_write', { path: 'a.js', command: 'create', file_text: 'x' }, null), done('w', { items: [] })];
    const lc = loadCheckOf({ order: loadOrderOf(stream, 'kiro-cli'), extraction: extractSkills(stream, 'kiro-cli'), task: task({ targets: { targetSkills: [], targetSop: 'k-plan' } }), arm: {} });
    assert.deepEqual(lc.loaded, [{ unit: 'k-plan', kind: 'sop', firstAt: 0, beforeFirstWrite: true }]);
    assert.deepEqual(lc.mustLoad, [{ unit: 'k-plan', loaded: true, beforeFirstWrite: true }]);
  }
});

test('unitKey drops kind and sop- prefixes', () => {
  assert.deepEqual(['skill:Backend-Review', 'sop-k-plan', 'agent:k-tpm', 'k-plan'].map(unitKey), ['backend-review', 'k-plan', 'k-tpm', 'k-plan']);
});

test('resultFields writes a loadCheck block that the result schema accepts', () => {
  const f = resultFields({ extraction: extractSkills(kiroStream, 'kiro-cli'), info: null, task: task(), arm: { vanilla: false }, order: loadOrderOf(kiroStream, 'kiro-cli') });
  const schema = loadSchema('result').properties.loadCheck;
  assert.deepEqual(validate(schema, f.loadCheck), []);
  assert.deepEqual(validate(schema, null), []);
  assert.equal(resultFields({ extraction: null, info: null, task: task(), arm: {} }).loadCheck, null);
});

test('the skills report shows the selection rate per unit and arm', () => {
  const fieldsOf = (stream, t) => resultFields({ extraction: extractSkills(stream, 'kiro-cli'), info: null, task: t, arm: { vanilla: false }, order: loadOrderOf(stream, 'kiro-cli') });
  const t = task({ loadCheck: { mustLoad: ['backend-review'], mustNotLoad: ['frontend-review'] } });
  const rows = [
    { armId: 'konductor', taskId: 't', taskClass: 'review', target: null, fields: fieldsOf(kiroStream, t) },
    { armId: 'konductor', taskId: 't', taskClass: 'review', target: null, fields: fieldsOf([], t) },
  ];
  const sum = summarizeSkills(rows, { armOrder: ['konductor'] });
  assert.deepEqual(sum.arms.konductor.selection.units, [
    { unit: 'backend-review', needed: 2, loaded: 1, beforeWrite: 1, falseLoads: 0 },
    { unit: 'frontend-review', needed: 0, loaded: 0, beforeWrite: 0, falseLoads: 1 },
  ]);
  const md = renderSkillsMarkdown(sum);
  assert.match(md, /### Load check: selection rate per unit/);
  assert.match(md, /\| konductor \| backend-review \| 2 \| 50% \(1\/2\) \| 50% \(1\/2\) \| 0 \|/);
});
