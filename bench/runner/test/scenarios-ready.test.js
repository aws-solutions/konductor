// SPDX-License-Identifier: Apache-2.0
'use strict';

// `scenarios ready` (dry-run gates and the run loader) and `scenarios spot-review` (seeded, at least one per batch).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write } = require('./helpers.js');
const { readiness, dryRunReasons, fixReasons, lockBlockers } = require('../../scenarios/ready.js');
const { spotSample } = require('../../scenarios/spot-review.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const dry = (o) => ({ scores: {}, decision: 'keep', date: '2026-11-19', dryRun: { reference: 100, stub: 0, lazy: 20, alt: 90, date: '2026-11-19', ...o } });
const task = (id, o = {}) => ({ id, class: 'simple', prompt: 'Do the thing.', fixture: id, timeoutSec: 600, checks: [{ type: 'file_exists', path: 'a.txt' }], rubric: [{ id: 'c1', criterion: 'Is it done?', weight: 1 }], tiers: ['full'], targetSkills: [], ...o });

function pack() {
  const root = tmp();
  const put = (b, t) => { write(path.join(root, b, `${t.id}.json`), `${JSON.stringify(t)}\n`); write(path.join(root, b, 'fixtures', t.id, 'a.txt'), 'a\n'); };
  put('t1', task('t1-ok', { pilot: dry({}) }));
  put('t1', task('t1-lazy', { pilot: dry({ lazy: 55 }) }));
  put('t1', task('t1-none'));
  put('t1', task('t1-fix', { pilot: { ...dry({}), decision: 'fix' } }));
  put('t2', task('t2-ok', { pilot: dry({}) }));
  put('t2', task('t2-bad', { pilot: dry({}), notAField: true }));
  return root;
}

test('dryRunReasons names each failed gate and a missing record', () => {
  assert.deepEqual(dryRunReasons({}), ['no pilot.dryRun recorded']);
  assert.deepEqual(dryRunReasons({ pilot: dry({}) }), []);
  assert.deepEqual(dryRunReasons({ pilot: dry({ reference: 90, stub: 25, lazy: 41, alt: 79 }) }), [
    'dry run reference 90, needs >= 95', 'dry run stub 25, needs <= 20', 'dry run lazy 41, needs <= 40', 'dry run alt 79, needs >= 80']);
});

test('a hand-edited task with no review.recheck is blocked from lock; a dry run kept elsewhere is named', () => {
  assert.deepEqual(lockBlockers({ handEdited: { family: 'claude' } }), ['hand-edited, recheck missing']);
  assert.deepEqual(lockBlockers({ handEdited: { family: 'claude' }, review: { recheck: { family: 'glm' } } }), []);
  assert.deepEqual(lockBlockers({ handEdited: null }), []);
  assert.deepEqual(dryRunReasons({ pilot: { scores: { dryRun: { reference: 100, stub: 7, alt: 100 } } } }),
    ['dry run kept in pilot.scores.dryRun, not pilot.dryRun', 'dry run has no lazy score']);
});

test('a task is ready only with a passing dry run in a folder the runner loads', () => {
  const rows = Object.fromEntries(readiness(pack()).map((r) => [r.id, r]));
  assert.equal(rows['t1-ok'].ready, true);
  assert.match(rows['t1-lazy'].reasons.join(), /fix: lazy 55 over 40/);
  assert.deepEqual(rows['t1-lazy'].fix, ['lazy 55 over 40']);
  assert.equal(rows['t1-fix'].ready, false);
  assert.deepEqual(rows['t1-fix'].reasons, ['fix: pilot.decision is fix']);
  assert.deepEqual(fixReasons({ pilot: dry({ lazy: 40 }) }), []);
  assert.match(rows['t1-none'].reasons.join(), /no pilot\.dryRun/);
  assert.match(rows['t2-bad'].reasons[0], /fails the run loader/);
  // One bad file stops the whole --extra-tasks folder, so its neighbour is not ready either.
  assert.equal(rows['t2-ok'].ready, false);
  assert.match(rows['t2-ok'].reasons[0], /batch folder fails the run loader \(1 file\(s\), first t2-bad\.json\)/);
});

test('bench.js scenarios ready --ids prints the ready ids of a batch, --late the others', () => {
  const dir = pack();
  const run = (...a) => spawnSync(process.execPath, [BENCH_JS, 'scenarios', 'ready', dir, ...a], { encoding: 'utf8' });
  assert.equal(run('--batch', 't1', '--ids').stdout.trim(), 't1-ok');
  assert.equal(run('--batch', 't1', '--ids', '--late').stdout.trim(), 't1-fix,t1-lazy,t1-none');
  assert.equal(run('--batch', 't2', '--ids').stdout.trim(), '');
  const all = run();
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /\| t1 \| 4 \| 1 \| 2 \| 3 \|/);
  assert.match(all.stdout, /Fix \(not ready\):\n- t1-fix: pilot\.decision is fix\n- t1-lazy: lazy 55 over 40/);
  assert.equal(run('--batch', 't7').status, 2);
});

test('spot-review takes 10% of each batch rounded up, at least one, the same for the same seed', () => {
  const root = tmp();
  for (let i = 0; i < 12; i++) write(path.join(root, 't1', `t1-x${i}.json`), '{}\n');
  write(path.join(root, 't2', 't2-only.json'), '{}\n');
  const a = spotSample(root, 20261119);
  assert.equal(a.t1.length, 2);
  assert.deepEqual(a.t2, ['t2-only']);
  assert.deepEqual(spotSample(root, 20261119), a);
  assert.ok(a.t1.every((id) => /^t1-x\d+$/.test(id)));
});
