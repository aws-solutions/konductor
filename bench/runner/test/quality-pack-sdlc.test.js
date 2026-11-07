// SPDX-License-Identifier: Apache-2.0
'use strict';

// The SDLC criteria of the quality pack: requirements, non-functional, design scalability, plan and change discipline. Gating and
// counted criteria on synthetic files, the pack score in the quality score, the process signals, and the two requirements-suite tasks
// (checks, negatives, answer-key guard). Fake data only; no model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const P = require('../../judge/pack/index.js');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { loadTasks } = require('../lib/tasks.js');
const { taskRevision } = require('../../judge/revision.js');
const { evalCheck, ANSWER_KEY } = require('../lib/check-matcher.js');
const { loadCases, checkCases } = require('../lib/negatives.js');
const { loadScoring, qualityOfRun, computeScores, DEFAULT_WEIGHTS } = require('../../report/scores.js');
const { packScores, recordScore } = require('../../report/packscore.js');
const { hasAssumptionsSection, processSignalsOf, summarizeProcess, spawnsOf } = require('../../report/process.js');
const { summarizeQuality, qualityBlocks } = require('../../report/quality.js');
const { loadRun } = require('../../report/load.js');
const { toMarkdown } = require('../../report/doc.js');
const D = require('../../report/doc.js');

const BENCH = path.join(__dirname, '..', '..');
const pack = P.loadPack('quality');
const file = (rel, text, orig = null) => ({ rel, created: orig === null, binary: false, text, orig });
const lines = (n, prefix = 'const v') => Array.from({ length: n }, (_, i) => `${prefix}${i} = ${i};`).join('\n');
const status = (app) => Object.fromEntries(app.criteria.map((c) => [c.criterion.id, c]));
const task = (over) => ({ id: 'x', class: 'simple', prompt: 'Do it.', ...over });
const NEW = {
  'change-discipline': ['chg-no-leftovers', 'chg-tests-intact', 'chg-scoped'],
  'requirements-clarity': ['req-unambiguous', 'req-testable', 'req-failure-and-edge-cases', 'req-no-solution-leak', 'req-conflicts-and-gaps', 'req-assumptions-and-questions', 'req-prioritized', 'req-traceable'],
  'nfr-chain': ['req-nfr-coverage', 'req-nfr-measurable', 'des-nfr-addressed'],
  'design-scalability': ['des-scale-bottleneck', 'des-failure-modes'],
  'task-breakdown': ['plan-independent-tasks', 'plan-done-criteria', 'plan-dependencies-order', 'plan-coverage', 'plan-sizing', 'plan-risks', 'plan-test-tasks', 'plan-delegation-fit'],
};
const TASK_REQ = { id: 'req-vague-request', class: 'design', prompt: 'Write requirements.' };
const TASK_PLAN = { id: 'plan-multipart-feature', class: 'sop', prompt: 'Write a plan.' };

// ---- the pack ----

test('the new dimensions hold exactly the criteria listed for them, and the lint passes the pack', () => {
  assert.deepEqual(P.validatePack(pack), []);
  for (const [dim, ids] of Object.entries(NEW)) assert.deepEqual(pack.criteria.filter((c) => c.dimension === dim).map((c) => c.id), ids, dim);
  assert.equal(pack.criteria.length, 79);
});

test('the pre-existing criteria keep their dimension, weight, anchors and evidence rule', () => {
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'quality-pack-42.json'), 'utf8'));
  assert.equal(base.length, 42);
  for (const old of base) {
    const now = pack.criteria.find((c) => c.id === old.id);
    assert.ok(now, old.id);
    // Extended on purpose to name diagrams as a source; quality-pack-3b.test.js pins what must stay.
    if (old.id === 'des-consistency') { assert.deepEqual([now.dimension, now.weight, now.evidence.minQuotes], [old.dimension, old.weight, old.evidence.minQuotes]); continue; }
    const { appliesTo: oldApplies, ...oldRest } = old;
    const { appliesTo: nowApplies, ...nowRest } = now;
    assert.deepEqual(nowRest, oldRest, old.id);
    // Only the written-content criteria gained document types.
    assert.deepEqual(nowApplies.filter((t) => !oldApplies.includes(t)), old.id.startsWith('cq-') && oldApplies.includes('design') ? ['requirements', 'plan'] : [], old.id);
  }
});

