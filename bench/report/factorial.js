// SPDX-License-Identifier: Apache-2.0
'use strict';

// The 2x2 pilot table: harness (Kiro CLI, Claude Code) by konductor (off, on) on one model, from four judged run
// directories. Nothing here calls a model or writes into a run directory. Each cell is loaded and scored with the same
// loaders and the same quality formula the other reports use; this module only checks that the four cells are
// comparable and then lays them side by side.
//
// Units never cross a harness. Quality is a 0..100 score and is compared everywhere. Cost is credits for Kiro and USD
// for Claude Code, so it is compared only as a konductor / vanilla ratio inside one harness.

const path = require('node:path');
const { loadRuns } = require('./load.js');
const { loadTasks } = require('../runner/lib/tasks.js');
const { analyze } = require('./generate.js');
const { enrichOrch } = require('./orch.js');
const { loadScoring, qualityOfRun } = require('./scores.js');
const { normalize } = require('./verdict.js');
const { pairedCellCI, MIN_CELLS } = require('./stats.js');
const D = require('./doc.js');

const SPECS = [
  { id: 'kiroVanilla', harness: 'kiro-cli', role: 'vanilla', unit: 'credits', flag: 'kiro-vanilla' },
  { id: 'kiroKonductor', harness: 'kiro-cli', role: 'konductor', unit: 'credits', flag: 'kiro-konductor' },
  { id: 'ccVanilla', harness: 'claude-code', role: 'vanilla', unit: 'USD', flag: 'cc-vanilla' },
  { id: 'ccKonductor', harness: 'claude-code', role: 'konductor', unit: 'USD', flag: 'cc-konductor' },
];
const HARNESS_NAME = { 'kiro-cli': 'Kiro CLI', 'claude-code': 'Claude Code' };
const MIN_REPS = 2;

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const uniq = (xs) => [...new Set(xs)];
const labelOf = (spec) => `${HARNESS_NAME[spec.harness]} ${spec.role}`;

/** claude-sonnet-5.5, us.anthropic.claude-sonnet-5-5 and claude-sonnet-5-5 name the same model. */
function canonicalModel(id) {
  return String(id ?? 'unknown').replace(/^(?:us|eu|apac|global)\.anthropic\./, '').replace(/\./g, '-');
}

