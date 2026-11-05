// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js explain`: how the quality number of one saved run was computed, step by step, from the files in its directory.
// It calls the same loaders and formulas as `report` (rows.js, scores.js, judge/score.js) and no model. A reader sees each check
// with what was observed, hidden tests, the rubric per judge with its evidence and any downgrade, the weights, the
// renormalisation, the final number and what the number would be if checks were scored as a fraction.

const fs = require('node:fs');
const path = require('node:path');
const { loadRuns } = require('./load.js');
const { enrichOrch } = require('./orch.js');
const { analyze } = require('./generate.js');
const { qualityOfRun, componentsOf } = require('./scores.js');
const { normalize } = require('./verdict.js');
const { rubricScore } = require('../judge/score.js');
const { VERDICT_VALUE } = require('../judge/config.js');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f1 = (v) => (fin(v) ? v.toFixed(1) : 'n/a');
const f3 = (v) => (fin(v) ? String(Math.round(v * 1e4) / 1e4) : 'n/a');
const cut = (s, n = 120) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };
const signed = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/**
 * The run directories under `dir`: a 2x2 pilot root (cells/<cell>/<task>) expands to one directory per cell and task;
 * any other directory is itself a run directory.
 */
function expandRunDirs(dir) {
  const cells = path.join(dir, 'cells');
  if (!isDir(cells)) return [{ dir, cell: null }];
  const out = [];
  for (const cell of fs.readdirSync(cells).sort()) {
    for (const task of fs.readdirSync(path.join(cells, cell)).sort()) {
      const d = path.join(cells, cell, task);
      if (fs.existsSync(path.join(d, 'run-config.json'))) out.push({ dir: d, cell });
    }
  }
  return out;
}

// A cell directory sits at <root>/cells/<cell>/<task>; the 2x2 report names the cell in camel case.
function cellOf(dir) {
  const parts = path.resolve(dir).split(path.sep);
  const i = parts.lastIndexOf('cells');
  return i >= 0 && parts.length > i + 2 ? { name: parts[i + 1], root: parts.slice(0, i).join(path.sep) || path.sep } : null;
}

function reportJsonFor(dir) {
  const cell = cellOf(dir);
  if (!cell) return null;
  const file = path.join(cell.root, 'report', 'factorial-2x2.json');
  return fs.existsSync(file) ? file : null;
}

// Label for check i: the id or name if the task gives one, else a /*TAG*/ marker in the command, else type and path.
function checkLabel(i, c, taskChecks) {
  const named = (taskChecks?.[i] || {}).id || (taskChecks?.[i] || {}).name || c.id || c.name;
  if (named) return String(named);
  const tag = /\/\*([A-Za-z0-9_-]+)\*\//.exec(c.cmd || '');
  return tag ? tag[1] : `${c.type}${c.path ? ` ${c.path}` : ''}`;
}

const checkDesc = (c) => [c.path && `path=${cut(c.path, 60)}`, c.pattern !== undefined && `pattern=${cut(c.pattern)}`, c.cmd !== undefined && `cmd=${cut(c.cmd)}`, c.min !== undefined && `min=${c.min}`].filter(Boolean).join(' ');

function checksSection(L, { r, row, task, weights }) {
  const checks = Array.isArray(r.checks) ? r.checks : [];
  const failed = checks.filter((c) => !c.passed);
  L(`2. CHECKS  (${checks.length - failed.length} of ${checks.length} passed)`);
  if (!checks.length) L('   no checks recorded');
  checks.forEach((c, i) => {
    L(`   #${String(i).padStart(2)} ${c.passed ? 'PASS' : 'FAIL'}  ${checkLabel(i, c, task?.checks).padEnd(18)} type=${c.type}  ${checkDesc(c)}${c.passed ? '' : `  OBSERVED: ${cut(c.detail)}`}`);
    if (c.passed && c.detail && /\d/.test(c.detail) && c.type !== 'cmd') L(`        recorded: ${cut(c.detail)}`);
  });
  const mode = weights.checksMode === 'fraction' ? 'fraction passed' : 'all-or-nothing';
  L(`   Component score (${mode}): checks = ${row.checks === null ? 'n/a (no checks)' : f3(row.checks)}  [${checks.length ? `every check passed? ${checks.every((c) => c.passed)}` : 'none'}]`);
  return checks;
}

function hiddenSection(L, { r, row }) {
  L('3. HIDDEN TESTS');
  if (row.hidden === null) { L('   absent (no hiddenTests or intendedTests with total > 0): component dropped from the score'); return; }
  const t = row.hiddenSource === 'hiddenTests' ? r.hiddenTests : r.intendedTests;
  L(`   present: ${row.hiddenSource} ${t.passed}/${t.total} = ${f3(row.hidden)}`);
}

