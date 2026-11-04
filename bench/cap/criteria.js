// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap criteria`: which rubric criteria and checks do not separate the arms of a study. It reads the judgments and check
// results already on disk and makes no model call. Advisory only: no call, margin or floor of `cap decide` reads it.
//
// Per item (a rubric criterion or a check of one task) and arm: the pass rate (pass 1, partial 0.5, fail 0; a rubric
// criterion is the mean over judges). Each variant arm is compared with the baseline. Flags:
//   NON-DISCRIMINATING  every comparison gives the same value in every run (always pass, always fail) with at least
//                       minRuns runs per arm, or its interval lies inside the no-effect margin of cap decide.
//                       An always-the-same item with fewer runs is INSUFFICIENT-DATA instead, never flagged.
//   SATURATED           every arm sits at or above the ceiling rate, or every arm at or below the floor (1 - ceiling),
//                       with at least minRuns runs per arm; with fewer it is INSUFFICIENT-DATA instead.
//   HIGH-VARIANCE       judges disagree (strict: any verdict difference, partial included) on more than a share of the
//                       runs, or replicates of one arm and task spread more than a pooled standard deviation. Each half
//                       is measured only when the data has it. The coarse rate (pass against not pass) is shown beside.
// The margin default is the cap decide MARGIN, imported, so the two cannot drift apart.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { diffCI, pairedCellCI, withinCellSd } = require('../report/stats.js');
const { VERDICT_VALUE } = require('../judge/config.js');
const { MARGIN } = require('./decide.js');

const DEFAULTS = Object.freeze({ margin: MARGIN, saturated: 0.95, judgeDisagree: 0.3, replicateSd: 0.4, minRuns: 5, adjust: true });
const FLAGS = ['NON-DISCRIMINATING', 'SATURATED', 'HIGH-VARIANCE'];
const LEFT_OUT = ['infraError', 'modelMismatch'];

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (v, d = 3) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(d)) : v ?? null);
const short = (s, n = 80) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };

const checkIdOf = (c) => (typeof c?.id === 'string' && c.id ? c.id : typeof c?.name === 'string' && c.name ? c.name : null);
const checkLabel = (c) => short(`${c.type} ${c.path ?? c.cmd ?? c.pattern ?? ''}`);

// The fields the task schema defines for a check. A content id hashes the ones a check sets, so the same check gets the
// same id from its task definition and from the record a run wrote. No task file or schema changes: a real id field would
// change checksRevision and mark every earlier result as not current.
const CONTENT_FIELDS = Object.keys(require('../schema/task.schema.json').properties.checks.items.properties).sort();

function contentHash(c) {
  const picked = {};
  for (const k of CONTENT_FIELDS) if (c?.[k] !== undefined) picked[k] = c[k];
  return crypto.createHash('sha256').update(JSON.stringify(picked)).digest('hex').slice(0, 12);
}

/**
 * Content ids for a check list. Two checks with the same content get #1, #2... in list order; they run the same check on
 * the same workspace, so which of them a result is paired with cannot change its value.
 */
function contentIds(list) {
  const hashes = list.map(contentHash);
  const total = new Map();
  for (const h of hashes) total.set(h, (total.get(h) ?? 0) + 1);
  const seen = new Map();
  return hashes.map((h) => { const k = (seen.get(h) ?? 0) + 1; seen.set(h, k); return total.get(h) > 1 ? `content:${h}#${k}` : `content:${h}`; });
}

/**
 * Check observations for one run, matched in this order: an explicit `id` (or `name`) when every result record carries
 * one; the content id; position, only when the run has as many check results as the reference list (the task's checks,
 * or the first run seen for a task with no loaded definition) with the same type at each place. Anything else is an
 * error for the run rather than a guess. When content ids fail because result records lack fields the reference sets,
 * `note` names those fields. Returns { observations, error, note }.
 */