function loadCell(spec, dirs, { tasks, weights, scoringFile }) {
  const where = `cell ${spec.id} (${labelOf(spec)})`;
  if (!Array.isArray(dirs) || !dirs.length) throw new Error(`${where}: no run directory given`);
  let run;
  try { run = loadRuns(dirs); } catch (e) { throw new Error(`${where}: ${e.message}`); }
  if (run.harness !== spec.harness) throw new Error(`${where}: expected a ${spec.harness} run directory, found ${run.harness}. Check the flags: ${spec.harness === 'kiro-cli' ? 'a Kiro cell cannot hold Claude Code or opencode results' : 'a Claude Code cell holds cc- arms only'}`);
  enrichOrch(run);
  const executed = run.runs.filter((e) => e.result.status !== 'budget_skipped');
  const arms = uniq(executed.map((e) => e.armId));
  if (arms.length !== 1) throw new Error(`${where}: exactly one arm per cell is expected, found ${arms.length ? arms.join(', ') : 'none'}`);
  const armId = arms[0];
  const isVanillaArm = armId === 'vanilla' || armId === 'cc-vanilla';
  if (spec.role === 'vanilla' && !isVanillaArm) throw new Error(`${where}: the arm is ${armId}, expected vanilla`);
  if (spec.role === 'konductor' && isVanillaArm) throw new Error(`${where}: the arm is ${armId}; a konductor cell needs a konductor arm`);
  if (spec.harness === 'claude-code' && !armId.startsWith('cc-')) throw new Error(`${where}: arm ${armId} is not a Claude Code arm`);

  const a = analyze({ run, tasks, baseline: armId, scoringFile });
  if (a.scores.unit !== spec.unit) throw new Error(`${where}: cost unit is ${a.scores.unit}, expected ${spec.unit}; units are never mixed across harnesses`);

  const j = run.judgments;
  if (!j) throw new Error(`${where}: not judged (no judgments.json). Run bench.js judge on each cell first`);
  if (j.backend === 'mixed') throw new Error(`${where}: judgments come from more than one backend (${(j.backends ?? []).join(', ')})`);
  const rubric = (j.rubric ?? []).filter((r) => r.score !== undefined);
  if (!rubric.length) throw new Error(`${where}: judgments.json has no rubric records; judge with the rubric mode`);
  const panel = {
    backend: j.backend ?? 'kiro',
    judges: [...(j.judges ?? [])].sort(),
    models: Object.fromEntries(Object.entries(j.backendInfo?.models ?? {}).map(([k, v]) => [k, v.bedrockModelId ?? null]).sort(([x], [y]) => (x < y ? -1 : 1))),
  };
  const revisions = {};
  for (const r of rubric) revisions[r.taskId] = uniq([...(revisions[r.taskId] ?? []), r.taskRevision ?? 'unrecorded']).sort();
  for (const [t, revs] of Object.entries(revisions)) if (revs.length > 1) throw new Error(`${where}: task ${t} was judged against more than one rubric revision (${revs.join(', ')})`);

  const rows = a.rows.map((r, i) => {
    const n = normalize(r, 0);
    const result = executed[i].result;
    const excluded = r.outcome === 'infraError' || r.outcome === 'modelMismatch';
    const q = excluded ? null : qualityOfRun({ hidden: n.hidden, checks: n.checks, rubric: n.rubric }, weights);
    const spawns = result.orch?.spawns ?? result.claudeCode?.spawned ?? result.subagentCalls ?? null;
    return {
      task: r.task, rep: r.rep, outcome: r.outcome, excluded, quality: q ? q.score : null, hasRubric: r.rubric !== null,
      cost: fin(r.credits) ? r.credits : null, censored: Boolean(r.censored), wallMs: r.wall, spawns: fin(spawns) ? spawns : null,
      timeout: r.outcome === 'timeout', zeroFilled: n.zeroFilled, model: result.claudeCode?.canonicalModel ?? result.model ?? null,
    };
  });
  if (!rows.length) throw new Error(`${where}: no executed runs`);

  const model = canonicalModel(run.config.canonicalModel ?? rows.find((r) => r.model)?.model ?? run.config.model);
  const shas = uniq(executed.map((e) => e.result.commitSha).filter(Boolean));
  const modelsSeen = uniq(executed.flatMap((e) => (e.result.claudeCode?.modelsSeen ?? [e.result.sessionModel ?? e.result.model]).filter(Boolean))).sort();
  return { spec, dirs: run.dirs ?? [run.dir], armId, rows, unit: a.scores.unit, panel, revisions, model, modelsSeen, pin: a.facts.pin ?? null, shas, harnessVersion: executed[0].result.harnessVersion ?? executed[0].result.kiroCliVersion ?? null };
}

const sameJson = (x, y) => JSON.stringify(x) === JSON.stringify(y);

