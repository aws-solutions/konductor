// SPDX-License-Identifier: Apache-2.0
'use strict';

// Summary of the graded 1 to 5 judge mode. Each record compares one run with the baseline run of the same task and
// replicate, graded in both answer orders; `orderDisagreement` means the preference flipped with position.

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function block(recs) {
  const ok = recs.filter((r) => !r.judgeError && Number.isFinite(r.armGrade));
  const dis = ok.filter((r) => r.orderDisagreement).length;
  return {
    n: ok.length, errors: recs.length - ok.length,
    armGrade: mean(ok.map((r) => r.armGrade)), baseGrade: mean(ok.map((r) => r.baseGrade)), delta: mean(ok.map((r) => r.delta)),
    orderDisagreements: dis, disagreementRate: ok.length ? dis / ok.length : null, shift: mean(ok.map((r) => r.shift).filter(Number.isFinite)),
  };
}

/** judgments: the parsed judgments.json (or null). isStale(record) drops records made against an older task wording. */
function gradedSummary(judgments, { isStale = () => false } = {}) {
  const recs = (judgments?.graded || []).filter((r) => !isStale(r));
  if (!recs.length) return { present: false, baselineId: null, arms: {}, total: { n: 0, errors: 0, orderDisagreements: 0, disagreementRate: null } };
  const arms = {};
  for (const armId of [...new Set(recs.map((r) => r.armId))]) {
    const mine = recs.filter((r) => r.armId === armId);
    arms[armId] = { ...block(mine), judges: Object.fromEntries([...new Set(mine.map((r) => r.judge))].sort().map((j) => [j, block(mine.filter((r) => r.judge === j))])) };
  }
  const all = block(recs);
  return { present: true, baselineId: recs[0].baselineId ?? null, arms, total: { n: all.n, errors: all.errors, orderDisagreements: all.orderDisagreements, disagreementRate: all.disagreementRate } };
}

const f1 = (v) => (v === null || v === undefined ? 'n/a' : v.toFixed(2));
const pct = (v) => `${Math.round(v * 100)}%`;
const signed = (v) => (v === null ? 'n/a' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`);
// More than a quarter of the comparisons flipping with position makes the grades weak evidence.
const POSITION_CAVEAT_RATE = 0.25;

/** { head, rows, note } for D.table. */
function gradedTable(summary) {
  const head = ['arm', 'records', 'mean grade (arm, 1-5)', 'mean grade (baseline)', 'difference', 'order disagreements', 'mean shift between orders', 'judge errors'];
  const rows = Object.entries(summary.arms).map(([arm, a]) => [
    arm, a.n, f1(a.armGrade), f1(a.baseGrade), signed(a.delta),
    a.n ? `${a.orderDisagreements} of ${a.n} (${pct(a.disagreementRate)})` : 'n/a', f1(a.shift), a.errors,
  ]);
  const rate = summary.total.disagreementRate;
  const note = rate !== null && rate > POSITION_CAVEAT_RATE
    ? `The preference flipped with answer position in ${pct(rate)} of the comparisons: the judges follow position often, so read these grades as weak evidence.`
    : 'A comparison is an order disagreement when one order favored the arm and the other favored the baseline.';
  return { head, rows, note };
}

module.exports = { gradedSummary, gradedTable, POSITION_CAVEAT_RATE };
