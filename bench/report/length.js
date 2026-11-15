// SPDX-License-Identifier: Apache-2.0
'use strict';

// Output length of a run: the characters of its final text and the bytes of the files it created or changed. Longer is not
// better, so a stamped report shows both per arm and scope, warns when an arm differs a lot from the reference arm, and
// reports how closely artifact length tracks the rubric score within a task. Nothing here feeds a score or a judge prompt.

const fs = require('node:fs');
const path = require('node:path');
const { walk } = require('../judge/bundle.js');

// Largest ratio to the reference arm's mean, in either direction, before the diligence scorecard warns.
const LENGTH_RATIO_WARN = 1.5;
// Fewest runs for a rank correlation worth showing.
const MIN_CORRELATION_RUNS = 6;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Bytes of the files a run left in its workspace that are not in the task fixture as it was seeded: created files and files
 * whose content differs, at their full size. Tool state the judge never sees (see judge/bundle.js) is skipped. null when the
 * workspace or the fixture cannot be read.
 */
function artifactBytesOf(runDir, fixtureDir) {
  if (!fixtureDir || !fs.existsSync(fixtureDir)) return null;
  try {
    const wsRoot = path.join(runDir, 'workspace');
    if (!fs.existsSync(wsRoot)) return null;
    const seed = new Set(walk(fixtureDir).files);
    let bytes = 0;
    for (const rel of walk(wsRoot).files) {
      const mine = fs.readFileSync(path.join(wsRoot, rel));
      if (seed.has(rel) && mine.equals(fs.readFileSync(path.join(fixtureDir, rel)))) continue;
      bytes += mine.length;
    }
    return bytes;
  } catch { return null; }
}

/** { finalChars, artifactBytes } of a run entry; a value is null when the run did not record it. */
function lengthOf(entry, task) {
  const text = entry.result.finalText;
  return { finalChars: typeof text === 'string' ? text.length : null, artifactBytes: artifactBytesOf(entry.dir, task?.fixtureDir) };
}

/** Mean and count over the runs that have the value; mean is null when none do. */
function meanOf(values) {
  const have = values.map(num).filter((v) => v !== null);
  return { n: have.length, mean: have.length ? have.reduce((a, b) => a + b, 0) / have.length : null };
}

/** The cell's length block: per-run values summarised as { finalChars: {n, mean}, artifactBytes: {n, mean} }. */
const summarizeLength = (lengths) => ({ finalChars: meanOf(lengths.map((l) => l.finalChars)), artifactBytes: meanOf(lengths.map((l) => l.artifactBytes)) });

/** Average ranks (ties share the mean of their positions), 1-based. */
function ranksOf(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation of x and y within each task, pooled: ranks are taken inside a task and centred on that task's
 * mean rank, so a task that is long and scores high overall does not drive the result. With one task this is the plain
 * Spearman coefficient. points: [{ task, x, y }]. Returns { n, rho }; rho is null with fewer than two runs or when one side has no spread.
 */
function withinTaskSpearman(points) {
  const byTask = new Map();
  for (const p of points) byTask.set(p.task, [...(byTask.get(p.task) || []), p]);
  const xs = [];
  const ys = [];
  for (const group of byTask.values()) {
    const centre = (values) => { const r = ranksOf(values); const m = (group.length + 1) / 2; return r.map((v) => v - m); };
    xs.push(...centre(group.map((p) => p.x)));
    ys.push(...centre(group.map((p) => p.y)));
  }
  const n = xs.length;
  const sxy = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sxx = xs.reduce((s, x) => s + x * x, 0);
  const syy = ys.reduce((s, y) => s + y * y, 0);
  return { n, rho: n >= 2 && sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null };
}

/** The line contrast and compare print, or null when fewer than MIN_CORRELATION_RUNS runs have both numbers. */
function correlationLine(points) {
  const usable = points.filter((p) => num(p.x) !== null && num(p.y) !== null);
  if (usable.length < MIN_CORRELATION_RUNS) return null;
  const { n, rho } = withinTaskSpearman(usable);
  return `Output length: Spearman rank correlation between artifact bytes and rubric score, ranked within each task, ${rho === null ? 'not defined (no spread on one side)' : rho.toFixed(2)} over ${n} run(s). Longer output is not better; a high value means the rubric may reward length.`;
}

/**
 * Arms whose mean differs from the reference arm's by more than LENGTH_RATIO_WARN in either direction, for each of the two
 * measures. cells: arm -> overall cell. Returns [{ arm, measure, armMean, refMean, ratio }]; a measure with no reference mean
 * above 0 or no arm mean is skipped.
 */
function lengthOutliers(cells, reference, limit = LENGTH_RATIO_WARN) {
  const ref = cells[reference]?.length;
  if (!ref) return [];
  const out = [];
  for (const [arm, cell] of Object.entries(cells)) {
    if (arm === reference || !cell?.length) continue;
    for (const measure of ['finalChars', 'artifactBytes']) {
      const a = cell.length[measure]?.mean;
      const r = ref[measure]?.mean;
      if (a === null || a === undefined || !r || r <= 0) continue;
      if (a > limit * r || r > limit * a) out.push({ arm, measure, armMean: a, refMean: r, ratio: a / r });
    }
  }
  return out;
}

const MEASURE_LABEL = { finalChars: 'final text characters', artifactBytes: 'artifact bytes' };

/** "orch-abc artifact bytes 33244 vs vanilla 17000 (1.96x)" for each outlier. */
const describeOutliers = (outliers, reference) => outliers.map((o) => `${o.arm} ${MEASURE_LABEL[o.measure]} ${Math.round(o.armMean)} vs ${reference} ${Math.round(o.refMean)} (${o.ratio.toFixed(2)}x)`).join('; ');

module.exports = {
  LENGTH_RATIO_WARN, MIN_CORRELATION_RUNS, artifactBytesOf, lengthOf, meanOf, summarizeLength, ranksOf, withinTaskSpearman, correlationLine, lengthOutliers, describeOutliers,
};
