// SPDX-License-Identifier: Apache-2.0
'use strict';

// The orchestrator pass rule, per (harness, model) cell. A test arm passes against vanilla when
//   cost:    it costs at most 2.0x vanilla, per executed run and per successful run (both ratios must be at most 2.0), and
//   quality: the 95% interval of its quality minus vanilla's does not reach below minus the tolerance. The difference is paired by
//            cell (task and run directory) and the interval is a t interval on the per-cell differences. The tolerance is the
//            pooled within-cell standard deviation of vanilla's scores (how much one vanilla run varies on one task), at least
//            5 points. A point estimate below the tolerance fails; one above it whose interval reaches below it is NOT ENOUGH EVIDENCE.
// The A/A sentinel guards both: when the drift between an arm and its own repeat (at least 5 quality points) is not smaller than the
// effect measured, that criterion is uncertain and the cell is NOT ENOUGH EVIDENCE. Gaps in the evidence give NOT ENOUGH EVIDENCE too:
// under 3 scored runs a side, under 5 paired cells, no A/A repeat, no within-task spread, more than a fifth of the runs on a side
// without a score, arms scored on different components, a skill-only change whose skill never loaded.
// Failed and timed-out runs stay in: a run with nothing to score counts as quality 0 and its cost counts. A run with no metered cost
// is counted at the largest metered cost of its task when that decides the cost call.

const path = require('node:path');
const { loadRun } = require('./load.js');
const { loadTasks } = require('../runner/lib/tasks.js');
const { analyze, outPaths, writeOutputs, formatOf } = require('./generate.js');
const { computeScores, loadScoring, MIN_N } = require('./scores.js');
const { mergeQuote, passSensitivity } = require('./quotes.js');
const { otherRule } = require('../judge/views.js');
const { normalize, unisolatedReason, aaNoiseFromCells, levelText, qualityList, aaGroups, refLabel, pairCells, nonScoredOf, componentCheck, MAX_NONSCORED_SHARE, NOISE_FLOOR_PTS } = require('./verdict.js');
const { pairedCellCI, withinCellSd, MIN_CELLS } = require('./stats.js');
const { enrichOrch, summarize } = require('./orch.js');
const { modelFamily } = require('../judge/config.js');

const PASS = 'PASS';
const FAIL = 'FAIL';
const NEE = 'NOT ENOUGH EVIDENCE';
const COST_MAX = 2.0;
// The least tolerance for a quality drop, and the least A/A drift: the same 5 points the platform verdict uses as its noise floor.
const QUALITY_FLOOR_PTS = NOISE_FLOOR_PTS;
const FAILURE_OUTCOMES = ['checksFailed', 'timeout', 'error', 'infraError', 'modelMismatch'];

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f1 = (v) => v.toFixed(1);
const f2 = (v) => v.toFixed(2);

