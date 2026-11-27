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
    assert.match(md, /## Main session and sub-executions/);
    assert.equal(r.json.costSplit.find((x) => x.arm === 'head').runs, 2);
    assert.ok(Array.isArray(r.json.contextPerArm), 'context per arm is in the json even when no run reported context');
    assert.ok(Array.isArray(r.json.promptFloor));
  } finally { s.done(); }
});

// ---- cost split: main session vs sub-executions ----
const sub = (dir, id, startSec, endSec, calls) => {
  const at = (s) => new Date(Date.UTC(2026, 10, 25, 16, 0, s)).toISOString();
  const lines = [{ timestamp: at(startSec), payload: { type: 'assistant', content: 'start' } }];
  for (let i = 0; i < calls; i++) lines.push({ timestamp: at(startSec + 1), payload: { type: 'tool_call', toolCallId: `${id}-${i}` } }, { timestamp: at(startSec + 1), payload: { type: 'tool_result', toolCallId: `${id}-${i}` } });
  lines.push({ timestamp: at(endSec), payload: { type: 'assistant', content: 'end' } });
  write(path.join(dir, 'session', 'sess_x', 'sub-executions', `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
};

test('sub-executions are read as time spans and tool calls; overlapping spans count once', () => {
  const dir = tmp();
  try {
    sub(dir, 's1', 0, 10, 2);
    sub(dir, 's2', 5, 20, 1);
    const subs = dl.subExecutions(dir);
    assert.deepEqual(subs.map((x) => [x.id, x.endMs - x.startMs, x.toolCalls]), [['s1', 10000, 2], ['s2', 15000, 1]]);
    assert.equal(dl.unionMs(subs), 20000);
    assert.deepEqual(dl.subExecutions(path.join(dir, 'none')), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the cost split gives each arm main-session and sub-execution time and calls, with the reviewer share', () => {
  const runs = [
    { arm: 'a', rep: 1, events: [v3call('c1', 's1', 'Review the change'), v3call('c2', 's2', 'Implement the change')], over: { turnDurationMs: 30000, toolCalls: 6, credits: 9 } },
    { arm: 'a', rep: 2, over: { turnDurationMs: 10000, toolCalls: 4, credits: 3 } },
    { arm: 'b', rep: 1, over: { turnDurationMs: 8000, toolCalls: 5, credits: 2 } },
  ];
  const s = setup(runs);
  try {
    sub(s.dirOf(runs[0]), 's1', 0, 10, 2);
    sub(s.dirOf(runs[0]), 's2', 5, 20, 1);
    const rows = dl.costSplit(loadRun(s.runDir));
    assert.deepEqual(rows.find((r) => r.arm === 'a'), { arm: 'a', runs: 2, withSubs: 1, turnMs: 40000, subMs: 20000, reviewerSubMs: 10000, mainCalls: 10, subCalls: 3, credits: 12, creditsWithSubs: 9 });
    assert.equal(rows.find((r) => r.arm === 'b').subMs, 0);
    const md = JSON.stringify(dl.costSplitBlocks(rows));
    assert.match(md, /Main session and sub-executions/);
    assert.match(md, /50%/, 'sub-executions took half of arm a\'s turn time');
  } finally { s.done(); }
});

// ---- context per arm ----
const ctxEv = (pct, breakdown) => ({ type: 'sessionUpdate', data: { sessionId: 'root', update: { sessionUpdate: 'session_info_update', _meta: { kiro: { kind: 'context_usage', usagePercentage: pct, contextUsage: { usagePercentage: pct }, ...(breakdown ? { breakdown } : {}) } } } } });
const BD = (files, tools, prompts, items = []) => ({ contextFiles: { tokens: files, items }, tools: { tokens: tools }, memory: { tokens: 0 }, kiroResponses: { tokens: 0 }, yourPrompts: { tokens: prompts }, sessionFiles: { tokens: 0 } });

test('a run\'s context: the fixed context of the first breakdown, and the mean and peak share per context report', () => {
  const s = setup([{ arm: 'a', rep: 1, events: [ctxEv(2, BD(6000, 7000, 7000)), ctxEv(4), ctxEv(6)] }, { arm: 'a', rep: 2, events: [] }]);
  try {
    const c = dl.contextOf(s.dirOf({ arm: 'a', rep: 1 }));
    assert.deepEqual({ fixed: c.fixedTokens, files: c.contextFiles, tools: c.tools, prompts: c.prompts, n: c.updates, mean: c.meanPct, peak: c.peakPct, window: c.windowTokens }, { fixed: 20000, files: 6000, tools: 7000, prompts: 7000, n: 3, mean: 4, peak: 6, window: 1000000 });
    assert.equal(dl.contextOf(s.dirOf({ arm: 'a', rep: 2 })), null, 'no context report: null');
  } finally { s.done(); }
});

test('context per arm is the median over runs with a report, and the block shows it', () => {
  const runs = [
    { arm: 'base', rep: 1, events: [ctxEv(1, BD(0, 7000, 3000)), ctxEv(3)] },
    { arm: 'head', rep: 1, events: [ctxEv(2, BD(6000, 7000, 7000)), ctxEv(4), ctxEv(6)] },
    { arm: 'head', rep: 2, events: [ctxEv(2, BD(6000, 7000, 7000)), ctxEv(8)] },
  ];
  const s = setup(runs);
  try {
    const rows = dl.contextPerArm(loadRun(s.runDir));
    const head = rows.find((r) => r.arm === 'head');
    assert.deepEqual({ runs: head.withData, fixed: head.fixedTokens, mean: head.meanPct, peak: head.peakPct, updates: head.updates }, { runs: 2, fixed: 20000, mean: 4.5, peak: 7, updates: 2.5 });
    const md = JSON.stringify(dl.contextBlocks(rows));
    assert.match(md, /Context per arm/);
    assert.match(md, /20000/);
  } finally { s.done(); }
});

// ---- prompt-size floor ----
test('the prompt-size floor per arm: always-loaded files, tool specs and the agent prompt, and the extra over the base arm', () => {
  const items = [{ name: '~/.kiro/context/k-core-rules.md', tokens: 3000, matched: true }, { name: 'AGENTS.md', tokens: 0, matched: false }];
  const runs = [
    { arm: 'base', rep: 1, events: [ctxEv(1, BD(0, 7000, 3000))] },
    { arm: 'head', rep: 1, events: [ctxEv(2, BD(3000, 7400, 3000, items))] },
  ];
  const s = setup(runs);
  try {
    write(path.join(s.dirOf(runs[1]), 'installed-agent.json'), JSON.stringify({ name: 'konductor', prompt: 'x'.repeat(400) }));
    const rows = dl.promptFloor(loadRun(s.runDir), 'base');
    const head = rows.find((r) => r.arm === 'head');
    assert.deepEqual({ files: head.files, ctx: head.contextFiles, tools: head.tools, chars: head.agentPromptChars, floor: head.floorTokens, extra: head.extraTokens },
      { files: [{ name: '~/.kiro/context/k-core-rules.md', tokens: 3000 }], ctx: 3000, tools: 7400, chars: 400, floor: 10500, extra: 3500 });
    const base = rows.find((r) => r.arm === 'base');
    assert.deepEqual({ chars: base.agentPromptChars, floor: base.floorTokens, extra: base.extraTokens }, { chars: null, floor: 7000, extra: 0 });
    const md = JSON.stringify(dl.floorBlocks(rows, 'base'));
    assert.match(md, /Prompt-size floor/);
    assert.match(md, /k-core-rules\.md \(3000\)/);
  } finally { s.done(); }
});
