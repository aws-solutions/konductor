// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mainText, planCall, EXPECT } = require('../../report/plan-call.js');

const chunk = (text, sub = false) => ({ type: 'sessionUpdate', data: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text }, _meta: { kiro: sub ? { kind: 'agent-subtask', agentSubtaskId: 'x' } : {} } } } });

test('mainText: the root session text only, chunks joined', () => {
  assert.equal(mainText([chunk('Orchestration: auto ('), chunk('default)\nPlan: so'), chunk('child text', true), chunk('lo, because 1 part')]), 'Orchestration: auto (default)\nPlan: solo, because 1 part');
});

test('planCall: reads the Plan, Plan changed, Skills and Review gate lines and scores them against the expectation', () => {
  const text = 'Orchestration: auto (default)\n**Plan: team (k-developer x3), because 3 independent tickets**\nSkills: git-merge\n...\nPlan changed: cmux is missing\n...\nReview gate: ran k-developer\n';
  const p = planCall({ text, orch: { makerSpawns: 3, reviewerSpawns: 1 }, expect: { plan: 'team', review: 'always' } });
  assert.equal(p.planLine, 'Plan: team (k-developer x3), because 3 independent tickets');
  assert.equal(p.plan, 'team');
  assert.deepEqual(p.planChanged, ['Plan changed: cmux is missing']);
  assert.equal(p.skillsLine, 'Skills: git-merge');
  assert.equal(p.reviewGateLine, 'Review gate: ran k-developer');
  assert.equal(p.writerSpawns, 3);
  assert.equal(p.planRight, true);
  assert.equal(p.actionRight, true);
  assert.equal(p.reviewRight, true);
});

test('planCall: a solo plan with a writer spawn is right in words and wrong in action; no line is wrong', () => {
  const p = planCall({ text: 'Plan: solo, because 1 part', orch: { makerSpawns: 1, reviewerSpawns: 0 }, expect: { plan: 'solo', review: 'always' } });
  assert.equal(p.planRight, true);
  assert.equal(p.actionRight, false);
  assert.equal(p.reviewRight, false);
  const none = planCall({ text: 'no plan here', orch: { makerSpawns: 0, reviewerSpawns: 0 }, expect: { plan: 'team', review: 'any' } });
  assert.equal(none.planLine, null);
  assert.equal(none.planRight, false);
  assert.equal(none.actionRight, false);
});

test('planCall: proceed tasks are not scored on the word; no expectation gives nulls', () => {
  const p = planCall({ text: 'Plan: solo, because x', orch: { makerSpawns: 0, reviewerSpawns: 0 }, expect: { plan: 'proceed', review: 'not-needed' } });
  assert.equal(p.planRight, null);
  assert.equal(p.actionRight, null);
  assert.equal(p.reviewRight, null);
  const q = planCall({ text: 'Plan: solo, because x', orch: null, expect: null });
  assert.equal(q.planRight, null);
  assert.equal(q.writerSpawns, null);
});

test('the pre-registered expectations name 14 tasks with a known plan and review value', () => {
  const t = Object.entries(EXPECT.tasks);
  assert.equal(t.length, 14);
  for (const [id, e] of t) {
    assert.ok(['solo', 'team', 'proceed'].includes(e.plan), id);
    assert.ok(['always', 'exempt-or-one', 'not-needed'].includes(e.review), id);
  }
});
