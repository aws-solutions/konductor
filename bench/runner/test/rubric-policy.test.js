// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const { renderAll } = require('./rubric-policy-fixture.js');

const LEGACY = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'rubric-policy-legacy.snapshot.json'), 'utf8'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const LEGACY_LINE = 'legacy: excluded runs are gaps\n\n';

function legacyOutput() {
  const root = tmp();
  try { return renderAll(root); } finally { rm(root); }
}

test('a study without the policy stamp renders as before, plus one legacy line', () => {
  const out = legacyOutput();
  assert.equal(out.md.split(LEGACY_LINE).length, 2);
  assert.equal(out.md.replace(LEGACY_LINE, ''), LEGACY.md);
  assert.deepEqual(out.json, LEGACY.json);
  assert.equal(out.compare, LEGACY.compare);
  assert.deepEqual(out.verdict, LEGACY.verdict);
});

const STAMP = 'excluded-as-failures';
const { buildStudy, DEFAULT_RUNS } = require('./rubric-policy-fixture.js');
const { makeBench, makeRun } = require('./helpers.js');
const { loadRun, loadRuns } = require('../../report/load.js');
const { loadTasks } = require('../lib/tasks.js');
const { buildReport } = require('../../report/aggregate.js');
const { renderMarkdown } = require('../../report/render.js');
const { analyze } = require('../../report/generate.js');
const { compareRuns, formatCompare } = require('../../report/compare.js');
const { runJudging, exclusionClass, exclusionClassOfReason, EXCLUSION_CLASS, RUBRIC_POLICY } = require('../../judge/run.js');
const { DEFAULT_REDACTIONS, compileRedactions } = require('../../judge/redact.js');

function stamped(opts = {}) {
  const root = tmp();
  const s = buildStudy(root, 'head', { stamp: STAMP, ...opts });
  const r = buildReport({ run: loadRun(s.dir), tasks: loadTasks(s.bench), baseline: 'vanilla' });
  return { root, ...s, ...r, md: renderMarkdown(r.report) };
}

test('the policy stamp value is shared by the judge and the report', () => {
  assert.equal(RUBRIC_POLICY, STAMP);
});

test('exclusion classes: integrity reasons count as failures, the rest are gaps', () => {
  assert.deepEqual(EXCLUSION_CLASS, { credsUnscrubbed: 'integrity', stdioTampered: 'integrity', usageDbTampered: 'integrity', infraError: 'gap', 'no workspace': 'gap' });
  assert.equal(exclusionClassOfReason(null), null);
  assert.equal(exclusionClassOfReason('something else'), null);
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const dir = makeRun(path.join(root, 'run'), bench, [
      { arm: 'a', rep: 1 }, { arm: 'a', rep: 2, flags: ['credsUnscrubbed'] }, { arm: 'a', rep: 3, flags: ['stdioTampered'] }, { arm: 'a', rep: 4, flags: ['usageDbTampered'] },
      { arm: 'a', rep: 5, status: 'error', infraError: 'x' }, { arm: 'a', rep: 6, status: 'budget_skipped' }, { arm: 'a', rep: 7, flags: ['snapshotFailed'] },
    ]);
    const byRep = Object.fromEntries(loadRun(dir).runs.map((r) => [r.replicate, exclusionClass(r)]));
    assert.deepEqual(byRep, { 1: null, 2: 'integrity', 3: 'integrity', 4: 'integrity', 5: 'gap', 6: 'gap', 7: 'gap' });
  } finally { rm(root); }
});

test('stamped: an integrity-excluded run counts as 0 in rubricAll and is absent from rubricJudged; infraError stays a gap', () => {
  const s = stamped();
  try {
    const v1 = s.report.arms.v1.overall;
    const vanilla = s.report.arms.vanilla.overall;
    assert.equal(s.report.rubricPolicy, STAMP);
    assert.deepEqual(v1.rubricJudged, { n: 2, mean: 0.875, meanRaw: 0.875 });
    assert.deepEqual(v1.rubricAll, { n: 4, mean: 0.4375, meanRaw: 0.4375 });
    assert.equal(v1.excludedCount, 2);
    assert.deepEqual(vanilla.rubricAll, vanilla.rubricJudged);
    assert.equal(vanilla.excludedCount, 0);
    assert.equal(vanilla.rubricJudged.n, 3);
    assert.deepEqual([...s.series.v1.overall.rubricScore].sort((x, y) => x - y), [0, 0, 0.75, 1]);
    assert.equal(s.series.v1.overall.rubricScore.filter((x) => x === 0).length, 2);
    assert.equal(s.series.v1.overall.rubricScoreJudged.length, 2);
  } finally { rm(s.root); }
});

