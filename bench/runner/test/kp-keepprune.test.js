// SPDX-License-Identifier: Apache-2.0
// cap keep-prune, end to end on the stub provider (no model, no credentials, no spend): the convention control shows
// its known effect, the dose ladder shows rising harm, a real skill gets a record with both depths, a label, a
// suggested verdict and an empty sign-off. Then the gates around the copied rules: SR-24, SR-25, stale judgments, the
// deep A/A rule, the setup checks, the record's version and staleness, and the record cap decide writes.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadBaseline, loadConvention, loadDoseLadder } = require('../../cap/frozen.js');
const kp = require('../../cap/keepprune.js');
const rec = require('../../cap/kprecord.js');
const { runKeepPrune, STUB_JUDGES, STUB_SUBJECT_MODEL } = require('../../cap/kprun.js');
const { createStubProvider } = require('../../cap/stubprovider.js');
const { LABELS, VERDICTS } = require('../../cap/labels.js');

const REPO = path.resolve(__dirname, '..', '..', '..');
const PILOT = 'plan-review';
const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const ladder = loadDoseLadder();
const stub = createStubProvider({ ladder });
const seats = [...STUB_JUDGES];
const pilot = () => loadBaseline({ name: PILOT, skillFile: path.join(REPO, 'skills', PILOT, 'SKILL.md') });
const depthCheck = (over = {}) => kp.checkDepth({ depth: 'quick', subject: pilot(), convention: loadConvention(), ladder, provider: stub, subjectModel: STUB_SUBJECT_MODEL, judges: STUB_JUDGES, ...over });

test('the convention control comes out with its known effect at both depths: B gains, A contains 0', () => {
  for (const depth of ['quick', 'deep']) {
    const s = kp.checkSubject({ subject: loadConvention(), depth, provider: stub, seats, store: kp.judgmentStore(null), subjectModel: STUB_SUBJECT_MODEL });
    assert.equal(s.tasks, 8);
    assert.equal(s.A.tasks_counted, 8);
    assert.ok(s.B.t_interval_exact[0] > 0, `${depth}: B lower end ${s.B.t_interval_exact[0]} is above 0`);
    assert.ok(s.A.t_interval_exact[0] <= 0 && s.A.t_interval_exact[1] >= 0, `${depth}: A ${s.A.t_interval} contains 0`);
  }
});

test('the dose ladder shows the judges reading rising harm: D0 contains 0 and the gap falls from D1 to D4', () => {
  const doses = kp.checkLadder({ ladder, provider: stub, seats, store: kp.judgmentStore(null) });
  const means = Object.fromEntries(doses.map((d) => [d.dose, d.summary.A.mean_gap]));
  assert.ok(means.D1 > means.D2 && means.D2 > means.D4, JSON.stringify(means));
  const d0 = doses[0].summary.A.t_interval_exact;
  assert.ok(d0[0] <= 0 && d0[1] >= 0);
  const { evaluateLadder } = require('../../cap/passrules.js');
  assert.equal(evaluateLadder(doses).status, 'PASS');
});

test('one real skill, both depths: one record with a label, a suggested verdict, both controls passed and an empty sign-off', (t) => {
  const out = tmp(t);
  const { record, file } = runKeepPrune({ name: PILOT, repo: REPO, runId: 'stub-pilot', outDir: out });
  assert.deepEqual(rec.recordProblems(record), []);
  assert.equal(record.schema, 'keep-prune-record/1');
  for (const depth of ['quick', 'deep']) {
    const b = record[depth];
    assert.ok(Object.values(LABELS).includes(b.label), `${depth} label ${b.label}`);
    assert.ok(Object.values(VERDICTS).includes(b.verdict), `${depth} verdict ${b.verdict}`);
    assert.equal(b.controls.passed, true);
    assert.deepEqual(b.controls.ran, ['convention-control', 'dose-ladder']);
    assert.deepEqual(b.judges.map((j) => j.family), ['deepseek', 'glm', 'grok']);
    assert.equal(b.subject.family, 'claude');
    assert.equal(b.coverage.tasksTotal, 16);
  }
  assert.equal(record.deep.coverage.runsPerSide, kp.DEFAULT_REPLICATES);
  assert.deepEqual(record.signoff, { by: null, date: null, decision: null, note: null });
  assert.equal(record.rules.labelRulesDate, '2026-11-10');
  assert.equal(record.rules.verdictRulesDate, '2026-11-16');
  assert.deepEqual(rec.readRecord(file).stale, { value: false, why: null });
  assert.ok(fs.existsSync(file.replace(/\.json$/, '.md')));
});

