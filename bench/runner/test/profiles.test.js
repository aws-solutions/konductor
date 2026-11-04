// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const P = require('../lib/profiles.js');

const BENCH = path.join(__dirname, '..', '..');

test('quick and detailed ship as files, and scoring.json is not a profile', () => {
  assert.deepEqual(P.PROFILE_NAMES, ['quick', 'detailed']);
  for (const n of P.PROFILE_NAMES) assert.ok(fs.existsSync(path.join(BENCH, 'profiles', `${n}.json`)), n);
});

test('detailed: at least 5 replicates, an A/A arm, controls, 8 scenarios per skill, graded judging in both orders, a calibration sample', () => {
  const d = P.loadProfile('detailed');
  assert.ok(d.replicates.min >= 5 && d.replicates.default >= 5);
  assert.equal(d.replicates.max, undefined);
  assert.equal(d.aaArm, true);
  assert.equal(d.controls, true);
  assert.ok(d.scenariosPerSkill.min >= 8);
  assert.deepEqual(d.judging.modes, ['rubric', 'pairwise', 'graded']);
  assert.equal(d.judging.bothOrders, true);
  assert.ok(d.calibrationSample >= 1);
  assert.equal(d.report.detail, 'full');
});

test('quick: 1 to 3 replicates, no A/A arm, no controls, anecdotal below 3', () => {
  const q = P.loadProfile('quick');
  assert.deepEqual([q.replicates.min, q.replicates.max], [1, 3]);
  assert.ok(q.replicates.default >= 1 && q.replicates.default <= 3);
  assert.equal(q.aaArm, false);
  assert.equal(q.controls, false);
  assert.equal(q.calibrationSample, 0);
  assert.equal(q.anecdotalBelow, 3);
  assert.equal(q.report.detail, 'quick');
});

test('an unknown profile name lists the known ones', () => {
  assert.throws(() => P.loadProfile('thorough'), /--profile takes quick or detailed \(got "thorough"\)/);
  assert.equal(P.optionalProfile(undefined), null);
  assert.throws(() => P.optionalProfile(true), /--profile takes quick or detailed/);
  assert.equal(P.optionalProfile('quick').name, 'quick');
});