function rubricSection(L, { run, row, task }) {
  L('4. RUBRIC');
  const recs = (run.judgments?.rubric || []).filter((x) => x.armId === row.arm && x.taskId === row.task && x.replicate === row.rep);
  const rubric = task?.rubric || [];
  if (!recs.length) { L('   no rubric records for this run (not judged): component dropped from the score'); return; }
  for (const item of rubric) {
    L(`   ${item.id} (weight ${item.weight})`);
    for (const rec of recs) {
      const cr = (rec.criteria || []).find((x) => x.id === item.id);
      if (!cr) { L(`     ${rec.judge.padEnd(14)} (no verdict)`); continue; }
      const note = cr.verdictRaw && cr.verdictRaw !== cr.verdict ? ` [judge said ${cr.verdictRaw}; evidence quote not found, dropped one level]` : '';
      L(`     ${rec.judge.padEnd(14)} ${String(cr.verdict).padEnd(8)}${note}  "${cut(cr.evidence)}"`);
    }
  }
  L('   per-judge score (verified = after the evidence check, which the report uses; raw = the judge\'s verdicts as given):');
  const verified = [];
  for (const rec of recs) {
    if (rec.judgeError) { L(`     ${rec.judge.padEnd(14)} judgeError: ${cut(rec.judgeError)} (excluded)`); continue; }
    const calc = rubricScore(rubric, rec.criteria || []);
    const rawCalc = rubricScore(rubric, (rec.criteria || []).map((x) => ({ id: x.id, verdict: x.verdictRaw ?? x.verdict })));
    const agree = fin(calc) && fin(rec.score) && Math.abs(calc - rec.score) < 1e-9 ? 'ok' : 'DIFFERS from stored';
    const down = (rec.criteria || []).filter((x) => x.evidenceDowngraded).length;
    L(`     ${rec.judge.padEnd(14)} verified=${f3(calc)} (stored ${f3(rec.score)}, ${agree})  raw=${f3(rawCalc)} (stored ${f3(rec.scoreRaw)})  downgraded ${down} of ${(rec.criteria || []).length}`);
    if (fin(rec.score)) verified.push(rec.score);
  }
  L(`   rubric mean over ${verified.length} judge(s) = ${f3(mean(verified))}   (report value: ${f3(row.rubric)}; VERDICT_VALUE ${JSON.stringify(VERDICT_VALUE)})`);
}

function arithmeticSection(L, { n, q, weights, scoringFile, dir, row, executed, reportJson }) {
  L('5. ARITHMETIC');
  const parts = { hidden: n.hidden, checks: n.checks, rubric: n.rubric, pack: n.pack };
  const used = componentsOf(weights).filter((k) => fin(parts[k]) && (weights[k] ?? 0) > 0);
  const absent = componentsOf(weights).filter((k) => !used.includes(k));
  L(`   weights (${scoringFile || 'bench/profiles/scoring.json'}): ${componentsOf(weights).map((k) => `${k} ${weights[k]}`).join(', ')}${weights.checksMode ? ` (checks scored as ${weights.checksMode})` : ''}`);
  L(`   components present: ${used.map((k) => `${k}=${f3(parts[k])}`).join(', ') || 'none'}${absent.length ? `;  absent (dropped): ${absent.join(', ')}` : ''}`);
  if (!q) { L(`   no score: ${n.outcome === 'infraError' || n.outcome === 'modelMismatch' ? `run is excluded (${n.outcome})` : 'no weighted component'}`); return; }
  const total = used.reduce((s, k) => s + weights[k], 0);
  const renorm = Object.fromEntries(used.map((k) => [k, weights[k] / total]));
  L(`   renormalised weights (each / ${f3(total)}): ${used.map((k) => `${k} ${f3(renorm[k])}`).join(', ')}`);
  const manual = 100 * used.reduce((s, k) => s + renorm[k] * parts[k], 0);
  L(`   quality = 100 * (${used.map((k) => `${f3(renorm[k])}*${k}`).join(' + ')}) = 100 * (${used.map((k) => `${f3(renorm[k])}*${f3(parts[k])}`).join(' + ')}) = ${manual.toFixed(2)}`);
  L(`   qualityOfRun() = ${q.score.toFixed(2)}  (${Math.abs(manual - q.score) < 1e-9 ? 'agrees with the line above' : 'DISAGREES with the line above'})`);
  const cell = cellOf(dir);
  const rep = reportJson?.cells?.find((c) => c.id === camel(cell?.name ?? ''))?.byTask?.[row.task];
  if (rep && fin(rep.quality)) {
    const single = executed.filter((x) => x.taskId === row.task).length === 1;
    L(`   2x2 report: ${camel(cell.name)} / ${row.task} quality = ${rep.quality.toFixed(2)}  (runs ${rep.runs}, scored ${rep.scored}): ${Math.abs(rep.quality - q.score) < 1e-9 ? 'MATCH' : 'MISMATCH'}${single ? '' : ' (the report cell is a mean over replicates)'}`);
  }
}

