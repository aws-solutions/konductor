// SPDX-License-Identifier: Apache-2.0
'use strict';

// D-54: the three-arm statistic (bench/report/three-arm.js) over vanilla, konductor and konductor-noskills. Pure, with
// synthetic rows and a fixed split; few draws keep it fast.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildThreeArm, threeArmBlocks, pairsFor, DEFAULT_ARMS } = require('../../report/three-arm.js');
const { compare } = require('../../scenarios/bootstrap.js');
const { toMarkdown } = require('../../report/doc.js');

const OPTS = { draws: 400, seed: 7 };
const HELD = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const split = (id) => (id.startsWith('h') ? 'HELD-OUT' : 'DEV');

// konductor scores 30 over vanilla, noskills 10 over vanilla; two runs per task and arm, small spread.
function rows() {
  const out = [];
  const base = { vanilla: 50, konductor: 80, 'konductor-noskills': 60 };
  [...HELD, 'd1', 'd2'].forEach((task, i) => {
    for (const [arm, v] of Object.entries(base)) for (const k of [0, 1]) out.push({ arm, task, quality: v + ((i + k) % 3) - 1 });
  });
  out.push({ arm: 'vanilla', task: 'h1', quality: null }); // an excluded run is left out
  return out;
}

test('three pairs in plan order, each head minus base, with the expected estimates', () => {
  const t = buildThreeArm({ rows: rows(), taskIds: [...HELD, 'd1', 'd2'], split, opts: OPTS });
  assert.deepEqual(t.pairs.map((p) => p.key), ['konductor-vs-vanilla', 'konductor-vs-noskills', 'noskills-vs-vanilla']);
  assert.deepEqual(t.pairs.map((p) => [p.head, p.base]), [['konductor', 'vanilla'], ['konductor', 'konductor-noskills'], ['konductor-noskills', 'vanilla']]);
  const est = t.pairs.map((p) => Math.round(p.heldOut.estimate));
  assert.deepEqual(est, [30, 20, 10]);
  assert.deepEqual(t.taskCounts, { heldOut: 6, dev: 2 });
  for (const p of t.pairs) {
    assert.equal(p.heldOut.n, 6);
    assert.equal(p.heldOut.verdict, 'beats by the margin');
    assert.ok(p.heldOut.level >= 0.95 - 1e-12, 'a Holm-corrected interval is taken at the family level or wider');
    assert.equal(p.dev.n, 2, 'DEV is compared apart');
  }
});

test('HELD-OUT pairs are Holm-corrected: their interval is at least as wide as an uncorrected one', () => {
  const r = rows();
  const t = buildThreeArm({ rows: r, taskIds: HELD, split, opts: OPTS });
  const p = t.pairs[2];
  const q = (arm) => (id) => r.filter((x) => x.arm === arm && x.task === id && Number.isFinite(x.quality)).map((x) => x.quality);
  const plain = compare(HELD.map((id) => ({ id, head: q('konductor-noskills')(id), base: q('vanilla')(id) })), OPTS);
  assert.ok(p.heldOut.high - p.heldOut.low >= plain.high - plain.low - 1e-9);
  assert.ok(Number.isFinite(p.heldOut.pAdj));
});

test('a missing arm is an error, not an unsettled row; other arm ids can be named', () => {
  const r = rows().filter((x) => x.arm !== 'konductor-noskills');
  assert.throws(() => buildThreeArm({ rows: r, taskIds: HELD, split, opts: OPTS }), /no scored runs for arm konductor-noskills/);
  const renamed = rows().map((x) => ({ ...x, arm: x.arm === 'konductor' ? 'main' : x.arm }));
  const t = buildThreeArm({ rows: renamed, taskIds: HELD, split, arms: { ...DEFAULT_ARMS, konductor: 'main' }, opts: OPTS });
  assert.equal(t.pairs[0].label, 'main minus vanilla');
  assert.deepEqual(pairsFor(DEFAULT_ARMS).map((p) => p.label), ['konductor minus vanilla', 'konductor minus konductor-noskills', 'konductor-noskills minus vanilla']);
});

test('fewer than 2 HELD-OUT tasks: every pair is unsettled with a note, and the blocks render', () => {
  const t = buildThreeArm({ rows: rows(), taskIds: ['h1', 'd1'], split, opts: OPTS });
  for (const p of t.pairs) assert.equal(p.heldOut.verdict, 'unsettled');
  const md = toMarkdown(threeArmBlocks(t));
  assert.match(md, /the three arm pairs/);
  assert.match(md, /konductor minus konductor-noskills/);
  assert.match(md, /fewer than 2 tasks/);
});

test('bench.js report shows the three-arm section when a run has vanilla, konductor and konductor-noskills, and not otherwise (D-54)', () => {
  const { spawnSync } = require('node:child_process');
  const { tmp, makeBench, makeRun } = require('./helpers.js');
  const { threeArmsOf } = require('../../report/build.js');
  assert.deepEqual(threeArmsOf(['vanilla', 'main', 'konductor-noskills']), { vanilla: 'vanilla', konductor: 'main', noskills: 'konductor-noskills' });
  assert.equal(threeArmsOf(['vanilla', 'konductor']), null);
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const specs = (arms) => arms.flatMap((arm) => [1, 2].map((rep) => ({ arm, rep, credits: 1, wallClockMs: 1000, toolCalls: 3 })));
    const BENCH_JS = path.join(__dirname, '..', 'bench.js');
    const env = { ...process.env, BENCH_TEST_MODE: '1' };
    const three = makeRun(path.join(root, 'three'), bench, specs(['vanilla', 'konductor', 'konductor-noskills']));
    const r = spawnSync(process.execPath, [BENCH_JS, 'report', '--run', three, '--bench-dir', bench], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const md = fs.readFileSync(path.join(three, 'report.md'), 'utf8');
    assert.match(md, /## Pre-registered statistic: the three arm pairs/);
    assert.match(md, /konductor minus konductor-noskills/);
    const two = makeRun(path.join(root, 'two'), bench, specs(['vanilla', 'konductor']));
    assert.equal(spawnSync(process.execPath, [BENCH_JS, 'report', '--run', two, '--bench-dir', bench], { env, encoding: 'utf8' }).status, 0);
    assert.doesNotMatch(fs.readFileSync(path.join(two, 'report.md'), 'utf8'), /three arm pairs/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