test('stamped: rubricJudged is the number the legacy report gave for the same data', () => {
  const s = stamped();
  try {
    for (const arm of ['vanilla', 'v1']) {
      const old = LEGACY.json.arms[arm].overall.rubric.meanOfJudges;
      assert.deepEqual(s.report.arms[arm].overall.rubricJudged, old);
      assert.deepEqual(s.report.arms[arm].overall.rubric.meanOfJudges, old);
    }
  } finally { rm(s.root); }
});

test('stamped: the table has the main column, the judged-only column and the excluded count, and no legacy line', () => {
  const s = stamped();
  try {
    assert.match(s.md, /\| rubric \(excluded runs = 0\), scored \(raw\) \| rubric \(judged runs only\), scored \(raw\) \| excluded runs \(counted as 0\) \|/);
    assert.match(s.md, /\| v1 \| 4 \|.*\| mean 0\.44 \(raw 0\.44\) over 4 run\(s\) \| j1 0\.88 \(raw 0\.88\)<br>j2 0\.88 \(raw 0\.88\)<br>mean 0\.88 \(raw 0\.88\) \| 2 \|/);
    assert.match(s.md, /\| vanilla \| 4 \|.*\| mean 0\.75 \(raw 0\.75\) over 3 run\(s\) \|.*\| 0 \|/);
    assert.ok(!s.md.includes('legacy: excluded runs are gaps'));
    assert.match(s.md, /\| credsUnscrubbed \| integrity \| counted as 0 \|/);
    assert.match(s.md, /\| infraError \| gap \| left out \|/);
    assert.match(s.md, /\| budget_skipped \| gap \|/);
    assert.match(s.md, /Not judged \(3\): vanilla\/t1\/#4 \(infraError, gap\), v1\/t1\/#3 \(credsUnscrubbed, integrity\), v1\/t1\/#4 \(usageDbTampered, integrity\)/);
  } finally { rm(s.root); }
});

test('stamped: an arm whose runs were all excluded scores 0 in the main number and has no judged-only number', () => {
  const runs = [{ arm: 'vanilla', rep: 1 }, { arm: 'vanilla', rep: 2 }, { arm: 'v1', rep: 1, flags: ['stdioTampered'] }, { arm: 'v1', rep: 2, flags: ['credsUnscrubbed'] }];
  const notJudged = [{ armId: 'v1', taskId: 't1', replicate: 1, reason: 'stdioTampered' }, { armId: 'v1', taskId: 't1', replicate: 2, reason: 'credsUnscrubbed' }];
  const s = stamped({ runs, notJudged, scores: { vanilla: { 1: 1, 2: 1 } } });
  try {
    const c = s.report.arms.v1.overall;
    assert.deepEqual(c.rubricAll, { n: 2, mean: 0, meanRaw: 0 });
    assert.deepEqual(c.rubricJudged, { n: 0, mean: null, meanRaw: null });
    assert.equal(c.excludedCount, 2);
    assert.match(s.md, /\| v1 \| 2 \|.*\| mean 0\.00 \(raw 0\.00\) over 2 run\(s\) \| j1 n\/a \(raw n\/a\)<br>j2 n\/a \(raw n\/a\)<br>mean n\/a \(raw n\/a\) \| 2 \|/);
  } finally { rm(s.root); }
});

test('stamped: a run that a judge did score is never counted as a failure, even if listed as not judged', () => {
  const s = stamped({ notJudged: [{ armId: 'vanilla', taskId: 't1', replicate: 1, reason: 'credsUnscrubbed' }] });
  try {
    assert.equal(s.report.arms.vanilla.overall.excludedCount, 0);
    assert.equal(s.report.arms.vanilla.overall.rubricAll.n, 3);
  } finally { rm(s.root); }
});

test('stamped: score rows count an integrity-excluded run as a rubric 0; judge coverage and the diligence rating do not change', () => {
  const root = tmp();
  try {
    const legacy = buildStudy(root, 'legacy', { stamp: null });
    const stampedStudy = buildStudy(root, 'stamped', { stamp: STAMP });
    const a = analyze({ run: loadRun(legacy.dir), tasks: loadTasks(legacy.bench), baseline: 'vanilla' });
    const b = analyze({ run: loadRun(stampedStudy.dir), tasks: loadTasks(stampedStudy.bench), baseline: 'vanilla' });
    const key = (r) => `${r.arm}#${r.rep}`;
    const rowOf = (x, id) => x.rows.find((r) => key(r) === id);
    assert.equal(rowOf(a, 'v1#3').rubric, null);
    assert.equal(rowOf(b, 'v1#3').rubric, 0);
    assert.equal(rowOf(b, 'v1#3').judgesUsed, 0);
    assert.equal(rowOf(b, 'vanilla#4').rubric, null);
    assert.deepEqual(b.card, a.card);
    assert.equal(b.card.criteria.find((c) => c.id === 'coverage').status, 'FAIL');
  } finally { rm(root); }
});

test('compare refuses a legacy study against a stamped one, and labels both rubric rows when both are stamped', () => {
  const root = tmp();
  try {
    const legacy = buildStudy(root, 'legacy', { stamp: null });
    const st = buildStudy(root, 'stamped', { stamp: STAMP });
    const r = compareRuns({ baseDir: legacy.dir, headDir: st.dir, benchDir: st.bench });
    assert.equal(r.exitCode, 2);
    assert.match(formatCompare(r), /rubric policy differs: base "legacy, excluded runs are gaps" vs head "excluded-as-failures"/);
    const small = [{ arm: 'vanilla', rep: 1 }, { arm: 'v1', rep: 1 }, { arm: 'v1', rep: 2, flags: ['stdioTampered'] }];
    const nj = [{ armId: 'v1', taskId: 't1', replicate: 2, reason: 'stdioTampered' }];
    const base = buildStudy(root, 'base', { stamp: STAMP, runs: small, notJudged: nj, scores: { vanilla: { 1: 0.5 }, v1: { 1: 0.5 } } });
    const head = buildStudy(root, 'head', { stamp: STAMP, runs: small, notJudged: nj, scores: { vanilla: { 1: 0.5 }, v1: { 1: 1 } } });
    const ok = compareRuns({ baseDir: base.dir, headDir: head.dir, benchDir: head.bench, minRel: 0.01 });
    assert.equal(ok.refusals.length, 0);
    const rows = ok.improvements.filter((x) => x.arm === 'v1' && x.scope === 'overall');
    assert.deepEqual(rows.map((x) => [x.metric, x.base, x.head]), [['rubricScore (excluded runs = 0)', 0.25, 0.5], ['rubricScore (judged runs only)', 0.5, 1]]);
  } finally { rm(root); }
});

test('two judged directories merge into a stamped study only when every one is stamped', () => {
  const root = tmp();
  try {
    const a = buildStudy(root, 'a', { stamp: STAMP });
    const b = buildStudy(root, 'b', { stamp: STAMP });
    const c = buildStudy(root, 'c', { stamp: null });
    assert.equal(loadRuns([a.dir, b.dir]).judgments.rubricPolicy, STAMP);
    assert.equal(loadRuns([a.dir, c.dir]).judgments.rubricPolicy, undefined);
    assert.equal(loadRuns([c.dir, a.dir]).judgments.rubricPolicy, undefined);
  } finally { rm(root); }
});

function judgeFixture(specs) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, specs);
  const caller = async ({ prompt }) => ({ text: JSON.stringify({ criteria: [...prompt.matchAll(/^- id: (\S+)/gm)].map((m) => ({ id: m[1], verdict: 'pass', evidence: 'a.txt' })) }), credits: 0.1, latencyMs: 10 });
  const common = {
    runDir, benchDir: bench, judges: ['gpt-test'], modes: ['rubric'], baseline: 'vanilla', concurrency: 1, budgetCredits: null, caller,
    limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {},
  };
  return { root, runDir, common };
}

