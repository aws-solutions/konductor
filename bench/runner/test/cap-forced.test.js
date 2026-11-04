// SPDX-License-Identifier: Apache-2.0
'use strict';

// The forced-load arm: the instruction per harness, the summary, and wave 1f of the skill study run by a fake bench.js.
// No model, no credits, no kiro-cli and no opencode. The forced arm must never change a call or an evidence row.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const F = require('../../cap/forced.js');
const { runStudy, decideStudy, studyStatus } = require('../../cap/skillstudy.js');
const { setup, fakeExec } = require('./cap-skillstudy-fake.js');
const { makeCapRepo, makeCapBench } = require('./cap-helpers.js');
const { mkScratch } = require('./scratch.js');
const { parseArgs } = require('../bench.js');
const { checkArgs } = require('../lib/cli-flags.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const runsOf = (calls) => calls.filter((a) => a[0] === 'run');
const flag = (argv, name) => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
const armsOf = (argv) => flag(argv, 'arms').split(',').map((a) => a.slice(0, a.indexOf('=')));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const cliEnv = (root) => { const home = path.join(root, 'h'); fs.mkdirSync(home, { recursive: true }); return { PATH: process.env.PATH, HOME: home, TMPDIR: root }; };
const withoutForced = (ds) => ds.map(({ forced, ...rest }) => rest);

// ---- the instruction ----

test('the forced instruction names the skill once and the harness tool, with no dashes', () => {
  const k = F.forcedPrefix({ name: 'backend-review', harness: 'kiro-cli' });
  const o = F.forcedPrefix({ name: 'backend-review', harness: 'opencode' });
  assert.match(k, /load the skill named "backend-review" with the get_skill tool/);
  assert.match(o, /load the skill named "backend-review" with the skill tool/);
  for (const t of [k, o]) {
    assert.equal(t.split('backend-review').length - 1, 1);
    assert.doesNotMatch(t, /[–—]/);
    assert.doesNotMatch(t, /\n/);
  }
  assert.throws(() => F.forcedPrefix({ name: 'x', harness: 'claude' }), /kiro-cli and opencode/);
  assert.throws(() => F.forcedPrefix({ name: 'a b' }), /not a skill name/);
});

test('--forced-load takes low-load or always, and low-load runs only under the load floor', () => {
  assert.equal(F.checkMode(undefined), null);
  assert.equal(F.checkMode('always'), 'always');
  assert.throws(() => F.checkMode(true), /low-load or always/);
  assert.throws(() => F.checkMode('sometimes'), /low-load or always/);
  assert.equal(F.forcedWanted(null, 0, 0.3).run, false);
  assert.equal(F.forcedWanted('always', 1, 0.3).run, true);
  assert.equal(F.forcedWanted('always', null, 0.3).run, true);
  assert.equal(F.forcedWanted('low-load', 0.29, 0.3).run, true);
  assert.equal(F.forcedWanted('low-load', 0.3, 0.3).run, false);
});

test('fail closed: low-load with an unknown load rate does not run the forced wave, and says why', () => {
  for (const rate of [null, undefined, NaN]) {
    const w = F.forcedWanted('low-load', rate, 0.3);
    assert.equal(w.run, false);
    assert.match(w.reason, /load rate is unknown/);
  }
});

test('the filler for the delete arm has the length of the forced instruction and names no skill or tool', () => {
  for (const name of ['a', 'backend-review', 'legacy-to-agentic-estimate', 'x'.repeat(60)]) {
    for (const harness of F.HARNESSES) {
      const p = F.forcedPrefix({ name, harness });
      const f = F.forcedFiller(p.length);
      assert.equal(f.length, p.length, `${name} ${harness}`);
      assert.equal(f, f.trim(), 'no leading or trailing space for the runner to strip');
      assert.ok(!f.includes(name) || name.length < 3, `${name} in the filler`);
      assert.doesNotMatch(f, /skill|tool|get_skill|load/i);
      assert.doesNotMatch(f, /[–—\n]/);
    }
  }
  const { promptFor } = require('../lib/arm-opts.js');
  const task = { prompt: 'Do the task.' };
  const p = F.forcedPrefix({ name: 'alpha' });
  const forced = promptFor({ prefixText: `${p}\n` }, task);
  const filled = promptFor({ prefixText: `${F.forcedFiller(p.length)}\n` }, task);
  assert.equal(forced.length, filled.length);
  assert.equal(forced.indexOf('\n\nDo the task.'), filled.indexOf('\n\nDo the task.'), 'the task starts at the same place');
  assert.throws(() => F.forcedFiller(10), /at least 40/);
});

test('--forced-held-min takes a share above 0 and at most 1', () => {
  assert.equal(F.checkHeldMin(undefined), null);
  assert.equal(F.checkHeldMin('0.8'), 0.8);
  for (const bad of [true, '0', '1.5', 'x']) assert.throws(() => F.checkHeldMin(bad), /share above 0/);
});

// ---- the summary ----

const arm = (scores, loaded = true) => ({ scores, credits: scores.map(() => 4), loaded: scores.map(() => loaded), runs: scores.length, timeouts: 0, excluded: {}, components: {} });
const spread = (v, n = 16) => Array.from({ length: n }, (_, i) => Math.max(0, Math.min(1, v + (i % 2 ? 0.02 : -0.02))));

test('a forced arm that loads, against a delete that loses, reads "helps when it loads" and is never used for a call', () => {
  const s = F.forcedSummary({ arms: { frc: arm(spread(0.8)), 'frc-b': arm(spread(0.8)), del: arm(spread(0.4), false) }, organic: { loaded: 1, of: 16, rate: 1 / 16 } });
  assert.equal(s.usedForCall, false);
  assert.equal(s.arm, 'forced-load');
  assert.equal(s.status, 'lost');
  assert.equal(s.held, true);
  assert.deepEqual(s.forcedLoad, { loaded: 32, of: 32, rate: 1 });
  assert.match(s.reading, /helps when it loads/);
  assert.equal(s.fixDescription, true);
  assert.match(s.notes.join(' '), /forced load helps; fix the description/);
});

test('the forced comparisons are a Bonferroni family: a gap that is "helps" alone can be unclear in a family of 20', () => {
  const tight = (v) => Array.from({ length: 16 }, (_, i) => v + [-0.12, 0.12, -0.04, 0.04][i % 4]);
  const arms = { frc: arm(tight(0.8)), 'frc-b': arm(tight(0.8)), del: arm(tight(0.71), false) };
  const one = F.forcedSummary({ arms, comparisons: 1 });
  const many = F.forcedSummary({ arms, comparisons: 20 });
  assert.equal(one.comparison.level, 0.95);
  assert.equal(many.comparison.level, 1 - 0.05 / 20);
  assert.ok(many.comparison.ci.lo < one.comparison.ci.lo && many.comparison.ci.hi > one.comparison.ci.hi, 'the family interval is wider');
  assert.equal(one.status, 'lost');
  assert.notEqual(many.status, 'lost');
});

test('the held bar is configurable', () => {
  const half = (n = 16) => Array.from({ length: n }, (_, i) => i % 5 !== 0);
  const a = { ...arm(spread(0.8)), loaded: half() };
  const arms = { frc: a, 'frc-b': a, del: arm(spread(0.4), false) };
  assert.equal(F.forcedSummary({ arms }).held, false);
  assert.equal(F.forcedSummary({ arms, heldMin: 0.75 }).held, true);
});

test('forcing that did not hold is flagged, and a missing A/A repeat is noted', () => {
  const s = F.forcedSummary({ arms: { frc: arm(spread(0.8), false), del: arm(spread(0.8), false) } });
  assert.equal(s.held, false);
  assert.match(s.notes.join(' '), /loaded in 0 of 16 forced runs/);
  assert.match(s.notes.join(' '), /no A\/A repeat/);
  assert.equal(F.forcedSummary({ arms: {} }).status, 'unclear');
});

// ---- wave 1f in the study ----

test('low-load: a skill that never loads in wave 1 gets wave 1f with the prefix on frc and frc-b only, and its call is unchanged', async () => {
  const plain = setup();
  const forced = setup();
  try {
    const q = { unloaded: ['ctl', 'ctl-b'], quality: { del: 0.3 } };
    const a = fakeExec(q);
    await runStudy({ studyDir: plain.studyDir, exec: a.exec, log: () => {} });
    const b = fakeExec(q);
    const r = await runStudy({ studyDir: forced.studyDir, exec: b.exec, log: () => {}, overrides: { forcedLoad: 'low-load' } });

    const fr = runsOf(b.calls).find((x) => armsOf(x).includes('frc'));
    assert.ok(fr, 'a forced run was made');
    assert.deepEqual(armsOf(fr), ['frc', 'frc-b', 'del']);
    assert.match(flag(fr, 'out'), /skills\/sectioned\/w1f$/);
    const pre = Object.fromEntries(flag(fr, 'arm-prefix').split(',').map((x) => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]));
    assert.deepEqual(Object.keys(pre), ['frc', 'frc-b', 'del']);
    assert.equal(pre.frc, pre['frc-b']);
    const forcedText = fs.readFileSync(pre.frc, 'utf8');
    const fillerText = fs.readFileSync(pre.del, 'utf8');
    assert.match(forcedText, /load the skill named "sectioned" with the get_skill tool/);
    assert.equal(fillerText.length, forcedText.length);
    assert.doesNotMatch(fillerText, /sectioned|skill/);
    assert.ok(runsOf(b.calls).filter((x) => !armsOf(x).includes('frc')).every((x) => flag(x, 'arm-prefix') === null), 'no other run carries a prefix');
    const judge = b.calls.find((x) => x[0] === 'judge' && /w1f$/.test(flag(x, 'run')));
    assert.ok(judge);
    assert.equal(flag(judge, 'baseline'), 'frc');

    const armsFile = readJson(path.join(forced.studyDir, 'skills/sectioned/w1f.arms.json'));
    assert.equal(armsFile.forced.usedForCall, false);
    assert.equal(armsFile.forced.harness, 'kiro-cli');
    assert.deepEqual(Object.keys(armsFile.forced.prefixes), ['frc', 'frc-b', 'del']);

    // The call and the evidence rows do not depend on the forced wave.
    const dPlain = readJson(path.join(plain.studyDir, 'decisions/decisions.json')).decisions;
    const dForced = readJson(path.join(forced.studyDir, 'decisions/decisions.json')).decisions;
    assert.deepEqual(withoutForced(dForced).map((d) => [d.name, d.decision, d.reasons]), withoutForced(dPlain).map((d) => [d.name, d.decision, d.reasons]));
    const sec = r.decisions.find((d) => d.name === 'sectioned');
    assert.equal(sec.decision, 'NEEDS DATA');
    assert.equal(sec.forced.usedForCall, false);
    assert.equal(sec.forced.status, 'lost');
    assert.deepEqual(readJson(path.join(forced.studyDir, 'decisions/evidence.json')), readJson(path.join(plain.studyDir, 'decisions/evidence.json')));
    assert.ok(readJson(path.join(forced.studyDir, 'decisions/evidence.json')).every((row) => !/forced/i.test(row.note)));

    const md = fs.readFileSync(path.join(forced.studyDir, 'decisions/decisions.md'), 'utf8');
    assert.match(md, /## Forced-load arm \(reported apart, never used for a call\)/);
    assert.match(md, /\| sectioned \| 0 of 16 \(0%\) \| 32 of 32 \(100%\) \| lost \|/);
    assert.match(md, /Remaining confound: the two instructions differ in text/);
    assert.match(md, /extra turn loading the skill/);
    assert.match(md, /forced load helps; fix the description/);
    assert.match(md, /own family of 1/);
    assert.doesNotMatch(fs.readFileSync(path.join(plain.studyDir, 'decisions/decisions.md'), 'utf8'), /Forced-load arm/);

    const st = studyStatus(forced.studyDir);
    assert.match(st, /w1f done \(forced load, reported apart\)/);
    const count = (t) => /waves done: (\d+\/\d+)/.exec(t)[1];
    assert.equal(count(st), count(studyStatus(plain.studyDir)), 'the forced wave is not counted as a wave');
  } finally { plain.e.done(); forced.e.done(); }
});

test('low-load skips wave 1f when the skill loaded in wave 1 and says why; always runs it anyway', async () => {
  const low = setup();
  const all = setup();
  try {
    const a = fakeExec({});
    await runStudy({ studyDir: low.studyDir, exec: a.exec, log: () => {}, overrides: { forcedLoad: 'low-load' } });
    assert.equal(runsOf(a.calls).some((x) => armsOf(x).includes('frc')), false);
    assert.match(fs.readFileSync(path.join(low.studyDir, 'skills/sectioned/w1f.skipped'), 'utf8'), /100% of wave 1 control runs, at or over the 30% floor/);
    assert.match(studyStatus(low.studyDir), /w1f skipped/);
    const b = fakeExec({});
    await runStudy({ studyDir: all.studyDir, exec: b.exec, log: () => {}, overrides: { forcedLoad: 'always' } });
    assert.equal(runsOf(b.calls).filter((x) => armsOf(x).includes('frc')).length, 1);
  } finally { low.e.done(); all.e.done(); }
});

test('without --forced-load nothing changes: no forced run and no forced section', async () => {
  const s = setup();
  try {
    const { exec, calls } = fakeExec({ unloaded: ['ctl', 'ctl-b'] });
    const r = await runStudy({ studyDir: s.studyDir, exec, log: () => {} });
    assert.equal(runsOf(calls).some((x) => armsOf(x).includes('frc')), false);
    assert.equal(fs.existsSync(path.join(s.studyDir, 'skills/sectioned/w1f.skipped')), false);
    assert.ok(r.decisions.every((d) => d.forced === undefined));
  } finally { s.e.done(); }
});

test('a forced wave whose isolation gate failed is not read and is rerun on resume', async () => {
  const s = setup();
  try {
    const bad = fakeExec({ unloaded: ['ctl', 'ctl-b'], summary: { isolationGate: { ok: false } } });
    const r = await runStudy({ studyDir: s.studyDir, exec: bad.exec, log: () => {}, overrides: { forcedLoad: 'low-load' } });
    assert.ok(r.stopped, 'a wave that fails its gate stops the study');
    assert.equal(decideStudy({ studyDir: s.studyDir }).decisions.find((d) => d.name === 'sectioned').forced, undefined);
    const good = fakeExec({ unloaded: ['ctl', 'ctl-b'] });
    await runStudy({ studyDir: s.studyDir, exec: good.exec, log: () => {}, overrides: { forcedLoad: 'low-load' } });
    assert.ok(runsOf(good.calls).some((x) => armsOf(x).includes('frc')));
    assert.ok(decideStudy({ studyDir: s.studyDir }).decisions.find((d) => d.name === 'sectioned').forced);
  } finally { s.e.done(); }
});

test('a dry run says when wave 1f would run and calls nothing', async () => {
  const s = setup();
  try {
    const lines = [];
    const { exec, calls } = fakeExec();
    await runStudy({ studyDir: s.studyDir, exec, log: (m) => lines.push(m), dryRun: true, overrides: { forcedLoad: 'low-load' } });
    assert.equal(calls.length, 0);
    assert.match(lines.join('\n'), /sectioned wave 1f: arms frc, frc-b, del \(forced load, reported apart, never used for a call\); runs only if the skill loaded in under 30%/);
  } finally { s.e.done(); }
});

test('cap skill-study accepts --forced-load and rejects a bad value', () => {
  assert.equal(checkArgs('cap', parseArgs(['skill-study', '--study', 'd', '--forced-load', 'low-load'])), null);
  const root = mkScratch('capforced-');
  try {
    const r = spawnSync(process.execPath, [BENCH_JS, 'cap', 'skill-study', '--study', path.join(root, 's'), '--init', '--forced-load', 'often', '--repo-root', root, '--bench-dir', root], { encoding: 'utf8', env: cliEnv(root) });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--forced-load takes low-load or always/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- cap forced-prefix ----

test('cap forced-prefix writes the instruction for each harness into --out and refuses a non-skill', () => {
  const root = mkScratch('capforced-');
  try {
    const r0 = makeCapRepo(root, { tag: 'v0' });
    const bench = makeCapBench(root);
    const env = cliEnv(root);
    const out = path.join(root, 'out');
    for (const harness of ['kiro-cli', 'opencode']) {
      const r = spawnSync(process.execPath, [BENCH_JS, 'cap', 'forced-prefix', '--cap', 'skill:alpha', '--harness', harness, '--out', out, '--repo-root', r0.repo, '--bench-dir', bench, '--base', 'v0'], { encoding: 'utf8', env });
      assert.equal(r.status, 0, r.stderr);
      const file = path.join(out, `forced-prefix-alpha-${harness}.txt`);
      assert.equal(fs.readFileSync(file, 'utf8'), `${F.forcedPrefix({ name: 'alpha', harness })}\n`);
      assert.match(r.stdout, harness === 'opencode' ? /--arms oc-frc=REF,oc-frc-b=REF/ : /--arms frc=REF,frc-b=REF/);
    }
    const sop = spawnSync(process.execPath, [BENCH_JS, 'cap', 'forced-prefix', '--cap', 'sop:k-plan', '--out', out, '--repo-root', r0.repo, '--bench-dir', bench, '--base', 'v0'], { encoding: 'utf8', env });
    assert.equal(sop.status, 2);
    assert.match(sop.stderr, /not a skill/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- the gate, failure isolation and wave-1-only runs ----

const { waveComplete } = require('../../cap/studyio.js');
const { AFTER_WAVE1_STEP, stepLabel } = require('../../cap/skillstudy.js');

test('the gate refuses a run whose prompt prefix is not the one its arm was planned with', () => {
  const root = mkScratch('capforced-');
  try {
    const sum = (results) => fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify({ interrupted: null, isolationGate: { ok: true }, armIds: ['frc', 'del'], replicates: 1, taskIds: ['t'], results }));
    const P = { sha256: 'f'.repeat(64), bytes: 10 };
    sum([{ status: 'success', armId: 'frc', armPrefix: P }, { status: 'success', armId: 'del', armPrefix: null }]);
    const want = { arms: 2, reps: 1, tasks: 1 };
    assert.equal(waveComplete(root, { ...want, prefixes: { frc: P.sha256 } }).complete, true);
    assert.equal(waveComplete(root, want).state, 'prefix-not-in-identity:frc', 'a regular wave refuses any prefix');
    assert.equal(waveComplete(root, { ...want, prefixes: { frc: P.sha256, del: 'e'.repeat(64) } }).state, 'prefix-not-in-identity:del', 'a missing prefix is refused too');
    sum([{ status: 'success', armId: 'frc', armPrefix: { bytes: 10 } }, { status: 'success', armId: 'del', armPrefix: null }]);
    assert.equal(waveComplete(root, { ...want, prefixes: { frc: P.sha256 } }).complete, false, 'a prefix with no hash is refused');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a forced wave whose runs carry an unplanned prefix is not read, and is rerun on resume', async () => {
  const s = setup();
  try {
    const { exec } = fakeExec({ unloaded: ['ctl', 'ctl-b'] });
    await runStudy({ studyDir: s.studyDir, exec, log: () => {}, overrides: { forcedLoad: 'low-load' } });
    const sumFile = path.join(s.studyDir, 'skills/sectioned/w1f/summary.json');
    const sum = readJson(sumFile);
    sum.results = sum.results.map((r) => (r.armId === 'del' ? { ...r, armPrefix: null } : r));
    fs.writeFileSync(sumFile, JSON.stringify(sum));
    assert.equal(decideStudy({ studyDir: s.studyDir }).decisions.find((d) => d.name === 'sectioned').forced, undefined);
    const again = fakeExec({ unloaded: ['ctl', 'ctl-b'] });
    await runStudy({ studyDir: s.studyDir, exec: again.exec, log: () => {}, overrides: { forcedLoad: 'low-load' } });
    assert.equal(runsOf(again.calls).filter((x) => armsOf(x).includes('frc')).length, 1);
    assert.ok(decideStudy({ studyDir: s.studyDir }).decisions.find((d) => d.name === 'sectioned').forced.comparison);
  } finally { s.e.done(); }
});

test('a failed forced wave does not stop the study: wave 2 and later skills still run, it is reported, and a resume retries it', async () => {
  const s = setup({ skills: ['sectioned', 'helped'] });
  try {
    const bad = fakeExec({ unloaded: ['ctl', 'ctl-b'], quality: { del: 0.3 }, failRuns: /w1f$/ });
    const r = await runStudy({ studyDir: s.studyDir, exec: bad.exec, log: () => {}, overrides: { forcedLoad: 'always' } });
    assert.equal(r.stopped, null);
    assert.deepEqual(r.forcedFailed.sort(), ['helped', 'sectioned']);
    assert.ok(runsOf(bad.calls).some((x) => /skills\/sectioned\/w2$/.test(flag(x, 'out'))), 'wave 2 still ran');
    assert.ok(runsOf(bad.calls).some((x) => /skills\/helped\/w1$/.test(flag(x, 'out'))), 'the next skill still ran');
    assert.match(fs.readFileSync(path.join(s.studyDir, 'skills/sectioned/w1f.failed'), 'utf8'), /did not finish cleanly/);
    assert.match(studyStatus(s.studyDir), /w1f failed/);
    const d = r.decisions.find((x) => x.name === 'sectioned');
    assert.equal(d.forced.failed, true);
    assert.equal(d.forced.usedForCall, false);
    assert.match(fs.readFileSync(path.join(s.studyDir, 'decisions/decisions.md'), 'utf8'), /the forced wave failed: .*rerun the study to retry it/);
    const good = fakeExec({ unloaded: ['ctl', 'ctl-b'], quality: { del: 0.3 } });
    const r2 = await runStudy({ studyDir: s.studyDir, exec: good.exec, log: () => {}, overrides: { forcedLoad: 'always' } });
    assert.equal(runsOf(good.calls).filter((x) => /w1f$/.test(flag(x, 'out'))).length, 2, 'only the forced waves are retried');
    assert.equal(fs.existsSync(path.join(s.studyDir, 'skills/sectioned/w1f.failed')), false);
    assert.ok(r2.decisions.find((x) => x.name === 'sectioned').forced.comparison);
    assert.equal(r2.decisions.find((x) => x.name === 'sectioned').forced.comparison.comparisons, 2, 'the family counts both skills');
  } finally { s.e.done(); }
});

test('forced-wave step labels are -w1f-, never -w2- or -w3-, and --waves 1 skips the forced wave', async () => {
  for (const kind of ['run', 'judge']) {
    const l = stepLabel('sectioned', '1f', kind);
    assert.match(l, /-w1f-/);
    assert.doesNotMatch(l, /-w2-|-w3-/);
    assert.match(l, AFTER_WAVE1_STEP);
    assert.doesNotMatch(stepLabel('sectioned', 1, kind), AFTER_WAVE1_STEP);
    for (const n of [2, 3]) assert.match(stepLabel('sectioned', n, kind), AFTER_WAVE1_STEP);
  }
  const s = setup();
  try {
    const { exec, calls } = fakeExec({ unloaded: ['ctl', 'ctl-b'], quality: { del: 0.3 } });
    const labels = [];
    const wrapped = async (a) => { labels.push(a.label); return exec(a); };
    await runStudy({ studyDir: s.studyDir, exec: wrapped, log: () => {}, overrides: { forcedLoad: 'always' }, waves: '1' });
    assert.equal(runsOf(calls).some((x) => armsOf(x).includes('frc')), false);
    assert.ok(labels.every((l) => !AFTER_WAVE1_STEP.test(l)), labels.join(', '));
    await assert.rejects(runStudy({ studyDir: s.studyDir, exec, waves: '2' }), /--waves takes 1/);
  } finally { s.e.done(); }
});

// ---- the plan's cost line ----

const { forcedEstimate, renderPlan } = require('../../cap/skillplan.js');

test('the skill plan shows the forced wave as its own line: 3 arms x tasks x reps x qualifying skills', () => {
  const scale = (runs, judged) => ({ runs, credits: { low: runs, mid: runs * 2, high: runs * 3 }, judgeUsd: runs * judged, wallHours: runs / 60 });
  const sk = (name, exposed, rate) => ({ name, lift: true, judgedShare: 1, exposure: { exposed, runsLoaded: Math.round(exposed * (rate ?? 0)), rate } });
  const skills = [sk('rare', 10, 0.1), sk('common', 10, 0.8), sk('never-seen', 0, null), { ...sk('triage', 10, 0), lift: false }];
  const low = forcedEstimate({ skills, mode: 'low-load', target: 8, repsN: 5, scale });
  assert.deepEqual(low.qualifying, ['rare']);
  assert.deepEqual(low.unknown, ['never-seen']);
  assert.equal(low.formula, '3 arms x 8 tasks x 5 reps x 1 qualifying skill = 120 runs');
  assert.equal(low.cost.runs, 120);
  assert.equal(low.cost.credits.mid, 240);
  const all = forcedEstimate({ skills, mode: 'always', target: 8, repsN: 5, scale });
  assert.equal(all.formula, '3 arms x 8 tasks x 5 reps x 3 qualifying skills = 360 runs');
});

test('cap skill-plan with --forced-load adds the line, and the totals stay as they were', () => {
  const plain = setup();
  const forced = setup({ planOpts: { forcedLoad: 'always' } });
  try {
    assert.equal(plain.plan.forced, null);
    assert.deepEqual(forced.plan.totals.expected, plain.plan.totals.expected);
    assert.equal(forced.plan.forced.qualifying.length, 1);
    assert.equal(forced.plan.totals.withForced.runs, forced.plan.totals.expected.runs + forced.plan.forced.cost.runs);
    const md = renderPlan(forced.plan);
    assert.match(md, /## Forced-load wave \(its own line, an estimate\)/);
    assert.match(md, /3 arms x 2 tasks x 8 reps x 1 qualifying skill = 48 runs/);
    assert.doesNotMatch(renderPlan(plain.plan), /Forced-load wave/);
  } finally { plain.e.done(); forced.e.done(); }
});
