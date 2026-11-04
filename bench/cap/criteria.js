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
//   SATURATED           every arm sits at or above the ceiling rate, or every arm at or below the floor (1 - ceiling).
//   HIGH-VARIANCE       judges disagree on more than a share of the runs, or replicates of one arm and task spread more
//                       than a pooled standard deviation. Each half is measured only when the data has it.

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

/**
 * Observations from one loaded run directory: one per item and run, after leaving out infra errors and model mismatches
 * as `cap decide` does. `rows` and `ctx` come from report/generate.js analyze(). A check is named by its position in the
 * task's check list. Returns { observations, judgesPerRun } where judgesPerRun counts runs by number of usable judges.
 */
function collectObservations({ run, rows, ctx, tasks, src = run.dir, armMap = null }) {
  const outcome = new Map(rows.map((r) => [`${r.arm}\u0000${r.task}\u0000${r.rep}`, r.outcome]));
  const observations = [];
  const judgesPerRun = {};
  for (const e of run.runs) {
    if (e.result.status === 'budget_skipped') continue;
    const arm = armMap ? armMap[e.armId] : e.armId;
    if (!arm) continue;
    const oc = outcome.get(`${e.armId}\u0000${e.taskId}\u0000${e.replicate}`);
    if (LEFT_OUT.includes(oc)) continue;
    const task = tasks.get(e.taskId);
    const base = { arm, task: e.taskId, rep: e.replicate, src };
    (e.result.checks ?? []).forEach((c, i) => {
      if (typeof c?.passed !== 'boolean') return;
      const spec = task?.checks?.[i] ?? c;
      observations.push({ ...base, kind: 'check', id: `check-${i + 1}`, label: short(`${spec.type} ${spec.path ?? spec.cmd ?? spec.pattern ?? ''}`), value: c.passed ? 1 : 0, judgeValues: null });
    });
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
  return { observations, judgesPerRun };
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
function analyzeObservations(observations, { baseline, aa = null, config = {} } = {}) {
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
    const judge = multi.length ? (() => { const d = multi.filter((o) => Math.max(...o.judgeValues) !== Math.min(...o.judgeValues)).length; return { runs: multi.length, disagree: d, rate: round(d / multi.length, 4) }; })() : null;
    const cellGroups = [...new Set(g.map((o) => `${o.arm}\u0000${o.src}`))].map((k) => g.filter((o) => `${o.arm}\u0000${o.src}` === k).map((o) => o.value));
    const w = withinCellSd(cellGroups);
    const replicate = w.cells ? { sd: round(w.sd, 4), cells: w.cells } : null;

    const flags = [];
    const reasons = [];
    if (comparisons.length && comparisons.every((c) => c.status === 'NON-DISCRIMINATING')) { flags.push('NON-DISCRIMINATING'); reasons.push(...comparisons.map((c) => `${c.arm}: ${c.reason}`)); }
    const rs = Object.values(rates).map((r) => r.rate);
    if (rs.length >= 2 && rs.every((r) => r >= cfg.saturated)) { flags.push('SATURATED'); reasons.push(`every arm at or above ${cfg.saturated} (ceiling)`); }
    else if (rs.length >= 2 && rs.every((r) => r <= 1 - cfg.saturated)) { flags.push('SATURATED'); reasons.push(`every arm at or below ${round(1 - cfg.saturated, 4)} (floor)`); }
    const hv = [];
    if (judge && judge.rate > cfg.judgeDisagree) hv.push(`judges disagreed on ${judge.disagree} of ${judge.runs} runs`);
    if (replicate && replicate.sd > cfg.replicateSd) hv.push(`replicate SD ${replicate.sd} over ${replicate.cells} cells`);
    if (hv.length) { flags.push('HIGH-VARIANCE'); reasons.push(...hv); }
    const insufficient = !flags.includes('NON-DISCRIMINATING') && comparisons.some((c) => c.status === 'INSUFFICIENT-DATA');
    if (insufficient) reasons.push(...comparisons.filter((c) => c.status === 'INSUFFICIENT-DATA').map((c) => `${c.arm}: ${c.reason}`));
    items.push({ kind: first.kind, task: first.task, id: first.id, label: first.label, weight: first.weight ?? null, rates, comparisons, aa: aaCmp, judge, replicate, flags, insufficient, reasons });
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
  const { observations, judgesPerRun } = collectObservations({ run, rows: a.rows, ctx: a.ctx, tasks, src: src ?? dir, armMap });
  const baselineId = baseline ?? (armMap ? armMap[a.base] : a.base);
  return { observations, judgesPerRun, baseline: baselineId, aa, config };
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
      groups.push({ skill: rec.name, wave: n, dir: path.relative(studyDir, where.dir), judges: judgeNote(r.judgesPerRun), ...analyzeObservations(r.observations, { baseline: 'ctl', aa: 'ctl-b', config }) });
    }
  }
  return groups;
}