test('each lint rule applies to the new criteria: a vague word in an anchor, a missing threshold and a missing list are refused', () => {
  const clone = () => JSON.parse(JSON.stringify(pack));
  const bad = (edit) => { const p = clone(); edit(p); return P.validatePack(p).join(' | '); };
  assert.match(bad((p) => { p.criteria.find((c) => c.id === 'plan-sizing').levels.pass = 'Each task is small and clean.'; }), /plan-sizing.*vague word/);
  assert.match(bad((p) => { p.criteria.find((c) => c.id === 'req-unambiguous').levels.fail = 'Many vague terms appear.'; }), /req-unambiguous.*threshold 3/);
  assert.match(bad((p) => { delete p.vagueTerms; }), /vagueTerms.*non-empty list/);
  assert.match(bad((p) => { p.leftoverPatterns.debug = ['(']; }), /leftoverPatterns.*valid regular expressions/);
  assert.match(bad((p) => { delete p.weakenedTestPatterns.skip; }), /weakenedTestPatterns/);
});

// ---- gating for requirements and plan ----

for (const [type, t, rel, docText] of [
  ['requirements', TASK_REQ, 'docs/requirements.md', '# Requirements\n\nREQ-1: The system shall store the count.\n'],
  ['plan', TASK_PLAN, 'docs/plan.md', '# Plan\n\nT1. Migration. Done when the tests pass.\n'],
]) {
  const dim = type === 'requirements' ? 'req-testable' : 'plan-done-criteria';
  test(`${type}: declared and produced is judged, declared and missing fails without a model call, not declared is n/a`, () => {
    const p = JSON.parse(JSON.stringify(pack));
    const made = status(P.applicability(p, t, [file(rel, docText)]));
    assert.equal(made[dim].status, 'judged');
    const missing = status(P.applicability(p, t, []));
    assert.equal(missing[dim].status, 'absent');
    assert.match(missing[dim].reason, new RegExp(`asks for ${type} and none was produced`));
    const results = P.absentCriteria(P.applicability(p, t, []).criteria);
    assert.ok(results.length >= NEW[type === 'requirements' ? 'requirements-clarity' : 'task-breakdown'].length - 1);
    assert.ok(results.every((r) => r.verdict === 'fail' && r.status === 'absent'));
    const other = status(P.applicability(p, task({ id: 'unrelated', class: 'review' }), [file(rel, docText)]));
    assert.equal(other[dim].status, 'na');
    assert.match(other[dim].reason, new RegExp(`does not ask for.*${type}`));
  });
}

test('plan-delegation-fit applies only to a task that declares delegation', () => {
  const p = JSON.parse(JSON.stringify(pack));
  const plain = status(P.applicability(p, TASK_PLAN, [file('docs/plan.md', '# Plan\n')]));
  assert.equal(plain['plan-delegation-fit'].status, 'na');
  p.taskArtifacts['plan-multipart-feature'] = ['plan', 'delegation'];
  assert.equal(status(P.applicability(p, TASK_PLAN, [file('docs/plan.md', '# Plan\n')]))['plan-delegation-fit'].status, 'judged');
  assert.equal(status(P.applicability(p, TASK_PLAN, []))['plan-delegation-fit'].status, 'absent');
});

test('the written-content criteria read a requirements document and a plan, and the other documents do not get the plan criteria', () => {
  const app = status(P.applicability(pack, TASK_REQ, [file('docs/requirements.md', '# R\nREQ-1: It shall work.\n')]));
  assert.equal(app['cq-lead-with-point'].status, 'judged');
  assert.equal(app['cq-plain-typography'].status, 'auto');
  assert.equal(app['plan-coverage'].status, 'na');
  assert.equal(app['des-consistency'].status, 'na');
});

// ---- change discipline: any size ----

test('change discipline applies to a one-line fix that the structure criteria skip, and is absent when no code changed', () => {
  const t = { id: 'simple-fix-failing-test', class: 'simple', prompt: 'Fix the test.' };
  const small = status(P.applicability(pack, t, [file('src/a.js', 'const a = 2;\n', 'const a = 1;\n')]));
  assert.equal(small['mod-single-responsibility'].status, 'na');
  assert.match(small['mod-single-responsibility'].reason, /too small to judge/);
  assert.equal(small['chg-scoped'].status, 'judged');
  assert.equal(small['chg-no-leftovers'].status, 'auto');
  assert.equal(small['chg-tests-intact'].status, 'auto');
  const none = status(P.applicability(pack, t, []));
  for (const id of NEW['change-discipline']) assert.equal(none[id].status, 'absent', id);
  const undeclared = status(P.applicability(pack, task({ class: 'review' }), [file('src/a.js', lines(3))]));
  for (const id of NEW['change-discipline']) assert.equal(undeclared[id].status, 'na', id);
  assert.match(undeclared['chg-scoped'].reason, /^the task does not ask for code$/);
  assert.match(status(P.applicability(pack, TASK_PLAN, [file('docs/plan.md', '# Plan\n')]))['plan-delegation-fit'].reason, /^the task does not ask for assignments$/);
});

