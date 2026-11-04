// SPDX-License-Identifier: Apache-2.0
'use strict';

// cap criteria: flags for rubric criteria and checks that do not separate arms, from judgments already on disk. The pure
// part is driven with in-memory observations; one study test uses the fake runner, so no model and no credits are used.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { analyzeObservations, collectObservations, judgeNote, buildCriteriaReport, renderCriteria, DEFAULTS } = require('../../cap/criteria.js');
const { MARGIN } = require('../../cap/decide.js');
const { decideStudy } = require('../../cap/skillstudy.js');
const { setupAndRun } = require('./cap-skillstudy-fake.js');
const { env } = require('./cap-study-helpers.js');
const { checkArgs } = require('../lib/cli-flags.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');

// n observations of one item for one arm, values from fn(rep).
const obs = (arm, n, fn, over = {}) => Array.from({ length: n }, (_, i) => ({ kind: 'check', task: 't1', id: 'check-1', label: 'file_exists a.txt', arm, rep: i + 1, src: 'd1', value: fn(i), judgeValues: null, ...over }));
const item = (r, id = 'check-1') => r.items.find((i) => i.id === id);

test('the default margin is the no-effect margin of cap decide', () => {
  assert.equal(DEFAULTS.margin, MARGIN);
});

test('a check that always passes in both arms is NON-DISCRIMINATING and SATURATED at the ceiling', () => {
  const r = analyzeObservations([...obs('ctl', 6, () => 1), ...obs('del', 6, () => 1)], { baseline: 'ctl' });
  const it = item(r);
  assert.deepEqual(it.flags, ['NON-DISCRIMINATING', 'SATURATED']);
  assert.match(it.comparisons[0].reason, /always passes in both arms/);
  assert.match(it.reasons.join(' '), /ceiling/);
});

test('a check that always fails is flagged as possibly broken and SATURATED at the floor', () => {
  const it = item(analyzeObservations([...obs('ctl', 5, () => 0), ...obs('del', 5, () => 0)], { baseline: 'ctl' }));
  assert.ok(it.flags.includes('NON-DISCRIMINATING'));
  assert.match(it.comparisons[0].reason, /always fails.*broken/);
  assert.match(it.reasons.join(' '), /floor/);
});

test('an item that always passes with 4 runs per arm is INSUFFICIENT-DATA and not flagged; with 5 it is NON-DISCRIMINATING', () => {
  const four = item(analyzeObservations([...obs('ctl', 4, () => 1), ...obs('del', 4, () => 1)], { baseline: 'ctl' }));
  assert.equal(four.comparisons[0].status, 'INSUFFICIENT-DATA');
  assert.ok(!four.flags.includes('NON-DISCRIMINATING'));
  assert.equal(four.insufficient, true);
  assert.match(four.reasons.join(' '), /4 and 4 runs, under the 5 per arm/);
  const five = item(analyzeObservations([...obs('ctl', 5, () => 1), ...obs('del', 5, () => 1)], { baseline: 'ctl' }));
  assert.equal(five.comparisons[0].status, 'NON-DISCRIMINATING');
  assert.ok(five.flags.includes('NON-DISCRIMINATING'));
  assert.equal(five.insufficient, false);
});

test('the run minimum is configurable and the report counts and lists INSUFFICIENT-DATA items', () => {
  const data = [...obs('ctl', 4, () => 1), ...obs('del', 4, () => 1)];
  assert.ok(item(analyzeObservations(data, { baseline: 'ctl', config: { minRuns: 4 } })).flags.includes('NON-DISCRIMINATING'));
  const g = { skill: 'alpha', wave: 1, dir: 'w1', judges: judgeNote({}), ...analyzeObservations([...obs('ctl', 4, () => 1), ...obs('del', 3, () => 1)], { baseline: 'ctl', config: { saturated: 1.1 } }) };
  const rep = buildCriteriaReport([g], { source: 'test' });
  assert.deepEqual([rep.summary.flagged, rep.summary.insufficient], [0, 1]);
  const md = renderCriteria(rep);
  assert.match(md, /\| min-runs \| 5 \|/);
  assert.match(md, /\| INSUFFICIENT-DATA \| del: the same value in every run, but 3 and 4 runs/);
});