function matchChecks(results, reference, base) {
  const done = results.filter((c) => typeof c?.passed === 'boolean');
  if (!done.length) return { observations: [], error: null, note: null };
  const obsOf = (c, id, spec) => ({ ...base, kind: 'check', id, label: checkLabel(spec ?? c), value: c.passed ? 1 : 0, judgeValues: null });
  const ids = done.map(checkIdOf);
  if (ids.every(Boolean)) {
    return { observations: done.map((c, i) => obsOf(c, `check:${ids[i]}`, (reference ?? []).find((r) => checkIdOf(r) === ids[i]))), error: null, note: null };
  }
  const refIds = contentIds(reference);
  const resIds = contentIds(results);
  if (resIds.every((id) => refIds.includes(id))) {
    return { observations: results.map((c, i) => (typeof c?.passed === 'boolean' ? obsOf(c, resIds[i], reference[refIds.indexOf(resIds[i])]) : null)).filter(Boolean), error: null, note: null };
  }
  const missing = [...new Set(reference.flatMap((r, i) => (results[i] && results[i].type === r.type ? CONTENT_FIELDS.filter((k) => r[k] !== undefined && results[i][k] === undefined) : [])))].sort();
  const why = missing.length ? `result check records lack ${missing.join(', ')}, which the task's checks set, so content ids cannot be computed the same way` : 'the check contents differ from the reference list (the checks may have changed since the run)';
  const where = `arm ${base.arm}, replicate ${base.rep}`;
  if (results.length !== reference.length) return { observations: [], error: `${where}: ${results.length} check results against ${reference.length} checks; ${why}, and position cannot be used`, note: null };
  const off = results.findIndex((c, i) => c?.type !== reference[i]?.type);
  if (off >= 0) return { observations: [], error: `${where}: check ${off + 1} is ${results[off]?.type} in the result and ${reference[off]?.type} in the reference list; ${why}, and position cannot be used`, note: null };
  return {
    observations: results.map((c, i) => (typeof c?.passed === 'boolean' ? obsOf(c, refIds[i], reference[i]) : null)).filter(Boolean),
    error: null,
    note: `${why}; matched by position`,
  };
}

/**
 * Observations from one loaded run directory: one per item and run, after leaving out infra errors and model mismatches
 * as `cap decide` does. `rows` and `ctx` come from report/generate.js analyze(). Returns { observations, judgesPerRun,
 * checkErrors, checkNotes } where judgesPerRun counts runs by number of usable judges, checkErrors lists runs whose
 * checks could not be matched and checkNotes says, per task, why content ids gave way to position.
 */
function collectObservations({ run, rows, ctx, tasks, src = run.dir, armMap = null }) {
  const outcome = new Map(rows.map((r) => [`${r.arm}\u0000${r.task}\u0000${r.rep}`, r.outcome]));
  const observations = [];
  const judgesPerRun = {};
  const checkErrors = [];
  const checkNotes = new Map();
  const firstSeen = new Map();
  for (const e of run.runs) {
    if (e.result.status === 'budget_skipped') continue;
    const arm = armMap ? armMap[e.armId] : e.armId;
    if (!arm) continue;
    const oc = outcome.get(`${e.armId}\u0000${e.taskId}\u0000${e.replicate}`);
    if (LEFT_OUT.includes(oc)) continue;
    const task = tasks.get(e.taskId);
    const base = { arm, task: e.taskId, rep: e.replicate, src };
    const results = Array.isArray(e.result.checks) ? e.result.checks : [];
    if (results.length) {
      if (!task && !firstSeen.has(e.taskId)) firstSeen.set(e.taskId, results);
      const m = matchChecks(results, task?.checks ?? firstSeen.get(e.taskId), base);
      observations.push(...m.observations);
      if (m.error) checkErrors.push({ task: e.taskId, arm, rep: e.replicate, src, reason: m.error });
      if (m.note) checkNotes.set(`${e.taskId}\u0000${m.note}`, { task: e.taskId, note: m.note, runs: (checkNotes.get(`${e.taskId}\u0000${m.note}`)?.runs ?? 0) + 1 });
    }
    const byCriterion = new Map();
    let usable = 0;
    for (const j of ctx.judges ?? []) {
      const rec = ctx.rubricIdx?.get(`${j}|${e.armId}|${e.taskId}|${e.replicate}`);
      if (!rec || rec.judgeError || !Array.isArray(rec.criteria) || !rec.criteria.length) continue;
      usable++;
      for (const c of rec.criteria) {
        const v = VERDICT_VALUE[c.verdict];
        if (v === undefined) continue;
        if (!byCriterion.has(c.id)) byCriterion.set(c.id, []);
        byCriterion.get(c.id).push(v);
      }
    }
    if (usable) judgesPerRun[usable] = (judgesPerRun[usable] ?? 0) + 1;
    for (const [id, vals] of byCriterion) {
      const spec = task?.rubric?.find((r) => r.id === id);
      observations.push({ ...base, kind: 'rubric', id, label: short(spec?.criterion ?? id), weight: spec?.weight ?? null, value: mean(vals), judgeValues: vals });
    }
  }
  return { observations, judgesPerRun, checkErrors, checkNotes: [...checkNotes.values()] };
}

