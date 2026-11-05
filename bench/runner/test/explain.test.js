// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench.js explain on synthetic runs: a multi-arm directory, a 2x2 root and a single cell. Files only; no model.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { explainRuns, expandRunDirs } = require('../../report/explain.js');
const { loadTasks } = require('../lib/tasks.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });

function judgments(runDir, records) {
  const rubric = records.map((r) => {
    const criteria = Object.entries(r.verdicts).map(([id, [verdict, raw]]) => ({
      id, verdict, verdictRaw: raw ?? verdict, verdictScored: verdict, evidence: `quote for ${id}`, evidenceFound: raw === undefined || raw === verdict,
      ...(raw !== undefined && raw !== verdict ? { evidenceDowngraded: true } : {}),
    }));
    const weights = { c1: 1, c2: 3 };
    const val = (v) => ({ pass: 1, partial: 0.5, fail: 0 })[v];
    const score = criteria.reduce((s, c) => s + weights[c.id] * val(c.verdict), 0) / 4;
    const scoreRaw = criteria.reduce((s, c) => s + weights[c.id] * val(c.verdictRaw), 0) / 4;
    return { kind: 'rubric', judge: r.judge, armId: r.arm, taskId: 't1', replicate: r.rep ?? 1, taskRevision: null, score, scoreRaw, criteria, judgeError: null, parseFailures: 0, calls: [], redactionsFired: {} };
  });
  write(path.join(runDir, 'judgments.json'), JSON.stringify({ schemaVersion: 1, baseline: 'vanilla', judges: [...new Set(records.map((r) => r.judge))], modes: ['rubric'], rubric, pairwise: [] }));
}

// Two arms; vanilla fails one of two checks, other passes both. Both are judged by two judges.
function multiArm(root) {
  const bench = makeBench(path.join(root, 'bench'));
  const failing = [{ type: 'file_exists', path: 'a.txt', passed: true }, { type: 'contains', path: 'a.txt', pattern: 'zzz', passed: false, detail: 'pattern not found in a.txt' }];
  const runDir = makeRun(path.join(root, 'run'), bench, [
    { arm: 'vanilla', checks: failing }, { arm: 'vanilla', rep: 2 },
    { arm: 'other', checks: [{ type: 'file_exists', path: 'a.txt', passed: true }, { type: 'contains', path: 'a.txt', pattern: 'fixed', passed: true }] },
  ]);
  judgments(runDir, [
    { judge: 'j1', arm: 'vanilla', verdicts: { c1: ['pass'], c2: ['partial', 'pass'] } },
    { judge: 'j2', arm: 'vanilla', verdicts: { c1: ['pass'], c2: ['pass'] } },
    { judge: 'j1', arm: 'vanilla', rep: 2, verdicts: { c1: ['pass'], c2: ['pass'] } },
    { judge: 'j1', arm: 'other', verdicts: { c1: ['fail'], c2: ['partial'] } },
  ]);
  return { bench, runDir };
}

const explain = (root, runDir, bench, o = {}) => explainRuns({ dir: runDir, tasks: loadTasks(bench), ...o });

test('every arm and replicate of a multi-arm directory is explained, and filters narrow the set', () => {
  const root = tmp();
  try {
    const { bench, runDir } = multiArm(root);
    const all = explain(root, runDir, bench, { brief: true }).split('\n');
    assert.equal(all.length, 3);
    assert.equal(explain(root, runDir, bench, { brief: true, filter: { arm: 'other' } }).split('\n').length, 1);
    assert.equal(explain(root, runDir, bench, { brief: true, filter: { arm: 'vanilla', rep: 2 } }).split('\n').length, 1);
    assert.equal(explain(root, runDir, bench, { brief: true, filter: { task: 't1' } }).split('\n').length, 3);
    assert.throws(() => explain(root, runDir, bench, { filter: { arm: 'ghost' } }), /no run in .* matches arm ghost/);
  } finally { cleanup(root); }
});

test('the full explanation shows each check with what was observed, the rubric per judge, the downgrade, and the arithmetic', () => {
  const root = tmp();
  try {
    const { bench, runDir } = multiArm(root);
    const text = explain(root, runDir, bench, { filter: { arm: 'vanilla', rep: 1 } });
    assert.match(text, /2\. CHECKS {2}\(1 of 2 passed\)/);
    assert.match(text, /FAIL .*type=contains .*OBSERVED: pattern not found in a\.txt/);
    assert.match(text, /3\. HIDDEN TESTS\n {3}absent/);
    assert.match(text, /c2 \(weight 3\)/);
    assert.match(text, /j1 {13}partial {2}\[judge said pass; evidence quote not found, dropped one level\] {2}"quote for c2"/);
    assert.match(text, /j1 {13}verified=0\.625 \(stored 0\.625, ok\) {2}raw=1 \(stored 1\) {2}downgraded 1 of 2/);
    assert.match(text, /rubric mean over 2 judge\(s\) = 0\.8125/);
    assert.match(text, /renormalised weights \(each \/ 0\.5\): checks 0\.4, rubric 0\.6/);
    // checks term 0 (one failed), rubric 0.8125: 100 * (0.4*0 + 0.6*0.8125) = 48.75
    assert.match(text, /= 48\.75\n {3}qualityOfRun\(\) = 48\.75 {2}\(agrees with the line above\)/);
    assert.match(text, /\[A\] checks scored as a fraction \(1\/2 = 0\.5.*quality 48\.75 -> 68\.8/);
    assert.match(text, /\[B\] every check passed: quality 48\.75 -> 88\.8/);
  } finally { cleanup(root); }
});

test('an unjudged run drops the rubric component and says so', () => {
  const root = tmp();
  try {
    const { bench, runDir } = multiArm(root);
    fs.rmSync(path.join(runDir, 'judgments.json'));
    const text = explain(root, runDir, bench, { filter: { arm: 'other' } });
    assert.match(text, /no rubric records for this run \(not judged\)/);
    assert.match(text, /components present: checks=1;/);
    assert.match(text, /absent \(dropped\): hidden, rubric/);
  } finally { cleanup(root); }
});

test('a fractional scoring file changes the checks term and the label', () => {
  const root = tmp();
  try {
    const { bench, runDir } = multiArm(root);
    const frac = path.join(root, 'frac.json');
    write(frac, JSON.stringify({ weights: { hidden: 0.5, checks: 0.2, rubric: 0.3 }, checks: 'fraction' }));
    const text = explain(root, runDir, bench, { filter: { arm: 'vanilla', rep: 1 }, scoringFile: frac });
    assert.match(text, /Component score \(fraction passed\): checks = 0\.5/);
    assert.match(text, /\(checks scored as fraction\)/);
    assert.match(text, /= 68\.75\n/);
  } finally { cleanup(root); }
});

test('a 2x2 root is expanded to its cells and --arm may name a cell; a single cell directory works on its own', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const mk = (cell, arm) => makeRun(path.join(root, 'pilot', 'cells', cell, 't1'), bench, [{ arm }]);
    const dirA = mk('kiro-vanilla', 'vanilla');
    mk('kiro-konductor', 'konductor');
    const rootDir = path.join(root, 'pilot');
    assert.deepEqual(expandRunDirs(rootDir).map((d) => d.cell), ['kiro-konductor', 'kiro-vanilla']);
    assert.equal(explain(root, rootDir, bench, { brief: true }).split('\n').length, 2);
    const one = explain(root, rootDir, bench, { brief: true, filter: { arm: 'kiro-vanilla' } });
    assert.equal(one.split('\n').length, 1);
    assert.match(one, /^vanilla\tt1\trep1/);
    assert.equal(explain(root, dirA, bench, { brief: true }).split('\n').length, 1);
  } finally { cleanup(root); }
});

test('bench.js explain runs from the command line and refuses an unknown flag', () => {
  const root = tmp();
  try {
    const { bench, runDir } = multiArm(root);
    const env = { PATH: process.env.PATH, HOME: tmp(), TMPDIR: process.env.TMPDIR };
    const ok = spawnSync(process.execPath, [BENCH_JS, 'explain', '--run', runDir, '--bench-dir', bench, '--brief', '--arm', 'other'], { encoding: 'utf8', env });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^other\tt1\trep1\tsuccess\tchecks 2\/2/);
    const bad = spawnSync(process.execPath, [BENCH_JS, 'explain', '--run', runDir, '--bench-dir', bench, '--tsak', '1'], { encoding: 'utf8', env });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /unknown flag --tsak \(did you mean --task\?\)/);
  } finally { cleanup(root); }
});
