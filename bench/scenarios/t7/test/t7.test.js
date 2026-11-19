// SPDX-License-Identifier: Apache-2.0
'use strict';

// Tests of the T7 grader, the task builder, and the files of every assembled T7 task.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readBlock, gradeAssertion, getPath } = require('../lib/plan-grade.cjs');
const { buildTask, TEST_CMD, GRADER_FILES, renderPrompt } = require('../stage.js');

const DIR = path.join(__dirname, '..');
const doc = {
  overall: 'red',
  risks: [{ tickets: ['PAY-212', 'OPS-7'], kind: 'critical-path' }, { tickets: ['CHK-40'], kind: 'other' }],
  critical_path: ['OPS-7', 'PAY-212', 'CHK-90'],
  revised_launch_date: '2027-04-16',
  reasoning: { 'Sprints_Needed': 3 },
};
const g = (a) => gradeAssertion(doc, { id: 'x', ...a });

test('readBlock takes the first block with the info string that parses', () => {
  const text = 'intro\n```status\nnot json\n```\n```json\n{"a":1}\n```\n```Status\n{"overall":"red"}\n```\n';
  assert.deepStrictEqual(readBlock(text, 'status'), { overall: 'red' });
  assert.strictEqual(readBlock(text, 'plan'), null);
});

test('getPath matches keys ignoring case and indexes lists', () => {
  assert.strictEqual(getPath(doc, 'reasoning.sprints_needed'), 3);
  assert.strictEqual(getPath(doc, 'critical_path.1'), 'PAY-212');
  assert.strictEqual(getPath(doc, 'missing.key'), undefined);
});

test('ids match on a token edge only', () => {
  assert.ok(g({ op: 'cites', path: 'risks', field: 'tickets', ids: ['pay-212'] }).ok);
  assert.ok(!g({ op: 'cites', path: 'risks', field: 'tickets', ids: ['PAY-21'] }).ok);
  assert.ok(g({ op: 'cites', path: 'risks', field: 'tickets', ids: ['PAY-212', 'OPS-7'], min: 2 }).ok);
});

test('cites with where checks the citing element only', () => {
  assert.ok(g({ op: 'cites', path: 'risks', field: 'tickets', ids: ['CHK-40'], where: { kind: 'OTHER' } }).ok);
  assert.ok(!g({ op: 'cites', path: 'risks', field: 'tickets', ids: ['CHK-40'], where: { kind: 'critical-path' } }).ok);
});

test('an object is read as the list of its values', () => {
  const plan = { sprints: { S1: ['A-1', 'A-2'], S2: ['A-3'] } };
  assert.ok(gradeAssertion(plan, { id: 'x', op: 'includes', path: 'sprints', ids: ['A-3', 'A-1'] }).ok);
  assert.ok(gradeAssertion(plan, { id: 'x', op: 'order', path: 'sprints', ids: ['A-1', 'A-3'] }).ok);
});

test('absent fails when a decoy is named', () => {
  assert.ok(!g({ op: 'absent', path: 'risks', field: 'tickets', ids: ['CHK-40'] }).ok);
  assert.ok(g({ op: 'absent', path: 'risks', field: 'tickets', ids: ['CHK-41'] }).ok);
});

test('includes, excludes and order on a list', () => {
  assert.ok(g({ op: 'includes', path: 'critical_path', ids: ['OPS-7', 'CHK-90'] }).ok);
  assert.ok(!g({ op: 'includes', path: 'critical_path', ids: ['OPS-7', 'X-1'] }).ok);
  assert.ok(g({ op: 'includes', path: 'critical_path', ids: ['OPS-7', 'X-1'], any: true }).ok);
  assert.ok(g({ op: 'excludes', path: 'critical_path', ids: ['X-1'] }).ok);
  assert.ok(g({ op: 'order', path: 'critical_path', ids: ['OPS-7', 'CHK-90'] }).ok);
  assert.ok(!g({ op: 'order', path: 'critical_path', ids: ['CHK-90', 'OPS-7'] }).ok);
});

test('date and number tolerances', () => {
  assert.ok(g({ op: 'date', path: 'revised_launch_date', value: '2027-04-14', tolDays: 2 }).ok);
  assert.ok(!g({ op: 'date', path: 'revised_launch_date', value: '2027-04-13', tolDays: 2 }).ok);
  assert.ok(g({ op: 'number', path: 'reasoning.sprints_needed', value: 3.4, tol: 0.5 }).ok);
  assert.ok(!g({ op: 'number', path: 'reasoning.sprints_needed', value: 4, tolPct: 10 }).ok);
  assert.ok(!g({ op: 'number', path: 'overall', value: 1, tol: 5 }).ok);
  assert.throws(() => g({ op: 'date', path: 'revised_launch_date', value: 'soon' }));
});

