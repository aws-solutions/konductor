// SPDX-License-Identifier: Apache-2.0
'use strict';

// The SDLC view of report-2x2: quality, cost and time per cell, the same three axes per SDLC phase of the quality pack,
// and konductor against vanilla paired by task with the spread. Reads what the 2x2 already loaded; calls no model.
//
// Quality is the repository score of each run: the median of the judges' rubric scores (SR-24) with the hidden tests
// and checks. The pack column of a phase is the median over the judges of that phase's criteria only. Cost is never
// compared across harnesses: credits and USD stay in their own cell, and the paired view gives a ratio inside one harness.

const { recordsOf } = require('./quality.js');
const { taskRevision } = require('../judge/revision.js');
const { VERDICT_VALUE } = require('../judge/config.js');
const { panelScore, MIN_JUDGES } = require('../judge/score.js');
const { declaredArtifacts } = require('../judge/pack/gate.js');
const D = require('./doc.js');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const runKey = (task, rep) => `${task}\u0000${rep}`;
// A paired difference smaller than this many quality points counts as a tie.
const TIE_POINTS = 0.5;

/** n, mean, median, sample standard deviation, min and max of the finite values in `xs`. */
function spread(xs) {
  const v = xs.filter(fin).sort((a, b) => a - b);
  if (!v.length) return { n: 0, mean: null, median: null, sd: null, min: null, max: null };
  const m = mean(v);
  const mid = Math.floor(v.length / 2);
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) : null;
  return { n: v.length, mean: m, median, sd, min: v[0], max: v[v.length - 1] };
}

/** The phase id of each criterion id, from the pack's `phases` list. */
function phaseOfCriterion(pack) {
  return new Map((pack.phases ?? []).flatMap((ph) => ph.criteria.map((id) => [id, ph.id])));
}

/** The phases a task exercises: those with a criterion that applies to an artifact type the task declares. */
function taskPhases(pack, task) {
  const declared = new Set(declaredArtifacts(pack, task));
  if (declared.has('code')) declared.add('change');
  const phaseOf = phaseOfCriterion(pack);
  return [...new Set(pack.criteria.filter((c) => c.appliesTo.some((t) => declared.has(t))).map((c) => phaseOf.get(c.id)))].filter(Boolean);
}

/**
 * Per run of one cell, the pack score of each phase: per judge the weighted mean of that phase's criteria (pass 1,
 * partial 0.5, fail 0), then the median over judges. A phase scored by fewer than MIN_JUDGES judges is left out (NO DATA).
 * Only records of the cell's arm made against the current pack and task revisions are read.
 */
function phasePackScores(pack, cell, tasks) {
  const phaseOf = phaseOfCriterion(pack);
  const weight = new Map(pack.criteria.map((c) => [c.id, c.weight]));
  const byRun = new Map();
  for (const r of recordsOf(cell.run).records) {
    if (r.armId !== cell.armId || r.judgeError || !Array.isArray(r.criteria) || r.packRevision !== pack.revision) continue;
    if (!tasks.has(r.taskId) || r.taskRevision !== taskRevision(tasks.get(r.taskId))) continue;
    const sums = {};
    for (const c of r.criteria) {
      const ph = phaseOf.get(c.id);
      if (!ph || VERDICT_VALUE[c.verdict] === undefined) continue;
      const s = (sums[ph] ||= { got: 0, total: 0 });
      s.got += weight.get(c.id) * VERDICT_VALUE[c.verdict];
      s.total += weight.get(c.id);
    }
    const k = runKey(r.taskId, r.replicate);
    if (!byRun.has(k)) byRun.set(k, {});
    for (const [ph, s] of Object.entries(sums)) (byRun.get(k)[ph] ||= []).push(s.got / s.total);
  }
  const out = new Map();
  for (const [k, phases] of byRun) {
    out.set(k, Object.fromEntries(Object.entries(phases).filter(([, xs]) => xs.length >= MIN_JUDGES).map(([ph, xs]) => [ph, panelScore(xs) * 100])));
  }
  return out;
}

/** Quality, cost and time of one cell's runs, restricted to `taskIds`. Quality spread is over the per-task means. */
function axesOf(cell, taskIds) {
  const rows = cell.rows.filter((r) => taskIds.includes(r.task));
  const taskMeans = taskIds.map((t) => mean(rows.filter((r) => r.task === t && fin(r.quality)).map((r) => r.quality)));
  return {
    quality: spread(taskMeans),
    costPerRun: mean(rows.map((r) => r.cost).filter(fin)),
    secondsPerRun: mean(rows.map((r) => r.wallMs).filter(fin)) === null ? null : mean(rows.map((r) => r.wallMs).filter(fin)) / 1000,
    runs: rows.length,
  };
}

const ratio = (a, b) => (fin(a) && fin(b) && b > 0 ? a / b : null);

/** Konductor against vanilla inside one harness, task by task: both spreads over replicates, the difference and the ratios. */
function pairedOf(van, kon, taskIds) {
  const perTask = taskIds.map((t) => {
    const pick = (c) => c.rows.filter((r) => r.task === t);
    const v = pick(van);
    const k = pick(kon);
    const vq = spread(v.map((r) => r.quality));
    const kq = spread(k.map((r) => r.quality));
    const mc = (rs) => mean(rs.map((r) => r.cost).filter(fin));
    const mt = (rs) => mean(rs.map((r) => r.wallMs).filter(fin));
    return { task: t, vanilla: vq, konductor: kq, delta: fin(vq.mean) && fin(kq.mean) ? kq.mean - vq.mean : null, costRatio: ratio(mc(k), mc(v)), timeRatio: ratio(mt(k), mt(v)) };
  });
  const deltas = perTask.map((x) => x.delta).filter(fin);
  return {
    perTask,
    summary: {
      ...spread(deltas),
      wins: deltas.filter((d) => d >= TIE_POINTS).length, losses: deltas.filter((d) => d <= -TIE_POINTS).length, ties: deltas.filter((d) => Math.abs(d) < TIE_POINTS).length,
      costRatio: spread(perTask.map((x) => x.costRatio)), timeRatio: spread(perTask.map((x) => x.timeRatio)),
    },
  };
}