test('SATURATED needs the run minimum too: 4 runs per arm is INSUFFICIENT-DATA, 5 is SATURATED', () => {
  const at = (n) => item(analyzeObservations([...obs('ctl', n, (i) => (i % 2 ? 1 : 0.95)), ...obs('del', n, () => 1)], { baseline: 'ctl', config: { saturated: 0.9 } }));
  const four = at(4);
  assert.ok(!four.flags.includes('SATURATED'));
  assert.equal(four.insufficient, true);
  assert.match(four.reasons.join(' '), /ceiling\), but 2 arms have fewer than 5 runs, so SATURATED is not called/);
  const five = at(5);
  assert.ok(five.flags.includes('SATURATED'));
  assert.equal(five.insufficient, false);
});

test('judge disagreement has a strict rate that drives HIGH-VARIANCE and a coarse pass against not pass rate beside it', () => {
  const rub = (arm, n, jv) => obs(arm, n, () => 0.25, { kind: 'rubric', id: 'c1', judgeValues: jv });
  const partialFail = item(analyzeObservations([...rub('ctl', 6, [0.5, 0]), ...rub('del', 6, [0.5, 0])], { baseline: 'ctl', config: { replicateSd: 0.9 } }), 'c1');
  assert.deepEqual([partialFail.judge.disagree, partialFail.judge.coarseDisagree, partialFail.judge.rate, partialFail.judge.coarseRate], [12, 0, 1, 0]);
  assert.ok(partialFail.flags.includes('HIGH-VARIANCE'), 'partial against fail counts in the strict rate');
  const partialPass = item(analyzeObservations([...rub('ctl', 6, [1, 0.5]), ...rub('del', 6, [1, 1])], { baseline: 'ctl', config: { replicateSd: 0.9 } }), 'c1');
  assert.deepEqual([partialPass.judge.disagree, partialPass.judge.coarseDisagree], [6, 6]);
  const md = renderCriteria(buildCriteriaReport([{ skill: 's', wave: 1, dir: 'w1', judges: judgeNote({ 2: 12 }), ...analyzeObservations([...rub('ctl', 6, [0.5, 0]), ...rub('del', 6, [0.5, 0])], { baseline: 'ctl', config: { replicateSd: 0.9 } }) }], { source: 't' }));
  assert.match(md, /\| 12 of 12; 0 of 12 \|/);
});

// One run per entry: { arm, rep, checks }. Task t1 defines two checks unless `taskChecks` says otherwise.
function checkRun(entries, { taskChecks = [{ type: 'file_exists', path: 'a' }, { type: 'contains', path: 'b', pattern: 'x' }], hasTask = true } = {}) {
  const run = { dir: 'd1', runs: entries.map((e) => ({ armId: e.arm, taskId: 't1', replicate: e.rep, result: { status: 'success', checks: e.checks } })) };
  const rows = entries.map((e) => ({ arm: e.arm, task: 't1', rep: e.rep, outcome: 'good' }));
  const tasks = new Map(hasTask ? [['t1', { id: 't1', checks: taskChecks, rubric: [] }]] : []);
  return collectObservations({ run, rows, ctx: { judges: [], rubricIdx: new Map() }, tasks });
}

test('checks are matched by id when every result carries one, whatever the order', () => {
  const r = checkRun([
    { arm: 'ctl', rep: 1, checks: [{ id: 'exists', type: 'file_exists', passed: true }, { id: 'mentions', type: 'contains', passed: false }] },
    { arm: 'del', rep: 1, checks: [{ id: 'mentions', type: 'contains', passed: true }, { id: 'exists', type: 'file_exists', passed: true }, { id: 'extra', type: 'cmd', passed: true }] },
  ]);
  assert.deepEqual(r.checkErrors, []);
  const of = (arm, id) => r.observations.find((o) => o.arm === arm && o.id === id)?.value;
  assert.deepEqual([of('ctl', 'check:mentions'), of('del', 'check:mentions'), of('del', 'check:exists')], [0, 1, 1]);
});

