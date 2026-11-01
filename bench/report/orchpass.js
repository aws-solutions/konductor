// SPDX-License-Identifier: Apache-2.0
'use strict';

// The orchestrator pass rule, per (harness, model) cell. A test arm passes against vanilla when
//   cost:    it costs at most 2.0x vanilla, per executed run and per successful run (both ratios must be at most 2.0), and
//   quality: its mean quality is not below vanilla's by more than the spread of one vanilla run, which is the sample
//            standard deviation (n-1) of vanilla's per-run quality scores. A gain always meets it. A spread of 0 allows no drop.
// The A/A sentinel guards both: when the drift between an arm and its own repeat is not smaller than the effect measured, that
// criterion is uncertain and the cell is NOT ENOUGH EVIDENCE. Gaps in the evidence (under 3 scored runs a side, no A/A repeat,
// a vanilla spread that cannot be computed, a skill-only change whose skill never loaded) give NOT ENOUGH EVIDENCE too.
// Failed and timed-out runs stay in: a run with nothing to score counts as quality 0 and its cost counts.

const path = require('node:path');
const { loadRun } = require('./load.js');
const { loadTasks } = require('../runner/lib/tasks.js');
const { analyze, outPaths, writeOutputs, formatOf } = require('./generate.js');
const { computeScores, loadScoring, MIN_N } = require('./scores.js');
const { normalize, qualityList, aaGroups, refLabel } = require('./verdict.js');
const { enrichOrch, summarize } = require('./orch.js');
const { modelFamily } = require('../judge/config.js');

const PASS = 'PASS';
const FAIL = 'FAIL';
const NEE = 'NOT ENOUGH EVIDENCE';
const COST_MAX = 2.0;
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
 * c: { nHead, nBase, qualityDelta, baseSd, qualityDrift, costRunRatio, costSuccessRatio, costDrift, hasAA, target }
 * costSuccessRatio may be Infinity (the arm had no clean pass) or null (not computable); drift fields are null without an A/A repeat;
 * target is { blocks, reason } for a skill-only change, else null.
 */
function decideCell(c) {
  const evidence = [];
  if (c.nHead < MIN_N || c.nBase < MIN_N) evidence.push(`fewer than ${MIN_N} scored runs on a side (${c.nHead} for the arm, ${c.nBase} for vanilla)`);
  if (!c.hasAA) evidence.push('there is no A/A repeat in this cell, so drift cannot be told from an effect');
  if (!fin(c.baseSd)) evidence.push('vanilla has fewer than 2 scored runs, so its run-to-run spread is unknown');
  if (!fin(c.qualityDelta)) evidence.push('quality could not be computed for both sides');
  const ratios = [c.costRunRatio, c.costSuccessRatio].filter((r) => r === Infinity || fin(r));
  if (!ratios.length) evidence.push('the cost ratio could not be computed (vanilla has no cost or no clean pass)');
  if (c.target?.blocks) evidence.push(c.target.reason);

  const reasons = [];
  const worst = ratios.length ? Math.max(...ratios) : null;
  let cost = { status: 'unknown', worst };
  if (worst !== null) {
    const passes = worst <= COST_MAX;
    const effect = worst === Infinity ? Infinity : Math.abs(worst - 1);
    const uncertain = fin(c.costDrift) && !(effect > c.costDrift);
    cost = { status: uncertain ? 'uncertain' : passes ? 'pass' : 'fail', worst, passes };
    if (!passes) {
      const which = c.costRunRatio === worst ? 'per run' : 'per successful run';
      reasons.push(worst === Infinity ? 'the arm had no clean pass, so its cost per successful run is unbounded' : `it costs ${f2(worst)}x vanilla ${which}, over the ${f1(COST_MAX)}x limit`);
    }
    if (uncertain) reasons.push(`the A/A cost drift of ${Math.round(c.costDrift * 100)}% is not smaller than the cost difference of ${Math.round(effect * 100)}%`);
  }
  let quality = { status: 'unknown' };
  if (fin(c.qualityDelta) && fin(c.baseSd)) {
    const passes = c.qualityDelta >= -c.baseSd;
    const uncertain = fin(c.qualityDrift) && !(Math.abs(c.qualityDelta) > c.qualityDrift);
    quality = { status: uncertain ? 'uncertain' : passes ? 'pass' : 'fail', passes };
    if (!passes) reasons.push(`quality is below vanilla by ${f1(-c.qualityDelta)} points, more than the spread of one vanilla run (${f1(c.baseSd)} points)`);
    if (uncertain) reasons.push(`the A/A drift of ${f1(c.qualityDrift)} points is not smaller than the quality difference of ${f1(Math.abs(c.qualityDelta))} points`);
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
  return { call, reasons: call === NEE ? [...evidence, ...reasons] : call === FAIL ? reasons.filter((r) => !/A\/A/.test(r)) : [], evidence, cost, quality, rawPass };
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

function buildCell({ key, inputs, baseline, weights, unit, testArms, changedSkillsOverride, phases }) {
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
      const slot = pairs.get(pl) || { primary: pl, a: [], b: [], costA: [], costB: [] };
      const mine = input.rows.filter((r) => r.armId === primary);
      slot.a.push(...qualityList(mine, weights));
      slot.costA.push(...mine.map((r) => r.credits).filter(fin));
      for (const rep of repeats) {
        const rr = input.rows.filter((r) => r.armId === rep);
        slot.b.push(...qualityList(rr, weights));
        slot.costB.push(...rr.map((r) => r.credits).filter(fin));
        repeatOf.set(refLabel({ armId: rep, ...rr[0] }), pl);
      }
      pairs.set(pl, slot);
    }
  }
  const qDrifts = [...pairs.values()].filter((p) => p.a.length && p.b.length).map((p) => Math.abs(mean(p.a) - mean(p.b)));
  const cDrifts = [...pairs.values()].filter((p) => p.costA.length && p.costB.length && mean(p.costA) > 0).map((p) => Math.abs(mean(p.costB) / mean(p.costA) - 1));
  const hasAA = qDrifts.length > 0;
  const aa = { available: hasAA, qualityDrift: hasAA ? Math.max(...qDrifts) : null, costDrift: cDrifts.length ? Math.max(...cDrifts) : null, pairs: [...pairs.values()].map((p) => ({ arm: p.primary, runsA: p.a.length, runsB: p.b.length, qualityA: mean(p.a), qualityB: mean(p.b), costA: mean(p.costA), costB: mean(p.costB) })) };

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
    const delta = hq.length && bq.length ? mean(hq) - mean(bq) : null;
    const cost = common.size ? costStats(head, base, weights, unit) : costStats([], [], weights, unit);
    const target = out.aaRepeatOf ? null : targetOf(label, armId, headAll, changedSkillsOverride);
    const decision = out.aaRepeatOf ? null : decideCell({
      nHead: hq.length, nBase: bq.length, qualityDelta: delta, baseSd: sampleSd(bq), qualityDrift: aa.qualityDrift, costRunRatio: cost.ratioPerRun, costSuccessRatio: cost.ratioPerSuccess,
      costDrift: aa.costDrift, hasAA, target,
    });
    const failures = Object.fromEntries(['good', ...FAILURE_OUTCOMES].map((k) => [k, head.filter((r) => r.outcome === k).length]));
    const entries = head.map((r) => ({ armId, result: r.result, orchSource: r.orchSource }));
    return {
      ...out, call: decision?.call ?? null, reasons: decision?.reasons ?? [], rawPass: decision?.rawPass ?? null,
      cost: { ...cost, status: decision?.cost.status ?? null }, quality: { n: hq.length, baseN: bq.length, value: mean(hq), baseValue: mean(bq), delta, baseSd: sampleSd(bq), status: decision?.quality.status ?? null },
      target, notes: [target?.note].filter(Boolean), failures, failedAsZero: head.filter((r) => r.zeroFilled).length, runs: head.length, baseRuns: base.length,
      orch: summarize({ runs: entries }, { phases })[0] ?? null,
    };
  });
  return { key, baselineLabel, arms: arms.filter((a) => !a.skipped), aa, dirs: inputs.map((i) => i.dir) };
}