test('judging a new study writes the stamp; judging more into a legacy file leaves it unstamped', async () => {
  const f = judgeFixture([{ arm: 'vanilla', rep: 1 }, { arm: 'vanilla', rep: 2, flags: ['credsUnscrubbed'] }]);
  try {
    const first = await runJudging(f.common);
    assert.equal(first.rubricPolicy, STAMP);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.runDir, 'judgments.json'), 'utf8')).rubricPolicy, STAMP);
    const again = await runJudging(f.common);
    assert.equal(again.rubricPolicy, STAMP);
    const file = path.join(f.runDir, 'judgments.json');
    const legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete legacy.rubricPolicy;
    fs.writeFileSync(file, JSON.stringify(legacy));
    const more = await runJudging(f.common);
    assert.equal(more.rubricPolicy, undefined);
    assert.equal('rubricPolicy' in JSON.parse(fs.readFileSync(file, 'utf8')), false);
  } finally { rm(f.root); }
});

test('a study judged by the new code reports the integrity run as a failure end to end', async () => {
  const f = judgeFixture([{ arm: 'vanilla', rep: 1 }, { arm: 'vanilla', rep: 2, flags: ['usageDbTampered'] }]);
  try {
    await runJudging(f.common);
    const { report } = buildReport({ run: loadRun(f.runDir), tasks: loadTasks(path.join(f.root, 'bench')), baseline: 'vanilla' });
    const c = report.arms.vanilla.overall;
    assert.equal(c.excludedCount, 1);
    assert.equal(c.rubricJudged.n, 1);
    assert.equal(c.rubricAll.n, 2);
    assert.equal(c.rubricAll.mean, c.rubricJudged.mean / 2);
  } finally { rm(f.root); }
});