test('without ids, checks are matched by position only when the lengths and types agree', () => {
  const ok = checkRun([{ arm: 'ctl', rep: 1, checks: [{ type: 'file_exists', passed: true }, { type: 'contains', passed: false }] }]);
  assert.deepEqual(ok.checkErrors, []);
  assert.deepEqual(ok.observations.map((o) => [o.id, o.value, o.label]), [['check-1', 1, 'file_exists a'], ['check-2', 0, 'contains b']]);
  const noTask = checkRun([{ arm: 'ctl', rep: 1, checks: [{ type: 'cmd', passed: true }] }, { arm: 'del', rep: 1, checks: [{ type: 'cmd', passed: false }] }], { hasTask: false });
  assert.deepEqual(noTask.checkErrors, [], 'with no task definition the first run seen is the reference');
  const swapped = checkRun([{ arm: 'ctl', rep: 1, checks: [{ type: 'contains', passed: true }, { type: 'file_exists', passed: true }] }]);
  assert.match(swapped.checkErrors[0].reason, /check 1 is contains in the result and file_exists in the reference list/);
});

test('a check list of a different length with no ids is an error for that task, never a guess', () => {
  const r = checkRun([
    { arm: 'ctl', rep: 1, checks: [{ type: 'file_exists', passed: true }, { type: 'contains', passed: true }] },
    { arm: 'del', rep: 2, checks: [{ type: 'file_exists', passed: true }] },
  ]);
  assert.equal(r.checkErrors.length, 1);
  assert.match(r.checkErrors[0].reason, /arm del, replicate 2: 1 check results against 2 checks, and the checks have no id, so they cannot be matched/);
  const a = analyzeObservations(r.observations, { baseline: 'ctl', checkErrors: r.checkErrors });
  for (const it of a.items.filter((i) => i.kind === 'check')) {
    assert.deepEqual(it.flags, []);
    assert.equal(it.error.length, 1);
  }
  const rep = buildCriteriaReport([{ skill: 's', wave: 1, dir: 'w1', judges: judgeNote({}), ...a }], { source: 't' });
  assert.equal(rep.summary.errors, 2);
  assert.match(renderCriteria(rep), /\| ERROR \| not judged: 1 run had check results that could not be matched; arm del, replicate 2/);
  const none = analyzeObservations([], { baseline: 'ctl', checkErrors: r.checkErrors });
  assert.equal(none.items[0].id, 'checks', 'a task with no matched check still gets an error item');
});

test('an item that separates the arms carries no flag', () => {
  const it = item(analyzeObservations([...obs('ctl', 8, () => 1), ...obs('del', 8, () => 0)], { baseline: 'ctl' }));
  assert.equal(it.comparisons[0].status, 'SEPARATES');
  assert.deepEqual(it.flags, []);
});

test('an interval inside the margin is NON-DISCRIMINATING; a wide one including 0 is INCONCLUSIVE and not flagged', () => {
  const near = (i) => (i % 40 === 0 ? 0 : 1);
  const narrow = item(analyzeObservations([...obs('ctl', 80, near), ...obs('del', 80, near)], { baseline: 'ctl', config: { saturated: 0.999 } }));
  assert.equal(narrow.comparisons[0].status, 'NON-DISCRIMINATING');
  assert.match(narrow.comparisons[0].reason, /inside the 0\.1 margin/);
  const wide = item(analyzeObservations([...obs('ctl', 4, (i) => i % 2), ...obs('del', 4, (i) => (i + 1) % 2)], { baseline: 'ctl', config: { replicateSd: 0.9 } }));
  assert.equal(wide.comparisons[0].status, 'INCONCLUSIVE');
  assert.deepEqual(wide.flags, []);
});