function checkComparable(cells) {
  const [first] = cells;
  for (const c of cells.slice(1)) {
    if (c.panel.backend !== first.panel.backend) throw new Error(`judge backend differs: ${first.spec.id} used ${first.panel.backend}, ${c.spec.id} used ${c.panel.backend}`);
    if (!sameJson(c.panel.judges, first.panel.judges)) throw new Error(`judge panel differs: ${first.spec.id} has ${first.panel.judges.join(', ')}; ${c.spec.id} has ${c.panel.judges.join(', ')}`);
    if (!sameJson(c.panel.models, first.panel.models)) throw new Error(`judge model ids differ between ${first.spec.id} and ${c.spec.id}`);
    if (c.model !== first.model) throw new Error(`model differs: ${first.spec.id} ran ${first.model}, ${c.spec.id} ran ${c.model}`);
  }
  const taskSets = cells.map((c) => uniq(c.rows.map((r) => r.task)).sort());
  const all = uniq(taskSets.flat()).sort();
  const problems = cells.map((c, i) => {
    const missing = all.filter((t) => !taskSets[i].includes(t));
    return missing.length ? `${c.spec.id} lacks ${missing.join(', ')}` : null;
  }).filter(Boolean);
  if (problems.length) throw new Error(`the four cells do not hold the same tasks: ${problems.join('; ')}. Every cell must run the same task set`);
  for (const t of all) {
    const revs = cells.map((c) => (c.revisions[t] ?? ['none'])[0]);
    if (uniq(revs).length > 1) throw new Error(`task ${t} was judged against different rubric revisions: ${cells.map((c, i) => `${c.spec.id} ${revs[i]}`).join(', ')}`);
  }
  for (const h of ['kiro-cli', 'claude-code']) {
    const pair = cells.filter((c) => c.spec.harness === h);
    if (pair[0].unit !== pair[1].unit) throw new Error(`cost units differ inside ${h}: ${pair[0].unit} and ${pair[1].unit}`);
  }
  const kon = cells.filter((c) => c.spec.role === 'konductor');
  const [s1, s2] = kon.map((c) => c.shas);
  const notes = [];
  if (s1.length === 1 && s2.length === 1 && s1[0] !== s2[0]) throw new Error(`the two konductor cells were built from different commits (${s1[0].slice(0, 12)} and ${s2[0].slice(0, 12)}); both harnesses must use the same source tree`);
  if (!s1.length || !s2.length || s1.length > 1 || s2.length > 1) notes.push('The source commit of a konductor cell is not recorded or not unique, so "same source tree in both harnesses" was not verified from the results.');
  return { tasks: all, notes };
}

function summarizeCell(c, tasks) {
  const byTask = {};
  for (const t of tasks) {
    const rs = c.rows.filter((r) => r.task === t);
    const scored = rs.filter((r) => r.quality !== null);
    const kept = scored.filter((r) => !r.timeout);
    byTask[t] = {
      runs: rs.length, scored: scored.length, quality: mean(scored.map((r) => r.quality)), qualityExclTimeouts: mean(kept.map((r) => r.quality)),
      timeouts: rs.filter((r) => r.timeout).length, excluded: rs.filter((r) => r.excluded).length,
    };
  }
  const rows = c.rows;
  const executed = rows.length;
  const clean = rows.filter((r) => r.outcome === 'good' || r.outcome === 'checksFailed').length;
  const charged = rows.map((r) => r.cost).filter(fin);
  const total = charged.reduce((s, v) => s + v, 0);
  const spawns = rows.map((r) => r.spawns).filter(fin);
  const taskMeans = tasks.map((t) => byTask[t].quality).filter(fin);
  const taskMeansKept = tasks.map((t) => byTask[t].qualityExclTimeouts).filter(fin);
  const scoredRows = rows.filter((r) => !r.excluded);
  return {
    id: c.spec.id, harness: c.spec.harness, role: c.spec.role, arm: c.armId, unit: c.unit, dirs: c.dirs, model: c.model, harnessVersion: c.harnessVersion,
    runs: executed, success: clean, passed: rows.filter((r) => r.outcome === 'good').length, timeouts: rows.filter((r) => r.timeout).length,
    errors: rows.filter((r) => r.outcome === 'error').length, excluded: rows.filter((r) => r.excluded).length,
    quality: mean(taskMeans), qualityExclTimeouts: mean(taskMeansKept), byTask,
    rubricCoverage: scoredRows.length ? scoredRows.filter((r) => r.hasRubric).length / scoredRows.length : null,
    cost: { total, perRun: executed ? total / executed : null, perSuccess: clean ? total / clean : null, unmetered: rows.filter((r) => r.cost === null).length, censoredRuns: rows.filter((r) => r.censored).length },
    delegation: { runs: spawns.length, meanSpawns: mean(spawns), share: spawns.length ? spawns.filter((s) => s > 0).length / spawns.length : null },
    wallS: mean(rows.map((r) => r.wallMs).filter(fin)) === null ? null : mean(rows.map((r) => r.wallMs).filter(fin)) / 1000,
    modelIdentity: { models: c.modelsSeen, pin: c.pin },
  };
}

