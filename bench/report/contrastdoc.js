// SPDX-License-Identifier: Apache-2.0
'use strict';

// contrast at a detail level: a scorecard subset, forest plots of per-scope deltas against the base with the noise band,
// the overall verdict table per head, and (full) the existing contrast tables unchanged.

const C = require('./charts.js');
const D = require('./doc.js');
const { qualityOfRun } = require('./scores.js');
const { renderContrast, tableFor } = require('./contrast.js');
const { forestRows, tone, noiseBands, scorecardBlocks, headlineTable } = require('./build.js');
const { medianCI } = require('./stats.js');

const SUBSET = ['replicates', 'aa', 'controls', 'coverage', 'families', 'agreement', 'hidden', 'headroom', 'failures', 'pin', 'drift', 'provenance'];
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

function buildContrastDocument({ c, run, rows, scores, card, facts, weights, detail }) {
  const full = detail === 'full';
  const blocks = [];
  const charts = new Map();
  const add = (name, svg, alt) => { charts.set(name, svg); blocks.push(D.chart(name, svg, alt)); };
  const unit = c.costUnit === 'usd' ? 'USD' : 'credits';
  const rq = (r) => (r.outcome === 'infraError' || r.outcome === 'modelMismatch' ? null : qualityOfRun({ hidden: r.hidden, checks: r.checks, rubric: r.rubric }, weights)?.score ?? null);
  const groupOf = c.by === 'task' ? (r) => r.task : (r) => r.cls;

  blocks.push(D.h(1, `Contrast: ${c.heads.join(', ')} vs ${c.base} (${detail})`));
  blocks.push(D.p(`Run: ${(run.dirs || [run.dir]).length > 2 ? `${run.dirs.length} run directories merged` : (run.dirs || [run.dir]).join(', ')}  \nSuite ${c.run.suite ?? 'n/a'}, model ${c.run.model}, effort ${c.run.effort}. Noise rule: at least ${(c.minRel * 100).toFixed(0)}% and, with 3 or more runs a side, outside the bootstrap CIs. Grouped ${c.by === 'task' ? 'per task' : 'per task class'}.`));

  const subset = { ...card, criteria: card.criteria.filter((x) => SUBSET.includes(x.id) && x.status !== 'N/A') };
  blocks.push(D.h(2, 'Diligence scorecard (subset)'));
  blocks.push(...scorecardBlocks({ ...subset, counts: card.counts, blockers: card.blockers, rating: card.rating }, { compact: false }));
  blocks.push(D.note('The rating is computed from the full scorecard of this run; this table shows the criteria that matter for a contrast.'));

  blocks.push(D.h(2, 'Scores'));
  blocks.push(headlineTable(scores, Object.keys(scores.arms), unit));

  const heads = c.heads;
  const { qBand, cBand } = noiseBands(facts.aa, scores.arms[c.base]?.overall?.quality.value);
  const qRows = forestRows(rows, c.base, heads, rq, { higherBetter: true, groupOf }).map((x) => ({ ...x, tone: tone(x.delta, x.lo, x.hi, qBand.v, true) }));
  add('forest-quality', C.forestPlot({ title: `Quality delta versus ${c.base}, per ${c.by === 'task' ? 'task' : 'task class'}`, id: 'forest-quality', unit: 'quality points (head minus base)', rows: qRows, noise: { lo: -qBand.v, hi: qBand.v, label: qBand.label } }), 'Forest plot of quality deltas');
  const cRows = forestRows(rows, c.base, heads, (x) => x.credits, { rel: true, scale: 100, higherBetter: false, groupOf }).map((x) => ({ ...x, tone: tone(x.delta, x.lo, x.hi, cBand.v, false) }));
  add('forest-cost', C.forestPlot({ title: `Cost change versus ${c.base}, per ${c.by === 'task' ? 'task' : 'task class'}`, id: 'forest-cost', unit: '% change in cost per run (head vs base)', rows: cRows, noise: { lo: -cBand.v, hi: cBand.v, label: cBand.label } }), 'Forest plot of cost change');

  const good = rows.filter((r) => r.outcome === 'good');
  const pts = Object.keys(scores.arms).map((a) => {
    const g = good.filter((x) => x.arm === a).map((x) => x.credits).filter(fin);
    const m = g.length ? medianCI(g) : null;
    const q = scores.arms[a].overall?.quality;
    return { label: a, x: m?.median, xLo: m?.ciLow, xHi: m?.ciHigh, y: q?.value, yLo: q?.ciLow, yHi: q?.ciHigh, n: q?.n, isBase: a === c.base };
  });
  add('cost-vs-quality', C.scatter({ title: 'Cost vs quality, by arm', id: 'cost-vs-quality', xLabel: `${unit} per run (median, clean passes)`, yLabel: 'quality (0-100)', yBounds: [0, 100], xBounds: [0, Infinity], points: pts }), 'Cost versus quality scatter');

  blocks.push(D.h(2, 'Verdicts, overall'));
  for (const h of heads) {
    const cell = c.cells[h]?.overall;
    if (!cell) continue;
    blocks.push(D.md(`### ${h} vs ${c.base}\n\n${tableFor(cell)}`));
  }
  for (const n of c.notes) blocks.push(D.note(n));
  if (!full) return { blocks, charts, title: 'Contrast (quick)' };

  const taskOrder = [...new Set(rows.map((r) => r.task))].sort();
  add('dots-quality', C.dotPlot({ title: 'Quality per task, one dot per replicate', id: 'dots-quality', unit: 'quality (0-100)', min: 0, max: 100, rows: taskOrder.map((t) => ({ label: t, groups: Object.keys(scores.arms).map((a) => ({ name: a, values: rows.filter((x) => x.arm === a && x.task === t).map(rq).filter(fin) })) })) }), 'Per-task dot plot of quality');
  blocks.push(D.h(2, 'Scorecard, every criterion'));
  blocks.push(...scorecardBlocks(card, { compact: false }));
  blocks.push(D.h(2, 'Contrast tables (the existing report, unchanged)'));
  blocks.push(D.md(D.demote(renderContrast(c).replace(/^# [^\n]*\n+/, ''), 1)));
  return { blocks, charts, title: 'Contrast (full)' };
}

module.exports = { buildContrastDocument };