test('judge disagreement and replicate spread each raise HIGH-VARIANCE, and either is null when the data lacks it', () => {
  const split = analyzeObservations([...obs('ctl', 6, () => 0.5, { kind: 'rubric', id: 'c1', judgeValues: [1, 0] }), ...obs('del', 6, () => 0.5, { kind: 'rubric', id: 'c1', judgeValues: [0, 1] })], { baseline: 'ctl' });
  const a = item(split, 'c1');
  assert.ok(a.flags.includes('HIGH-VARIANCE'));
  assert.deepEqual([a.judge.disagree, a.judge.runs], [12, 12]);
  assert.match(a.reasons.join(' '), /judges disagreed on 12 of 12 runs/);
  const coin = item(analyzeObservations([...obs('ctl', 8, (i) => i % 2), ...obs('del', 8, (i) => i % 2)], { baseline: 'ctl' }));
  assert.equal(coin.judge, null, 'a check has no judges');
  assert.ok(coin.replicate.sd > 0.4);
  assert.ok(coin.flags.includes('HIGH-VARIANCE'));
  const one = item(analyzeObservations([...obs('ctl', 1, () => 1), ...obs('del', 1, () => 0)], { baseline: 'ctl' }));
  assert.equal(one.replicate, null, 'one run per arm gives no replicate spread');
});

test('judgeNote says when judge disagreement cannot be measured', () => {
  assert.equal(judgeNote({}).measured, false);
  assert.match(judgeNote({ 1: 10 }).note, /one judge per run/);
  assert.equal(judgeNote({ 1: 2, 2: 8 }).measured, true);
});

test('the A/A arm is context, not a variant, and a criterion is NON-DISCRIMINATING only if every variant agrees', () => {
  const r = analyzeObservations([...obs('ctl', 8, () => 1), ...obs('ctl-b', 8, () => 1), ...obs('rm1', 8, () => 1), ...obs('rm2', 8, () => 0)], { baseline: 'ctl', aa: 'ctl-b' });
  assert.deepEqual(r.variants, ['rm1', 'rm2']);
  const it = item(r);
  assert.equal(it.aa.arm, 'ctl-b');
  assert.deepEqual(it.comparisons.map((c) => c.status), ['NON-DISCRIMINATING', 'SEPARATES']);
  assert.ok(!it.flags.includes('NON-DISCRIMINATING'));
});

test('intervals widen for the number of items on an arm pair unless adjust is off', () => {
  const many = ['check-1', 'check-2', 'check-3'].flatMap((id) => [...obs('ctl', 6, (i) => i % 2, { id }), ...obs('del', 6, (i) => i % 3 ? 1 : 0, { id })]);
  const on = item(analyzeObservations(many, { baseline: 'ctl' }));
  const off = item(analyzeObservations(many, { baseline: 'ctl', config: { adjust: false } }));
  assert.equal(on.comparisons[0].level, round(1 - 0.05 / 3));
  assert.equal(off.comparisons[0].level, 0.95);
  assert.ok(on.comparisons[0].hi - on.comparisons[0].lo >= off.comparisons[0].hi - off.comparisons[0].lo);
});

test('an item found in two or more run directories gets an interval paired by directory', () => {
  const both = ['d1', 'd2', 'd3'].flatMap((src, k) => [...obs('ctl', 4, () => 1, { src }), ...obs('del', 4, (i) => (i + k) % 2, { src })]);
  const c = item(analyzeObservations(both, { baseline: 'ctl' })).comparisons[0];
  assert.match(c.method, /paired by run directory/);
  assert.equal(c.cells, 3);
});

test('the report is advisory, lists the thresholds and names each flagged item with its reason', () => {
  const g = { skill: 'alpha', wave: 1, dir: 'skills/alpha/w1', judges: judgeNote({}), ...analyzeObservations([...obs('ctl', 6, () => 1), ...obs('del', 6, () => 1)], { baseline: 'ctl' }) };
  const rep = buildCriteriaReport([g], { source: 'test', createdAt: '2026-01-01T00:00:00Z' });
  assert.equal(rep.advisory, true);
  assert.equal(rep.summary.byFlag['NON-DISCRIMINATING'], 1);
  assert.equal(rep.groups[0].config, undefined, 'thresholds are stated once, at the top');
  const md = renderCriteria(rep);
  for (const re of [/Advisory only/, /\| margin \| 0\.1 \|/, /alpha, wave 1/, /always passes in both arms/, /judge disagreement is not measured/]) assert.match(md, re);
  assert.doesNotMatch(md, /[–—]/, 'no en or em dashes');
});

