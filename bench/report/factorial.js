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
const { loadScoring, qualityOfRun, checksModeNote } = require('./scores.js');
const { spawnsOf } = require('./process.js');
const { normalize } = require('./verdict.js');
const { pairedCellCI, MIN_CELLS } = require('./stats.js');
const D = require('./doc.js');
const { mergeQuote, STRICT_ONLY, ruleLine } = require('./quotes.js');
const { otherRule } = require('../judge/views.js');
const { MIN_JUDGES } = require('../judge/score.js');
const C = require('./charts.js');
const { buildPaired, pairedBlocks } = require('./paired.js');
const { levelHeader } = require('../scenarios/konductor/levels.js');
const { DESCRIPTORS } = require('../runner/lib/harness/descriptors.js');
const { descriptorOf } = require('../runner/lib/harness/runtime.js');

// The two harnesses of the table: the descriptors with a `report.factorialKey`, in registry order (A Kiro CLI, B Claude
// Code). The key prefixes the cell ids (kiroVanilla), the contrast ids (kiroEffect), the cost ratios and the flags.
const [A, B] = DESCRIPTORS.filter((d) => d.report.factorialKey);
const HARNESSES = [A.id, B.id];
const HARNESS_NAME = { [A.id]: A.label, [B.id]: B.label };
const keyOf = (d) => d.report.factorialKey;
const cellId = (d, role) => `${keyOf(d)}${role === 'vanilla' ? 'Vanilla' : 'Konductor'}`;
const SPECS = [A, B].flatMap((d) => ['vanilla', 'konductor'].map((role) => ({
  id: cellId(d, role), harness: d.id, role, unit: d.costUnit === 'usd' ? 'USD' : 'credits', flag: `${keyOf(d)}-${role}`,
})));
const [AV, AK, BV, BK] = SPECS.map((x) => x.id);
const MIN_REPS = 2;

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const uniq = (xs) => [...new Set(xs)];
const qualityWeightsText = (w) => `hidden tests ${w.hidden}, checks ${w.checks}${checksModeNote(w)}, rubric ${w.rubric}${w.pack > 0 ? `, quality pack ${w.pack}` : ''}`;
const labelOf = (spec) => `${HARNESS_NAME[spec.harness]} ${spec.role}`;

/** claude-sonnet-5.5, us.anthropic.claude-sonnet-5-5 and claude-sonnet-5-5 name the same model. */
function canonicalModel(id) {
  return String(id ?? 'unknown').replace(/^(?:us|eu|apac|global)\.anthropic\./, '').replace(/\./g, '-');
}

/**
 * The run reduced to one arm: its runs, its config entry and its judgment records. Used when a cell names the arm it
 * reads from a directory that holds several. Returns a new object; the loaded run is not changed.
 */
function onlyArm(run, armId) {
  const keep = (rec) => rec.armId === undefined || rec.armId === armId;
  const j = run.judgments;
  const judgments = j ? {
    ...j,
    rubric: (j.rubric ?? []).filter(keep),
    graded: (j.graded ?? []).filter(keep),
    notJudged: (j.notJudged ?? []).filter(keep),
    // A pairwise record compares the arm with a baseline that is dropped here, and the 2x2 reads rubric records only.
    pairwise: [],
  } : j;
  const config = { ...run.config, armIds: (run.config?.armIds ?? []).filter((id) => id === armId), arms: (run.config?.arms ?? []).filter((a) => a.id === armId) };
  return { ...run, config, runs: run.runs.filter((e) => e.armId === armId), judgments };
}