test('a stub run needs a stub- run id, and phase A has no live provider', (t) => {
  const out = tmp(t);
  assert.throws(() => runKeepPrune({ name: PILOT, repo: REPO, runId: 'pilot', outDir: out }), /stub-/);
  assert.throws(() => runKeepPrune({ name: PILOT, repo: REPO, runId: 'stub-x', outDir: out, provider: 'live' }), /only the stub provider/);
});

test('SR-24 at both depths: an agent of unknown family is unjudged and NO DATA, never a pass', () => {
  for (const depth of ['quick', 'deep']) {
    const r = depthCheck({ depth, subjectModel: 'auto' });
    assert.equal(r.entry.label, LABELS.noData);
    assert.equal(r.entry.verdict, VERDICTS.noData);
    assert.match(r.entry.no_data[0], /unjudged, never a pass \(SR-24\)/);
    assert.equal(r.controls.trusted, false, 'unjudged controls are NOT RUN, so the run is not trusted');
    const block = rec.blockFromCheck(r, { replicates: 3 });
    assert.match(block.unjudged, /SR-24/);
    assert.deepEqual(block.judges, []);
  }
});

test('SR-24: a Claude agent never gets a Claude judge seat; with only one other family no task counts', () => {
  const r = depthCheck({ judges: ['claude-opus-5', 'deepseek-v3.2'] });
  const block = rec.blockFromCheck(r, {});
  assert.deepEqual(block.judges.map((j) => j.model), ['deepseek-v3.2']);
  assert.match(block.judgesRefused[0].why, /own family/);
  assert.equal(r.entry.label, LABELS.noData, 'one seat is under the 2 seats a task needs');
  assert.ok(r.entry.no_data.some((x) => /counts 0 of the skill's 16 tasks/.test(x)));
});

test('SR-25: a run whose control fails or includes no control gives no verdict', () => {
  const none = depthCheck({ convention: null, ladder: null });
  assert.equal(none.entry.verdict, VERDICTS.noData);
  assert.match(none.entry.no_data[0], /includes no control.*SR-25/);
  // A convention control whose with arm never loads its skill has no usable task, so it is NOT RUN, not a pass.
  const broken = { ...createStubProvider({ ladder }), answer: (a) => ({ ...stub.answer(a), loaded: false }) };
  const r = depthCheck({ provider: broken });
  assert.equal(r.entry.verdict, VERDICTS.noData);
  assert.match(r.entry.no_data[0], /convention-control NOT RUN.*SR-25/);
});

test('a stale judgment is refused, never read, until it is made again with rejudge', (t) => {
  const store = kp.judgmentStore(tmp(t));
  const base = pilot();
  const args = { depth: 'quick', subject: base, provider: stub, seats, store, subjectModel: STUB_SUBJECT_MODEL };
  assert.equal(kp.checkSubject(args).A.judgments.stale, 0);
  const edited = { ...base, skill: { ...base.skill, text: `${base.skill.text}\nAlso write \`extra-mark\`.\n` } };
  const stale = kp.checkSubject({ ...args, subject: edited });
  assert.ok(stale.A.judgments.stale > 0);
  assert.equal(stale.A.tasks_counted, 0);
  const { labelSkill } = require('../../cap/labels.js');
  const entry = labelSkill({ summary: stale, batches: base.batches.map((b) => b.batch) });
  assert.ok(entry.no_data.some((x) => /stale judgment/.test(x)));
  const again = kp.checkSubject({ ...args, subject: edited, rejudge: true });
  assert.equal(again.A.judgments.stale, 0);
  assert.equal(again.A.tasks_counted, 16);
});

test('a with arm that never loads is not counted; a without arm that loads is a setup fault', () => {
  const never = { ...stub, answer: (a) => ({ ...stub.answer(a), loaded: false }) };
  const s1 = kp.checkSubject({ subject: pilot(), depth: 'quick', provider: never, seats, store: kp.judgmentStore(null), subjectModel: STUB_SUBJECT_MODEL });
  assert.deepEqual(s1.status, { counted: 0, not_loaded: 16, setup_fault: 0 });
  assert.equal(s1.A.tasks_counted, 0);
  const leaky = { ...stub, answer: (a) => ({ ...stub.answer(a), loaded: true }) };
  const s2 = kp.checkSubject({ subject: pilot(), depth: 'quick', provider: leaky, seats, store: kp.judgmentStore(null), subjectModel: STUB_SUBJECT_MODEL });
  assert.equal(s2.status.setup_fault, 16);
});

test('a baseline made from another SKILL.md reads A alone, and an edited frozen file is refused', (t) => {
  const dir = tmp(t);
  const skillFile = path.join(dir, 'SKILL.md');
  fs.writeFileSync(skillFile, '# changed skill\n');
  const b = loadBaseline({ name: PILOT, skillFile });
  assert.deepEqual(b.bWaiting, ['rules-b6', 'rules-c5']);
  assert.match(b.staleWhy, /reading B waits/);
  const r = kp.checkDepth({ depth: 'quick', subject: b, convention: loadConvention(), ladder, provider: stub, subjectModel: STUB_SUBJECT_MODEL, judges: STUB_JUDGES, bWaiting: b.bWaiting });
  assert.equal(r.summary.B.tasks, 0);
  assert.ok([LABELS.helps, LABELS.harm, LABELS.noData].includes(r.entry.label), 'with B waiting only A can label');
  const copy = path.join(dir, 'baselines');
  fs.cpSync(path.join(REPO, 'bench', 'cap', 'baselines'), copy, { recursive: true });
  fs.appendFileSync(path.join(copy, PILOT, 'rules.json'), ' ');
  assert.throws(() => loadBaseline({ name: PILOT, skillFile, dir: copy }), /differs from its hash/);
});

test('deep rule: NO DATA inside the A/A spread or with no A/A interval', () => {
  const A = { mean_gap: 0.1 };
  assert.equal(kp.deepNoData(A, null), null);
  assert.match(kp.deepNoData(A, { t_interval_exact: null, tasks_counted: 1 }), /deep rule 1/);
  assert.match(kp.deepNoData(A, { t_interval_exact: [-0.2, 0.3], mean_gap: -0.15 }), /inside the A\/A spread.*deep rule 2/);
  assert.equal(kp.deepNoData({ mean_gap: 0.4 }, { t_interval_exact: [-0.2, 0.3], mean_gap: 0.05 }), null);
  assert.match(kp.DEEP_RULES, /written before any paid deep run/);
  assert.equal(kp.DEEP_RULES_DATE, '2026-11-17');
});

test('quick and deep disagreeing are kept side by side, never averaged', () => {
  const r = depthCheck();
  const quick = rec.blockFromCheck(r, {});
  const deep = { ...rec.blockFromCheck({ ...r, depth: 'deep', summary: { ...r.summary, aa: null } }, { replicates: 3 }), verdict: VERDICTS.keep, label: LABELS.helps };
  const record = rec.buildRecord({ skill: { name: PILOT, sha256: null }, quick, deep });
  assert.equal(record.agree, false);
  assert.equal(record.quick.verdict, quick.verdict);
  assert.equal(record.deep.verdict, VERDICTS.keep);
  assert.equal('verdict' in record, false, 'there is no combined verdict');
  assert.match(rec.renderRecord(record), /NO: the verdicts differ, a person decides/);
  assert.equal(rec.buildRecord({ skill: { name: PILOT }, quick }).agree, null);
});

test('readers refuse an unknown major, and a record made under other rules or another SKILL.md is stale', (t) => {
  const dir = tmp(t);
  const record = rec.buildRecord({ skill: { name: PILOT, sha256: 'a'.repeat(64) }, quick: rec.blockFromCheck(depthCheck(), {}) });
  const file = rec.writeRecord(path.join(dir, 'r.json'), record);
  fs.writeFileSync(path.join(dir, 'v2.json'), JSON.stringify({ ...record, schema: 'keep-prune-record/2' }));
  assert.throws(() => rec.readRecord(path.join(dir, 'v2.json')), /major version 2 is unknown/);
  assert.match(rec.readRecord(file, { skillSha256: 'b'.repeat(64) }).stale.why, /SKILL.md changed/);
  fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify({ ...record, rules: { ...record.rules, sha256: 'c'.repeat(64) } }));
  assert.match(rec.readRecord(path.join(dir, 'old.json')).stale.why, /made under other rules/);
  assert.throws(() => rec.writeRecord(path.join(dir, 'bad.json'), { ...record, signoff: { by: 'x' } }), /missing required/);
});

test('cap decide writes a record beside each call: deep block NO DATA until the readings are wired, the call kept', () => {
  const decision = { skill: 'skill:x', name: 'x', decision: 'KEEP', confidence: 'medium', reasons: ['removing the skill lost 20 points'], aaSpread: 0.02, evidence: { del: { nHead: 15, nBase: 15, credits: { delta: 1.2 } } } };
  const deep = rec.blockFromDecision(decision, { model: 'claude-sonnet-5.5', controlsTrusted: true, replicates: 5 });
  const record = rec.buildRecord({ skill: { name: 'x', sha256: null }, deep });
  assert.deepEqual(rec.recordProblems(record), []);
  assert.equal(deep.label, LABELS.noData);
  assert.equal(deep.verdict, VERDICTS.noData);
  assert.equal(deep.capCall.decision, 'KEEP');
  assert.equal(deep.coverage.runsPerSide, 15);
  assert.equal(deep.subject.family, 'claude');
  assert.equal(record.quick, null);
  assert.equal(record.agree, null);
});

test('cap decide on a full fake study writes a schema-valid record per call, its call kept in capCall', async () => {
  const { setup, fakeExec } = require('./cap-skillstudy-fake.js');
  const { runStudy } = require('../../cap/skillstudy.js');
  const s = setup();
  try {
    const { exec } = fakeExec({ quality: { del: 0.3, rm2: 0.3, rm3: 0.3, mv3: 0.3 } });
    const r = await runStudy({ studyDir: s.studyDir, exec, log: () => {} });
    for (const d of r.decisions) {
      const record = rec.readRecord(path.join(s.studyDir, 'decisions', 'records', `${d.name}.json`));
      assert.equal(record.deep.capCall.decision, d.decision);
      assert.equal(record.deep.label, LABELS.noData);
      assert.equal(record.signoff.by, null);
    }
  } finally { s.e.done(); }
});

test('SR-26: a judge call carries the seat, the checklist and the answer, never the arm or the skill name', () => {
  const calls = [];
  const recording = { ...stub, judge: (input) => { calls.push(input); return stub.judge(input); } };
  kp.checkSubject({ subject: loadConvention(), depth: 'deep', provider: recording, seats, store: kp.judgmentStore(null), subjectModel: STUB_SUBJECT_MODEL, replicates: 2 });
  assert.ok(calls.length > 0);
  for (const c of calls) {
    assert.deepEqual(Object.keys(c).sort(), ['answer', 'checklist', 'seat', 'taskId']);
    assert.equal(c.answer.includes('convention-control'), false);
  }
});

test('every copied module names Michael Lin, its pull request and commit on line 2, and the rule dates are his', () => {
  const cap = path.join(REPO, 'bench', 'cap');
  for (const f of ['gapstats.js', 'labels.js', 'gaptext.js', 'doseladder.js', 'passrules.js', 'stubprovider.js']) {
    const [first, second] = fs.readFileSync(path.join(cap, f), 'utf8').split('\n');
    assert.equal(first, '// SPDX-License-Identifier: Apache-2.0', f);
    assert.match(second, /Michael Lin's .*pull request #\d+.*commit [0-9a-f]{8}/, f);
  }
  const { LABEL_RULES_DATE, VERDICT_RULES_DATE, MIN_COUNTED, PER_TASKS } = require('../../cap/labels.js');
  assert.deepEqual([LABEL_RULES_DATE, VERDICT_RULES_DATE, MIN_COUNTED, PER_TASKS], ['2026-11-10', '2026-11-16', 12, 16]);
  assert.equal(require('../../cap/passrules.js').PASS_RULES_DATE, '2026-11-10');
});