test('cap criteria flags are in the flag table and --no-adjust takes no value', () => {
  assert.equal(checkArgs('cap', { _: ['criteria'], study: 'x', margin: '0.1', 'no-adjust': true }), null);
  assert.match(checkArgs('cap', { _: ['criteria'], marign: '0.1' }), /did you mean --margin/);
});

test('on a finished study it reads per-judge criteria and checks, writes criteria.md and .json, and leaves cap decide unchanged', async () => {
  const e = env();
  try {
    const s = await setupAndRun(e, { del: 0.3 });
    const w1 = path.join(s.studyDir, 'skills', 'sectioned', 'w1');
    const recs = [];
    for (const arm of fs.readdirSync(w1, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(w1, d.name, 'rev-one')))) {
      for (const rep of fs.readdirSync(path.join(w1, arm.name, 'rev-one'))) {
        const f = path.join(w1, arm.name, 'rev-one', rep, 'result.json');
        const r = JSON.parse(fs.readFileSync(f, 'utf8'));
        fs.writeFileSync(f, JSON.stringify({ ...r, checks: [{ type: 'file_exists', path: 'a.txt', passed: true }] }));
        for (const judge of ['judge-a', 'judge-b']) recs.push({ kind: 'rubric', judge, armId: arm.name, taskId: 'rev-one', replicate: Number(rep), score: 1, scoreRaw: 1, criteria: [{ id: 'c1', verdict: 'pass', verdictRaw: 'pass', evidence: 'x' }], judgeError: null });
      }
    }
    fs.writeFileSync(path.join(w1, 'judgments.json'), JSON.stringify({ schemaVersion: 1, baseline: 'ctl', judges: ['judge-a', 'judge-b'], modes: ['rubric'], rubric: recs, pairwise: [] }));

    const strip = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'decisions.json'), 'utf8')).decisions;
    decideStudy({ studyDir: s.studyDir, outDir: path.join(e.root, 'before'), patches: false });
    const before = fs.readdirSync(path.join(s.studyDir, 'decisions')).sort();
    const r = spawnSync(process.execPath, [BENCH_JS, 'cap', 'criteria', '--study', s.studyDir], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: e.root, TMPDIR: process.env.TMPDIR } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /advisory; no call was changed/);
    decideStudy({ studyDir: s.studyDir, outDir: path.join(e.root, 'after'), patches: false });
    assert.deepEqual(strip(path.join(e.root, 'after')), strip(path.join(e.root, 'before')), 'cap decide gives the same calls after cap criteria');
    assert.deepEqual(fs.readdirSync(path.join(s.studyDir, 'decisions')).sort(), before, 'nothing is written into decisions/');

    const rep = JSON.parse(fs.readFileSync(path.join(s.studyDir, 'criteria', 'criteria.json'), 'utf8'));
    assert.ok(fs.existsSync(path.join(s.studyDir, 'criteria', 'criteria.md')));
    const g = rep.groups.find((x) => x.wave === 1);
    assert.equal(g.judges.measured, true);
    const c1 = g.items.find((i) => i.kind === 'rubric' && i.id === 'c1');
    assert.deepEqual(c1.judge, { runs: Object.values(c1.rates).reduce((n, a) => n + a.n, 0), disagree: 0, rate: 0, coarseDisagree: 0, coarseRate: 0 });
    assert.ok(c1.flags.includes('NON-DISCRIMINATING') && c1.flags.includes('SATURATED'));
    const chk = g.items.find((i) => i.kind === 'check' && i.task === 'rev-one');
    assert.ok(chk.flags.includes('NON-DISCRIMINATING'));
  } finally { e.done(); }
});

function round(v) { return Number(v.toFixed(4)); }