function loadCell(spec, dirs, { tasks, weights, scoringFile, qualityPack, quoteRule = null, arm = null }) {
  const where = `cell ${spec.id} (${labelOf(spec)})`;
  if (!Array.isArray(dirs) || !dirs.length) throw new Error(`${where}: no run directory given`);
  let run;
  try { run = loadRuns(dirs); } catch (e) { throw new Error(`${where}: ${e.message}`); }
  if (run.harness !== spec.harness) throw new Error(`${where}: expected a ${spec.harness} run directory, found ${run.harness}. Check the flags: ${descriptorOf(spec.harness).armPrefix ? `a ${HARNESS_NAME[spec.harness]} cell holds ${descriptorOf(spec.harness).armPrefix} arms only` : `a ${HARNESS_NAME[spec.harness]} cell cannot hold the results of another runtime`}`);
  if (arm) {
    const present = uniq(run.runs.map((e) => e.armId)).sort();
    if (!present.includes(arm)) throw new Error(`${where}: arm ${arm} is not in the run directory; it holds ${present.length ? present.join(', ') : 'no arm'}`);
    run = onlyArm(run, arm);
  }
  enrichOrch(run);
  const executed = run.runs.filter((e) => e.result.status !== 'budget_skipped');
  const arms = uniq(executed.map((e) => e.armId));
  if (arms.length !== 1) throw new Error(`${where}: exactly one arm per cell is expected, found ${arms.length ? arms.join(', ') : 'none'}${arms.length > 1 ? `. Pick one with --${spec.flag} DIR:ARM or --cell ${spec.id}=DIR:ARM` : ''}`);
  const armId = arms[0];
  const prefix = descriptorOf(spec.harness).armPrefix;
  const isVanillaArm = armId === `${prefix}vanilla`;
  if (spec.role === 'vanilla' && !isVanillaArm) throw new Error(`${where}: the arm is ${armId}, expected vanilla`);
  if (spec.role === 'konductor' && isVanillaArm) throw new Error(`${where}: the arm is ${armId}; a konductor cell needs a konductor arm`);
  if (prefix && !armId.startsWith(prefix)) throw new Error(`${where}: arm ${armId} is not a ${HARNESS_NAME[spec.harness]} arm`);

  const a = analyze({ run, tasks, baseline: armId, scoringFile, qualityPack, quoteRule });
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
    const q = excluded ? null : qualityOfRun(n, weights);
    const spawns = spawnsOf(result);
    return {
      task: r.task, rep: r.rep, outcome: r.outcome, excluded, quality: q ? q.score : null, hasRubric: r.rubric !== null && !r.rubricCountedAsFailure,
      cost: fin(r.credits) ? r.credits : null, censored: Boolean(r.censored), wallMs: r.wall, spawns: fin(spawns) ? spawns : null,
      timeout: r.outcome === 'timeout', zeroFilled: n.zeroFilled, model: result.claudeCode?.canonicalModel ?? result.model ?? null,
    };
  });
  if (!rows.length) throw new Error(`${where}: no executed runs`);
  const partial = rows.filter((row) => {
    if (row.excluded) return false;
    const seen = new Set(rubric.filter((x) => x.armId === armId && x.taskId === row.task && x.replicate === row.rep && fin(x.score)).map((x) => x.judge));
    return seen.size > 0 && seen.size < panel.judges.length;
  });
  if (partial.length) throw new Error(`${where}: ${partial.length} run(s) were scored by only part of the panel of ${panel.judges.length} judges (${partial.slice(0, 3).map((row) => `${row.task} rep ${row.rep}`).join(', ')}${partial.length > 3 ? ', ...' : ''}). Finish judging that cell first`);

  // Each judge's own mean rubric score (0 to 100) over the cell's runs it scored, shown beside the panel median.
  const judgeRubric = Object.fromEntries(panel.judges.map((jd) => {
    const own = rubric.filter((x) => x.judge === jd && x.armId === armId && fin(x.score)).map((x) => x.score);
    return [jd, own.length ? mean(own) * 100 : null];
  }));
  const model = canonicalModel(run.config.canonicalModel ?? rows.find((r) => r.model)?.model ?? run.config.model);
  const shas = uniq(executed.map((e) => e.result.commitSha).filter(Boolean));
  // The effort level each run was started at. A Claude Code run from before bench passed --effort to claude records "default".
  const efforts = uniq(executed.map((e) => e.result.effort ?? 'unrecorded')).sort();
  if (efforts.length > 1) throw new Error(`${where}: its runs were started at more than one effort level (${efforts.join(', ')}); a cell holds one effort level`);
  const modelsSeen = uniq(executed.flatMap((e) => (e.result.claudeCode?.modelsSeen ?? [e.result.sessionModel ?? e.result.model]).filter(Boolean))).sort();
  // The skill listing each run recorded (plugins/claude-code/listing.js; Kiro's from its install). A konductor cell
  // whose runs sent a konductor skill by name only is refused: that harness would lose descriptions the other keeps.
  const listings = executed.map((e) => e.result.skillListing ?? e.result.claudeCode?.skillListing ?? null);
  const cut = listings.find((l) => l?.nameOnly > 0);
  if (spec.role === 'konductor' && cut) throw new Error(`${where}: ${listings.filter((l) => l?.nameOnly > 0).length} run(s) sent ${cut.nameOnly} konductor skill(s) by name only in the ${spec.harness} skill listing (${cut.listingChars} chars > ${cut.budgetChars} budget: ${cut.konductorNameOnly.join(', ')}); this cell does not compare with the other harness. Land the description trim, or pin a commit whose listing fits`);
  // A vanilla arm must see built-ins only and a konductor arm konductor's only: a skill from above the run cwd (the
  // owner's ~/.claude/skills) is a confound.
  const foreign = listings.find((l) => (l?.otherDescribed ?? 0) + (l?.otherNameOnly ?? 0) > 0);
  if (foreign) throw new Error(`${where}: ${listings.filter((l) => (l?.otherDescribed ?? 0) + (l?.otherNameOnly ?? 0) > 0).length} run(s) listed ${foreign.otherDescribed + foreign.otherNameOnly} skill(s) that are neither built-in nor the arm's (project skills found above the run cwd); rerun with TMPDIR outside HOME, for example under /var/tmp`);
  const listing = { record: listings.find(Boolean) ?? null, unrecorded: listings.filter((l) => !l).length, variants: uniq(listings.filter(Boolean).map((l) => JSON.stringify({ ...l, cacheKey: undefined }))).length };
  return { run, spec, dirs: run.dirs ?? [run.dir], quote: a.quote, armId, rows, unit: a.scores.unit, panel, revisions, model, modelsSeen, pin: a.facts.pin ?? null, shas, effort: efforts[0], judgeRubric, listing, harnessVersion: executed[0].result.harnessVersion ?? executed[0].result.kiroCliVersion ?? null };
}

