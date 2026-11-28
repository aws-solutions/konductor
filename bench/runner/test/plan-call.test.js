// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mainText, planCall, EXPECT } = require('../../report/plan-call.js');
const { parseStream } = require('../lib/stream.js');

const chunk = (text, sub = false) => ({ type: 'sessionUpdate', data: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text }, _meta: { kiro: sub ? { kind: 'agent-subtask', agentSubtaskId: 'x' } : {} } } } });

test('mainText: the root session text only, chunks joined', () => {
  assert.equal(mainText([chunk('Orchestration: auto ('), chunk('default)\nPlan: so'), chunk('child text', true), chunk('lo, because 1 part')]), 'Orchestration: auto (default)\nPlan: solo, because 1 part');
});

test('mainText: each message starts on a new line (a new replayId, or text after a tool call); one message split over chunks stays one line', () => {
  const say = (text, replayId) => ({ type: 'sessionUpdate', data: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text }, _meta: { kiro: { replayId } } } } });
  const tool = { type: 'sessionUpdate', data: { sessionId: 's1', update: { sessionUpdate: 'tool_call', toolCallId: 'run_1', title: 'Run Command', kind: 'execute' } } };
  assert.equal(mainText([say('Skills', 'a'), say(': none fit', 'a'), tool, say('Pl', 'b'), say('an: solo', 'b')]), 'Skills: none fit\nPlan: solo');
  assert.equal(mainText([say('one.', 'a'), say('Two.', 'b')]), 'one.\nTwo.', 'a new message with no tool call between');
  assert.equal(mainText([say('one.\n', 'a'), tool, say('Two.', 'b')]), 'one.\nTwo.', 'no second line break');
});

// Cut from the reply check's real streams (2026-11-28): the placeholder message ends `Skills: none fit` with no line
// break, a read-only tool call follows, and the next message opens `Plan: solo, because ...`.
const fixture = (name) => parseStream(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')).events;

test('planCall on a real stream: the placeholder, then `Plan: solo, because ...` in the next message, is the plan; Skills reads alone', () => {
  const p = planCall({ text: mainText(fixture('plan-line-t12-split-r2.stream.jsonl')), orch: { makerSpawns: 0, reviewerSpawns: 0 }, expect: EXPECT.tasks['t12-split-shared-file'] });
  assert.match(p.planLine, /^Plan: solo, because both tickets are small edits/);
  assert.equal(p.plan, 'solo');
  assert.equal(p.planRight, true);
  assert.equal(p.skillsLine, 'Skills: none fit');
  const q = planCall({ text: mainText(fixture('plan-line-t1-r3.stream.jsonl')), orch: null, expect: null });
  assert.equal(q.plan, null, '`Plan stays solo: ...` is not the asked-for line');
  assert.equal(q.skillsLine, 'Skills: verification');
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

test('planCall: a `Plan: after a read-only look` placeholder is skipped; the first Plan line naming solo or team counts', () => {
  const text = 'Orchestration: auto (default)\nPlan: after a read-only look\nSkills: none fit\n...\nPlan: solo, because one file\n';
  const p = planCall({ text, orch: { makerSpawns: 0, reviewerSpawns: 0 }, expect: { plan: 'solo', review: 'not-needed' } });
  assert.equal(p.planLine, 'Plan: solo, because one file');
  assert.equal(p.plan, 'solo');
  const none = planCall({ text: 'Plan: after a read-only look\n', orch: null, expect: null });
  assert.equal(none.planLine, 'Plan: after a read-only look', 'with no solo or team line, the first Plan line is still shown');
  assert.equal(none.plan, null);
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

test('the pre-registered expectations name 15 tasks (14 rows and CardDemo) with a known plan and review value', () => {
  const t = Object.entries(EXPECT.tasks);
  assert.equal(t.length, 15);
  for (const [id, e] of t) {
    assert.ok(['solo', 'team', 'proceed'].includes(e.plan), id);
    assert.ok(['always', 'exempt-or-one', 'not-needed'].includes(e.review), id);
  }
});