test('a criterion only a task can opt into does not become the reason a dimension is n/a', () => {
  const { root, tasks, run } = packRun([
    { criteria: [], na: [{ id: 'plan-done-criteria', dimension: 'task-breakdown', reason: 'the task does not ask for plan' }, { id: 'plan-delegation-fit', dimension: 'task-breakdown', reason: 'the task does not ask for assignments' }], dimensions: { 'task-breakdown': { score: null, judged: 0, absent: 0 } } },
  ]);
  try {
    const s = summarizeQuality({ groups: [{ id: 'vanilla', label: 'vanilla', run, arm: 'vanilla' }], tasks, pack });
    assert.deepEqual(s.groups[0].dimensions['task-breakdown'].naReasons, [{ reason: 'the task does not ask for plan', count: 1 }]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('leftovers counts debug output, focus markers, notes and commented-out code in added lines only', () => {
  const t = { id: 'simple-fix-failing-test', class: 'simple', prompt: 'Fix the test.' };
  const run = (text, orig) => P.autoCriteria(pack, P.applicability(pack, t, [file('src/a.js', text, orig)]).criteria).find((c) => c.id === 'chg-no-leftovers');
  const clean = run('function a() {\n  return 2;\n}\n', 'function a() {\n  return 1;\n}\n');
  assert.equal(clean.verdict, 'pass');
  const dirty = run('function a() {\n  console.log(1);\n  // TODO tidy\n  // const b = 2;\n  return 2;\n}\n', 'function a() {\n  return 1;\n}\n');
  assert.equal(dirty.count, 3);
  assert.equal(dirty.verdict, 'fail');
  const old = run('function a() {\n  console.log(1);\n  return 2;\n}\n', 'function a() {\n  console.log(1);\n  return 1;\n}\n');
  assert.equal(old.count, 0);
  const focus = run('it.only("a", () => {});\n', 'it("a", () => {});\n');
  assert.equal(focus.count, 1);
  assert.equal(focus.verdict, 'partial');
});

test('weakened tests counts skip markers, net removed test declarations and deleted test files', () => {
  const t = { id: 'simple-fix-failing-test', class: 'simple', prompt: 'Fix the test.' };
  const run = (files, deleted = []) => P.autoCriteria(pack, P.applicability(pack, t, files, { deleted }).criteria).find((c) => c.id === 'chg-tests-intact');
  const src = file('src/a.js', 'const a = 2;\n', 'const a = 1;\n');
  const before = 'it("a", () => { assert.ok(1); });\nit("b", () => { assert.ok(2); });\n';
  assert.equal(run([src, file('test/a.test.js', before, before)]).verdict, 'pass');
  assert.equal(run([src, file('test/a.test.js', before.replace('it("b"', 'it.skip("b"'), before)]).count, 1);
  assert.equal(run([src, file('test/a.test.js', 'it("a", () => { assert.ok(1); });\n', before)]).count, 1);
  const rewritten = 'it("a", () => { assert.ok(1); });\nit("b renamed", () => { assert.ok(2); });\n';
  assert.equal(run([src, file('test/a.test.js', rewritten, before)]).count, 0);
  const gone = run([src], ['test/old.test.js', 'README.md']);
  assert.equal(gone.count, 1);
  assert.match(gone.evidence, /deleted test\/old\.test\.js/);
  assert.equal(run([src, file('test/a.test.js', 'it("a", () => {});\n', before)], ['test/b.test.js']).verdict, 'fail');
});

// ---- vague terms ----

const vague = (text) => P.DETECTORS['vague-terms'](P.proseOf(P.changeStats([file('d.md', text)]), ['d.md'], { tables: true }), pack);

test('vague terms are counted in requirement sentences that hold no number, in prose and in table rows', () => {
  assert.deepEqual(vague('REQ-1: The system shall respond fast.\n'), ['fast']);
  assert.deepEqual(vague('| REQ-2 | The upload shall be easy to use, as needed. | MUST |\n'), ['easy', 'as needed']);
  assert.deepEqual(vague('REQ-3: The system shall respond fast, within 200 ms.\n'), []);
  assert.deepEqual(vague('| REQ-4 | The report shall load quickly | p95 under 2 s |\n'), []);
  assert.deepEqual(vague('A sentence that is not a requirement is fast and simple.\n'), []);
});

test('a vague term is not counted when it is quoted, flagged as vague, or inside a section about the request', () => {
  assert.deepEqual(vague('REQ-1: The system shall respond within 2 s. The term "quickly" in the request is vague.\n'), []);
  assert.deepEqual(vague('REQ-2: "Quickly" is vague and the system shall get a number.\n'), []);
  assert.deepEqual(vague('## Ambiguities\nREQ-5: The system should be fast.\n## Requirements\nREQ-6: The system shall be fast.\n'), ['fast']);
  assert.deepEqual(vague('## Assumptions\n- The service will be reliable and fast.\n'), []);
});

test('the counted requirement criterion scores partial for one and fail for three', () => {
  const run = (text) => P.autoCriteria(pack, P.applicability(pack, TASK_REQ, [file('docs/requirements.md', text)]).criteria).find((c) => c.id === 'req-unambiguous');
  assert.equal(run('REQ-1: The system shall respond within 2 s.\n').verdict, 'pass');
  assert.equal(run('REQ-1: The system shall respond fast.\n').verdict, 'partial');
  assert.equal(run('REQ-1: It shall be fast.\nREQ-2: It shall be easy.\nREQ-3: It shall be flexible.\n').verdict, 'fail');
});

// ---- the pack in the quality score ----

test('the default scoring file has no pack weight and a file that gives one is refused unless the caller can supply it', () => {
  assert.deepEqual(Object.keys(loadScoring()), ['hidden', 'checks', 'rubric']);
  const f = path.join(BENCH, 'profiles', 'scoring-quality.json');
  assert.throws(() => loadScoring(f), /weight for pack needs the quality-pack scores/);
  const w = loadScoring(f, { allowPack: true });
  assert.deepEqual(w, { hidden: 0.4, checks: 0.16, rubric: 0.24, pack: 0.2 });
  assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('a run with a pack score is scored on four components, and one without keeps the other three renormalised', () => {
  const w = { hidden: 0.4, checks: 0.16, rubric: 0.24, pack: 0.2 };
  const withPack = qualityOfRun({ hidden: 1, checks: 1, rubric: 1, pack: 0 }, w);
  assert.ok(Math.abs(withPack.score - 80) < 1e-9);
  assert.deepEqual(withPack.used, ['hidden', 'checks', 'rubric', 'pack']);
  const none = qualityOfRun({ hidden: 1, checks: 0, rubric: 1, pack: null }, w);
  assert.deepEqual(none.used, ['hidden', 'checks', 'rubric']);
  assert.ok(Math.abs(none.score - (0.64 / 0.8) * 100) < 1e-9);
  assert.equal(qualityOfRun({ hidden: 1, checks: 1, rubric: 1, pack: 0 }, DEFAULT_WEIGHTS).score, 100);
});

test('the scores block lists the pack component and its formula only when the weight is above zero', () => {
  const rows = [{ arm: 'a', cls: 'design', task: 't', rep: 1, outcome: 'good', hidden: null, checks: 1, rubric: 0.8, pack: 0.5, credits: 1, wall: 1, modelCalls: 1, workToolCalls: 1, subagentCalls: 0, turns: 0 }];
  const plain = computeScores({ rows, baseline: 'a', weights: DEFAULT_WEIGHTS });
  assert.equal(plain.arms.a.overall.quality.components.pack, undefined);
  assert.doesNotMatch(plain.formulas.quality, /Pack quality/);
  const scored = computeScores({ rows, baseline: 'a', weights: { hidden: 0.4, checks: 0.16, rubric: 0.24, pack: 0.2 } });
  assert.equal(scored.arms.a.overall.quality.components.pack.n, 1);
  assert.match(scored.formulas.quality, /Pack quality/);
  assert.ok(scored.arms.a.overall.quality.value < plain.arms.a.overall.quality.value);
});

// ---- the pack score of a run, from records ----

function packRun(records, { notJudged = [], taskIdMap = null } = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla', task: 't1' }, { arm: 'other', task: 't1' }], { taskIds: ['t1'] });
  const tasks = loadTasks(bench);
  const rev = taskRevision(tasks.get('t1'));
  const full = records.map((r) => ({ judge: 'j1', armId: 'vanilla', taskId: 't1', replicate: 1, taskRevision: rev, packRevision: pack.revision, dimensions: {}, judgeError: null, criteria: [], na: [], ...r }));
  write(path.join(runDir, 'judgments-quality.json'), JSON.stringify({ schemaVersion: 1, kind: 'quality-pack', pack: { id: pack.id, revision: pack.revision }, backend: 'kiro', judges: ['j1', 'j2'], notJudged, records: full }));
  return { root, tasks, run: loadRun(runDir), rev };
}
const crit = (id, verdict) => ({ id, dimension: 'x', status: 'judged', verdict });

test('a pack score is the weighted mean of the criteria that applied, averaged over judges', () => {
  const { root, tasks, run } = packRun([
    { criteria: [crit('chg-tests-intact', 'pass'), crit('chg-scoped', 'fail')] },
    { armId: 'vanilla', judge: 'j2', criteria: [crit('chg-tests-intact', 'pass'), crit('chg-scoped', 'pass')] },
    { armId: 'other', criteria: [] },
  ]);
  try {
    // chg-tests-intact weighs 3 and chg-scoped 2: judge 1 gives 3/5, judge 2 gives 1.
    assert.ok(Math.abs(recordScore(pack, { criteria: [crit('chg-tests-intact', 'pass'), crit('chg-scoped', 'fail')] }) - 0.6) < 1e-9);
    const s = packScores({ run, tasks, pack });
    assert.ok(Math.abs(s.scoreOf('vanilla', 't1', 1) - 0.8) < 1e-9);
    assert.equal(s.scoreOf('other', 't1', 1), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a run the pack never judged, or judged against another revision, stops the scoring with a message that names the cause', () => {
  const missing = packRun([{ criteria: [crit('chg-scoped', 'pass')] }]);
  try {
    assert.throws(() => packScores({ run: missing.run, tasks: missing.tasks, pack }), /1 run\(s\) were never judged by the pack \(other\/t1\/1\)/);
  } finally { fs.rmSync(missing.root, { recursive: true, force: true }); }
  const stale = packRun([{ criteria: [crit('chg-scoped', 'pass')] }, { armId: 'other', packRevision: 'old', criteria: [crit('chg-scoped', 'pass')] }]);
  try {
    assert.throws(() => packScores({ run: stale.run, tasks: stale.tasks, pack }), new RegExp(`another pack revision or another task revision \\(other/t1/1\\); the current pack revision is ${pack.revision}.*judge --criteria-pack quality`));
  } finally { fs.rmSync(stale.root, { recursive: true, force: true }); }
  const none = packRun([]);
  try {
    fs.rmSync(path.join(none.run.dir, 'judgments-quality.json'));
    assert.throws(() => packScores({ run: loadRun(none.run.dir), tasks: none.tasks, pack }), /has no judgments-quality\.json/);
  } finally { fs.rmSync(none.root, { recursive: true, force: true }); }
});

test('stale records are reported with their revision and how to refresh them, never mixed in', () => {
  const { root, tasks, run } = packRun([
    { criteria: [crit('chg-scoped', 'pass')], dimensions: { 'change-discipline': { score: 1, judged: 1, absent: 0 } } },
    { armId: 'other', packRevision: 'oldrev000001', criteria: [crit('chg-scoped', 'pass')], dimensions: { 'change-discipline': { score: 1, judged: 1, absent: 0 } } },
  ]);
  try {
    const s = summarizeQuality({ groups: [{ id: 'other', label: 'other', run, arm: 'other' }, { id: 'vanilla', label: 'vanilla', run, arm: 'vanilla' }], tasks, pack });
    assert.equal(s.staleBy.pack, 1);
    assert.deepEqual(s.staleRevisions, ['oldrev000001']);
    assert.equal(s.groups[0].dimensions['change-discipline'].score, null);
    assert.equal(s.groups[1].dimensions['change-discipline'].score, 100);
    const md = toMarkdown(qualityBlocks(s));
    assert.match(md, new RegExp(`made against pack revision oldrev000001 \\(the pack is now ${pack.revision}\\)`));
    assert.match(md, /Rerun bench\.js judge --criteria-pack quality --run DIR/);
    const allStale = summarizeQuality({ groups: [{ id: 'other', label: 'other', run, arm: 'other' }], tasks, pack });
    assert.match(toMarkdown(qualityBlocks(allStale)), /No run has a current pack record/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- process signals ----

test('an assumptions section is a heading, a bold label or a short line that opens a list; a passing mention is not one', () => {
  for (const yes of ['## Assumptions\n- a\n', '**Assumptions:**\n- a\n', 'Assumptions I made:\n- a\n', '### Open questions and assumptions\n', '| ID | Assumptions | Effect |\n', 'Key assumptions\n', '- **Assumptions**\n']) assert.equal(hasAssumptionsSection(yes), true, yes);
  for (const no of ['I made no assumptions about the format and kept the tests passing, which seemed the safe reading here.', 'Done. All tests pass.', '```\n## Assumptions\n```\n', '', null]) assert.equal(hasAssumptionsSection(no), false, String(no));
});

// makeRun keeps finalText in the stream only; the runner also records it in result.json, which the process signals read.
function procRun(specs, config = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, specs, { taskIds: ['t1'], ...config });
  for (const s of specs) {
    const f = path.join(runDir, s.arm, s.task ?? 't1', String(s.rep ?? 1), 'result.json');
    const r = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.writeFileSync(f, JSON.stringify({ ...r, finalText: s.finalText ?? null }));
  }
  return { root, bench, run: loadRun(runDir), tasks: loadTasks(bench) };
}

test('process signals per harness come from the recorded fields, and a missing field is n/a with its reason', () => {
  const { root, run, tasks } = procRun([
    { arm: 'kv', task: 't1', orch: { spawns: 0 }, capInvocation: { delegatedTo: [] }, askedUser: false, finalText: 'Done.\n\nAssumptions:\n- the format is csv', files: {} },
    { arm: 'kk', task: 't1', orch: { spawns: 3 }, capInvocation: { delegatedTo: [{ agent: 'k-developer', count: 2 }, { agent: '(unnamed)', count: 1 }] }, askedUser: true, finalText: 'Which one?', files: { 'docs/plan.md': '# Plan\n\n## Open questions\n- who?\n' } },
    { arm: 'dead', task: 't1', status: 'error', runFinishedStatus: null, subagentCalls: null, capInvocation: null, askedUser: null, finalText: null },
  ]);
  try {
    const by = (arm) => processSignalsOf(run.runs.find((e) => e.armId === arm), tasks.get('t1'));
    const kv = by('kv');
    assert.equal(kv.spawns.value, 0);
    assert.equal(kv.agents.value, 0);
    assert.equal(kv.assumptionsFinal.value, true);
    assert.equal(kv.assumptionsDoc.value, false);
    assert.equal(kv.askedQuestion.value, false);
    const kk = by('kk');
    assert.equal(kk.spawns.value, 3);
    assert.equal(kk.agents.value, 1);
    assert.equal(kk.agents.unnamed, 1);
    assert.equal(kk.assumptionsDoc.value, true);
    assert.equal(kk.askedQuestion.value, true);
    assert.equal(spawnsOf({ orch: { spawns: 2 }, claudeCode: { spawned: 5 }, subagentCalls: 9 }), 2);
    assert.equal(spawnsOf({ claudeCode: { spawned: 5 }, subagentCalls: 9 }), 5);
    assert.equal(spawnsOf({ subagentCalls: 9 }), 9);
    assert.equal(spawnsOf({}), null);
    const dead = by('dead');
    assert.equal(dead.spawns.value, null);
    assert.match(dead.spawns.na, /ended before any agent output/);
    assert.equal(dead.agents.value, null);
    assert.match(dead.assumptionsFinal.na, /no final message/);
    assert.match(dead.askedQuestion.na, /did not finish/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  const cc = procRun([{ arm: 'cc', task: 't1', harness: 'claude-code', claudeCode: { spawned: 1 }, capInvocation: { delegatedTo: [{ agent: 'reviewer', count: 1 }] }, askedUser: false, finalText: 'ok' }]);
  try {
    const sig = processSignalsOf(cc.run.runs[0], cc.tasks.get('t1'));
    assert.equal(sig.spawns.value, 1);
    assert.equal(sig.agents.value, 1);
  } finally { fs.rmSync(cc.root, { recursive: true, force: true }); }
});

test('the process table averages over the runs that recorded a signal, keeps n/a out of the means and explains it', () => {
  const { root, run, tasks } = procRun([
    { arm: 'a', task: 't1', rep: 1, orch: { spawns: 2 }, capInvocation: { delegatedTo: [{ agent: 'x', count: 1 }, { agent: 'y', count: 1 }] }, askedUser: false, finalText: 'Assumptions:\n- a' },
    { arm: 'a', task: 't1', rep: 2, orch: { spawns: 0 }, capInvocation: { delegatedTo: [] }, askedUser: true, finalText: 'ok' },
    { arm: 'a', task: 't1', rep: 3, status: 'error', runFinishedStatus: null, subagentCalls: null, capInvocation: null, askedUser: null, finalText: null },
  ]);
  try {
    const [g] = summarizeProcess({ groups: [{ id: 'a', label: 'a', run, arm: 'a' }], tasks });
    assert.equal(g.runs, 3);
    assert.deepEqual(g.spawns, { n: 2, mean: 1 });
    assert.deepEqual(g.delegated, { n: 2, k: 1 });
    assert.deepEqual(g.agents, { n: 2, mean: 1 });
    assert.deepEqual(g.asked, { n: 2, k: 1 });
    assert.deepEqual(g.assumptionsFinal, { n: 2, k: 1 });
    const md = toMarkdown(require('../../report/process.js').processBlocks([g], D));
    assert.match(md, /### Process signals \(descriptive, not scored\)/);
    assert.match(md, /\| a \| 3 \| 1\.00 \(n=2\) \| 1 of 2 \| 1\.00 \(n=2\) \|/);
    assert.match(md, /spawns: n\/a in 1 run\(s\), the run ended before any agent output was parsed/);
    assert.match(md, /A vanilla arm that has no subagent tool records 0 spawns, which is a count, not n\/a/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- the two requirements-suite tasks ----

const tasks = loadTasks(BENCH);
const SUITE = ['req-vague-request', 'plan-multipart-feature'];
const solutionsDir = path.join(BENCH, 'tasks', 'solutions');
const stubsDir = path.join(BENCH, 'tasks', 'stubs');

function workspace(t, ...overlays) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'req-suite-'));
  fs.cpSync(t.fixtureDir, dir, { recursive: true, filter: (p) => path.basename(p) !== ANSWER_KEY });
  for (const o of overlays) if (o) fs.cpSync(o, dir, { recursive: true });
  return dir;
}
const run = (dir, t, c) => evalCheck(dir, c, { pristineDir: t.fixtureDir }).passed;

test('the suite lists exactly the tasks tagged requirements, and the full suite does not include them', () => {
  const suite = JSON.parse(fs.readFileSync(path.join(BENCH, 'suites', 'requirements.json'), 'utf8'));
  assert.deepEqual([...suite.tasks].sort(), [...tasks.values()].filter((t) => t.tiers.includes('requirements')).map((t) => t.id).sort());
  assert.deepEqual([...suite.tasks].sort(), [...SUITE].sort());
  for (const name of ['lite', 'full', 'pilot']) assert.ok(!JSON.parse(fs.readFileSync(path.join(BENCH, 'suites', `${name}.json`), 'utf8')).tasks.some((id) => SUITE.includes(id)), name);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(BENCH, 'suites', 'lite.json'), 'utf8')).tasks, ['simple-fix-failing-test', 'simple-explain-file', 'orch-input-validation', 'review-inventory-security', 'design-hold-service']);
});

for (const id of SUITE) {
  const t = tasks.get(id);
  test(`${id}: every check passes on the reference solution, the untouched fixture fails, an empty workspace fails every check`, () => {
    const solved = workspace(t, path.join(solutionsDir, id));
    const fixture = workspace(t);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'req-empty-'));
    try {
      t.checks.forEach((c, i) => assert.ok(run(solved, t, c), `checks[${i}] on the solution`));
      assert.ok(t.checks.some((c) => !run(fixture, t, c)));
      t.checks.forEach((c, i) => assert.ok(!run(empty, t, c), `checks[${i}] passes on an empty workspace`));
    } finally { for (const d of [solved, fixture, empty]) fs.rmSync(d, { recursive: true, force: true }); }
  });

  test(`${id}: the keyword-only stub fails a counted check, and every near miss is rejected by its keyword check`, () => {
    const stubbed = workspace(t, path.join(solutionsDir, id), path.join(stubsDir, id));
    try {
      const failed = t.checks.filter((c) => !run(stubbed, t, c));
      assert.ok(failed.some((c) => c.type === 'min_matches' || c.type === 'cmd'));
    } finally { fs.rmSync(stubbed, { recursive: true, force: true }); }
    const spec = loadCases(path.join(BENCH, 'tasks', 'negatives'), id);
    assert.ok(spec.cases.length >= 15);
    const problems = checkCases({ task: t, spec, makeWorkspace: () => workspace(t, path.join(solutionsDir, id)), evalOne: (dir, c) => run(dir, t, c) });
    assert.deepEqual(problems, []);
  });

  test(`${id}: it is a document task that names its artifact in the pack, ends with the no-questions sentence and keeps the fixture and source untouched`, () => {
    assert.deepEqual(pack.taskArtifacts[id], [id === 'req-vague-request' ? 'requirements' : 'plan']);
    assert.match(t.prompt, /Do not ask me questions; if something is unclear/);
    assert.deepEqual(t.tiers, ['requirements']);
    for (const p of ['src', 'test']) assert.ok(t.checks.some((c) => c.type === 'fixture_unchanged' && c.path === p), p);
    assert.ok(t.rubric.length >= 3 && t.rubric.length <= 6);
  });
}

// The answer key of each fixture lists ids in the first column of its tables. Each id has to reach a deterministic check or a rubric
// item of the task that uses the fixture, so no seeded item can go unmeasured.
function keyIds(text) {
  return [...text.matchAll(/^\|\s*([A-Z][A-Z-]*\d+|[A-Z]-[A-Z]\d+)\s*\|/gm)].map((m) => m[1]);
}

for (const id of SUITE) {
  const t = tasks.get(id);
  test(`${id}: every id in the fixture's answer key is named by a check or a rubric item`, () => {
    const key = fs.readFileSync(path.join(t.fixtureDir, ANSWER_KEY), 'utf8');
    const ids = keyIds(key);
    assert.ok(ids.length >= 9, `${ids.length} ids found`);
    assert.equal(new Set(ids).size, ids.length, 'an id appears twice');
    const text = [...t.checks.map((c) => `${c.cmd ?? ''} ${c.pattern ?? ''}`), ...t.rubric.map((r) => r.criterion)].join('\n');
    const unnamed = ids.filter((x) => !new RegExp(`(?<![A-Z0-9-])${x}(?![A-Z0-9])`).test(text));
    assert.deepEqual(unnamed, []);
  });
}

test('the answer-key id guard reads the table ids and nothing else', () => {
  assert.deepEqual(keyIds('| ID | x |\n|----|---|\n| R-A1 | a |\n| PT1 | b |\n| DE12 | c |\nprose R-Z9\n'), ['R-A1', 'PT1', 'DE12']);
});

test('the seeded counts match the task statement: nine request items, and five parts with three edges, one parallel part, one trap', () => {
  const req = keyIds(fs.readFileSync(path.join(tasks.get('req-vague-request').fixtureDir, ANSWER_KEY), 'utf8'));
  assert.deepEqual(req, ['R-A1', 'R-A2', 'R-A3', 'R-C1', 'R-C2', 'R-X1', 'R-N1', 'R-U1', 'R-U2']);
  const plan = keyIds(fs.readFileSync(path.join(tasks.get('plan-multipart-feature').fixtureDir, ANSWER_KEY), 'utf8'));
  assert.deepEqual(plan, ['PT1', 'PT2', 'PT3', 'PT4', 'PT5', 'DE1', 'DE2', 'DE3', 'PA1', 'TR1', 'NF1']);
});

// Built from parts so this file does not match its own scan.
const INTERNAL = new RegExp(['amaz' + 'on', 'bra' + 'zil', 'mid' + 'way', 'isen' + 'gard', 'cor' + 'p\\.', 'dev-' + 'dsk', '\\bCR-\\d'].join('|'), 'i');

test('the request fixtures are public-safe: no internal names, no dashes, no curly quotes', () => {
  for (const id of SUITE) {
    const t = tasks.get(id);
    const doc = path.join(t.fixtureDir, 'docs', id === 'req-vague-request' ? 'stakeholder-request.md' : 'feature-request.md');
    const text = [fs.readFileSync(doc, 'utf8'), fs.readFileSync(path.join(t.fixtureDir, ANSWER_KEY), 'utf8'), t.prompt].join('\n');
    assert.doesNotMatch(text, /[\u2013\u2014\u2018\u2019\u201C\u201D]/);
    assert.doesNotMatch(text, INTERNAL);
  }
});

test('the pack judging spend is counted once per judgments file, not once per arm', () => {
  const { root, tasks, run } = packRun([
    { criteria: [crit('chg-scoped', 'pass')] },
    { armId: 'other', criteria: [crit('chg-scoped', 'pass')] },
  ]);
  try {
    const file = path.join(run.dir, 'judgments-quality.json');
    const q = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...q, spentCredits: 1.5, spentUsd: 2.25 }));
    const groups = [{ id: 'vanilla', label: 'vanilla', run: loadRun(run.dir), arm: 'vanilla' }, { id: 'other', label: 'other', run: loadRun(run.dir), arm: 'other' }];
    const s = summarizeQuality({ groups, tasks, pack });
    assert.equal(s.spend.credits, 1.5);
    assert.equal(s.spend.usd, 2.25);
    assert.match(toMarkdown(qualityBlocks(s)), /Pack judging spend: \$2\.2500 USD/);
    const three = summarizeQuality({ groups: [...groups, { id: 'third', label: 'third', run: loadRun(run.dir), arm: 'third' }], tasks, pack });
    assert.equal(three.spend.usd, 2.25);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
