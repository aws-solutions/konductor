// SPDX-License-Identifier: Apache-2.0
'use strict';

// D-54: the three-arm statistic (bench/report/three-arm.js) over vanilla, konductor and konductor-noskills. Pure, with
// synthetic rows and a fixed split; few draws keep it fast.

const test = require('node:test');
const assert = require('node:assert/strict');
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
