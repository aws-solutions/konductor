// SPDX-License-Identifier: Apache-2.0
'use strict';

// Null simulation behind the verdict interval: how often a "95%" interval excludes 0 when the arms do not differ.
// Compares the pooled-run bootstrap (stats.diffCI) with the paired-by-cell t interval (stats.pairedCellCI).
//   node bench/scripts/sim-interval-size.js [trials]
// Design: K tasks x 5 replicates, a task effect shared by both arms (SD 20), run noise SD 12 (normal) or a pass/fail mixture,
// and optionally a task-by-arm interaction (SD 10). Nominal rate is 5%.

const { diffCI, pairedCellCI } = require('../report/stats.js');
const { mulberry32 } = require('../../tests/scripts/stats.js');

const trials = Number(process.argv[2]) || 1000;
const rng = mulberry32(11);
const gauss = () => { let u = 0; while (!u) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); };
const noise = { normal: () => 12 * gauss(), mixture: () => (rng() < 0.25 ? -40 : 3) + 5 * gauss() };

function rate(k, kind, interaction, reps = 5) {
  let oldRej = 0;
  let newRej = 0;
  for (let i = 0; i < trials; i++) {
    const cells = [];
    const hp = [];
    const bp = [];
    for (let t = 0; t < k; t++) {
      const task = 60 + 20 * gauss();
      const shift = interaction * gauss();
      const head = Array.from({ length: reps }, () => task + shift + noise[kind]());
      const base = Array.from({ length: reps }, () => task + noise[kind]());
      cells.push({ head, base });
      hp.push(...head);
      bp.push(...base);
    }
    const o = diffCI(hp, bp, { seed: i + 1 });
    if (o.ciLow > 0 || o.ciHigh < 0) oldRej++;
    const p = pairedCellCI(cells);
    if (p.ciLow > 0 || p.ciHigh < 0) newRej++;
  }
  return [oldRej, newRej].map((x) => `${((100 * x) / trials).toFixed(1)}%`.padStart(6));
}

console.log(`null runs, ${trials} trials per row; columns: pooled-run bootstrap | paired by cell`);
for (const kind of ['normal', 'mixture']) {
  for (const interaction of [0, 10]) {
    for (const k of [3, 4, 5, 6, 8, 12]) console.log(`${kind.padEnd(8)} interaction ${String(interaction).padEnd(2)} cells ${String(k).padEnd(2)}`, rate(k, kind, interaction).join(' | '));
  }
}
let iid = 0;
for (let i = 0; i < trials; i++) {
  const r = diffCI(Array.from({ length: 3 }, () => 50 + 15 * gauss()), Array.from({ length: 3 }, () => 50 + 15 * gauss()), { seed: i + 1 });
  if (r.ciLow > 0 || r.ciHigh < 0) iid++;
}
console.log(`independent runs, 3 against 3, pooled bootstrap: ${((100 * iid) / trials).toFixed(1)}% excluded 0`);