function minRepsOf(cells, tasks) {
  const n = tasks.map((t) => Math.min(...cells.map((c) => c.byTask[t].scored)));
  return { perTask: Object.fromEntries(tasks.map((t, i) => [t, n[i]])), min: n.length ? Math.min(...n) : 0 };
}

function contrastOf(label, tasks, cellsById, pick) {
  const perTask = tasks.map((t) => ({ task: t, value: pick(cellsById, t) })).filter((x) => fin(x.value));
  return { label, k: perTask.length, dropped: tasks.length - perTask.length, perTask, delta: mean(perTask.map((x) => x.value)) };
}

const q = (id, t, c) => c[id].byTask[t].quality ?? NaN;
const CONTRASTS = [
  { id: 'kiroEffect', label: 'konductor effect in Kiro CLI (konductor minus vanilla)', pick: (c, t) => q('kiroKonductor', t, c) - q('kiroVanilla', t, c) },
  { id: 'ccEffect', label: 'konductor effect in Claude Code (konductor minus vanilla)', pick: (c, t) => q('ccKonductor', t, c) - q('ccVanilla', t, c) },
  { id: 'harnessVanilla', label: 'harness effect, vanilla (Claude Code minus Kiro CLI)', pick: (c, t) => q('ccVanilla', t, c) - q('kiroVanilla', t, c) },
  { id: 'harnessKonductor', label: 'harness effect, konductor (Claude Code minus Kiro CLI)', pick: (c, t) => q('ccKonductor', t, c) - q('kiroKonductor', t, c) },
  { id: 'interaction', label: 'interaction (Claude Code konductor effect minus Kiro CLI konductor effect)', pick: (c, t) => (q('ccKonductor', t, c) - q('ccVanilla', t, c)) - (q('kiroKonductor', t, c) - q('kiroVanilla', t, c)) },
];

function ratio(num, den) { return fin(num) && fin(den) && den > 0 ? num / den : null; }

function costRatio(van, kon) {
  const bound = van.cost.censoredRuns > 0 && kon.cost.censoredRuns > 0 ? 'both' : kon.cost.censoredRuns > 0 ? 'lower' : van.cost.censoredRuns > 0 ? 'upper' : null;
  return { unit: kon.unit, vanillaPerRun: van.cost.perRun, konductorPerRun: kon.cost.perRun, perRun: ratio(kon.cost.perRun, van.cost.perRun), perSuccess: ratio(kon.cost.perSuccess, van.cost.perSuccess), bound, unmetered: { vanilla: van.cost.unmetered, konductor: kon.cost.unmetered } };
}

/**
 * dirs: { kiroVanilla, kiroKonductor, ccVanilla, ccKonductor }, each an array of finished and judged run directories
 * (several per cell are merged read-only, as `report` does). Throws when the four cells cannot be compared.
 */
