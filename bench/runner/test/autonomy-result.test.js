// SPDX-License-Identifier: Apache-2.0
'use strict';

// Task and result schema, check groups, result fields and recheck for the autonomy tier.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { validate, loadSchema } = require('../lib/schema.js');
const { buildResult, validateResult } = require('../lib/result.js');
const { aggregateStream, summarizeSessionJson, sessionModels } = require('../lib/stream.js');
const { aggregateGroup, aggregateHidden } = require('../lib/check-matcher.js');
const { runCheck } = require('../lib/checks.js');
const { newConversation } = require('../lib/autonomy.js');
const { recheckAll } = require('../lib/recheck.js');

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null };
const CONFIG = { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' };
const ENV = { kiroCliVersion: 'k', modelListSnapshotPath: null };
const AUTONOMY = { clarifications: [{ id: 'unit', topic: 'unit', keywords: ['unit'], answer: 'Seconds.' }] };
const TASK = { id: 'a1', class: 'autonomy', autonomy: AUTONOMY };
const ev = (type, data) => ({ type, data });
const finished = (finalText = 'done') => aggregateStream([
  ev('metadata', { sessionId: 's1', turnDurationMs: 500, meteringUsage: [{ value: 1, unit: 'credit' }] }),
  ev('runFinished', { status: 'success', stopReason: 'end_turn', finalText }),
]);
const summary = (finalText) => ({ runFinishedStatus: 'success', stopReason: 'end_turn', finalText, askedUser: /\?\s*$/.test(finalText) });
const tests = (group, passed, total) => ({ type: 'tests', cmd: 'x', group, passed: passed === total, detail: '', tests: { passed, total, unparsed: false } });
const build = (o) => buildResult({ arm: ARM, task: TASK, replicate: 1, config: CONFIG, exec: { timedOut: false, exitCode: 0, wallClockMs: 10 }, agg: finished(), session: null, checks: [], transcript: { chars: 4, bytes: 4, partial: false }, env: ENV, ...o });

test('aggregateGroup sums the tests checks of one group and is null without any', () => {
  const checks = [tests('intended', 3, 4), tests('intended', 1, 1), tests('invariant', 5, 5), { type: 'cmd', passed: true }];
  assert.deepEqual(aggregateGroup(checks, 'intended'), { passed: 4, total: 5, unparsed: false });
  assert.deepEqual(aggregateGroup(checks, 'invariant'), { passed: 5, total: 5, unparsed: false });
  assert.equal(aggregateGroup([{ type: 'cmd', passed: true }], 'intended'), null);
  assert.deepEqual(aggregateHidden(checks), { passed: 9, total: 10, unparsed: false }, 'the combined hidden figure still sums both groups');
});

test('a check result carries its group', () => {
  const root = tmp();
  try {
    write(path.join(root, 'ws/a.txt'), 'x');
    const r = runCheck(path.join(root, 'ws'), { type: 'tests', cmd: 'true', min: 1, group: 'invariant' }, { hiddenDir: path.join(root, 'none') });
    assert.equal(r.group, 'invariant');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('task schema accepts class and tier autonomy with an autonomy block and grouped tests checks', () => {
  const task = {
    id: 'autonomy-x', class: 'autonomy', target: null, prompt: 'p', fixture: 'f', hidden: 'autonomy-x', timeoutSec: 600,
    checks: [{ type: 'tests', cmd: 'node --test intended/*.test.js', min: 3, group: 'intended' }, { type: 'tests', cmd: 'node --test invariants/*.test.js', min: 2, group: 'invariant' }],
    rubric: [{ id: 'r', criterion: 'c', weight: 1 }], tiers: ['autonomy'],
    autonomy: { clarifications: [{ id: 'unit', topic: 't', keywords: ['unit'], answer: 'Seconds.' }], maxInterjections: 3, defaultAnswer: 'Go on.', noQuestionNeeded: false },
    exampleQuestions: ['Which unit?'],
  };
  const schema = loadSchema('task');
  assert.deepEqual(validate(schema, task), []);
  assert.ok(validate(schema, { ...task, autonomy: { clarifications: [{ id: 'u' }] } }).length, 'a clarification needs every field');
  assert.ok(validate(schema, { ...task, autonomy: { ...task.autonomy, maxInterjections: -1 } }).length);
  assert.ok(validate(schema, { ...task, autonomy: { ...task.autonomy, extra: 1 } }).length);
  assert.ok(validate(schema, { ...task, checks: [{ type: 'tests', cmd: 'x', min: 1, group: 'other' }] }).length);
  assert.ok(validate(schema, { ...task, exampleQuestions: [1] }).length);
});

test('result schema accepts the autonomy fields and rejects wrong types', () => {
  const conv = newConversation(AUTONOMY);
  conv.record(summary('Which unit?'));
  conv.record(summary('Done.'));
  const r = build({ conv, checks: [tests('intended', 2, 2), tests('invariant', 1, 1)] });
  assert.deepEqual(validateResult(r), []);
  assert.ok(validate(loadSchema('result'), { ...r, turns: 'two' }).length);
  assert.ok(validate(loadSchema('result'), { ...r, questions: [{ turn: 1 }] }).length);
});

test('a task without an autonomy block has none of the autonomy fields', () => {
  const r = build({ task: { id: 't1' } });
  for (const k of ['turns', 'interjections', 'questions', 'questionsAsked', 'unmatchedQuestions', 'askedFirstTurn', 'interjectionCapHit', 'autonomous', 'intendedTests', 'invariantTests', 'completedWithoutHelp', 'assumptionsStated']) {
    assert.equal(k in r, false, k);
  }
});

test('a run that needed no help reports autonomous and completedWithoutHelp from the grouped tests', () => {
  const conv = newConversation(AUTONOMY);
  conv.record(summary('Done. I assumed seconds.'));
  const r = build({ conv, agg: finished('Done. I assumed seconds.'), checks: [tests('intended', 4, 4), tests('invariant', 2, 2)] });
  assert.equal(r.turns, 1);
  assert.equal(r.interjections, 0);
  assert.equal(r.autonomous, true);
  assert.equal(r.askedFirstTurn, false);
  assert.equal(r.questionsAsked, 0);
  assert.deepEqual(r.intendedTests, { passed: 4, total: 4, unparsed: false });
  assert.deepEqual(r.invariantTests, { passed: 2, total: 2, unparsed: false });
  assert.equal(r.completedWithoutHelp, true);
  assert.equal(r.assumptionsStated, true);
});

test('help received, a failing intended test or a failing invariant each clear completedWithoutHelp', () => {
  const asked = newConversation(AUTONOMY);
  asked.record(summary('Which unit?'));
  asked.record(summary('Done.'));
  const helped = build({ conv: asked, checks: [tests('intended', 4, 4), tests('invariant', 2, 2)] });
  assert.equal(helped.autonomous, false);
  assert.equal(helped.interjections, 1);
  assert.equal(helped.askedFirstTurn, true);
  assert.equal(helped.completedWithoutHelp, false);
  assert.deepEqual(helped.questions, [{ turn: 1, text: 'Which unit?', matched: ['unit'], answered: true, reply: 'Seconds.' }]);

  const lone = () => { const c = newConversation(AUTONOMY); c.record(summary('Done.')); return c; };
  assert.equal(build({ conv: lone(), checks: [tests('intended', 3, 4), tests('invariant', 2, 2)] }).completedWithoutHelp, false);
  assert.equal(build({ conv: lone(), checks: [tests('intended', 4, 4), tests('invariant', 1, 2)] }).completedWithoutHelp, false);
});

test('a cap hit is not autonomous even though it counted no interjection of its own', () => {
  const conv = newConversation({ ...AUTONOMY, maxInterjections: 0 });
  conv.record(summary('Which unit?'));
  const r = build({ conv, checks: [] });
  assert.equal(r.interjectionCapHit, true);
  assert.equal(r.interjections, 0);
  assert.equal(r.autonomous, false);
});

test('question text is cut at 300 characters', () => {
  const conv = newConversation(AUTONOMY);
  conv.record(summary(`${'Which unit do you want? '.repeat(40)}`));
  assert.ok(conv.questions[0].text.length <= 300);
});

test('a run that died before any turn has empty autonomy fields and no verdict', () => {
  const r = build({ conv: null, agg: null, exec: { timedOut: false, exitCode: null, wallClockMs: null, error: 'x' } });
  assert.equal(r.turns, 0);
  assert.equal(r.autonomous, null);
  assert.equal(r.completedWithoutHelp, null);
  assert.deepEqual(validateResult(r), []);
});

test('the session model is checked on every turn: any other model flags modelMismatch', () => {
  const session = { model: 'claude-sonnet-5.5', models: ['claude-sonnet-5.5', 'claude-haiku-5', 'claude-sonnet-5.5'], totalRequestCount: 3, turns: 3, meteringTotal: 1 };
  const r = build({ session });
  assert.equal(r.status, 'error');
  assert.ok(r.flags.includes('modelMismatch'));
  assert.match(r.error, /claude-haiku-5/);
  const ok = build({ session: { ...session, models: ['claude-sonnet-5.5', 'claude-sonnet-5.5'] } });
  assert.equal(ok.status, 'success');
});

test('sessionModels lists the model of every turn and summarizeSessionJson keeps the last one', () => {
  const json = { session_state: { conversation_metadata: { user_turn_metadatas: [{ model: 'a', total_request_count: 1 }, { model: 'b', total_request_count: 2 }] } } };
  assert.deepEqual(sessionModels(json), ['a', 'b']);
  assert.deepEqual(sessionModels({}), []);
  assert.equal(summarizeSessionJson(json).model, 'b');
  assert.equal(summarizeSessionJson(json).totalRequestCount, 3);
});

// ---- recheck ----

function recheckSetup() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  write(path.join(bench, 'tasks/hidden/h1/intended/a.test.js'), "const t=require('node:test');const a=require('node:assert');t('one',()=>a.ok(require('fs').existsSync('out.md')));t('two',()=>a.ok(true));\n");
  write(path.join(bench, 'tasks/hidden/h1/invariants/b.test.js'), "const t=require('node:test');const a=require('node:assert');t('inv',()=>a.ok(true));\n");
  const task = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
  write(path.join(bench, 'tasks/t1.json'), JSON.stringify({
    ...task, hidden: 'h1', autonomy: AUTONOMY,
    checks: [
      { type: 'tests', cmd: 'node --test intended/*.test.js', min: 2, group: 'intended' },
      { type: 'tests', cmd: 'node --test invariants/*.test.js', min: 1, group: 'invariant' },
    ],
  }));
  const old = [{ ...tests('intended', 1, 2), cmd: 'node --test intended/*.test.js', min: 2 }, { ...tests('invariant', 1, 1), cmd: 'node --test invariants/*.test.js', min: 1 }];
  const runDir = makeRun(path.join(root, 'run'), bench, [{
    arm: 'vanilla', files: { 'out.md': 'x' }, checks: old, hiddenTests: { passed: 2, total: 3 },
    intendedTests: { passed: 1, total: 2 }, invariantTests: { passed: 1, total: 1 }, autonomous: true, completedWithoutHelp: false, turns: 1, interjections: 0,
  }]);
  return { root, bench, runDir, resultFile: path.join(runDir, 'vanilla/t1/1/result.json'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('recheck refreshes the grouped figures and completedWithoutHelp and leaves the conversation fields alone', () => {
  const s = recheckSetup();
  try {
    const before = JSON.parse(fs.readFileSync(s.resultFile, 'utf8'));
    const [out] = recheckAll({ runDir: s.runDir, benchDir: s.bench });
    assert.equal(out.status, 'rechecked');
    const after = JSON.parse(fs.readFileSync(s.resultFile, 'utf8'));
    assert.deepEqual(after.intendedTests, { passed: 2, total: 2, unparsed: false });
    assert.deepEqual(after.invariantTests, { passed: 1, total: 1, unparsed: false });
    assert.deepEqual(after.hiddenTests, { passed: 3, total: 3, unparsed: false });
    assert.equal(after.completedWithoutHelp, true);
    for (const k of ['turns', 'interjections', 'autonomous']) assert.equal(after[k], before[k], k);
  } finally { s.cleanup(); }
});