/**
 * dirs: finished run directories. Cells are (harness, model); directories of one cell are pooled by exact ref.
 * Returns { baseline, rule, cells, skippedDirs, notes, unit, weights }.
 */
function buildOrchestratorPass({ dirs, benchDir, extraDirs = [], baseline = 'vanilla', testArms = null, changedSkills = null, scoringFile, phases = null }) {
  const tasks = loadTasks(benchDir, { extraDirs });
  const weights = loadScoring(scoringFile);
  const byCell = new Map();
  const skippedDirs = [];
  let unit = 'credits';
  for (const d of dirs) {
    const run = loadRun(d);
    if (!run.runs.some((r) => r.armId === baseline)) {
      skippedDirs.push({ dir: run.dir, reason: `no run of the baseline arm "${baseline}" (arms present: ${[...new Set(run.runs.map((r) => r.armId))].join(', ')})` });
      continue;
    }
    enrichOrch(run);
    const a = analyze({ run, tasks, baseline, scoringFile });
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
  const cells = [...byCell.values()].map((c) => ({
    harness: c.harness, engine: c.engine, harnessLabel: c.harnessLabel, model: c.model, family: modelFamily(c.model),
    ...buildCell({ key: c.key, inputs: c.inputs, baseline, weights, unit, testArms, changedSkillsOverride: changedSkills, phases }),
  }));

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
  for (const s of skippedDirs) notes.push(`${s.dir} was left out: ${s.reason}.`);
  if (cells.some((c) => c.arms.some((a) => a.failedAsZero))) notes.push('A run that failed or timed out with nothing to score counts as quality 0, and its cost counts. No run is dropped; infra errors and model mismatches are left out of quality and listed.');
  const rule = {
    costMax: COST_MAX,
    cost: 'Cost ratio = the arm over vanilla, on the cells (run directory and task) both ran, as mean credits per executed run and as credits per successful run. Both must be at most 2.0.',
    quality: "The arm's mean quality minus vanilla's must be at least minus the sample standard deviation (n-1) of vanilla's per-run quality scores on those cells. A gain always meets it; a spread of 0 allows no drop.",
    drift: 'Drift = the largest gap between an arm and its A/A repeat (quality points, and the cost ratio of the repeat to the arm). A criterion whose measured effect is not larger than the drift is uncertain, and the cell is NOT ENOUGH EVIDENCE unless the other criterion fails clearly.',
    evidence: `NOT ENOUGH EVIDENCE also when a side has fewer than ${MIN_N} scored runs, the cell has no A/A repeat, vanilla has fewer than 2 scored runs, or a change that lives only in skills never loaded one.`,
    gpt: 'A GPT cell is judged on its own ratios to vanilla; the Claude cell on the same harness is shown beside it, ratio against ratio, never raw credits.',
  };
  return { schemaVersion: 1, kind: 'orchestrator-pass', baseline, rule, cells, skippedDirs, notes, unit: unit === 'USD' ? 'USD' : 'credits', weights, phases };
}

module.exports = { buildOrchestratorPass, decideCell, sampleSd, cellKeyOf, targetOf, PASS, FAIL, NEE, COST_MAX };
