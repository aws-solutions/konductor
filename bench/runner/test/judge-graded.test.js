// SPDX-License-Identifier: Apache-2.0
'use strict';

// The graded 1 to 5 judge mode: prompt, reply check, two answer orders, order disagreement, ledger lines.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { runJudging } = require('../../judge/run.js');
const { gradedPrompt } = require('../../judge/prompts.js');
const { validateGradedReply } = require('../../judge/validate.js');
const { combineGraded } = require('../../judge/score.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');
const { readLedger } = require('../lib/credit-ledger.js');

const task = { prompt: 'Fix the thing.', rubric: [{ id: 'c1', criterion: 'Does the first thing.', weight: 1 }] };

test('the graded prompt asks for 1 to 5 grades of each response on its own and carries no arm labels', () => {
  const p = gradedPrompt({ task, answerKey: 'KEY', bundleA: 'alpha text', bundleB: 'bravo text' });
  assert.match(p, /1 to 5/);
  assert.match(p, /Grade each response on its own/);
  assert.match(p, /Does the first thing\./);
  assert.match(p, /KEY/);
  assert.match(p, /=== RESPONSE A ===[\s\S]*alpha text[\s\S]*=== RESPONSE B ===[\s\S]*bravo text/);
  assert.match(p, /"gradeA"/);
  assert.match(p, /"gradeB"/);
});

test('validateGradedReply takes whole grades from 1 to 5 and a reason, and nothing else', () => {
  assert.deepEqual(validateGradedReply({ gradeA: 4, gradeB: 2, reason: 'r' }), { ok: true, gradeA: 4, gradeB: 2, reason: 'r' });
  for (const bad of [{ gradeA: 0, gradeB: 3, reason: 'r' }, { gradeA: 3, gradeB: 6, reason: 'r' }, { gradeA: 3.5, gradeB: 3, reason: 'r' }, { gradeA: '3', gradeB: 3, reason: 'r' }, { gradeA: 3, reason: 'r' }, { gradeA: 3, gradeB: 3 }]) {
    assert.equal(validateGradedReply(bad).ok, false, JSON.stringify(bad));
  }
});

test('combineGraded averages the arm and baseline grades over both orders', () => {
  const r = combineGraded({ armGrade: 4, baseGrade: 2 }, { armGrade: 5, baseGrade: 3 });
  assert.deepEqual([r.armGrade, r.baseGrade, r.delta], [4.5, 2.5, 2]);
  assert.equal(r.orderDisagreement, false);
  assert.equal(r.shift, 1, 'mean absolute change of the same answer between the orders');
});

test('combineGraded flags a preference that flips with position, and not a tie in one order', () => {
  assert.equal(combineGraded({ armGrade: 2, baseGrade: 4 }, { armGrade: 4, baseGrade: 2 }).orderDisagreement, true);
  assert.equal(combineGraded({ armGrade: 3, baseGrade: 3 }, { armGrade: 4, baseGrade: 2 }).orderDisagreement, false);
  assert.deepEqual(combineGraded(null, { armGrade: 4, baseGrade: 2 }), { armGrade: null, baseGrade: null, delta: null, orderDisagreement: false, shift: null });
});

// ---- runJudging ----

const reply = (prompt, g) => {
  const a = prompt.slice(prompt.indexOf('RESPONSE A'), prompt.indexOf('RESPONSE B'));
  const aIsVanilla = /vanilla says/.test(a);
  const [va, vb] = g.vanilla;
  const [ca, cb] = g.arm;
  return JSON.stringify(aIsVanilla ? { gradeA: va, gradeB: cb, reason: 'r' } : { gradeA: ca, gradeB: vb, reason: 'r' });
};

function fixture() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, ['vanilla', 'v1.2.0'].map((arm) => ({ arm, finalText: `${arm} says: done`, files: { 'a.txt': `fixed by ${arm}\n` } })));
  const common = {
    runDir, benchDir: bench, judges: ['gpt-test'], modes: ['graded'], baseline: 'vanilla', concurrency: 1, budgetCredits: null,
    limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {},
  };
  return { root, runDir, common };
}
const stub = (handler) => {
  const calls = [];
  const fn = async ({ model, prompt }) => { calls.push({ model, prompt }); return { text: handler(prompt), credits: 0.1, latencyMs: 5 }; };
  fn.calls = calls;
  return fn;
};
const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });

test('graded mode calls the judge once per order for each non-baseline run and stores one record', async () => {
  const { root, common } = fixture();
  try {
    const caller = stub((p) => reply(p, { vanilla: [2, 2], arm: [4, 4] }));
    const j = await runJudging({ ...common, caller });
    assert.equal(caller.calls.length, 2);
    assert.equal(j.rubric.length + j.pairwise.length, 0);
    assert.equal(j.graded.length, 1);
    const g = j.graded[0];
    assert.deepEqual([g.kind, g.armId, g.baselineId, g.judge], ['graded', 'v1.2.0', 'vanilla', 'gpt-test']);
    assert.deepEqual([g.armGrade, g.baseGrade, g.delta], [4, 2, 2]);
    assert.equal(g.orderDisagreement, false);
    assert.equal(g.orderings.length, 2);
    assert.equal(g.judgeError, null);
    assert.deepEqual(j.modes, ['graded']);
  } finally { cleanup(root); }
});