const sameJson = (x, y) => JSON.stringify(x) === JSON.stringify(y);

function checkComparable(cells) {
  const [first] = cells;
  for (const c of cells.slice(1)) {
    if (c.panel.backend !== first.panel.backend) throw new Error(`judge backend differs: ${first.spec.id} used ${first.panel.backend}, ${c.spec.id} used ${c.panel.backend}`);
    if (!sameJson(c.panel.judges, first.panel.judges)) throw new Error(`judge panel differs: ${first.spec.id} has ${first.panel.judges.join(', ')}; ${c.spec.id} has ${c.panel.judges.join(', ')}`);
    if (!sameJson(c.panel.models, first.panel.models)) throw new Error(`judge model ids differ between ${first.spec.id} and ${c.spec.id}`);
    if (c.model !== first.model) throw new Error(`model differs: ${first.spec.id} ran ${first.model}, ${c.spec.id} ran ${c.model}`);
    if (c.effort !== first.effort) throw new Error(`effort differs: ${first.spec.id} ran at ${first.effort}, ${c.spec.id} at ${c.effort}; every cell must run at the same --effort level (a Claude Code run made before bench passed --effort to claude records "default")`);
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
  for (const h of HARNESSES) {
    const pair = cells.filter((c) => c.spec.harness === h);
    if (pair[0].unit !== pair[1].unit) throw new Error(`cost units differ inside ${h}: ${pair[0].unit} and ${pair[1].unit}`);
  }
  const kon = cells.filter((c) => c.spec.role === 'konductor');
  const [s1, s2] = kon.map((c) => c.shas);
  for (const c of kon) {
    if (!c.shas.length) throw new Error(`cell ${c.spec.id} (${labelOf(c.spec)}): no source commit is recorded in its results, so "same source tree in both harnesses" cannot be checked`);
    if (c.shas.length > 1) throw new Error(`cell ${c.spec.id} (${labelOf(c.spec)}): its runs were built from more than one commit (${c.shas.map((x) => x.slice(0, 12)).join(', ')}); a cell holds one source tree`);
  }
  if (s1[0] !== s2[0]) throw new Error(`the two konductor cells were built from different commits (${s1[0].slice(0, 12)} and ${s2[0].slice(0, 12)}); both harnesses must use the same source tree`);
  return { tasks: all, notes: [] };
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
    id: c.spec.id, harness: c.spec.harness, role: c.spec.role, arm: c.armId, unit: c.unit, dirs: c.dirs, model: c.model, effort: c.effort, harnessVersion: c.harnessVersion,
    runs: executed, success: clean, passed: rows.filter((r) => r.outcome === 'good').length, timeouts: rows.filter((r) => r.timeout).length,
    errors: rows.filter((r) => r.outcome === 'error').length, excluded: rows.filter((r) => r.excluded).length,
    quality: mean(taskMeans), qualityExclTimeouts: mean(taskMeansKept), byTask,
    rubricCoverage: scoredRows.length ? scoredRows.filter((r) => r.hasRubric).length / scoredRows.length : null,
    cost: { total, perRun: executed ? total / executed : null, perSuccess: clean ? total / clean : null, unmetered: rows.filter((r) => r.cost === null).length, censoredRuns: rows.filter((r) => r.censored).length },
    delegation: { runs: spawns.length, meanSpawns: mean(spawns), share: spawns.length ? spawns.filter((s) => s > 0).length / spawns.length : null },
    wallS: mean(rows.map((r) => r.wallMs).filter(fin)) === null ? null : mean(rows.map((r) => r.wallMs).filter(fin)) / 1000,
    modelIdentity: { models: c.modelsSeen, pin: c.pin },
    judgeRubric: c.judgeRubric,
    skillListing: c.listing,
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
  { id: `${keyOf(A)}Effect`, label: `konductor effect in ${A.label} (konductor minus vanilla)`, pick: (c, t) => q(AK, t, c) - q(AV, t, c) },
  { id: `${keyOf(B)}Effect`, label: `konductor effect in ${B.label} (konductor minus vanilla)`, pick: (c, t) => q(BK, t, c) - q(BV, t, c) },
  { id: 'harnessVanilla', label: `harness effect, vanilla (${B.label} minus ${A.label})`, pick: (c, t) => q(BV, t, c) - q(AV, t, c) },
  { id: 'harnessKonductor', label: `harness effect, konductor (${B.label} minus ${A.label})`, pick: (c, t) => q(BK, t, c) - q(AK, t, c) },
  { id: 'interaction', label: `interaction (${B.label} konductor effect minus ${A.label} konductor effect)`, pick: (c, t) => (q(BK, t, c) - q(BV, t, c)) - (q(AK, t, c) - q(AV, t, c)) },
];

function ratio(num, den) { return fin(num) && fin(den) && den > 0 ? num / den : null; }

function costRatio(van, kon) {
  const bound = van.cost.censoredRuns > 0 && kon.cost.censoredRuns > 0 ? 'both' : kon.cost.censoredRuns > 0 ? 'lower' : van.cost.censoredRuns > 0 ? 'upper' : null;
  return { unit: kon.unit, vanillaPerRun: van.cost.perRun, konductorPerRun: kon.cost.perRun, perRun: ratio(kon.cost.perRun, van.cost.perRun), perSuccess: ratio(kon.cost.perSuccess, van.cost.perSuccess), bound, unmetered: { vanilla: van.cost.unmetered, konductor: kon.cost.unmetered } };
}

/**
 * dirs: { kiroVanilla, kiroKonductor, ccVanilla, ccKonductor }, each an array of finished and judged run directories
 * (several per cell are merged read-only, as `report` does). arms: the same keys, each the one arm a cell reads when its
 * directories hold several; a cell without an entry must hold exactly one arm. Throws when the four cells cannot be compared.
 */
function buildFactorial({ dirs, arms = {}, benchDir, extraDirs = [], scoringFile, qualityPack = null, quoteRule = null, withSensitivity = true, withStats = false } = {}) {
  const tasks = loadTasks(benchDir, { extraDirs });
  const weights = loadScoring(scoringFile, { allowPack: Boolean(qualityPack) });
  const loaded = SPECS.map((spec) => loadCell(spec, dirs?.[spec.id], { tasks, weights, scoringFile, qualityPack, quoteRule, arm: arms?.[spec.id] ?? null }));
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
  const costRatios = { [keyOf(A)]: costRatio(byId[AV], byId[AK]), [keyOf(B)]: costRatio(byId[BV], byId[BK]) };
  const timeouts = cells.filter((c) => c.timeouts > 0).map((c) => `${labelOf(c)}: ${c.timeouts}`);
  const out = [...notes];
  if (timeouts.length) out.push(`Timed-out runs stay in every mean, scored on whatever they produced (zero when nothing), and are marked in the task table. The "excluding timeouts" row drops them. Timeouts: ${timeouts.join('; ')}.`);
  if (cells.some((c) => c.rubricCoverage !== null && c.rubricCoverage < 1)) out.push(`Some runs have no rubric score (${cells.filter((c) => c.rubricCoverage !== null && c.rubricCoverage < 1).map((c) => `${labelOf(c)} ${Math.round(c.rubricCoverage * 100)}%`).join(', ')}); their quality uses the remaining components, so the cells are not scored on exactly the same inputs.`);
  const unpinned = cells.filter((c) => c.modelIdentity.pin && c.modelIdentity.pin.verified < c.modelIdentity.pin.runs);
  if (unpinned.length) out.push(`The model pin could not be verified from the session for every run in: ${unpinned.map((c) => `${labelOf(c)} (${c.modelIdentity.pin.verified}/${c.modelIdentity.pin.runs})`).join(', ')}. Kiro CLI vanilla runs record no session model; their model is the one passed on the command line. A run whose model was seen and differed would be counted as a mismatch.`);
  if (cells.some((c) => c.excluded > 0)) out.push(`Runs with an infra error or a model mismatch are left out of quality and counted in the table (${cells.filter((c) => c.excluded > 0).map((c) => `${labelOf(c)} ${c.excluded}`).join(', ')}).`);
  let qualityDimensions = null;
  if (qualityPack) {
    const { summarizeQuality } = require('./quality.js');
    qualityDimensions = summarizeQuality({ groups: loaded.map((c) => ({ id: c.spec.id, label: labelOf(c.spec), run: c.run })), tasks, pack: qualityPack, strictPanel: true, scoredWeight: weights.pack ?? null });
  }
  // The SDLC view needs the pack's phase map, so it comes with --criteria-pack like the dimensions table.
  const sdlc = qualityPack ? require('./sdlc.js').summarizeSdlc({ cells: loaded, tasks, pack: qualityPack, taskIds }) : null;
  const quote = mergeQuote(loaded.map((c) => c.quote));
  const levelLine = levelHeader(loaded.map((c) => ({ cell: labelOf(c.spec), level: c.run.config?.level ?? null })));
  const result = {
    schemaVersion: 1, kind: 'factorial-2x2', quote, tasks: taskIds, replicates: { min: reps.min, perTask: reps.perTask },
    descriptive: !intervals, descriptiveReason, model: loaded[0].model, effort: loaded[0].effort, units: Object.fromEntries(HARNESSES.map((h) => [h, SPECS.find((x) => x.harness === h).unit])),
    judges: { backend: loaded[0].panel.backend, panel: loaded[0].panel.judges, models: loaded[0].panel.models },
    weights, cells, contrasts, costRatios, notes: out,
    ...(qualityDimensions ? { qualityDimensions } : {}),
    ...(sdlc ? { sdlc } : {}),
    ...(levelLine ? { runLevel: levelLine } : {}),
    ...(withStats ? { paired: buildPaired({ cells: loaded, tasks, taskIds }) } : {}),
  };
  if (withSensitivity) result.sensitivity = factorialSensitivity(result, buildFactorial({ dirs, arms, benchDir, extraDirs, scoringFile, qualityPack, quoteRule: otherRule(quote.requested), withSensitivity: false }));
  return result;
}

/** The 2x2 under the other quote rule against the one in use: quality per cell with rank, and the konductor effect per harness. */
function factorialSensitivity(res, o) {
  const rule = res.quote.requested;
  const other = o.quote.requested;
  if (o.quote.state === 'strict-only' || res.quote.state === 'strict-only') return { available: false, rule, other, reason: STRICT_ONLY };
  const rank = (r) => { const order = [...r.cells].sort((a, b) => (b.quality ?? -Infinity) - (a.quality ?? -Infinity) || (a.id < b.id ? -1 : 1)).map((c) => c.id); return Object.fromEntries(order.map((id, i) => [id, i + 1])); };
  const rp = rank(res);
  const ro = rank(o);
  const cells = res.cells.map((c) => {
    const b = o.cells.find((x) => x.id === c.id);
    return { id: c.id, harness: c.harness, role: c.role, quality: c.quality, otherQuality: b?.quality ?? null, rank: rp[c.id], otherRank: ro[c.id], flip: rp[c.id] !== ro[c.id] };
  });
  const effects = Object.keys(res.contrasts).map((k) => ({ id: k, label: res.contrasts[k].label, delta: res.contrasts[k].delta, otherDelta: o.contrasts[k]?.delta ?? null, interval: res.contrasts[k].interval, otherInterval: o.contrasts[k]?.interval ?? null }));
  const orderDiffers = cells.some((c) => c.flip);
  return {
    available: true, rule, other, cells, effects, orderDiffers,
    warning: orderDiffers ? `The order of the four cells by quality differs between the rules (${rule}: ${Object.entries(rp).sort((a, b) => a[1] - b[1]).map(([id]) => id).join(' > ')}; ${other}: ${Object.entries(ro).sort((a, b) => a[1] - b[1]).map(([id]) => id).join(' > ')}). Read the ranking as unsettled.` : null,
  };
}

// ---- charts ----

const COST_BOUND = { lower: 'lower bound', upper: 'upper bound', both: 'approximate' };
const costOf = Object.fromEntries([A, B].map((d) => [d.id, keyOf(d)]));
const effectOf = Object.fromEntries([A, B].map((d) => [d.id, `${keyOf(d)}Effect`]));

/**
 * Three SVG charts as a Map(name -> svg), drawn with the same helpers as `report`. Quality is one 0..100 axis for all
 * four cells. Cost is drawn only as the konductor / vanilla ratio inside a harness, so credits and USD never share an axis;
 * the unit is named in each category label. Interval whiskers appear only when the table has intervals.
 */
function factorialCharts(res) {
  const cellOf = (harness, role) => res.cells.find((c) => c.harness === harness && c.role === role);
  const reason = res.descriptive ? res.descriptiveReason : null;
  const names = (h) => HARNESS_NAME[h];
  const quality = C.groupedBarsCI({
    id: 'factorial-quality-by-cell', title: 'Quality by cell', unit: 'quality (0 to 100)',
    subtitle: reason ?? `bars: mean over ${res.tasks.length} tasks; dots: one task each; no interval`,
    categories: HARNESSES.map(names),
    series: ['vanilla', 'konductor'].map((role) => ({
      name: role,
      values: HARNESSES.map((h) => {
        const c = cellOf(h, role);
        return { v: c.quality, dots: res.tasks.map((t) => c.byTask[t].quality).filter(fin) };
      }),
    })),
  });
  const effect = C.groupedBarsCI({
    id: 'factorial-konductor-effect', title: 'Konductor effect on quality, per harness', unit: 'quality points, konductor minus vanilla',
    subtitle: reason ?? `95% interval, paired by task, over ${res.tasks.length} tasks`,
    categories: HARNESSES.map(names),
    series: [{
      name: 'konductor minus vanilla',
      values: HARNESSES.map((h) => {
        const k = res.contrasts[effectOf[h]];
        return { v: k.delta, ...(k.interval ? { lo: k.interval.low, hi: k.interval.high } : {}) };
      }),
    }],
  });
  const cost = C.groupedBarsCI({
    id: 'factorial-cost-ratio', title: 'Cost ratio, konductor over vanilla, per harness', unit: 'ratio per run (1 = same cost)',
    subtitle: `${reason ? `${reason}. ` : ''}Each ratio is inside one harness; credits and USD are never compared`,
    categories: HARNESSES.map((h) => {
      const r = res.costRatios[costOf[h]];
      return `${names(h)} (${r.unit})${r.bound ? `, ${COST_BOUND[r.bound]}` : ''}`;
    }),
    series: [{ name: 'konductor cost / vanilla cost', values: HARNESSES.map((h) => ({ v: res.costRatios[costOf[h]].perRun })) }],
  });
  return new Map([['quality-by-cell', quality], ['konductor-effect', effect], ['cost-ratio', cost]]);
}

// ---- rendering ----

/** The rule line of the 2x2 page and, when the other view exists, the cell qualities under both rules. */
function factorialRuleBlocks(res) {
  const sens = res.sensitivity;
  const blocks = [D.p(ruleLine(res.quote, sens?.available ? 'see the table below.' : 'not available.'))];
  if (!sens?.available) return blocks;
  const cap = (r) => r;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : 'n/a');
  const signedNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}` : 'n/a');
  blocks.push(D.table(
    ['cell', `mean quality, ${cap(sens.rule)}`, `mean quality, ${cap(sens.other)}`, 'rank'],
    sens.cells.map((c) => [`${HARNESS_NAME[c.harness]} ${c.role}`, num(c.quality), num(c.otherQuality), c.flip ? `${c.rank} to ${c.otherRank} **FLIP**` : String(c.rank)]),
    `Quality per cell under both quote rules (${cap(sens.rule)} is the one in use)`,
  ));
  blocks.push(D.table(
    ['contrast', `estimate, ${cap(sens.rule)}`, `estimate, ${cap(sens.other)}`],
    sens.effects.map((e) => [e.label, signedNum(e.delta), signedNum(e.otherDelta)]),
  ));
  if (sens.warning) blocks.push(D.note(`Warning: ${sens.warning}`));
  return blocks;
}

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

/** charts: the Map from factorialCharts when the SVG files are being written, so the markdown can link them. */
/** The skill listing table of the header: what each cell's runs were sent, from the record each run carries. */
function listingBlocks(cols) {
  const cell = (c) => `${HARNESS_NAME[c.harness]} ${c.role}`;
  const rows = cols.map((c) => {
    const l = c.skillListing?.record;
    const unrec = c.skillListing?.unrecorded ? `${c.skillListing.unrecorded} of ${c.runs}` : '0';
    if (!l) return [cell(c), 'not recorded', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', unrec];
    return [cell(c), l.skillsSent, l.konductorDescribed.length, l.nameOnly, l.listingChars ?? 'n/a', l.budgetChars ?? 'no known cap', l.sopsModelInvocable === null ? 'no SOPs' : l.sopsModelInvocable ? 'yes' : 'no', unrec];
  });
  const variants = cols.filter((c) => c.skillListing?.variants > 1).map(cell);
  return [
    D.h(2, 'Skill listing'),
    D.table(['cell', 'skills sent', 'konductor described', 'konductor name-only', 'listing chars', 'budget chars', 'SOPs model-invocable', 'runs without a record'], rows),
    D.note(`Measured once per arm before any run, with no model call. Claude Code sends each skill's name and description up to the budget and the rest by name only; a konductor cell with a name-only skill is refused. Kiro CLI has no known listing cap.${variants.length ? ` Runs in ${variants.join(', ')} recorded more than one listing; the first is shown.` : ''}`),
  ];
}