test('the full report page carries the policy: the main/judged columns and a note when stamped, the legacy line when not', () => {
  const { generateRunReport } = require('../../report/generate.js');
  const root = tmp();
  try {
    for (const [name, stamp] of [['legacy', null], ['stamped', STAMP]]) {
      const s = buildStudy(root, name, { stamp });
      const out = path.join(root, `out-${name}`);
      generateRunReport({ run: loadRun(s.dir), tasks: loadTasks(s.bench), baseline: 'vanilla', out, detail: 'full', format: 'md', defaultDir: out });
      const md = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
      const json = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
      if (stamp) {
        assert.match(md, /Rubric policy: a run kept out of judging for an integrity reason/);
        assert.match(md, /rubric \(judged runs only\), scored \(raw\)/);
        assert.ok(!md.includes('legacy: excluded runs are gaps'));
        assert.equal(JSON.stringify(json).includes('"rubricAll"'), true);
      } else {
        assert.equal(md.split('legacy: excluded runs are gaps').length, 2);
        assert.ok(!md.includes('judged runs only'));
        assert.equal(JSON.stringify(json).includes('rubricAll'), false);
      }
    }
  } finally { rm(root); }
});

test('explain says an integrity-excluded run counts as a failure in a stamped study, and keeps the old wording in a legacy one', () => {
  const { explainRuns } = require('../../report/explain.js');
  const root = tmp();
  try {
    const legacy = buildStudy(root, 'legacy', { stamp: null });
    const st = buildStudy(root, 'stamped', { stamp: STAMP });
    const filter = { arm: 'v1', rep: 3 };
    const text = (s) => explainRuns({ dir: s.dir, tasks: loadTasks(s.bench), filter });
    assert.match(text(st), /kept out of judging for an integrity reason: counted as a failure, 0 on every item/);
    assert.match(text(legacy), /no rubric records for this run \(not judged\): component dropped from the score/);
  } finally { rm(root); }
});

test('compare of a judged study with an unjudged one does not add a rubric policy line to the refusal', () => {
  const root = tmp();
  try {
    const judged = buildStudy(root, 'judged', { stamp: STAMP });
    const plainBench = makeBench(path.join(root, 'plain-bench'));
    const plain = makeRun(path.join(root, 'plain'), plainBench, DEFAULT_RUNS);
    const r = compareRuns({ baseDir: plain, headDir: judged.dir, benchDir: judged.bench });
    assert.equal(r.exitCode, 2);
    assert.ok(r.refusals.some((x) => x.startsWith('judge set differs')));
    assert.ok(!r.refusals.some((x) => x.startsWith('rubric policy')));
  } finally { rm(root); }
});