test('a profile file with a missing or bad field is refused with the field named', () => {
  const dir = tmp();
  try {
    write(path.join(dir, 'profiles', 'quick.json'), JSON.stringify({ name: 'quick', replicates: { default: 9, min: 1, max: 3 } }));
    assert.throws(() => P.loadProfile('quick', { benchDir: dir }), /replicates\.default/);
    write(path.join(dir, 'profiles', 'quick.json'), '{ not json');
    assert.throws(() => P.loadProfile('quick', { benchDir: dir }), /quick\.json/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('replicatesFor: the default, a value in range, and a refusal outside it', () => {
  const q = P.loadProfile('quick');
  const d = P.loadProfile('detailed');
  assert.equal(P.replicatesFor(q, undefined), q.replicates.default);
  assert.equal(P.replicatesFor(q, '1'), 1);
  assert.equal(P.replicatesFor(d, undefined), 5);
  assert.equal(P.replicatesFor(d, '8'), 8);
  assert.throws(() => P.replicatesFor(d, '3'), /profile detailed needs at least 5 replicates per cell \(got 3\)/);
  assert.throws(() => P.replicatesFor(q, '5'), /profile quick allows 1 to 3 replicates \(got 5\)/);
  assert.throws(() => P.replicatesFor(d, 'x'), /integer/);
  assert.equal(P.replicatesFor(null, '2'), 2, 'no profile: the caller value passes through');
  assert.equal(P.replicatesFor(null, undefined), undefined);
});

// ---- A/A arm ----

const git = (id, sha) => ({ id, vanilla: false, runtime: 'kiro-cli', commitSha: sha, contentHash: `tree-${sha}`, source: 'git' });
const VAN = { id: 'vanilla', vanilla: true, runtime: 'kiro-cli', commitSha: null };

test('aaArmFor repeats the first non-vanilla arm at its exact commit', () => {
  const r = P.aaArmFor([VAN, git('v1.2.0', 'a'.repeat(40)), git('main', 'b'.repeat(40))]);
  assert.equal(r.spec, `v1.2.0-b=${'a'.repeat(40)}`);
  assert.equal(r.twin, 'v1.2.0');
  assert.match(r.note, /A\/A arm v1\.2\.0-b repeats v1\.2\.0 at aaaaaaa/);
});

test('aaArmFor adds nothing when two arms already share a commit, or when only vanilla is present', () => {
  const same = P.aaArmFor([VAN, git('a', 'c'.repeat(40)), git('b', 'c'.repeat(40))]);
  assert.equal(same.spec, null);
  assert.match(same.note, /already has an A\/A pair/);
  const van = P.aaArmFor([VAN]);
  assert.equal(van.spec, null);
  assert.match(van.note, /no A\/A arm: every arm is vanilla/);
});

test('aaArmFor repeats a directory arm by its path, keeps the opencode prefix and picks a free name', () => {
  const dirArm = { id: 'pr-1', vanilla: false, runtime: 'kiro-cli', source: 'dir', dir: '/x/y', contentHash: 'h'.repeat(40), commitSha: null };
  assert.equal(P.aaArmFor([VAN, dirArm]).spec, 'pr-1-b=dir:/x/y');
  const oc = { id: 'oc-main', vanilla: false, runtime: 'opencode', commitSha: 'd'.repeat(40), contentHash: 't' };
  assert.equal(P.aaArmFor([oc]).spec, `oc-main-b=${'d'.repeat(40)}`);
  assert.equal(P.aaArmFor([git('v1.2.0', 'a'.repeat(40)), { ...git('v1.2.0-b', 'e'.repeat(40)) }]).spec, `v1.2.0-c=${'a'.repeat(40)}`);
});

test('aaArmFor names the repeat of a Claude Code arm with one cc- prefix', () => {
  const cc = { id: 'cc-main', vanilla: false, runtime: 'claude-code', commitSha: 'f'.repeat(40), contentHash: 't' };
  assert.equal(P.aaArmFor([cc]).spec, `cc-main-b=${'f'.repeat(40)}`);
  const named = { id: 'cc-pr-105', vanilla: false, runtime: 'claude-code', commitSha: 'e'.repeat(40), contentHash: 't' };
  assert.equal(P.aaArmFor([named, { ...cc, commitSha: 'a'.repeat(40) }]).spec, `cc-pr-105-b=${'e'.repeat(40)}`);
  const taken = [cc, { id: 'cc-main-b', vanilla: true, runtime: 'claude-code' }];
  assert.equal(P.aaArmFor(taken).spec, `cc-main-c=${'f'.repeat(40)}`);
});

// ---- calibration sample ----

const run = (n) => ({ dir: '/r', runs: Array.from({ length: n }, (_, i) => ({ armId: i % 2 ? 'a' : 'vanilla', taskId: `t${i % 3}`, replicate: Math.floor(i / 2) + 1, dir: `/r/${i}`, result: { status: i === 0 ? 'budget_skipped' : 'success' } })) });

test('the calibration sample is the draw calibrate export would make, is repeatable and skips budget-skipped runs', () => {
  const a = P.calibrationSample({ run: run(40), n: 10, seed: 7 });
  const b = P.calibrationSample({ run: run(40), n: 10, seed: 7 });
  assert.deepEqual(a, b);
  assert.equal(a.items.length, 10);
  assert.ok(a.items.every((i) => i.armId && i.taskId && i.replicate));
  assert.ok(!a.items.some((i) => i.armId === 'vanilla' && i.taskId === 't0' && i.replicate === 1), 'the skipped run is never drawn');
  assert.notDeepEqual(P.calibrationSample({ run: run(40), n: 10, seed: 8 }).items, a.items);
  assert.equal(P.calibrationSample({ run: run(5), n: 25, seed: 1 }).items.length, 4, 'fewer eligible runs than n');
});

test('writeCalibrationSample writes json and md into the results directory with the export command', () => {
  const dir = tmp();
  try {
    const out = P.writeCalibrationSample({ run: { ...run(12), dir }, n: 5, seed: 3 });
    assert.equal(out.json, path.join(dir, 'calibration-sample.json'));
    const j = JSON.parse(fs.readFileSync(out.json, 'utf8'));
    assert.equal(j.items.length, 5);
    assert.equal(j.seed, 3);
    const md = fs.readFileSync(out.md, 'utf8');
    assert.match(md, /calibrate export --run .* --n 5 --seed 3/);
    assert.match(md, /do not show this file to the person labelling/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a profile with no calibration sample writes nothing', () => {
  const dir = tmp();
  try {
    assert.equal(P.writeCalibrationSample({ run: { ...run(12), dir }, n: 0, seed: 3 }), null);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- profile check ----

const facts = (o = {}) => ({
  study: { comparison: true, capability: false, judged: true },
  replicates: { min: 5 }, aaArms: ['a', 'a-b'], sameRefRepeat: false,
  controls: { positive: 0, negative: 0 }, calibration: { kappa: 0.7 },
  judging: { present: true, pairwise: { run: true, records: 4, bothOrders: 4 } },
  ...o,
});
const judg = { modes: ['graded', 'pairwise', 'rubric'], graded: [{ orderings: [{}, {}] }] };

test('profileCheck: a run that meets the detailed profile has every item ok', () => {
  const r = P.profileCheck(P.loadProfile('detailed'), { facts: facts(), judgments: judg });
  assert.equal(r.met, true);
  assert.ok(r.items.every((i) => i.ok), JSON.stringify(r.items.filter((i) => !i.ok)));
});

test('profileCheck: each shortfall of the detailed profile is named', () => {
  const r = P.profileCheck(P.loadProfile('detailed'), {
    facts: facts({ replicates: { min: 3 }, aaArms: null, calibration: null, judging: { present: true, pairwise: { run: true, records: 4, bothOrders: 3 } } }),
    judgments: { modes: ['rubric', 'pairwise'], graded: [] },
  });
  assert.equal(r.met, false);
  const bad = r.items.filter((i) => !i.ok).map((i) => i.text).join('\n');
  assert.match(bad, /3 replicates per cell, the profile needs 5/);
  assert.match(bad, /no A\/A arm or same-ref repeat/);
  assert.match(bad, /graded/);
  assert.match(bad, /both answer orders: 3 of 4/);
  assert.match(bad, /no human calibration result/);
});

test('profileCheck: skill studies also need the known-answer keep and prune controls', () => {
  const cap = facts({ study: { comparison: true, capability: true, judged: true } });
  const bad = P.profileCheck(P.loadProfile('detailed'), { facts: cap, judgments: judg }).items.filter((i) => !i.ok).map((i) => i.text).join('\n');
  assert.match(bad, /known-answer controls: 0 keep, 0 prune/);
  const ok = P.profileCheck(P.loadProfile('detailed'), { facts: { ...cap, controls: { positive: 1, negative: 1 } }, judgments: judg });
  assert.equal(ok.met, true);
});

test('profileCheck: a run that was not judged fails the judging items, never passes them', () => {
  const r = P.profileCheck(P.loadProfile('detailed'), { facts: facts({ judging: { present: false, pairwise: { run: false, records: 0, bothOrders: 0 } } }), judgments: null });
  assert.ok(r.items.some((i) => !i.ok && /not judged/.test(i.text)));
});

test('profileCheck: quick only says that fewer than 3 replicates is anecdotal', () => {
  const q = P.loadProfile('quick');
  assert.deepEqual(P.profileCheck(q, { facts: facts({ replicates: { min: 3 } }), judgments: null }).items.map((i) => i.ok), [true]);
  const low = P.profileCheck(q, { facts: facts({ replicates: { min: 2 } }), judgments: null });
  assert.equal(low.items[0].ok, false);
  assert.match(low.items[0].text, /2 replicates per cell: results are anecdotal/);
});
