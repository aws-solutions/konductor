// SPDX-License-Identifier: Apache-2.0
'use strict';

// The pre-registered statistic over three arms (plan 7, DEBT D-54): the three pairs of vanilla, konductor and
// konductor-noskills, each as head minus base on quality, by the two-level bootstrap of scenarios/bootstrap.js.
//   konductor - vanilla             what the whole konductor install does;
//   konductor - konductor-noskills  what the skills add on top of the rest of the install;
//   konductor-noskills - vanilla    what the install does without its skills.
// The three HELD-OUT pairs are one family, so their intervals use Holm's correction (compareRows); DEV tasks are shown
// apart, uncorrected, and are never a verdict. Pure over report rows ({ arm, task, quality }); nothing is read or written.
// `bench.js report` shows it when a run holds all three arms (build.js threeArmsOf; the konductor arm may be "main").

const { compare, compareRows } = require('../scenarios/bootstrap.js');
const { splitOf } = require('../scenarios/split.js');
const { BOOTSTRAP, MARGIN } = require('../scenarios/protocol.js');
const D = require('./doc.js');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const DEFAULT_ARMS = { vanilla: 'vanilla', konductor: 'konductor', noskills: 'konductor-noskills' };

/** The three pairs, in report order, for the arm ids given. */
const pairsFor = (a) => [
  { key: 'konductor-vs-vanilla', head: a.konductor, base: a.vanilla, label: `${a.konductor} minus ${a.vanilla}` },
  { key: 'konductor-vs-noskills', head: a.konductor, base: a.noskills, label: `${a.konductor} minus ${a.noskills}` },
  { key: 'noskills-vs-vanilla', head: a.noskills, base: a.vanilla, label: `${a.noskills} minus ${a.vanilla}` },
];

/** Per arm, per task, the scored run qualities: Map arm -> Map task -> [quality]. Excluded runs (no quality) are left out. */
function qualitiesByArm(rows) {
  const out = new Map();
  for (const r of rows) {
    if (!fin(r.quality)) continue;
    if (!out.has(r.arm)) out.set(r.arm, new Map());
    const byTask = out.get(r.arm);
    if (!byTask.has(r.task)) byTask.set(r.task, []);
    byTask.get(r.task).push(r.quality);
  }
  return out;
}

/**
 * `rows` are report rows ({ arm, task, quality }), `taskIds` the tasks the report covers, `arms` the three arm ids
 * (default vanilla, konductor, konductor-noskills), `split` maps a task id to HELD-OUT or DEV (default splitOf).
 * Returns { margin, draws, seed, arms, taskCounts, pairs: [{ key, label, head, base, heldOut, dev }] }, or throws when a
 * named arm has no rows at all (a typo would otherwise read as "unsettled").
 */
function buildThreeArm({ rows, taskIds, arms = DEFAULT_ARMS, split = splitOf, opts = {} }) {
  const q = qualitiesByArm(rows);
  for (const id of Object.values(arms)) if (!q.has(id)) throw new Error(`three-arm statistic: no scored runs for arm ${id}`);
  const heldIds = taskIds.filter((t) => split(t) === 'HELD-OUT');
  const devIds = taskIds.filter((t) => split(t) === 'DEV');
  const inputs = (p, ids) => ids.map((id) => ({ id, head: q.get(p.head).get(id) ?? [], base: q.get(p.base).get(id) ?? [] }));
  const pairs = pairsFor(arms);
  const held = compareRows(pairs.map((p) => ({ key: p.key, tasks: inputs(p, heldIds) })), opts);
  return {
    margin: opts.margin ?? MARGIN, draws: opts.draws ?? BOOTSTRAP.draws, seed: opts.seed ?? BOOTSTRAP.seed, arms,
    taskCounts: { heldOut: heldIds.length, dev: devIds.length },
    pairs: pairs.map((p, i) => ({ ...p, heldOut: held[i], dev: compare(inputs(p, devIds), opts) })),
  };
}

const num = (v) => (fin(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}` : 'n/a');
const ci = (r) => (fin(r.low) ? `[${num(r.low)}, ${num(r.high)}]${fin(r.level) && r.level !== BOOTSTRAP.confidence ? ` at ${(r.level * 100).toFixed(2)}%` : ''}` : 'n/a');

/** Document blocks for the section. */
function threeArmBlocks(t) {
  return [
    D.h(2, 'Pre-registered statistic: the three arm pairs, two-level bootstrap'),
    D.note(`Each pair is head minus base on quality: the mean paired difference per task, averaged over tasks. Interval: ${t.draws} bootstrap draws (tasks, then runs inside each task and arm), seed ${t.seed}, margin ${t.margin} points, verdict words as in the two-arm table. The three HELD-OUT pairs are one family, so their intervals are Holm-corrected. DEV tasks are shown apart and are not a verdict.`),
    D.table(['pair', 'HELD-OUT n', 'difference', 'interval', 'verdict', `DEV (${t.taskCounts.dev}) difference, not a verdict`], t.pairs.map((p) => [
      p.label, p.heldOut.n, num(p.heldOut.estimate), ci(p.heldOut), p.heldOut.verdict, num(p.dev.estimate),
    ])),
    ...t.pairs.filter((p) => p.heldOut.note).map((p) => D.note(`${p.label}: ${p.heldOut.note}`)),
  ];
}

module.exports = { buildThreeArm, threeArmBlocks, qualitiesByArm, pairsFor, DEFAULT_ARMS };