function buildFactorial({ dirs, benchDir, extraDirs = [], scoringFile } = {}) {
  const tasks = loadTasks(benchDir, { extraDirs });
  const weights = loadScoring(scoringFile);
  const loaded = SPECS.map((spec) => loadCell(spec, dirs?.[spec.id], { tasks, weights, scoringFile }));
  const { tasks: taskIds, notes } = checkComparable(loaded);
  const cells = loaded.map((c) => summarizeCell(c, taskIds));
  const byId = Object.fromEntries(cells.map((c) => [c.id, c]));
  const reps = minRepsOf(cells, taskIds);
  const eligibleTasks = taskIds.filter((t) => reps.perTask[t] >= MIN_REPS);
  const intervals = eligibleTasks.length >= MIN_CELLS;
  const descriptiveReason = intervals ? null : reps.min < MIN_REPS && eligibleTasks.length === 0
    ? 'descriptive only: n=1 per task'
    : `descriptive only: fewer than ${MIN_CELLS} tasks have ${MIN_REPS} or more scored replicates in every cell (${eligibleTasks.length})`;
  const contrasts = Object.fromEntries(CONTRASTS.map((spec) => {
    const c = contrastOf(spec.label, taskIds, byId, spec.pick);
    c.interval = null;
    if (intervals && c.k >= MIN_CELLS) {
      const ci = pairedCellCI(c.perTask.map((x) => ({ head: [x.value], base: [0] })));
      c.interval = { low: ci.ciLow, high: ci.ciHigh, level: ci.level, df: ci.df, method: 'paired by task, t interval on the per-task differences' };
    }
    return [spec.id, c];
  }));
  const costRatios = { kiro: costRatio(byId.kiroVanilla, byId.kiroKonductor), cc: costRatio(byId.ccVanilla, byId.ccKonductor) };
  const timeouts = cells.filter((c) => c.timeouts > 0).map((c) => `${labelOf(c)}: ${c.timeouts}`);
  const out = [...notes];
  if (timeouts.length) out.push(`Timed-out runs stay in every mean, scored on whatever they produced (zero when nothing), and are marked in the task table. The "excluding timeouts" row drops them. Timeouts: ${timeouts.join('; ')}.`);
  if (cells.some((c) => c.rubricCoverage !== null && c.rubricCoverage < 1)) out.push(`Some runs have no rubric score (${cells.filter((c) => c.rubricCoverage !== null && c.rubricCoverage < 1).map((c) => `${labelOf(c)} ${Math.round(c.rubricCoverage * 100)}%`).join(', ')}); their quality uses the remaining components, so the cells are not scored on exactly the same inputs.`);
  const unpinned = cells.filter((c) => c.modelIdentity.pin && c.modelIdentity.pin.verified < c.modelIdentity.pin.runs);
  if (unpinned.length) out.push(`The model pin could not be verified from the session for every run in: ${unpinned.map((c) => `${labelOf(c)} (${c.modelIdentity.pin.verified}/${c.modelIdentity.pin.runs})`).join(', ')}. Kiro CLI vanilla runs record no session model; their model is the one passed on the command line. A run whose model was seen and differed would be counted as a mismatch.`);
  if (cells.some((c) => c.excluded > 0)) out.push(`Runs with an infra error or a model mismatch are left out of quality and counted in the table (${cells.filter((c) => c.excluded > 0).map((c) => `${labelOf(c)} ${c.excluded}`).join(', ')}).`);
  return {
    schemaVersion: 1, kind: 'factorial-2x2', tasks: taskIds, replicates: { min: reps.min, perTask: reps.perTask },
    descriptive: !intervals, descriptiveReason, model: loaded[0].model, units: { 'kiro-cli': 'credits', 'claude-code': 'USD' },
    judges: { backend: loaded[0].panel.backend, panel: loaded[0].panel.judges, models: loaded[0].panel.models },
    weights, cells, contrasts, costRatios, notes: out,
  };
}

// ---- rendering ----

