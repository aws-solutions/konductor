// SPDX-License-Identifier: Apache-2.0
'use strict';

// `compare --aa ARM` (FW-33, FW-34): ARM ran in both directories, so its base-to-head gap is the A/A noise. Every
// score is paired by task (each task's mean over its replicates), as report/aa.js and scenarios/pilot-gaps.js do. Each
// other paired arm's gap prints beside the A/A half-width with an inside or outside mark, and beside the detectable gap
// at 80% power (report/power.js), so the words are "no gap over X", never "no gap".

const { buildReport } = require('./aggregate.js');
const { pairedCellCI } = require('./stats.js');
const { aaNoise, noiseMark } = require('./aa.js');
const { detectableGap, gapWords } = require('./power.js');

// The 0-to-1 mean metrics, shown in points of 100. Medians and counts have no paired-mean floor.
const AA_METRICS = Object.freeze(['successRate', 'checkPassRate', 'rubricScore', 'rubricScoreJudged']);
const POINTS = 100;

/** Per task, `arm`'s overall series of each AA metric in `run` (one buildReport per task, baseline fixed). */
function perTaskSeries(run, tasks, arm, baseline) {
  const ids = [...new Set(run.runs.map((r) => r.taskId))].sort();
  const out = new Map();
  for (const t of ids) {
    const runs = run.runs.filter((r) => r.taskId === t);
    if (!runs.some((r) => r.armId === arm) || !runs.some((r) => r.armId === baseline)) continue;
    const { series } = buildReport({ run: { ...run, runs }, tasks, baseline });
    out.set(t, series[arm]?.overall ?? {});
  }
  return out;
}

/** [{ task, head: number[], base: number[] }] for one metric, in points, over the tasks both sides ran. */
function cellsOf(baseByTask, headByTask, metric) {
  return [...baseByTask.keys()].filter((t) => headByTask.has(t)).map((t) => ({
    task: t,
    base: (baseByTask.get(t)[metric] ?? []).map((v) => v * POINTS),
    head: (headByTask.get(t)[metric] ?? []).map((v) => v * POINTS),
  })).filter((c) => c.base.length && c.head.length);
}

/**
 * The A/A section of a compare. `pairs` are the matched arms ({ base, head }); `aaArm` must be one of them by name.
 * Returns { arm, floor: { metric: aaNoise }, rows: [{ arm, metric, gap, tasks, detectable, insideNoise }] } or
 * { refusal } when the arm is not in both runs.
 */
function aaSection({ base, head, tasks, pairs, aaArm, baseline }) {
  if (!pairs.some((p) => p.base === aaArm && p.head === aaArm)) return { refusal: `--aa ${aaArm}: the arm is not in both runs` };
  const series = (run, arm) => perTaskSeries(run, tasks, arm, baseline);
  const aaBase = series(base, aaArm);
  const aaHead = series(head, aaArm);
  const floor = {};
  for (const m of AA_METRICS) {
    const cells = cellsOf(aaBase, aaHead, m);
    if (cells.length) floor[m] = aaNoise(cells);
  }
  const rows = [];
  for (const p of pairs.filter((x) => x.base !== aaArm || x.head !== aaArm)) {
    const b = series(base, p.base);
    const h = series(head, p.head);
    for (const m of Object.keys(floor)) {
      const ci = pairedCellCI(cellsOf(b, h, m));
      if (ci.delta === null) continue;
      const sd = ci.se === null ? null : ci.se * Math.sqrt(ci.k);
      const aa = floor[m];
      rows.push({
        arm: p.base === p.head ? p.head : `${p.base}->${p.head}`, metric: m, gap: ci.delta, tasks: ci.k,
        detectable: detectableGap({ sd, tasks: ci.k }), insideNoise: aa.halfWidth === null ? null : ci.delta === 0 || Math.abs(ci.delta) < aa.halfWidth,
      });
    }
  }
  return { arm: aaArm, floor, rows };
}

const signed = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

/** The text lines of an A/A section. */
function aaLines(aa) {
  const L = [`A/A noise (--aa ${aa.arm}: ${aa.arm} in base against ${aa.arm} in head, paired by task; points of 100):`];
  for (const [m, f] of Object.entries(aa.floor)) {
    L.push(`  ${aa.arm} / ${m}: A/A gap ${f.delta === null ? 'n/a' : signed(f.delta)}, half-width ${f.halfWidth === null ? 'unknown (fewer than 2 paired tasks)' : `${f.halfWidth.toFixed(1)} over ${f.tasks} tasks`}`);
  }
  for (const r of aa.rows) {
    // No gap on any task (every per-task gap 0) is not a reading against noise or power: say so.
    const read = r.gap === 0 && r.detectable === 0 ? 'no change on any task' : `${noiseMark(r.gap, aa.floor[r.metric])}; ${gapWords({ gap: r.gap, detectable: r.detectable })}`;
    L.push(`  ${r.arm} / ${r.metric}: gap ${signed(r.gap)}; ${read}`);
  }
  if (!Object.keys(aa.floor).length) L.push('  none: no 0-to-1 mean metric has a paired task on both sides');
  return L;
}

module.exports = { aaSection, aaLines, AA_METRICS };