test('the answer sits in position A in one order and position B in the other', async () => {
  const { root, common } = fixture();
  try {
    const caller = stub((p) => reply(p, { vanilla: [3, 3], arm: [3, 3] }));
    await runJudging({ ...common, caller });
    const first = caller.calls.map((c) => /vanilla says/.test(c.prompt.slice(c.prompt.indexOf('RESPONSE A'), c.prompt.indexOf('RESPONSE B'))));
    assert.deepEqual([...first].sort(), [false, true]);
  } finally { cleanup(root); }
});

test('a judge that always prefers position A is reported as an order disagreement', async () => {
  const { root, common } = fixture();
  try {
    const caller = stub(() => JSON.stringify({ gradeA: 5, gradeB: 2, reason: 'first looked better' }));
    const j = await runJudging({ ...common, caller });
    assert.equal(j.graded[0].orderDisagreement, true);
    assert.equal(j.graded[0].delta, 0, 'the two orders cancel');
  } finally { cleanup(root); }
});

test('a bad graded reply is retried once, then recorded as a judgeError and kept', async () => {
  const { root, common } = fixture();
  try {
    const caller = stub(() => '{"gradeA": 9, "gradeB": 1, "reason": "x"}');
    const j = await runJudging({ ...common, caller });
    assert.equal(j.graded.length, 1);
    assert.match(j.graded[0].judgeError, /unusable after retry/);
    assert.equal(j.graded[0].armGrade, null);
  } finally { cleanup(root); }
});

test('graded records are merged into judgments.json and an earlier rubric record is kept', async () => {
  const { root, runDir, common } = fixture();
  try {
    const ok = stub((p) => (p.includes('"gradeA"') ? reply(p, { vanilla: [3, 3], arm: [4, 4] }) : JSON.stringify({ criteria: [{ id: 'c1', verdict: 'pass', evidence: 'a.txt' }, { id: 'c2', verdict: 'pass', evidence: 'a.txt' }] })));
    await runJudging({ ...common, modes: ['rubric'], caller: ok });
    await runJudging({ ...common, caller: ok });
    const file = JSON.parse(fs.readFileSync(path.join(runDir, 'judgments.json'), 'utf8'));
    assert.equal(file.rubric.length, 2);
    assert.equal(file.graded.length, 1);
    assert.deepEqual(file.modes, ['graded', 'rubric']);
  } finally { cleanup(root); }
});

test('every judge call is a ledger line, and a cached call is a line at 0 credits', async () => {
  const { root, runDir, common } = fixture();
  try {
    const caller = stub((p) => reply(p, { vanilla: [3, 3], arm: [4, 4] }));
    await runJudging({ ...common, caller });
    let led = readLedger(runDir);
    assert.equal(led.entries.length, 2);
    assert.ok(led.entries.every((e) => e.kind === 'judge' && e.judge === 'gpt-test' && e.mode === 'graded' && e.credits === 0.1 && e.cached === false));
    assert.deepEqual(led.entries.map((e) => e.order).sort(), [1, 2]);
    await runJudging({ ...common, caller });
    led = readLedger(runDir);
    assert.equal(led.entries.length, 4);
    assert.ok(led.entries.slice(2).every((e) => e.cached === true && e.credits === 0));
    assert.equal(led.totals.judge, 0.2);
  } finally { cleanup(root); }
});

test('a judge budget stops new calls at 90% and the skipped units say so', async () => {
  const { root, runDir, common } = fixture();
  try {
    const j = await runJudging({ ...common, modes: ['rubric'], judges: ['gpt-test', 'glm-test'], budgetCredits: 0.32, caller: stub((p) => JSON.stringify({ criteria: [{ id: 'c1', verdict: 'pass', evidence: 'a.txt' }, { id: 'c2', verdict: 'pass', evidence: 'a.txt' }] })) });
    const skipped = j.rubric.filter((r) => /^budget reached/.test(r.judgeError || ''));
    assert.ok(skipped.length >= 1);
    assert.match(skipped[0].judgeError, /90%/);
    assert.ok(readLedger(runDir).totals.judge < 0.32);
  } finally { cleanup(root); }
});

test('runJudging reports the guard state: hard when the budget was passed, ok with no budget', async () => {
  const { root, common } = fixture();
  try {
    const caller = stub((p) => reply(p, { vanilla: [3, 3], arm: [4, 4] }));
    assert.equal((await runJudging({ ...common, caller })).guardState, 'ok');
  } finally { cleanup(root); }
  const b = fixture();
  try {
    const caller = stub((p) => reply(p, { vanilla: [3, 3], arm: [4, 4] }));
    assert.equal((await runJudging({ ...b.common, budgetCredits: 0.1, caller })).guardState, 'hard');
  } finally { cleanup(b.root); }
});