const f1 = (v) => (fin(v) ? v.toFixed(1) : 'n/a');
const f2 = (v) => (fin(v) ? v.toFixed(2) : 'n/a');
const signed = (v) => (fin(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}` : 'n/a');
const pct = (v) => (fin(v) ? `${Math.round(v * 100)}%` : 'n/a');
const BOUND = { lower: '>= ', upper: '<= ', both: '~ ' };

function ratioText(r, key) {
  const v = r[key];
  if (!fin(v)) return 'n/a';
  return `${BOUND[r.bound] ?? ''}${v.toFixed(2)}x`;
}

function renderFactorial(res) {
  const [kv, kk, cv, ck] = SPECS.map((s) => res.cells.find((c) => c.id === s.id));
  const cols = [kv, kk, cv, ck];
  const head = ['task', ...cols.map((c) => `${HARNESS_NAME[c.harness]} ${c.role}`)];
  const taskRows = res.tasks.map((t) => [t, ...cols.map((c) => {
    const x = c.byTask[t];
    const flags = [x.timeouts ? `${x.timeouts} timeout${x.timeouts > 1 ? 's' : ''}` : '', x.excluded ? `${x.excluded} excluded` : ''].filter(Boolean).join(', ');
    return `${f1(x.quality)}${x.runs > 1 ? ` (n=${x.runs})` : ''}${flags ? ` [${flags}]` : ''}`;
  })]);
  const blocks = [
    D.h(1, '2x2 pilot: harness by konductor'),
    D.note(res.descriptive
      ? `${res.descriptiveReason}. These are the observed numbers of one pilot, not statistics: no interval is shown and no effect should be called real from them.`
      : `Intervals are paired by task (t interval on the per-task differences) over ${res.tasks.length} tasks with at least ${MIN_REPS} replicates per cell.`),
    D.p(`Model ${res.model}. Quality is the repository score (hidden tests 0.5, checks 0.2, rubric 0.3, renormalised over what a run has, times 100). Judges: ${res.judges.panel.join(', ')} (${res.judges.backend}). Tasks: ${res.tasks.join(', ')}.`),
    D.h(2, 'Quality by cell'),
    D.table(head, [...taskRows,
      ['**mean over tasks**', ...cols.map((c) => `**${f1(c.quality)}**`)],
      ['mean excluding timed-out runs', ...cols.map((c) => f1(c.qualityExclTimeouts))]]),
    D.h(2, 'Effects on quality (points)'),
    D.table(['contrast', 'estimate', 'per task', 'interval'], Object.values(res.contrasts).map((c) => [
      c.label, signed(c.delta), c.perTask.map((x) => `${x.task} ${signed(x.value)}`).join('; ') || 'n/a',
      c.interval ? `[${signed(c.interval.low)}, ${signed(c.interval.high)}] at ${Math.round(c.interval.level * 100)}%` : res.descriptive ? 'none (descriptive)' : 'n/a',
    ])),
    D.h(2, 'Cost: konductor over vanilla, inside each harness'),
    D.table(['harness', 'unit', 'vanilla per run', 'konductor per run', 'ratio per run', 'ratio per successful run'], [
      ['Kiro CLI', res.costRatios.kiro.unit, f2(res.costRatios.kiro.vanillaPerRun), f2(res.costRatios.kiro.konductorPerRun), ratioText(res.costRatios.kiro, 'perRun'), ratioText(res.costRatios.kiro, 'perSuccess')],
      ['Claude Code', res.costRatios.cc.unit, f2(res.costRatios.cc.vanillaPerRun), f2(res.costRatios.cc.konductorPerRun), ratioText(res.costRatios.cc, 'perRun'), ratioText(res.costRatios.cc, 'perSuccess')],
    ]),
    D.note('Credits and USD are different units. Only the ratio inside a harness is meaningful; the raw figures of the two harnesses are never compared. ">=" marks a ratio whose konductor side has runs with no metered cost, "<=" a vanilla side with such runs, "~" both.'),
    D.h(2, 'Reliability, delegation and model identity'),
    D.table(['cell', 'arm', 'runs', 'finished', 'all checks passed', 'timeouts', 'errors', 'excluded', 'spawns per run', 'runs that delegated', 'mean seconds', 'model identity'], cols.map((c) => [
      `${HARNESS_NAME[c.harness]} ${c.role}`, c.arm, c.runs, `${c.success}/${c.runs}`, `${c.passed}/${c.runs}`, c.timeouts, c.errors, c.excluded,
      f2(c.delegation.meanSpawns), pct(c.delegation.share), f1(c.wallS),
      c.modelIdentity.pin ? `${c.modelIdentity.pin.verified}/${c.modelIdentity.pin.runs} verified, ${c.modelIdentity.pin.mismatch} mismatch (${c.modelIdentity.models.join(', ') || c.model})` : c.model,
    ])),
  ];
  if (res.notes.length) blocks.push(D.h(2, 'Notes'), D.list(res.notes));
  blocks.push(D.h(2, 'Inputs'), D.list(cols.map((c) => `${HARNESS_NAME[c.harness]} ${c.role}: ${c.dirs.map((d) => path.basename(d)).join(', ')} (${c.unit})`)));
  return blocks;
}

module.exports = { buildFactorial, renderFactorial, canonicalModel, SPECS, CONTRASTS, MIN_REPS };