/**
 * cells: the loaded 2x2 cells (spec, armId, rows, run); tasks: the task Map; pack: the loaded quality pack with phases;
 * taskIds: the tasks every cell holds. Returns the three axes per cell, per phase and the paired view per harness.
 */
function summarizeSdlc({ cells, tasks, pack, taskIds }) {
  const phaseTasks = Object.fromEntries((pack.phases ?? []).map((ph) => [ph.id, taskIds.filter((t) => tasks.has(t) && taskPhases(pack, tasks.get(t)).includes(ph.id))]));
  const packByCell = new Map(cells.map((c) => [c.spec.id, phasePackScores(pack, c, tasks)]));
  const phases = (pack.phases ?? []).map((ph) => ({
    id: ph.id, label: ph.label, tasks: phaseTasks[ph.id],
    cells: Object.fromEntries(cells.map((c) => {
      const packScores = [...packByCell.get(c.spec.id).values()].map((x) => x[ph.id]).filter(fin);
      return [c.spec.id, { ...axesOf(c, phaseTasks[ph.id]), pack: spread(packScores) }];
    })),
  }));
  const byId = Object.fromEntries(cells.map((c) => [c.spec.id, c]));
  return {
    cells: cells.map((c) => ({ id: c.spec.id, harness: c.spec.harness, role: c.spec.role, unit: c.unit, ...axesOf(c, taskIds) })),
    phases,
    uncovered: phases.filter((p) => !p.tasks.length).map((p) => p.id),
    paired: { kiro: pairedOf(byId.kiroVanilla, byId.kiroKonductor, taskIds), cc: pairedOf(byId.ccVanilla, byId.ccKonductor, taskIds) },
    tiePoints: TIE_POINTS,
  };
}

// ---- rendering ----

const f1 = (v) => (fin(v) ? v.toFixed(1) : 'n/a');
const f2 = (v) => (fin(v) ? v.toFixed(2) : 'n/a');
const signed = (v) => (fin(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}` : 'n/a');
const x2 = (v) => (fin(v) ? `${v.toFixed(2)}x` : 'n/a');
const range = (s) => (s.n ? `${f1(s.min)} to ${f1(s.max)}` : 'n/a');

/** Markdown blocks for a summary. `labelOf(id)` names a cell. */
function sdlcBlocks(s, labelOf) {
  const blocks = [
    D.h(2, 'Quality, cost and time'),
    D.p('Quality is each run\'s repository score: the median of the three judges\' rubric scores with the hidden tests and checks, 0 to 100. Spread is over the per-task means. Cost is in the cell\'s own unit; credits and USD are never compared.'),
    D.table(['cell', 'quality mean', 'median', 'sd', 'range', 'cost per run', 'seconds per run', 'runs'], s.cells.map((c) => [
      labelOf(c.id), f1(c.quality.mean), f1(c.quality.median), f1(c.quality.sd), range(c.quality), `${f2(c.costPerRun)} ${c.unit}`, f1(c.secondsPerRun), c.runs,
    ])),
    D.h(2, 'By SDLC phase'),
    D.p('A task counts in every phase whose pack criteria apply to what it asks for, so a code task also counts in change discipline. "pack" is the median over judges of that phase\'s criteria alone, mean over runs.'),
    D.table(['phase', 'tasks', ...s.cells.map((c) => labelOf(c.id))], s.phases.map((p) => [
      p.label, p.tasks.length,
      ...s.cells.map((c) => {
        const x = p.cells[c.id];
        return p.tasks.length ? `q ${f1(x.quality.mean)}, pack ${f1(x.pack.mean)}, ${f2(x.costPerRun)} ${c.unit}, ${f1(x.secondsPerRun)} s` : 'no task';
      }),
    ])),
  ];
  if (s.uncovered.length) blocks.push(D.note(`No task in this study exercises: ${s.uncovered.join(', ')}. Add tasks from suites/sdlc.json to cover them.`));
  for (const [key, name] of [['kiro', 'Kiro CLI'], ['cc', 'Claude Code']]) {
    const p = s.paired[key];
    blocks.push(
      D.h(2, `Paired by task, ${name}: konductor minus vanilla`),
      D.table(['task', 'vanilla mean (sd, n)', 'konductor mean (sd, n)', 'quality difference', 'cost ratio', 'time ratio'], p.perTask.map((x) => [
        x.task, `${f1(x.vanilla.mean)} (${f1(x.vanilla.sd)}, ${x.vanilla.n})`, `${f1(x.konductor.mean)} (${f1(x.konductor.sd)}, ${x.konductor.n})`, signed(x.delta), x2(x.costRatio), x2(x.timeRatio),
      ])),
      D.p(`Over ${p.summary.n} tasks: median difference ${signed(p.summary.median)}, mean ${signed(p.summary.mean)}, sd ${f1(p.summary.sd)}, range ${signed(p.summary.min)} to ${signed(p.summary.max)}; konductor ahead on ${p.summary.wins}, behind on ${p.summary.losses}, tied on ${p.summary.ties} (within ${s.tiePoints} points). Median cost ratio ${x2(p.summary.costRatio.median)}, median time ratio ${x2(p.summary.timeRatio.median)}.`),
    );
  }
  return blocks;
}

module.exports = { summarizeSdlc, sdlcBlocks, taskPhases, phasePackScores, spread, TIE_POINTS };
