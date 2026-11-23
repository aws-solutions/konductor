// SPDX-License-Identifier: Apache-2.0
'use strict';

// FW-33 and FW-34 in compare (DEBT D-227, D-228): `compare --aa ARM` takes ARM, run in both directories, as the A/A
// pair. Paired by task, its gap's 95% half-width is the noise floor; every other arm's gap prints beside it, marked
// inside or outside, with the detectable gap at 80% power and "no gap over X" instead of "no gap".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { compareRuns, formatCompare } = require('../../report/compare.js');

const TASKS = ['t1', 't2', 't3', 't4'];
const check = (passed) => ({ checks: [{ type: 'file_exists', path: 'a.txt', passed }] });

// pass[arm][task] = [rep1 passed, rep2 passed]
function study(root, name, pass) {
  const bench = path.join(root, 'bench');
  if (!fs.existsSync(path.join(bench, 'tasks'))) for (const t of TASKS) makeBench(bench, { taskId: t });
  const specs = Object.entries(pass).flatMap(([arm, byTask]) => Object.entries(byTask).flatMap(([task, reps]) => reps.map((p, i) => ({ arm, task, rep: i + 1, ...check(p) }))));
  return { bench, dir: makeRun(path.join(root, name), bench, specs, { taskIds: TASKS }) };
}

const all = (v) => Object.fromEntries(TASKS.map((t) => [t, [v, v]]));

test('a fixture with two same-arm sets prints the A/A half-width; a smaller gap is marked inside noise', () => {
  const root = tmp();
  try {
    // vanilla: the A/A arm, a little noise between the two directories. v1: one task better in head, inside the noise.
    const base = study(root, 'base', { vanilla: { t1: [true, true], t2: [true, false], t3: [false, false], t4: [true, true] }, v1: all(true) });
    const head = study(root, 'head', { vanilla: { t1: [true, false], t2: [true, true], t3: [false, true], t4: [true, true] }, v1: { ...all(true), t3: [true, false] } });
    const r = compareRuns({ baseDir: base.dir, headDir: head.dir, benchDir: base.bench, aa: 'vanilla' });
    assert.equal(r.refusals.length, 0);
    const floor = r.aa.floor.checkPassRate;
    assert.equal(floor.tasks, 4);
    assert.ok(floor.halfWidth > 0);
    const v1 = r.aa.rows.find((x) => x.arm === 'v1' && x.metric === 'checkPassRate');
    assert.ok(Math.abs(v1.gap) < floor.halfWidth);
    assert.equal(v1.insideNoise, true);
    const text = formatCompare(r);
    assert.match(text, /^A\/A noise \(--aa vanilla: vanilla in base against vanilla in head, paired by task; points of 100\):$/m);
    assert.match(text, new RegExp(`^  vanilla / checkPassRate: A/A gap [+-]\\d+\\.\\d, half-width ${floor.halfWidth.toFixed(1)} over 4 tasks$`, 'm'));
    assert.match(text, /^  v1 \/ checkPassRate: gap -12\.5; inside A\/A noise \(half-width \d+\.\d over 4 tasks\); (no gap over \d+\.\d points|detectable gap unknown)/m);
    assert.doesNotMatch(text, /\bno gap\b(?! over)/, 'never a bare "no gap"');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--aa names an arm that is not in both runs: refused', () => {
  const root = tmp();
  try {
    const base = study(root, 'base', { vanilla: all(true) });
    const head = study(root, 'head', { vanilla: all(true) });
    const r = compareRuns({ baseDir: base.dir, headDir: head.dir, benchDir: base.bench, aa: 'nope' });
    assert.equal(r.exitCode, 2);
    assert.match(formatCompare(r), /--aa nope: the arm is not in both runs/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('without --aa nothing changes: no A/A section', () => {
  const root = tmp();
  try {
    const base = study(root, 'base', { vanilla: all(true) });
    const head = study(root, 'head', { vanilla: all(true) });
    const r = compareRuns({ baseDir: base.dir, headDir: head.dir, benchDir: base.bench });
    assert.equal(r.aa, undefined);
    assert.doesNotMatch(formatCompare(r), /A\/A/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