const itemKey = (o) => `${o.kind}\u0000${o.task}\u0000${o.id}`;

/** Variant minus baseline for one item. Paired by run directory when two or more directories hold both arms. */
function compare(headObs, baseObs, comparisons) {
  const h = headObs.map((o) => o.value);
  const b = baseObs.map((o) => o.value);
  const out = { nHead: h.length, nBase: b.length, delta: h.length && b.length ? mean(h) - mean(b) : null, lo: null, hi: null, method: null, level: null, cells: 0 };
  const srcs = [...new Set(headObs.map((o) => o.src))].filter((s) => baseObs.some((o) => o.src === s));
  if (srcs.length >= 2) {
    const r = pairedCellCI(srcs.map((s) => ({ head: headObs.filter((o) => o.src === s).map((o) => o.value), base: baseObs.filter((o) => o.src === s).map((o) => o.value) })), { comparisons });
    Object.assign(out, { delta: r.delta, lo: r.ciLow, hi: r.ciHigh, method: 'paired by run directory, t interval', level: r.level, cells: r.k });
    return out;
  }
  if (h.length < 2 || b.length < 2) return out;
  const level = comparisons > 1 ? 1 - 0.05 / comparisons : 0.95;
  const r = diffCI(h, b, { confidence: level });
  Object.assign(out, { lo: r.ciLow, hi: r.ciHigh, method: 'replicates, unpaired bootstrap', level, cells: srcs.length });
  return out;
}

function statusOf(c, head, base, cfg) {
  const vals = [...head, ...base].map((o) => o.value);
  if (vals.length && head.length && base.length && vals.every((v) => v === vals[0])) {
    if (head.length < cfg.minRuns || base.length < cfg.minRuns) return { status: 'INSUFFICIENT-DATA', reason: `the same value in every run, but ${head.length} and ${base.length} runs, under the ${cfg.minRuns} per arm needed to call it` };
    const word = vals[0] === 1 ? 'always passes' : vals[0] === 0 ? 'always fails' : `always scores ${round(vals[0], 2)}`;
    return { status: 'NON-DISCRIMINATING', reason: `${word} in both arms${vals[0] === 0 ? ' (the criterion or check may be broken or out of reach)' : ''}` };
  }
  if (c.lo === null || c.hi === null) return { status: 'INCONCLUSIVE', reason: `too few runs for an interval (${c.nHead} and ${c.nBase})` };
  const iv = `${round(c.lo)} to ${round(c.hi)}`;
  if (c.lo >= -cfg.margin && c.hi <= cfg.margin) return { status: 'NON-DISCRIMINATING', reason: `the interval ${iv} lies inside the ${cfg.margin} margin` };
  if (c.lo > 0 || c.hi < 0) return { status: 'SEPARATES', reason: `the interval ${iv} excludes 0` };
  return { status: 'INCONCLUSIVE', reason: `the interval ${iv} includes 0 and reaches past the ${cfg.margin} margin` };
}

/**
 * Pure: observations in, one entry per item out. baseline is the arm every other arm is compared with; aa (optional) is
 * the A/A repeat, reported for context and never counted as a variant. With cfg.adjust each interval is widened for the
 * number of items compared on that arm pair (Bonferroni), which makes NON-DISCRIMINATING harder to reach, not easier.
 */