function whatIfSection(L, { n, q, weights, checks }) {
  L('6. WHAT-IF (not the formula in use)');
  if (!q) { L('   n/a'); return; }
  const passed = checks.filter((c) => c.passed).length;
  const frac = checks.length ? passed / checks.length : null;
  const byFraction = qualityOfRun({ ...n, checks: frac }, weights);
  const allPass = qualityOfRun({ ...n, checks: checks.length ? 1 : null }, weights);
  L(`   [A] checks scored as a fraction (${passed}/${checks.length} = ${f3(frac)}, profiles/scoring-quality-fractional.json): quality ${q.score.toFixed(2)} -> ${f1(byFraction?.score)}  (${signed(byFraction.score - q.score)} points)`);
  L(`   [B] every check passed: quality ${q.score.toFixed(2)} -> ${f1(allPass?.score)}  (${signed(allPass.score - q.score)} points: the most the failed checks cost)`);
}

function explainRow({ row, run, tasks, weights, unit, scoringFile, dir, executed, reportJson, brief }) {
  const e = executed.find((x) => x.armId === row.arm && x.taskId === row.task && x.replicate === row.rep);
  const r = e.result;
  const task = tasks.get(row.task);
  const n = normalize(row, 0);
  const q = (n.outcome === 'infraError' || n.outcome === 'modelMismatch') ? null : qualityOfRun(n, weights);
  const checks = Array.isArray(r.checks) ? r.checks : [];
  const failed = checks.map((c, i) => ({ c, i })).filter((x) => !x.c.passed);
  const out = [];
  const L = (s = '') => out.push(s);
  if (brief) {
    const byFraction = qualityOfRun({ ...n, checks: checks.length ? checks.filter((c) => c.passed).length / checks.length : null }, weights);
    return [[row.arm, row.task, `rep${row.rep}`, row.status, `checks ${checks.length - failed.length}/${checks.length}`,
      `failed=[${failed.map((x) => `#${x.i}:${checkLabel(x.i, x.c, task?.checks)}`).join(',')}]`, `checksTerm=${row.checks ?? 'n/a'}`, `hidden=${f3(row.hidden)}`, `rubric=${f3(row.rubric)}`,
      `quality=${f1(q?.score)}`, `ifFraction=${f1(byFraction?.score)}`].join('\t')];
  }
  L('='.repeat(100));
  L(`RUN  ${path.join(dir, row.arm, row.task, String(row.rep))}`);
  L('='.repeat(100));
  L('1. HEADER');
  L(`   arm=${row.arm}  task=${row.task}  replicate=${row.rep}  status=${row.status}  outcome=${row.outcome}`);
  L(`   cost=${f3(row.credits)} ${unit}${row.censored ? ' (censored)' : ''}  wall=${fin(row.wall) ? (row.wall / 1000).toFixed(1) : 'n/a'} s  flags=[${(row.flags || []).join(', ')}]`);
  L('');
  const allChecks = checksSection(L, { r, row, task, weights });
  L('');
  hiddenSection(L, { r, row });
  L('');
  rubricSection(L, { run, row, task });
  L('');
  arithmeticSection(L, { n, q, weights, scoringFile, dir, row, executed, reportJson });
  L('');
  whatIfSection(L, { n, q, weights, checks: allChecks });
  L('');
  return out;
}

/**
 * Text explaining each selected run of one run directory (or of every cell of a 2x2 root).
 * filter: { arm, task, rep } narrow the runs; arm matches an arm id or, in a 2x2 root, a cell name.
 */
function explainRuns({ dir, tasks, filter = {}, brief = false, scoringFile = undefined }) {
  const lines = [];
  let matched = 0;
  for (const target of expandRunDirs(path.resolve(dir))) {
    const run = loadRuns([target.dir]);
    enrichOrch(run);
    const a = analyze({ run, tasks, scoringFile });
    const executed = run.runs.filter((e) => e.result.status !== 'budget_skipped');
    const reportFile = reportJsonFor(target.dir);
    const reportJson = reportFile ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : null;
    for (const row of a.rows) {
      if (filter.arm && filter.arm !== row.arm && filter.arm !== target.cell) continue;
      if (filter.task && filter.task !== row.task) continue;
      if (filter.rep !== undefined && Number(filter.rep) !== row.rep) continue;
      matched++;
      lines.push(...explainRow({ row, run, tasks, weights: a.weights, unit: a.scores.unit, scoringFile, dir: target.dir, executed, reportJson, brief }));
    }
  }
  if (!matched) throw new Error(`no run in ${dir} matches${filter.arm ? ` arm ${filter.arm}` : ''}${filter.task ? ` task ${filter.task}` : ''}${filter.rep !== undefined ? ` replicate ${filter.rep}` : ''}`);
  return lines.join('\n');
}

module.exports = { explainRuns, expandRunDirs, checkLabel };