/** Run directories outside a study, pooled into one group. Items in two or more directories get a paired interval. */
function analyzeRuns({ dirs, benchDir, extraTasks = [], baseline = null, aa = null, config = {} }) {
  const obs = [];
  const jpr = {};
  let base = baseline;
  for (const dir of dirs) {
    const r = analyzeDir({ dir, benchDir, extraTasks, baseline, aa, config });
    base = base ?? r.baseline;
    obs.push(...r.observations);
    for (const [k, v] of Object.entries(r.judgesPerRun)) jpr[k] = (jpr[k] ?? 0) + v;
  }
  return [{ skill: null, wave: null, dir: dirs.join(', '), judges: judgeNote(jpr), ...analyzeObservations(obs, { baseline: base, aa, config }) }];
}

// ---- report ----

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

function summarize(groups) {
  const items = groups.flatMap((g) => g.items);
  return { items: items.length, flagged: items.filter((i) => i.flags.length).length, insufficient: items.filter((i) => i.insufficient).length, byFlag: Object.fromEntries(FLAGS.map((f) => [f, items.filter((i) => i.flags.includes(f)).length])) };
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
    ['judge-disagree', t.judgeDisagree, 'HIGH-VARIANCE when judges gave different verdicts on more than this share of runs'],
    ['replicate-sd', t.replicateSd, 'HIGH-VARIANCE when the pooled SD of one arm and task across replicates is above this (0.5 is a coin flip)'],
    ['min-runs', t.minRuns, 'runs per arm needed before an item that scored the same in every run is called NON-DISCRIMINATING; below it the item is INSUFFICIENT-DATA'],
    ['adjust', t.adjust ? 'on' : 'off', 'intervals widened for the number of items on each arm pair (Bonferroni)'],
  ]), '');
  L.push('## Summary', '', table(['flag', 'items'], [...FLAGS.map((f) => [f, report.summary.byFlag[f]]), ['any flag', report.summary.flagged], ['INSUFFICIENT-DATA (not flagged)', report.summary.insufficient], ['all items', report.summary.items]]), '');
  for (const g of report.groups) {
    L.push(`## ${g.skill ? `${g.skill}, wave ${g.wave}` : 'Run directories'} (${g.dir})`, '');
    L.push(`Baseline ${g.baseline}${g.aa ? `, A/A ${g.aa}` : ''}; variants ${g.variants.join(', ') || 'none'}. ${g.judges.note}.`, '');
    const flagged = g.items.filter((i) => i.flags.length || i.insufficient);
    if (!flagged.length) { L.push(`No item flagged (${g.items.length} items).`, ''); continue; }
    L.push(table(['task', 'item', 'rate by arm', 'variant minus baseline (interval)', 'A/A', 'judges disagree', 'replicate SD', 'flags', 'why'], flagged.map((i) => [
      i.task, `${i.kind === 'rubric' ? `rubric ${i.id}` : i.id}: ${i.label}`, Object.entries(i.rates).map(([a, r]) => `${a} ${r.rate} (n ${r.n})`).join('; '),
      i.comparisons.map(fmtCmp).join('; ') || '-', i.aa ? fmtCmp(i.aa) : '-', i.judge ? `${i.judge.disagree} of ${i.judge.runs}` : 'not measured',
      i.replicate ? i.replicate.sd : 'not measured', i.flags.length ? i.flags.join(', ') : 'INSUFFICIENT-DATA', i.reasons.join('; '),
    ])), '');
    L.push(`${g.items.length - flagged.length} of ${g.items.length} items have no flag and enough runs; criteria.json lists them all.`, '');
  }
  L.push('## Not shown by this report', '',
    '- A rubric criterion and a check belong to one task, so a comparison inside one run directory rests on that task\'s replicates; the interval is a bootstrap over them and treats runs as independent. Items found in two or more run directories get a paired interval by directory.',
    '- An item that does not separate these arms can still matter on another skill or task. NON-DISCRIMINATING says the item gave no information here, not that it is wrong.',
    '- Judge disagreement counts any difference in verdict, partial included, after the evidence check that downgrades an unfound quote.',
    '- Timeouts and errors stay in; infra errors and model mismatches are left out, as in cap decide.', '');
  return L.join('\n');
}

function writeCriteria(outDir, report) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'criteria.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'criteria.md'), renderCriteria(report));
  return [path.join(outDir, 'criteria.md'), path.join(outDir, 'criteria.json')];
}

module.exports = { DEFAULTS, FLAGS, collectObservations, analyzeObservations, judgeNote, analyzeStudy, analyzeRuns, buildCriteriaReport, renderCriteria, writeCriteria };
