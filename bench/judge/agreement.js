// SPDX-License-Identifier: Apache-2.0
'use strict';

// pairs: [[labelFromRaterA, labelFromRaterB], ...]

function percentAgreement(pairs) {
  return pairs.length ? pairs.filter(([a, b]) => a === b).length / pairs.length : null;
}

function cohenKappa(pairs) {
  const n = pairs.length;
  if (!n) return null;
  const countA = {};
  const countB = {};
  for (const [a, b] of pairs) {
    countA[a] = (countA[a] || 0) + 1;
    countB[b] = (countB[b] || 0) + 1;
  }
  const po = percentAgreement(pairs);
  const pe = Object.keys(countA).reduce((s, k) => s + (countA[k] / n) * ((countB[k] || 0) / n), 0);
  return pe === 1 ? null : (po - pe) / (1 - pe);
}

function ranks(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

// Pearson correlation of average ranks.
function spearman(xs, ys) {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const m = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const mx = m(rx);
  const my = m(ry);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  rx.forEach((x, i) => {
    cov += (x - mx) * (ry[i] - my);
    vx += (x - mx) ** 2;
    vy += (ry[i] - my) ** 2;
  });
  return vx && vy ? cov / Math.sqrt(vx * vy) : null;
}

module.exports = { percentAgreement, cohenKappa, spearman };