function renderFactorial(res, { charts = null } = {}) {
  const [kv, kk, cv, ck] = SPECS.map((s) => res.cells.find((c) => c.id === s.id));
  const cols = [kv, kk, cv, ck];
  const head = ['task', ...cols.map((c) => `${HARNESS_NAME[c.harness]} ${c.role}`)];
  const chart = (name, alt) => (charts?.has(name) ? [D.chart(name, charts.get(name), alt)] : []);
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
    D.p(`Model ${res.model}, effort ${res.effort} in every cell. Quality is the repository score (${qualityWeightsText(res.weights)}, renormalised over what a run has, times 100). Judges: ${res.judges.panel.join(', ')} (${res.judges.backend}). Tasks: ${res.tasks.join(', ')}.`),
    ...(res.runLevel ? [D.p(res.runLevel)] : []),
    ...listingBlocks(cols),
    D.h(2, 'Quality by cell'),
    D.table(head, [...taskRows,
      ['**mean over tasks**', ...cols.map((c) => `**${f1(c.quality)}**`)],
      ['mean excluding timed-out runs', ...cols.map((c) => f1(c.qualityExclTimeouts))]]),
    ...chart('quality-by-cell', 'Quality by cell: bars are the mean over tasks, dots are single tasks'),
    D.h(2, 'Rubric by judge (0 to 100)'),
    D.table(['judge', ...cols.map((c) => `${HARNESS_NAME[c.harness]} ${c.role}`)], res.judges.panel.map((jd) => [jd, ...cols.map((c) => f1(c.judgeRubric?.[jd] ?? null))])),
    D.note(`Each judge's mean rubric score over the cell's runs. The quality score uses the panel score of each run: the median of these judges (SR-24); a run scored by fewer than ${MIN_JUDGES} judges is NO DATA.`),
    D.h(2, 'Effects on quality (points)'),
    D.table(['contrast', 'estimate', 'per task', 'interval'], Object.values(res.contrasts).map((c) => [
      c.label, signed(c.delta), c.perTask.map((x) => `${x.task} ${signed(x.value)}`).join('; ') || 'n/a',
      c.interval ? `[${signed(c.interval.low)}, ${signed(c.interval.high)}] at ${Math.round(c.interval.level * 100)}%` : res.descriptive ? 'none (descriptive)' : 'n/a',
    ])),
    ...chart('konductor-effect', 'Konductor effect on quality in each harness'),
    D.h(2, 'Cost: konductor over vanilla, inside each harness'),
    D.table(['harness', 'unit', 'vanilla per run', 'konductor per run', 'ratio per run', 'ratio per successful run'], [
      ...HARNESSES.map((h) => {
        const r = res.costRatios[costOf[h]];
        return [HARNESS_NAME[h], r.unit, f2(r.vanillaPerRun), f2(r.konductorPerRun), ratioText(r, 'perRun'), ratioText(r, 'perSuccess')];
      }),
    ]),
    ...chart('cost-ratio', 'Cost ratio, konductor over vanilla, in each harness'),
    D.note('Credits and USD are different units. Only the ratio inside a harness is meaningful; the raw figures of the two harnesses are never compared. ">=" marks a ratio whose konductor side has runs with no metered cost, "<=" a vanilla side with such runs, "~" both.'),
    D.h(2, 'Reliability, delegation and model identity'),
    D.table(['cell', 'arm', 'runs', 'finished', 'all checks passed', 'timeouts', 'errors', 'excluded', 'spawns per run', 'runs that delegated', 'mean seconds', 'model identity'], cols.map((c) => [
      `${HARNESS_NAME[c.harness]} ${c.role}`, c.arm, c.runs, `${c.success}/${c.runs}`, `${c.passed}/${c.runs}`, c.timeouts, c.errors, c.excluded,
      f2(c.delegation.meanSpawns), pct(c.delegation.share), f1(c.wallS),
      c.modelIdentity.pin ? `${c.modelIdentity.pin.verified}/${c.modelIdentity.pin.runs} verified, ${c.modelIdentity.pin.mismatch} mismatch (${c.modelIdentity.models.join(', ') || c.model})` : c.model,
    ])),
  ];
  if (res.quote) {
    blocks.splice(1, 0, ...factorialRuleBlocks(res));
  }
  if (res.paired) blocks.push(...pairedBlocks(res.paired));
  if (res.notes.length) blocks.push(D.h(2, 'Notes'), D.list(res.notes));
  if (res.qualityDimensions) blocks.push(...require('./quality.js').qualityBlocks(res.qualityDimensions));
  if (res.sdlc) blocks.push(...require('./sdlc.js').sdlcBlocks(res.sdlc, (id) => labelOf(SPECS.find((x) => x.id === id))));
  blocks.push(D.h(2, 'Inputs'), D.list(cols.map((c) => `${HARNESS_NAME[c.harness]} ${c.role}: ${c.dirs.map((d) => path.basename(d)).join(', ')} (${c.unit})`)));
  return blocks;
}

module.exports = { buildFactorial, factorialSensitivity, renderFactorial, factorialCharts, canonicalModel, SPECS, CONTRASTS, MIN_REPS };