/** Sample standard deviation (n-1); null below two values. */
function sampleSd(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * The call for one arm in one cell, from plain numbers.
 * c: { nHead, nBase, cells, qualityDelta, qualityCiLow, qualityCiHigh, withinSd, qualityDrift, costRunRatio, costSuccessRatio, costBound,
 *      costDrift, hasAA, target, nonScored, components }
 * qualityDelta and its interval are the paired-by-cell difference; withinSd is vanilla's pooled within-cell spread. costSuccessRatio may be
 * Infinity (the arm had no clean pass) or null (not computable); drift fields are null without an A/A repeat; target is { blocks, reason }
 * for a skill-only change, else null. costBound is { censoredRuns, runRatio, successRatio } with unmetered runs of the arm counted at the
 * largest metered cost of their task, or null when every run was metered. nonScored is { head: { n, total }, base: { n, total } }.
 * components is { ok, reason }.
 */
function decideCell(c) {
  const evidence = [];
  if (c.unisolated && (c.unisolated.head || c.unisolated.base)) evidence.push(unisolatedReason(c.unisolated, 'vanilla'));
  if (c.nHead < MIN_N || c.nBase < MIN_N) evidence.push(`fewer than ${MIN_N} scored runs on a side (${c.nHead} for the arm, ${c.nBase} for vanilla)`);
  if ((c.cells ?? 0) < MIN_CELLS) evidence.push(`fewer than ${MIN_CELLS} paired task cells (${c.cells ?? 0}), too few for an interval that holds its 95% level`);
  if (!c.hasAA) evidence.push('there is no A/A repeat in this cell with two or more paired task cells, so drift cannot be told from an effect');
  if (!fin(c.withinSd)) evidence.push('vanilla has no task with two scored runs, so its within-task spread is unknown');
  if (!fin(c.qualityDelta) || !fin(c.qualityCiLow)) evidence.push('quality could not be computed for both sides, with an interval');
  const ratios = [c.costRunRatio, c.costSuccessRatio].filter((r) => r === Infinity || fin(r));
  if (!ratios.length) evidence.push('the cost ratio could not be computed (vanilla has no cost or no clean pass)');
  if (c.target?.blocks) evidence.push(c.target.reason);
  for (const [who, side] of [['the arm', c.nonScored?.head], ['vanilla', c.nonScored?.base]]) {
    if (side && side.total && side.n / side.total > MAX_NONSCORED_SHARE) evidence.push(`${side.n} of ${side.total} runs of ${who} have no score (infra errors, model mismatches or nothing to score), over the ${Math.round(MAX_NONSCORED_SHARE * 100)}% limit`);
  }
  if (c.components && c.components.ok === false) evidence.push(c.components.reason);

  const reasons = [];
  const worst = ratios.length ? Math.max(...ratios) : null;
  let cost = { status: 'unknown', worst };
  if (worst !== null) {
    const passes = worst <= COST_MAX;
    const effect = worst === Infinity ? Infinity : Math.abs(worst - 1);
    const drifting = fin(c.costDrift) && !(effect > c.costDrift);
    const bound = c.costBound && c.costBound.censoredRuns > 0 ? Math.max(...[c.costBound.runRatio, c.costBound.successRatio].filter((r) => r === Infinity || fin(r)), worst) : worst;
    const boundFails = passes && bound > COST_MAX;
    cost = { status: drifting || boundFails ? 'uncertain' : passes ? 'pass' : 'fail', worst, passes: passes && !boundFails, bound };
    if (!passes) {
      const which = c.costRunRatio === worst ? 'per run' : 'per successful run';
      reasons.push(worst === Infinity ? 'the arm had no clean pass, so its cost per successful run is unbounded' : `it costs ${f2(worst)}x vanilla ${which}, over the ${f1(COST_MAX)}x limit`);
    }
    if (boundFails) reasons.push(`${c.costBound.censoredRuns} run(s) of the arm have no metered cost and are counted at the largest metered cost of their task; on that bound it costs ${bound === Infinity ? 'an unbounded multiple of' : `${f2(bound)}x`} vanilla, over the ${f1(COST_MAX)}x limit`);
    if (drifting) reasons.push(`the A/A cost drift of ${Math.round(c.costDrift * 100)}% is not smaller than the cost difference of ${Math.round(effect * 100)}%`);
  }
  let quality = { status: 'unknown' };
  if (fin(c.qualityDelta) && fin(c.qualityCiLow) && fin(c.withinSd)) {
    const tolerance = Math.max(c.withinSd, QUALITY_FLOOR_PTS);
    const drift = fin(c.qualityDrift) ? Math.max(c.qualityDrift, QUALITY_FLOOR_PTS) : null;
    const dropped = c.qualityDelta < -tolerance;
    const clears = c.qualityCiLow >= -tolerance;
    const drifting = fin(drift) && !(Math.abs(c.qualityDelta) > drift);
    const reaches = !dropped && !clears;
    quality = { status: drifting || reaches ? 'uncertain' : clears ? 'pass' : 'fail', passes: clears, tolerance, drift };
    if (dropped) reasons.push(`quality is below vanilla by ${f1(-c.qualityDelta)} points, more than the tolerance of ${f1(tolerance)} points (vanilla's spread within a task, at least ${f1(QUALITY_FLOOR_PTS)})`);
    if (reaches) reasons.push(`the ${levelText(c.qualityLevel ?? 0.95)} interval of the quality difference [${f1(c.qualityCiLow)}, ${f1(c.qualityCiHigh)}] reaches below the tolerance of -${f1(tolerance)} points`);
    if (drifting) reasons.push(`the A/A drift of ${f1(drift)} points is not smaller than the quality difference of ${f1(Math.abs(c.qualityDelta))} points`);
  }

  const costFails = cost.status === 'fail' || (cost.status === 'uncertain' && cost.passes === false);
  const qualityFails = quality.status === 'fail' || (quality.status === 'uncertain' && quality.passes === false);
  const costUnknown = cost.status === 'unknown';
  const qualityUnknown = quality.status === 'unknown';
  const rawPass = costFails || qualityFails ? false : costUnknown || qualityUnknown ? null : true;

  let call;
  if (evidence.length) call = NEE;
  else if (cost.status === 'fail' || quality.status === 'fail') call = FAIL;
  else if (cost.status === 'uncertain' || quality.status === 'uncertain') call = NEE;
  else call = PASS;
  return { call, reasons: call === NEE ? [...evidence, ...reasons] : call === FAIL ? reasons.filter((r) => !/A\/A|no metered cost|reaches below/.test(r)) : [], evidence, cost, quality, rawPass };
}

// ---- cells ----

const isGpt = (model) => modelFamily(model) === 'gpt';

/** { harness, engine, model, key } of a loaded run: from run-config, else from its first result. */
function cellKeyOf(run) {
  const r0 = run.runs[0].result;
  const harness = run.config.harness ?? run.harness ?? 'kiro-cli';
  const engine = run.config.agentEngine ?? r0.agentEngine ?? null;
  const model = run.config.model ?? r0.model ?? 'unknown';
  const harnessLabel = `${harness}${engine ? ` ${engine}` : ''}`;
  return { harness, engine, model, harnessLabel, key: `${harnessLabel} / ${model}` };
}

function targetOf(label, armId, rows, override) {
  const results = rows.filter((r) => r.label === label).map((r) => r.result);
  const recorded = results.map((r) => r.changedSkills).find((x) => x && x.names?.length);
  const names = override?.length ? override : recorded?.names ?? [];
  if (!names.length) return null;
  const onlySkills = override?.length ? true : Boolean(recorded?.onlySkills);
  const withData = results.filter((r) => Array.isArray(r.skillsLoaded));
  const loaded = Object.fromEntries(names.map((n) => [n, withData.filter((r) => r.skillsLoaded.some((s) => s.name === n)).length]));
  const neverLoaded = names.filter((n) => !loaded[n]);
  const hasData = withData.length > 0;
  const out = { names, onlySkills, runsWithLoadData: withData.length, loaded, neverLoaded, blocks: false, reason: null, note: null };
  if (onlySkills && !hasData) return { ...out, blocks: true, reason: `no skill-load data was recorded for ${armId}, so whether ${names.join(', ')} loaded cannot be checked and the change lives only in skills` };
  if (onlySkills && hasData && neverLoaded.length === names.length) return { ...out, blocks: true, reason: `skill ${names.join(', ')} never loaded in any run of ${armId}, so a change that lives only in ${names.length > 1 ? 'those skills' : 'that skill'} cannot have acted` };
  if (hasData && neverLoaded.length) return { ...out, note: `skill ${neverLoaded.join(', ')} never loaded in any run of ${armId}` };
  return out;
}

function costStats(headRows, baseRows, weights, unit) {
  const per = (rs) => mean(rs.map((r) => r.credits).filter(fin));
  const h = per(headRows);
  const b = per(baseRows);
  const sc = computeScores({ rows: [...headRows.map((r) => ({ ...r, arm: 'head' })), ...baseRows.map((r) => ({ ...r, arm: 'base' }))], baseline: 'base', weights, unit });
  const eff = sc.arms.head?.overall?.efficiency?.creditsPerSuccess;
  const headGood = headRows.filter((r) => r.outcome === 'good').length;
  const baseGood = baseRows.filter((r) => r.outcome === 'good').length;
  let perSuccess = eff?.ratio ?? null;
  if (headGood === 0 && baseGood > 0) perSuccess = Infinity;
  return {
    headCleanPasses: headGood, baseCleanPasses: baseGood, perRunMean: h, basePerRunMean: b, ratioPerRun: fin(h) && fin(b) && b > 0 ? h / b : null,
    ratioPerSuccess: perSuccess, perSuccessValue: eff?.value ?? null, basePerSuccessValue: eff?.baseValue ?? null, ciLow: eff?.ciLow ?? null, ciHigh: eff?.ciHigh ?? null,
    totalHead: headRows.reduce((s, r) => s + (fin(r.credits) ? r.credits : 0), 0), totalBase: baseRows.reduce((s, r) => s + (fin(r.credits) ? r.credits : 0), 0),
  };
}

// A run is unmetered when it ended before its last metering event or reported no credits at all. Its charged cost is then a lower bound
// (or 0). The bound used when that decides a call: each unmetered run of the arm is charged the largest metered cost among the arm's runs
// of the same task, else of the arm. Vanilla keeps its charged figure, which only makes the arm's ratio look worse than the bound.
const unmetered = (r) => r.censored === true || !fin(r.creditsObserved);

function boundedCost(headRows, baseRows, weights, unit) {
  const open = headRows.filter(unmetered);
  if (!open.length) return null;
  const metered = headRows.filter((r) => !unmetered(r) && fin(r.credits));
  const top = (rs) => (rs.length ? Math.max(...rs.map((r) => r.credits)) : null);
  const overall = top(metered);
  const adjusted = headRows.map((r) => {
    if (!unmetered(r)) return r;
    const t = top(metered.filter((m) => m.task === r.task)) ?? overall;
    return fin(t) ? { ...r, credits: Math.max(r.credits ?? 0, t) } : r;
  });
  const bound = costStats(adjusted, baseRows, weights, unit);
  return { censoredRuns: open.length, runRatio: bound.ratioPerRun, successRatio: bound.ratioPerSuccess };
}

function buildCell({ key, inputs, baseline, weights, unit, testArms, changedSkillsOverride, phases, comparisons = 1 }) {
  const all = inputs.flatMap((i) => i.rows);
  const baseRows = all.filter((r) => r.armId === baseline);
  const baselineLabel = [...new Set(baseRows.map((r) => r.label))].join(' + ');
  // A/A pairs per directory, pooled by the primary's exact ref.
  const pairs = new Map();
  const repeatOf = new Map();
  for (const input of inputs) {
    for (const g of aaGroups(input, baseline)) {
      const [primary, ...repeats] = g;
      const pl = refLabel({ armId: primary, ...input.rows.find((r) => r.armId === primary) });
      const slot = pairs.get(pl) || { primary: pl, a: [], b: [], cells: [], costA: [], costB: [] };
      const mine = input.rows.filter((r) => r.armId === primary && r.comparable);
      slot.a.push(...qualityList(mine, weights));
      slot.cells.push(...pairCells(mine, input.rows.filter((r) => repeats.includes(r.armId) && r.comparable), weights));
      slot.costA.push(...mine.map((r) => r.credits).filter(fin));
      for (const rep of repeats) {
        const repAll = input.rows.filter((r) => r.armId === rep);
        const rr = repAll.filter((r) => r.comparable);
        slot.b.push(...qualityList(rr, weights));
        slot.costB.push(...rr.map((r) => r.credits).filter(fin));
        repeatOf.set(refLabel({ armId: rep, ...repAll[0] }), pl);
      }
      pairs.set(pl, slot);
    }
  }
  // Drift in quality points is pooled over every paired cell of each A/A group (see aaNoiseFromCells).
  const noiseOf = new Map([...pairs.values()].map((p) => [p, aaNoiseFromCells(p.cells)]));
  const qDrifts = [...noiseOf].filter(([, n]) => n.available).map(([, n]) => n.pts);
  const cDrifts = [...pairs.values()].filter((p) => p.costA.length && p.costB.length && mean(p.costA) > 0).map((p) => Math.abs(mean(p.costB) / mean(p.costA) - 1));
  const hasAA = qDrifts.length > 0;
  const aa = { available: hasAA, qualityDrift: hasAA ? Math.max(...qDrifts) : null, costDrift: cDrifts.length ? Math.max(...cDrifts) : null, pairs: [...pairs.values()].map((p) => ({ arm: p.primary, runsA: p.a.length, runsB: p.b.length, qualityA: mean(p.a), qualityB: mean(p.b), cells: noiseOf.get(p).k, meanDiff: noiseOf.get(p).meanDiff, pts: noiseOf.get(p).pts, costA: mean(p.costA), costB: mean(p.costB) })) };

  const labels = [...new Set(all.filter((r) => r.armId !== baseline).map((r) => r.label))];
  const arms = labels.map((label) => {
    const headAll = all.filter((r) => r.label === label);
    const armId = headAll[0].armId;
    const out = { label, armId, aaRepeatOf: repeatOf.get(label) ?? null, commitSha: headAll[0].commitSha, contentHash: headAll[0].contentHash };
    if (testArms && !testArms.includes(armId) && !out.aaRepeatOf) return { ...out, skipped: true };
    const cellsOf = (rs) => new Set(rs.map((r) => `${r.src}|${r.task}`));
    const baseCells = cellsOf(baseRows);
    const common = new Set([...cellsOf(headAll)].filter((c) => baseCells.has(c)));
    const head = headAll.filter((r) => common.has(`${r.src}|${r.task}`));
    const base = baseRows.filter((r) => common.has(`${r.src}|${r.task}`));
    const hq = qualityList(head, weights);
    const bq = qualityList(base, weights);
    const pcells = pairCells(head, base, weights);
    const paired = pairedCellCI(pcells.map((x) => ({ head: x.head, base: x.base })), { comparisons });
    const within = withinCellSd(pcells.map((x) => x.base));
    const nonScored = { head: nonScoredOf(head, weights), base: nonScoredOf(base, weights) };
    const components = componentCheck(pcells);
    const unpaired = hq.length && bq.length ? mean(hq) - mean(bq) : null;
    const cost = common.size ? costStats(head, base, weights, unit) : costStats([], [], weights, unit);
    const costBound = common.size ? boundedCost(head, base, weights, unit) : null;
    const target = out.aaRepeatOf ? null : targetOf(label, armId, headAll, changedSkillsOverride);
    const decision = out.aaRepeatOf ? null : decideCell({
      nHead: hq.length, nBase: bq.length, cells: paired.k, qualityDelta: paired.delta, qualityCiLow: paired.ciLow, qualityCiHigh: paired.ciHigh, qualityLevel: paired.level, withinSd: within.sd, baseSd: sampleSd(bq),
      unisolated: { head: head.filter((r) => !r.comparable).length, base: base.filter((r) => !r.comparable).length, headTotal: head.length, baseTotal: base.length },
      qualityDrift: aa.qualityDrift, costRunRatio: cost.ratioPerRun, costSuccessRatio: cost.ratioPerSuccess, costBound, costDrift: aa.costDrift, hasAA, target, nonScored, components,
    });
    const failures = Object.fromEntries(['good', ...FAILURE_OUTCOMES].map((k) => [k, head.filter((r) => r.outcome === k).length]));
    const entries = head.map((r) => ({ armId, result: r.result, orchSource: r.orchSource }));
    return {
      ...out, call: decision?.call ?? null, reasons: decision?.reasons ?? [], rawPass: decision?.rawPass ?? null,
      cost: { ...cost, bound: costBound, status: decision?.cost.status ?? null },
      quality: {
        n: hq.length, baseN: bq.length, value: mean(hq), baseValue: mean(bq), delta: paired.delta, deltaCiLow: paired.ciLow, deltaCiHigh: paired.ciHigh, k: paired.k, droppedCells: paired.droppedCells, method: paired.method, level: paired.level, comparisons: paired.comparisons, p: paired.p, pAdjusted: paired.pAdjusted,
        unpairedDelta: unpaired, withinSd: within.sd, withinCells: within.cells, tolerance: fin(within.sd) ? Math.max(within.sd, QUALITY_FLOOR_PTS) : null, baseSd: sampleSd(bq), status: decision?.quality.status ?? null,
      },
      nonScored, components, target, notes: [target?.note].filter(Boolean), failures, failedAsZero: head.filter((r) => r.zeroFilled).length, runs: head.length, baseRuns: base.length,
      orch: summarize({ runs: entries }, { phases })[0] ?? null,
    };
  });
  return { key, baselineLabel, arms: arms.filter((a) => !a.skipped), aa, dirs: inputs.map((i) => i.dir) };
}

/**
 * dirs: finished run directories. Cells are (harness, model); directories of one cell are pooled by exact ref.
 * Returns { baseline, rule, cells, skippedDirs, notes, unit, weights }.
 */
function buildOrchestratorPass({ dirs, benchDir, extraDirs = [], baseline = 'vanilla', testArms = null, changedSkills = null, scoringFile, phases = null, qualityPack = null, quoteRule = null, withSensitivity = true }) {
  const tasks = loadTasks(benchDir, { extraDirs });
  const weights = loadScoring(scoringFile, { allowPack: Boolean(qualityPack) });
  const byCell = new Map();
  const skippedDirs = [];
  const quotes = [];
  let unit = 'credits';
  for (const d of dirs) {
    const run = loadRun(d);
    if (!run.runs.some((r) => r.armId === baseline)) {
      skippedDirs.push({ dir: run.dir, reason: `no run of the baseline arm "${baseline}" (arms present: ${[...new Set(run.runs.map((r) => r.armId))].join(', ')})` });
      continue;
    }
    enrichOrch(run);
    const a = analyze({ run, tasks, baseline, scoringFile, qualityPack, quoteRule });
    quotes.push(a.quote);
    unit = a.scores.unit;
    const executed = run.runs.filter((e) => e.result.status !== 'budget_skipped');
    const rows = a.rows.map((r, i) => ({ ...normalize(r, 0), result: executed[i].result, orchSource: executed[i].orchSource }));
    const cell = cellKeyOf(run);
    const slot = byCell.get(cell.key) ?? { ...cell, inputs: [] };
    const src = slot.inputs.length;
    slot.inputs.push({ src, dir: run.dir, run, rows: rows.map((r) => ({ ...r, src })) });
    byCell.set(cell.key, slot);
  }
  if (!byCell.size) throw new Error(`no run directory has the baseline arm "${baseline}"`);
  // Every test arm in every cell is one comparison with vanilla; an A/A repeat is not. With m comparisons each quality interval
  // is widened to level 1 - 0.05/m (Bonferroni), so the cells are built once to count the arms and again at that level.
  const buildAll = (comparisons) => [...byCell.values()].map((c) => ({
    harness: c.harness, engine: c.engine, harnessLabel: c.harnessLabel, model: c.model, family: modelFamily(c.model),
    ...buildCell({ key: c.key, inputs: c.inputs, baseline, weights, unit, testArms, changedSkillsOverride: changedSkills, phases, comparisons }),
  }));
  let cells = buildAll(1);
  const comparisons = Math.max(1, cells.reduce((n, c) => n + c.arms.filter((a) => !a.aaRepeatOf).length, 0));
  if (comparisons > 1) cells = buildAll(comparisons);

  const notes = [];
  for (const c of cells.filter((x) => isGpt(x.model))) {
    const ref = cells.find((x) => x.harnessLabel === c.harnessLabel && x.family === 'claude');
    c.ratioComparison = ref ? c.arms.filter((a) => !a.aaRepeatOf).map((a) => {
      const other = ref.arms.find((x) => x.armId === a.armId && !x.aaRepeatOf);
      if (!other) return null;
      const rel = (g, cl) => (fin(g) && fin(cl) && cl > 0 ? g / cl : null);
      return {
        armId: a.armId, reference: ref.key,
        gpt: { perRun: a.cost.ratioPerRun, perSuccess: a.cost.ratioPerSuccess }, claude: { perRun: other.cost.ratioPerRun, perSuccess: other.cost.ratioPerSuccess },
        relativePerRun: rel(a.cost.ratioPerRun, other.cost.ratioPerRun), relativePerSuccess: rel(a.cost.ratioPerSuccess, other.cost.ratioPerSuccess),
      };
    }).filter(Boolean) : [];
    if (!ref) notes.push(`${c.model} has no Claude cell on the same harness to compare ratios with. Add a Claude run directory, or read its ratios to vanilla on their own.`);
  }
  for (const name of testArms ?? []) {
    const hits = cells.flatMap((c) => c.arms.filter((x) => x.armId === name).map((x) => ({ c, x })));
    if (!hits.length) notes.push(`--test-arms names ${name}, but no run directory with the baseline arm "${baseline}" has an arm with that id. It has no call.`);
    for (const { c, x } of hits.filter((h) => h.x.aaRepeatOf)) notes.push(`--test-arms names ${name}, which is an A/A repeat of ${x.aaRepeatOf} in ${c.key}. A repeat measures drift and gets no call. Name ${x.aaRepeatOf} to get one.`);
  }
  for (const s of skippedDirs) notes.push(`${s.dir} was left out: ${s.reason}.`);
  if (comparisons > 1) notes.push(`${comparisons} test arms are compared with vanilla in this report, so each quality interval is widened to the Bonferroni level of ${levelText(1 - 0.05 / comparisons)} (0.05 divided by ${comparisons}).`);
  if (cells.some((c) => c.arms.some((a) => a.failedAsZero))) notes.push('A run that failed or timed out with nothing to score counts as quality 0, and its cost counts. Infra errors and model mismatches are left out of quality and listed, and a side with more than a fifth of its runs in that state gets no call.');
  const costNoun = cells.length && cells.every((c) => c.harness === 'claude-code') ? 'USD at list price' : 'credits';
  const rule = {
    costMax: COST_MAX,
    qualityFloorPts: QUALITY_FLOOR_PTS,
    minCells: MIN_CELLS,
    maxNonScoredShare: MAX_NONSCORED_SHARE,
    cost: `Cost ratio = the arm over vanilla, on the cells (run directory and task) both ran, as mean ${costNoun} per executed run and as ${costNoun} per successful run. Both must be at most 2.0. A run with no metered cost is counted at the largest metered cost of its task when that is what pushes a ratio over 2.0, and the cell is then NOT ENOUGH EVIDENCE.`,
    quality: "Quality is paired by cell (one task in one run directory): each cell contributes the arm's mean score minus vanilla's, and the interval is a t interval on those differences, at 95% for one test arm and at the Bonferroni level 1 - 0.05/m when m test arms are compared in the report. The tolerance is the pooled within-cell standard deviation of vanilla's scores, at least 5 points. The arm passes when the lower end of the interval is at least minus the tolerance. A difference below minus the tolerance fails; one above it whose interval reaches below it is NOT ENOUGH EVIDENCE. A gain passes.",
    drift: 'Drift = the quality drift pooled over every paired task cell of an arm and its A/A repeat (the larger end of the 95% interval of the per-cell differences, at least 5 points) and the largest cost ratio gap of the repeat to the arm. A criterion whose measured effect is not larger than the drift is uncertain, and the cell is NOT ENOUGH EVIDENCE unless the other criterion fails clearly.',
    evidence: `NOT ENOUGH EVIDENCE also when a side has fewer than ${MIN_N} scored runs, the cell has fewer than ${MIN_CELLS} paired task cells, no A/A repeat, no task where vanilla has two scored runs, more than a fifth of the runs on a side have no score (infra error, model mismatch, nothing to score), the arm and vanilla were scored on different components in any cell, or a change that lives only in skills never loaded one.`,
    gpt: 'A GPT cell is judged on its own ratios to vanilla; the Claude cell on the same harness is shown beside it, ratio against ratio, never raw credits.',
  };
  const quote = mergeQuote(quotes);
  const result = { schemaVersion: 1, kind: 'orchestrator-pass', baseline, comparisons, rule, cells, skippedDirs, notes, unit: unit === 'USD' ? 'USD' : 'credits', weights, phases, quote };
  if (withSensitivity) {
    result.sensitivity = passSensitivity(result, buildOrchestratorPass({ dirs, benchDir, extraDirs, baseline, testArms, changedSkills, scoringFile, phases, qualityPack, quoteRule: otherRule(quote.requested), withSensitivity: false }));
  }
  return result;
}

module.exports = { buildOrchestratorPass, decideCell, sampleSd, cellKeyOf, targetOf, boundedCost, PASS, FAIL, NEE, COST_MAX, QUALITY_FLOOR_PTS };
