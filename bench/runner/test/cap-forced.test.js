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
  assert.equal(F.forcedWanted(null, 0, 0.3), false);
  assert.equal(F.forcedWanted('always', 1, 0.3), true);
  assert.equal(F.forcedWanted('low-load', 0.29, 0.3), true);
  assert.equal(F.forcedWanted('low-load', 0.3, 0.3), false);
  assert.equal(F.forcedWanted('low-load', null, 0.3), true);
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
    const pre = flag(fr, 'arm-prefix').split(',').map((x) => x.split('=')[0]);
    assert.deepEqual(pre, ['frc', 'frc-b']);
    const prefixFile = flag(fr, 'arm-prefix').split(',')[0].split('=')[1];
    assert.match(fs.readFileSync(prefixFile, 'utf8'), /load the skill named "sectioned" with the get_skill tool/);
    assert.ok(runsOf(b.calls).filter((x) => !armsOf(x).includes('frc')).every((x) => flag(x, 'arm-prefix') === null), 'no other run carries a prefix');
    const judge = b.calls.find((x) => x[0] === 'judge' && /w1f$/.test(flag(x, 'run')));
    assert.ok(judge);
    assert.equal(flag(judge, 'baseline'), 'frc');

    const armsFile = readJson(path.join(forced.studyDir, 'skills/sectioned/w1f.arms.json'));
    assert.equal(armsFile.forced.usedForCall, false);
    assert.equal(armsFile.forced.harness, 'kiro-cli');

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
    assert.match(fs.readFileSync(path.join(low.studyDir, 'skills/sectioned/w1f.skipped'), 'utf8'), /100% of wave 1 control runs/);
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
