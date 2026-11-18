// SPDX-License-Identifier: Apache-2.0
'use strict';

// Summary of the graded 1 to 5 judge mode. Each record compares one run with the baseline run of the same task and
// replicate, graded in both answer orders; `orderDisagreement` means the preference flipped with position. One judge's
// record already averages its two orders (judge/score.js combineGraded). Across judges the panel takes the median per
// run (SR-24), and a run graded by fewer than three judges is NO DATA.

const { panelScore, MIN_JUDGES } = require('../judge/score.js');

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const usable = (recs) => recs.filter((r) => !r.judgeError && Number.isFinite(r.armGrade));
const runKey = (r) => `${r.armId}\u0000${r.taskId}\u0000${r.replicate}`;

/** One judge's grades over `recs` (its records): mean grades, mean difference, order disagreements and errors. */
function judgeBlock(recs) {
  const ok = usable(recs);
  const dis = ok.filter((r) => r.orderDisagreement).length;
  return {
    n: ok.length, errors: recs.length - ok.length,
    armGrade: mean(ok.map((r) => r.armGrade)), baseGrade: mean(ok.map((r) => r.baseGrade)), delta: mean(ok.map((r) => r.delta)),
    orderDisagreements: dis, disagreementRate: ok.length ? dis / ok.length : null, shift: mean(ok.map((r) => r.shift).filter(Number.isFinite)),
  };
}

/**
 * The panel's grades over `recs` (every judge's records): per run the median over judges of the arm grade, the
 * baseline grade and the difference, then the mean over runs. `n` counts runs with a panel grade, `noData` the runs
 * graded by fewer than MIN_JUDGES judges, `records` every usable record. Order disagreements, shift and errors count records.
 */
function panelBlock(recs) {
  const records = judgeBlock(recs);
  const byRun = new Map();
  for (const r of usable(recs)) byRun.set(runKey(r), [...(byRun.get(runKey(r)) ?? []), r]);
  const runs = [...byRun.values()].map((rs) => ({
    armGrade: panelScore(rs.map((r) => r.armGrade)), baseGrade: panelScore(rs.map((r) => r.baseGrade)), delta: panelScore(rs.map((r) => r.delta)),
  })).filter((x) => x.armGrade !== null);
  return {
    ...records, n: runs.length, records: records.n, noData: byRun.size - runs.length,
    armGrade: mean(runs.map((x) => x.armGrade)), baseGrade: mean(runs.map((x) => x.baseGrade)), delta: mean(runs.map((x) => x.delta)),
  };
}

/** judgments: the parsed judgments.json (or null). isStale(record) drops records made against an older task wording. */
function gradedSummary(judgments, { isStale = () => false } = {}) {
  const recs = (judgments?.graded || []).filter((r) => !isStale(r));
  if (!recs.length) return { present: false, baselineId: null, arms: {}, total: { n: 0, errors: 0, orderDisagreements: 0, disagreementRate: null } };
  const arms = {};
  for (const armId of [...new Set(recs.map((r) => r.armId))]) {
    const mine = recs.filter((r) => r.armId === armId);
    arms[armId] = { ...panelBlock(mine), judges: Object.fromEntries([...new Set(mine.map((r) => r.judge))].sort().map((j) => [j, judgeBlock(mine.filter((r) => r.judge === j))])) };
  }
  const all = judgeBlock(recs);
  return { present: true, baselineId: recs[0].baselineId ?? null, arms, total: { n: all.n, errors: all.errors, orderDisagreements: all.orderDisagreements, disagreementRate: all.disagreementRate } };
}

const f1 = (v) => (v === null || v === undefined ? 'n/a' : v.toFixed(2));
const pct = (v) => `${Math.round(v * 100)}%`;
const signed = (v) => (v === null ? 'n/a' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`);
// More than a quarter of the comparisons flipping with position makes the grades weak evidence.
const POSITION_CAVEAT_RATE = 0.25;

/** One judge's grades as text: arm and baseline mean grade and the difference. */
const judgeText = (j, b) => `${j} ${f1(b.armGrade)} vs ${f1(b.baseGrade)} (${signed(b.delta)})`;

/** { head, rows, note } for D.table: per arm the panel median grades, every judge's own grades, and the order checks. */
function gradedTable(summary) {
  const head = ['arm', 'runs (records)', 'median grade (arm, 1-5)', 'median grade (baseline)', 'difference', 'each judge (arm vs baseline)', 'order disagreements', 'mean shift between orders', 'judge errors'];
  const rows = Object.entries(summary.arms).map(([arm, a]) => [
    arm, `${a.n} (${a.records ?? a.n})${a.noData ? `, NO DATA ${a.noData}` : ''}`, f1(a.armGrade), f1(a.baseGrade), signed(a.delta),
    Object.entries(a.judges ?? {}).map(([j, b]) => judgeText(j, b)).join('; ') || 'n/a',
    a.records ?? a.n ? `${a.orderDisagreements} of ${a.records ?? a.n} (${pct(a.disagreementRate)})` : 'n/a', f1(a.shift), a.errors,
  ]);
  const rate = summary.total.disagreementRate;
  const median = `Grades are the median over judges per run (each judge's grade is the mean of its two answer orders), then the mean over runs; a run graded by fewer than ${MIN_JUDGES} judges is NO DATA (SR-24).`;
  const note = rate !== null && rate > POSITION_CAVEAT_RATE
    ? `${median} The preference flipped with answer position in ${pct(rate)} of the comparisons: the judges follow position often, so read these grades as weak evidence.`
    : `${median} A comparison is an order disagreement when one order favored the arm and the other favored the baseline.`;
  return { head, rows, note };
}

module.exports = { gradedSummary, gradedTable, POSITION_CAVEAT_RATE };