function analyzeObservations(observations, { baseline, aa = null, config = {}, checkErrors = [] } = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const groups = new Map();
  for (const o of observations) {
    if (!groups.has(itemKey(o))) groups.set(itemKey(o), []);
    groups.get(itemKey(o)).push(o);
  }
  const arms = [...new Set(observations.map((o) => o.arm))].sort((a, b) => (a === baseline ? -1 : b === baseline ? 1 : a === aa ? -1 : b === aa ? 1 : a.localeCompare(b)));
  const variants = arms.filter((a) => a !== baseline && a !== aa);
  const pairCount = Object.fromEntries([...variants, ...(aa ? [aa] : [])].map((a) => [a, [...groups.values()].filter((g) => g.some((o) => o.arm === a) && g.some((o) => o.arm === baseline)).length]));
  const items = [];
  for (const g of groups.values()) {
    const first = g[0];
    const of = (a) => g.filter((o) => o.arm === a);
    const rates = Object.fromEntries(arms.filter((a) => of(a).length).map((a) => [a, { n: of(a).length, rate: round(mean(of(a).map((o) => o.value)), 4) }]));
    const comparisons = [];
    for (const a of variants) {
      if (!of(a).length || !of(baseline).length) continue;
      const c = compare(of(a), of(baseline), cfg.adjust ? pairCount[a] : 1);
      comparisons.push({ arm: a, ...roundCmp(c), ...statusOf(c, of(a), of(baseline), cfg) });
    }
    const aaCmp = aa && of(aa).length && of(baseline).length ? (() => { const c = compare(of(aa), of(baseline), cfg.adjust ? pairCount[aa] : 1); return { arm: aa, ...roundCmp(c), ...statusOf(c, of(aa), of(baseline), cfg) }; })() : null;

    const multi = g.filter((o) => Array.isArray(o.judgeValues) && o.judgeValues.length >= 2);
    const judge = multi.length ? (() => {
      const strict = multi.filter((o) => Math.max(...o.judgeValues) !== Math.min(...o.judgeValues)).length;
      const coarse = multi.filter((o) => new Set(o.judgeValues.map((v) => v === 1)).size > 1).length;
      return { runs: multi.length, disagree: strict, rate: round(strict / multi.length, 4), coarseDisagree: coarse, coarseRate: round(coarse / multi.length, 4) };
    })() : null;
    const cellGroups = [...new Set(g.map((o) => `${o.arm}\u0000${o.src}`))].map((k) => g.filter((o) => `${o.arm}\u0000${o.src}` === k).map((o) => o.value));
    const w = withinCellSd(cellGroups);
    const replicate = w.cells ? { sd: round(w.sd, 4), cells: w.cells } : null;

    const flags = [];
    const reasons = [];
    if (comparisons.length && comparisons.every((c) => c.status === 'NON-DISCRIMINATING')) { flags.push('NON-DISCRIMINATING'); reasons.push(...comparisons.map((c) => `${c.arm}: ${c.reason}`)); }
    const rs = Object.values(rates);
    const side = rs.length < 2 ? null : rs.every((r) => r.rate >= cfg.saturated) ? `every arm at or above ${cfg.saturated} (ceiling)` : rs.every((r) => r.rate <= 1 - cfg.saturated) ? `every arm at or below ${round(1 - cfg.saturated, 4)} (floor)` : null;
    const few = rs.filter((r) => r.n < cfg.minRuns).length;
    const satShort = Boolean(side && few);
    if (side && !few) { flags.push('SATURATED'); reasons.push(side); }
    const hv = [];
    if (judge && judge.rate > cfg.judgeDisagree) hv.push(`judges disagreed on ${judge.disagree} of ${judge.runs} runs (pass against not pass: ${judge.coarseDisagree})`);
    if (replicate && replicate.sd > cfg.replicateSd) hv.push(`replicate SD ${replicate.sd} over ${replicate.cells} cells`);
    if (hv.length) { flags.push('HIGH-VARIANCE'); reasons.push(...hv); }
    const ndShort = !flags.includes('NON-DISCRIMINATING') && comparisons.some((c) => c.status === 'INSUFFICIENT-DATA');
    if (ndShort) reasons.push(...comparisons.filter((c) => c.status === 'INSUFFICIENT-DATA').map((c) => `${c.arm}: ${c.reason}`));
    if (satShort) reasons.push(`${side}, but ${few} arm${few === 1 ? ' has' : 's have'} fewer than ${cfg.minRuns} runs, so SATURATED is not called`);
    const insufficient = ndShort || satShort;
    items.push({ kind: first.kind, task: first.task, id: first.id, label: first.label, weight: first.weight ?? null, rates, comparisons, aa: aaCmp, judge, replicate, flags, insufficient, reasons });
  }
  const errTasks = [...new Set(checkErrors.map((x) => x.task))];
  for (const t of errTasks) {
    const why = checkErrors.filter((x) => x.task === t).map((x) => x.reason);
    const hit = items.filter((i) => i.kind === 'check' && i.task === t);
    for (const i of hit) Object.assign(i, { flags: [], insufficient: false, error: why, reasons: [`not judged: ${why.length} run${why.length === 1 ? '' : 's'} had check results that could not be matched`] });
    if (!hit.length) items.push({ kind: 'check', task: t, id: 'checks', label: 'check results that could not be matched', weight: null, rates: {}, comparisons: [], aa: null, judge: null, replicate: null, flags: [], insufficient: false, error: why, reasons: ['no check could be matched in any run'] });
  }
  items.sort((a, b) => b.flags.length - a.flags.length || a.task.localeCompare(b.task) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { arms, baseline, aa, variants, items, config: cfg };
}

function roundCmp(c) {
  return { nHead: c.nHead, nBase: c.nBase, delta: round(c.delta, 4), lo: round(c.lo, 4), hi: round(c.hi, 4), method: c.method, level: round(c.level, 4), cells: c.cells };
}

/** Whether judge disagreement can be measured, from the count of judged runs by number of usable judges. */
function judgeNote(judgesPerRun) {
  const multi = Object.entries(judgesPerRun).filter(([k]) => Number(k) >= 2).reduce((n, [, v]) => n + v, 0);
  const total = Object.values(judgesPerRun).reduce((n, v) => n + v, 0);
  if (!total) return { measured: false, note: 'no rubric judgments here, so judge disagreement is not measured; HIGH-VARIANCE rests on replicate spread only' };
  if (!multi) return { measured: false, note: 'one judge per run here, so judge disagreement is not measured; HIGH-VARIANCE rests on replicate spread only' };
  return { measured: true, note: `${multi} of ${total} judged runs have two or more judges` };
}

// ---- loading ----

function analyzeDir({ dir, benchDir, extraTasks = [], baseline = null, aa = null, armMap = null, config = {}, src = null }) {
  const { loadRun } = require('../report/load.js');
  const { analyze } = require('../report/generate.js');
  const { loadTasks } = require('../runner/lib/tasks.js');
  const run = loadRun(dir);
  const tasks = loadTasks(benchDir, { extraDirs: extraTasks });
  const present = [...new Set(run.runs.map((r) => r.armId))];
  const rawBase = armMap ? Object.keys(armMap).find((k) => armMap[k] === baseline) : baseline;
  const base = rawBase && present.includes(rawBase) ? rawBase : undefined;
  const a = analyze({ run, tasks, baseline: base });
  const { observations, judgesPerRun, checkErrors, checkNotes } = collectObservations({ run, rows: a.rows, ctx: a.ctx, tasks, src: src ?? dir, armMap });
  const baselineId = baseline ?? (armMap ? armMap[a.base] : a.base);
  return { observations, judgesPerRun, checkErrors, checkNotes, baseline: baselineId, aa, config };
}

/** Every lift skill and finished wave of a study. Wave 1 of a screened skill reads only its own delete arm, shown as del. */
function analyzeStudy({ studyDir, config = {}, benchDir = null, extraTasks = null }) {
  const { loadStudy, waveWhere, skillWaveComplete } = require('./skillstudy.js');
  const study = loadStudy(studyDir);
  const groups = [];
  for (const rec of study.plan.skills.filter((s) => s.lift)) {
    for (const n of [1, 2, 3]) {
      if (!skillWaveComplete(study, studyDir, rec, n)) continue;
      const where = waveWhere(study, studyDir, rec, n);
      const armMap = where.screen ? { ctl: 'ctl', 'ctl-b': 'ctl-b', [`del-${rec.name}`]: 'del' } : null;
      const r = analyzeDir({ dir: where.dir, benchDir: benchDir ?? study.settings.benchDir, extraTasks: extraTasks ?? study.settings.extraTasks ?? [], baseline: 'ctl', aa: 'ctl-b', armMap, config });
      groups.push({ skill: rec.name, wave: n, dir: path.relative(studyDir, where.dir), judges: judgeNote(r.judgesPerRun), checkNotes: r.checkNotes, ...analyzeObservations(r.observations, { baseline: 'ctl', aa: 'ctl-b', config, checkErrors: r.checkErrors }) });
    }
  }
  return groups;
}

/** Run directories outside a study, pooled into one group. Items in two or more directories get a paired interval. */
function analyzeRuns({ dirs, benchDir, extraTasks = [], baseline = null, aa = null, config = {} }) {
  const obs = [];
  const errs = [];
  const notes = [];
  const jpr = {};
  let base = baseline;
  for (const dir of dirs) {
    const r = analyzeDir({ dir, benchDir, extraTasks, baseline, aa, config });
    base = base ?? r.baseline;
    obs.push(...r.observations);
    errs.push(...r.checkErrors);
    notes.push(...r.checkNotes);
    for (const [k, v] of Object.entries(r.judgesPerRun)) jpr[k] = (jpr[k] ?? 0) + v;
  }
  return [{ skill: null, wave: null, dir: dirs.join(', '), judges: judgeNote(jpr), checkNotes: notes, ...analyzeObservations(obs, { baseline: base, aa, config, checkErrors: errs }) }];
}

// ---- report ----

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

function summarize(groups) {
  const items = groups.flatMap((g) => g.items);
  return { items: items.length, flagged: items.filter((i) => i.flags.length).length, insufficient: items.filter((i) => i.insufficient).length, errors: items.filter((i) => i.error).length, byFlag: Object.fromEntries(FLAGS.map((f) => [f, items.filter((i) => i.flags.includes(f)).length])) };
}

function buildCriteriaReport(groups, meta = {}) {
  const config = groups[0]?.config ?? { ...DEFAULTS, ...(meta.config ?? {}) };
  return { schemaVersion: 1, kind: 'criteria', advisory: true, createdAt: meta.createdAt ?? new Date().toISOString(), source: meta.source ?? null, thresholds: config, summary: summarize(groups), groups: groups.map(({ config: _c, ...g }) => g) };
}

const fmtCmp = (c) => (c.delta === null ? '-' : `${c.arm} ${c.delta >= 0 ? '+' : ''}${c.delta}${c.lo !== null ? ` (${c.lo} to ${c.hi})` : ''}`);

function renderCriteria(report) {
  const t = report.thresholds;
  const L = ['# Rubric criteria and checks that do not separate arms', ''];
  L.push(`Source ${report.source ?? '-'}; created ${report.createdAt}.`, '');
  L.push('Advisory only. This report changes no call, margin, floor or `cap decide` output, and `cap decide` does not read it. It reads judgments and check results already on disk and makes no model call. Use it to find rubric criteria and checks worth rewording, replacing or dropping before the next study.', '');
  L.push('## Thresholds', '', table(['threshold', 'value', 'meaning'], [
    ['margin', t.margin, 'the no-effect margin of cap decide: an interval inside plus or minus this is NON-DISCRIMINATING'],
    ['saturated', t.saturated, 'SATURATED when every arm is at or above this rate, or every arm at or below 1 minus it'],
    ['judge-disagree', t.judgeDisagree, 'HIGH-VARIANCE when judges gave different verdicts (strict: partial against pass counts) on more than this share of runs; the pass against not pass rate is shown beside it'],
    ['replicate-sd', t.replicateSd, 'HIGH-VARIANCE when the pooled SD of one arm and task across replicates is above this (0.5 is a coin flip)'],
    ['min-runs', t.minRuns, 'runs per arm needed before an item is called NON-DISCRIMINATING for scoring the same in every run, or SATURATED; below it the item is INSUFFICIENT-DATA'],
    ['adjust', t.adjust ? 'on' : 'off', 'intervals widened for the number of items on each arm pair (Bonferroni)'],
  ]), '');
  L.push('## Summary', '', table(['flag', 'items'], [...FLAGS.map((f) => [f, report.summary.byFlag[f]]), ['any flag', report.summary.flagged], ['INSUFFICIENT-DATA (not flagged)', report.summary.insufficient], ['checks not matched (error)', report.summary.errors], ['all items', report.summary.items]]), '');
  for (const g of report.groups) {
    L.push(`## ${g.skill ? `${g.skill}, wave ${g.wave}` : 'Run directories'} (${g.dir})`, '');
    L.push(`Baseline ${g.baseline}${g.aa ? `, A/A ${g.aa}` : ''}; variants ${g.variants.join(', ') || 'none'}. ${g.judges.note}.`, '');
    for (const n of g.checkNotes ?? []) L.push(`- checks of ${n.task}: ${n.note} (${n.runs} run${n.runs === 1 ? '' : 's'})`);
    if (g.checkNotes?.length) L.push('');
    const flagged = g.items.filter((i) => i.flags.length || i.insufficient || i.error);
    if (!flagged.length) { L.push(`No item flagged (${g.items.length} items).`, ''); continue; }
    L.push(table(['task', 'item', 'rate by arm', 'variant minus baseline (interval)', 'A/A', 'judges disagree (strict; pass against not pass)', 'replicate SD', 'flags', 'why'], flagged.map((i) => [
      i.task, `${i.kind === 'rubric' ? `rubric ${i.id}` : i.id}: ${i.label}`, Object.entries(i.rates).map(([a, r]) => `${a} ${r.rate} (n ${r.n})`).join('; '),
      i.comparisons.map(fmtCmp).join('; ') || '-', i.aa ? fmtCmp(i.aa) : '-', i.judge ? `${i.judge.disagree} of ${i.judge.runs}; ${i.judge.coarseDisagree} of ${i.judge.runs}` : 'not measured',
      i.replicate ? i.replicate.sd : 'not measured', i.flags.length ? i.flags.join(', ') : i.error ? 'ERROR' : 'INSUFFICIENT-DATA', [...i.reasons, ...(i.error ?? [])].join('; '),
    ])), '');
    L.push(`${g.items.length - flagged.length} of ${g.items.length} items have no flag and enough runs; criteria.json lists them all.`, '');
  }
  L.push('## Not shown by this report', '',
    '- A rubric criterion and a check belong to one task, so a comparison inside one run directory rests on that task\'s replicates; the interval is a bootstrap over them and treats runs as independent. Items found in two or more run directories get a paired interval by directory.',
    '- An item that does not separate these arms can still matter on another skill or task. NON-DISCRIMINATING says the item gave no information here, not that it is wrong.',
    '- Judge disagreement is counted after the evidence check that downgrades an unfound quote. The strict rate counts any difference in verdict, partial included, and drives HIGH-VARIANCE; the pass against not pass rate is shown beside it.',
    '- Checks are matched by an explicit id or name when every result record has one, else by a content id (a hash of the fields the task schema defines for a check), else by position when the lists have the same length and types. Two checks with the same content are numbered in list order (#1, #2); they run the same check, so the pairing cannot change a value. A run whose checks cannot be matched is an error for that task, and its checks are not judged.',
    '- Timeouts and errors stay in; infra errors and model mismatches are left out, as in cap decide.', '');
  return L.join('\n');
}

function writeCriteria(outDir, report) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'criteria.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'criteria.md'), renderCriteria(report));
  return [path.join(outDir, 'criteria.md'), path.join(outDir, 'criteria.json')];
}

module.exports = { DEFAULTS, FLAGS, CONTENT_FIELDS, contentIds, collectObservations, analyzeObservations, judgeNote, analyzeStudy, analyzeRuns, buildCriteriaReport, renderCriteria, writeCriteria };