test('equals ignores case; precision caps a padded list', () => {
  assert.ok(g({ op: 'equals', path: 'overall', value: 'RED' }).ok);
  assert.ok(g({ op: 'equals', path: 'overall', oneOf: ['amber', 'red'] }).ok);
  assert.ok(g({ op: 'precision', path: 'risks', field: 'tickets', ids: ['PAY-212'], min: 0.5 }).ok);
  assert.ok(!g({ op: 'precision', path: 'risks', field: 'tickets', ids: ['PAY-212'], min: 0.6 }).ok);
  assert.ok(!g({ op: 'precision', path: 'risks', field: 'tickets', ids: ['PAY-212', 'CHK-40'], maxCount: 1 }).ok);
});

test('no block fails every assertion; an unknown op is a key error', () => {
  assert.strictEqual(gradeAssertion(null, { id: 'x', op: 'equals', path: 'overall', value: 'red' }).ok, false);
  assert.throws(() => g({ op: 'nope' }));
});

test('buildTask: checks, twin targets and authorship', () => {
  const b = { id: 't7-a-twin', phase: 'planning', role: 'tpm', author: 'gpt-5.6-luna', controlKind: 'twin', twinOf: 't7-a', output: 'r/n.md', block: 'numbers', source: 'original', date: '2026-11-19' };
  const draft = { prompt: 'p', rubric: [], limits: { softSec: 300, hardSec: 600 }, dataFile: 'tickets.csv' };
  const t = buildTask(b, draft, { assertions: [{}, {}] }, { targetSkills: ['s1'], targetSop: null, targetAgent: null }, null, '2026-11-19');
  assert.strictEqual(t.fixture, 't7-a');
  assert.deepStrictEqual(t.targetSkills, []);
  assert.deepStrictEqual(t.loadCheck, { mustLoad: [], mustNotLoad: ['s1'] });
  assert.strictEqual(t.checks[0].cmd, TEST_CMD);
  assert.strictEqual(t.checks[0].min, 2);
  assert.strictEqual(t.authorship.family, 'openai');
});

test('every brief renders a prompt with no placeholder left', () => {
  for (const f of fs.readdirSync(path.join(DIR, 'briefs'))) {
    const text = renderPrompt(path.basename(f, '.json'));
    assert.ok(!/\{\{[A-Z]+\}\}/.test(text), f);
  }
});

test('pilotOf records the dry-run scores and the gate decision', () => {
  const { pilotOf } = require('../record-dry.js');
  const res = { repeat: 3, deterministic: true, pass: false, reference: { score: 100 }, stub: { score: 7.14 }, answers: { lazy: { score: 52.3 }, alt: { score: 90 } } };
  const p = pilotOf(res, '2026-11-19');
  assert.deepStrictEqual(p.scores.dryRun, { repeats: 3, deterministic: true, reference: 100, stub: 7.1, lazy: 52.3, alt: 90 });
  assert.strictEqual(p.decision, 'fix');
});

test('the answer gates: lazy at most 40, alternative at least 80', () => {
  const { ANSWER_GATES } = require('../../t1/dry-run.js');
  assert.ok(ANSWER_GATES.lazy(40) && !ANSWER_GATES.lazy(40.1));
  assert.ok(ANSWER_GATES.alt(80) && !ANSWER_GATES.alt(79.9));
});

const tasks = fs.readdirSync(DIR).filter((f) => /^t7-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));

test('every assembled task has its grader copies, key and reference', () => {
  for (const t of tasks) {
    const hid = path.join(DIR, 'hidden', t.id, 'hidden');
    for (const f of GRADER_FILES) assert.ok(fs.readFileSync(path.join(hid, f)).equals(fs.readFileSync(path.join(DIR, 'lib', f))), `${t.id}: ${f} differs from lib/`);
    const key = JSON.parse(fs.readFileSync(path.join(hid, 'key.json'), 'utf8'));
    assert.strictEqual(t.checks[0].min, key.assertions.length, t.id);
    assert.ok(fs.existsSync(path.join(DIR, 'solutions', t.id, key.output)), `${t.id}: reference ${key.output} missing`);
    assert.ok(fs.existsSync(path.join(DIR, 'fixtures', t.fixture)), `${t.id}: fixture ${t.fixture} missing`);
  }
});
