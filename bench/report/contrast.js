// SPDX-License-Identifier: Apache-2.0
'use strict';

// contrast: each head arm against one base arm in a single run, overall and per task class.
// It reuses compare's noise rules, so "worse" here means what a regression means in `compare`.

const { statFor, classify, armIdentity, MIN_RUNS_FOR_CI } = require('./compare.js');
const { buildReport, outcomeOf, OUTCOMES, CLASS_ORDER, BASIS } = require('./aggregate.js');
const { MIN_RECALL } = require('../runner/lib/contamination.js');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// Autonomy figures exist only on runs of a task with an autonomy block; the others report null and drop out of the mean.
const withAutonomy = (r) => typeof r.turns === 'number' && r.turns > 0;
const DEFAULT_BASE = 'v1.2.0';

// 'executed': every run that was not budget-skipped, so a timeout or error is counted at what it cost.
// 'finished': runs that ended with status success; a killed run has partial call counts and would pull a median down.
const SPECS = [
  { name: 'cost', group: 'cost', better: 'lower', kind: 'median', runs: 'executed' },
  { name: 'wallClockMs', group: 'cost', better: 'lower', kind: 'median', runs: 'executed', get: (r) => num(r.wallClockMs), fmt: 'time' },
  { name: 'modelCalls', group: 'cost', better: 'lower', kind: 'median', runs: 'finished', get: (r) => num(r.modelCalls?.meteringEntries), fmt: 'count' },
  { name: 'workToolCalls', group: 'cost', better: 'lower', kind: 'median', runs: 'finished', get: (r) => num(r.workToolCalls), fmt: 'count' },
  { name: 'subagentCalls', group: 'cost', better: 'lower', kind: 'median', runs: 'finished', get: (r) => num(r.subagentCalls), fmt: 'count' },
  { name: 'hiddenFraction', group: 'quality', better: 'higher', kind: 'mean', fmt: 'pct', scored: 'hiddenTests' },
  { name: 'regressionFraction', group: 'quality', better: 'higher', kind: 'mean', fmt: 'pct', scored: 'regressionTests' },
  { name: 'checksPass', group: 'quality', better: 'higher', kind: 'mean', fmt: 'rate', runs: 'executed', get: (r) => (outcomeOf(r) === 'good' ? 1 : 0) },
  { name: 'rubric', group: 'quality', better: 'higher', kind: 'mean', fmt: 'score', rubric: true },
  { name: 'askedUser', group: 'flags', better: 'lower', kind: 'mean', fmt: 'rate', runs: 'executed', get: (r) => (typeof r.askedUser === 'boolean' ? Number(r.askedUser) : null) },
  { name: 'externalFetch', group: 'flags', better: 'lower', kind: 'mean', fmt: 'rate', runs: 'executed', get: (r) => (r.contamination ? Number((r.contamination.externalFetch || []).length > 0) : null) },
  { name: 'fixRecall', group: 'flags', better: 'lower', kind: 'mean', fmt: 'rate', runs: 'executed', get: (r) => (r.contamination ? Number((r.contamination.fixRecallChars || 0) >= MIN_RECALL) : null) },
  { name: 'modelMismatch', group: 'flags', better: 'lower', kind: 'mean', fmt: 'rate', runs: 'executed', get: (r) => Number(outcomeOf(r) === 'modelMismatch') },
  { name: 'timeouts', group: 'flags', better: 'lower', kind: 'mean', fmt: 'rate', runs: 'executed', get: (r) => Number(outcomeOf(r) === 'timeout') },
  { name: 'errors', group: 'flags', better: 'lower', kind: 'mean', fmt: 'rate', runs: 'executed', get: (r) => Number(['error', 'infraError'].includes(outcomeOf(r))) },
  // optional: a row with no data on either side is left out, so a run set without autonomy data prints as before.
  { name: 'interjections', group: 'autonomy', better: 'lower', kind: 'mean', fmt: 'num', runs: 'executed', optional: true, get: (r) => (withAutonomy(r) ? num(r.interjections) : null) },
  { name: 'unmatchedQuestions', group: 'autonomy', better: 'lower', kind: 'mean', fmt: 'num', runs: 'executed', optional: true, get: (r) => (withAutonomy(r) ? num(r.unmatchedQuestions) : null) },
  { name: 'intendedFraction', group: 'autonomy', better: 'higher', kind: 'mean', fmt: 'pct', optional: true, scored: 'intendedTests' },
  { name: 'invariantFraction', group: 'autonomy', better: 'higher', kind: 'mean', fmt: 'pct', optional: true, scored: 'invariantTests' },
  { name: 'completedWithoutHelp', group: 'autonomy', better: 'higher', kind: 'mean', fmt: 'rate', runs: 'executed', optional: true, get: (r) => (withAutonomy(r) && typeof r.completedWithoutHelp === 'boolean' ? Number(r.completedWithoutHelp) : null) },
];

const LABELS = {
  cost: 'cost', wallClockMs: 'wall clock', modelCalls: 'model calls', workToolCalls: 'work tool calls', subagentCalls: 'subagent calls',
  hiddenFraction: 'hidden tests passed', regressionFraction: 'regression tests passed', checksPass: 'checks all pass', rubric: 'rubric score',
  askedUser: 'asked the user', externalFetch: 'external fetch', fixRecall: 'fix recall', modelMismatch: 'model mismatch', timeouts: 'timeouts', errors: 'errors',
  interjections: 'interjections', unmatchedQuestions: 'unmatched questions', intendedFraction: 'intended tests passed', invariantFraction: 'invariant tests passed', completedWithoutHelp: 'completed without help',
};

// Arms in run order: config order when recorded, else vanilla first and the rest by name.
function orderedArms(run) {
  const present = [...new Set(run.runs.map((r) => r.armId))];
  const cfg = (run.config.armIds || []).filter((a) => present.includes(a));
  const rest = present.filter((a) => !cfg.includes(a)).sort((a, b) => (a === 'vanilla' ? -1 : b === 'vanilla' ? 1 : a < b ? -1 : a > b ? 1 : 0));
  return [...cfg, ...rest];
}

function pickBase(armIds) {
  if (armIds.includes(DEFAULT_BASE)) return DEFAULT_BASE;
  if (armIds.includes('vanilla')) return 'vanilla';
  return armIds[0];
}

function provenance(run, armId) {
  const fromResult = run.runs.find((r) => r.armId === armId && armIdentity(r.result))?.result;
  const rec = fromResult ?? (run.config.arms || []).find((a) => a.id === armId) ?? run.runs.find((r) => r.armId === armId)?.result ?? {};
  const label = rec.armLabel ?? rec.label ?? armId;
  return {
    label, ref: rec.ref ?? null, source: rec.source ?? null, commitSha: rec.commitSha ?? null, contentHash: rec.contentHash ?? null, dirty: rec.dirty ?? null,
    baseSha: rec.baseSha ?? null, mergeBase: rec.mergeBase ?? null, commitsAhead: rec.commitsAhead ?? null, filesChanged: rec.filesChanged ?? null,
  };
}

function evaluate(spec, baseVals, headVals, opts, extra = {}) {
  const m = {
    name: spec.name, better: spec.better, fmt: spec.fmt ?? 'cost', nBase: baseVals.length, nHead: headVals.length,
    base: null, head: null, abs: null, rel: null, baseCI: null, headCI: null, verdict: 'no data', ...extra,
  };
  const sb = baseVals.length ? statFor(spec, baseVals) : null;
  const sh = headVals.length ? statFor(spec, headVals) : null;
  if (sb) { m.base = sb.value; m.baseCI = [sb.ciLow, sb.ciHigh]; }
  if (sh) { m.head = sh.value; m.headCI = [sh.ciLow, sh.ciHigh]; }
  if (!sb || !sh || sb.value === null || sh.value === null) return m;
  m.abs = sh.value - sb.value;
  m.rel = sb.value === 0 ? (sh.value === 0 ? 0 : Infinity) : m.abs / Math.abs(sb.value);
  if (Math.min(sb.n, sh.n) < MIN_RUNS_FOR_CI) { m.verdict = 'n too small'; return m; }
  const v = classify(spec, sb, sh, opts);
  m.verdict = !v ? 'within noise' : v.direction === 'worse' ? 'worse' : 'improved';
  return m;
}

const isExecuted = (e) => e.result.status !== 'budget_skipped';
const isFinished = (e) => e.result.status === 'success';

function outcomesOf(entries) {
  const executed = entries.filter(isExecuted);
  const o = { n: executed.length, ...Object.fromEntries(OUTCOMES.map((k) => [k, 0])), skipped: entries.length - executed.length };
  for (const e of executed) o[outcomeOf(e.result)]++;
  return o;
}

function minReplicates(entries) {
  const per = new Map();
  for (const e of entries.filter(isExecuted)) per.set(e.taskId, (per.get(e.taskId) || 0) + 1);
  return per.size ? Math.min(...per.values()) : 0;
}

function notCleanNote(arm, o) {
  const bad = OUTCOMES.slice(1).filter((k) => o[k]).map((k) => `${o[k]} ${k}`);
  return bad.length ? `${arm}: ${o.n - o.good} of ${o.n} run(s) were not clean passes (${bad.join(', ')}); cost and wall clock include them, call counts use finished runs only` : null;
}

function buildCell({ spec: specs, baseEntries, headEntries, base, head, basis, rubric, opts }) {
  const metrics = {};
  const tasksWith = (field) => new Set([...baseEntries, ...headEntries].filter((e) => e.result[field]?.total > 0).map((e) => e.taskId));
  for (const spec of specs) {
    const pool = (entries) => entries.filter(spec.runs === 'finished' ? isFinished : isExecuted);
    if (spec.scored) {
      const withData = tasksWith(spec.scored);
      const vals = (entries) => entries.filter(isExecuted).filter((e) => e.result[spec.scored]?.total > 0).map((e) => e.result[spec.scored].passed / e.result[spec.scored].total);
      const unscored = (entries) => entries.filter(isExecuted).filter((e) => withData.has(e.taskId) && !(e.result[spec.scored]?.total > 0)).length;
      metrics[spec.name] = evaluate(spec, vals(baseEntries), vals(headEntries), opts, { unscoredBase: unscored(baseEntries), unscoredHead: unscored(headEntries) });
    } else if (spec.rubric) {
      metrics[spec.name] = evaluate(spec, rubric(base), rubric(head), opts);
    } else {
      const get = spec.name === 'cost' ? (r) => basis.charged(r) : spec.get;
      const vals = (entries) => pool(entries).map((e) => get(e.result)).filter((v) => v !== null);
      const m = evaluate(spec, vals(baseEntries), vals(headEntries), opts);
      if (spec.name === 'cost') m.unit = basis.unit;
      metrics[spec.name] = m;
    }
  }
  const outcomes = { base: outcomesOf(baseEntries), head: outcomesOf(headEntries) };
  const notes = [notCleanNote(base, outcomes.base), notCleanNote(head, outcomes.head)].filter(Boolean);
  return { metrics, outcomes, notes, minReplicates: { base: minReplicates(baseEntries), head: minReplicates(headEntries) } };
}

function contrastRun({ run, tasks, base, heads, minRel = 0.15, rule = 'both' }) {
  const armIds = orderedArms(run);
  const baseArm = base ?? pickBase(armIds);
  if (!armIds.includes(baseArm)) throw new Error(`base arm "${baseArm}" has no runs in ${run.dir} (arms present: ${armIds.join(', ')})`);
  const headArms = heads && heads.length ? heads : armIds.filter((a) => a !== baseArm);
  for (const h of headArms) {
    if (!armIds.includes(h)) throw new Error(`head arm "${h}" has no runs in ${run.dir} (arms present: ${armIds.join(', ')})`);
    if (h === baseArm) throw new Error(`head arm "${h}" is also the base arm`);
  }
  if (!headArms.length) throw new Error(`nothing to contrast: the run has only the arm "${baseArm}"`);

  const basis = BASIS[run.harness ?? 'kiro-cli'];
  const classOf = (taskId) => tasks.get(taskId)?.class ?? 'unknown';
  const { series } = buildReport({ run, tasks, baseline: baseArm });
  const classes = [...new Set(run.runs.map((r) => classOf(r.taskId)))].sort((a, b) => (CLASS_ORDER.indexOf(a) + 1 || 99) - (CLASS_ORDER.indexOf(b) + 1 || 99));
  const scopes = ['overall', ...classes];
  const opts = { minRel, rule };
  const entriesOf = (arm, scope) => run.runs.filter((r) => r.armId === arm && (scope === 'overall' || classOf(r.taskId) === scope));

  const arms = Object.fromEntries([baseArm, ...headArms].map((a) => [a, provenance(run, a)]));
  const cells = {};
  const anecdotal = [];
  const notes = [];
  for (const head of headArms) {
    cells[head] = {};
    if (arms[head].commitSha && arms[head].commitSha === arms[baseArm].commitSha) notes.push(`${head} resolved to the same commit as ${baseArm}; differences are run-to-run noise`);
    for (const scope of scopes) {
      const baseEntries = entriesOf(baseArm, scope);
      const headEntries = entriesOf(head, scope);
      if (!baseEntries.length && !headEntries.length) continue;
      const rubric = (arm) => series[arm]?.[scope]?.rubricScore ?? [];
      const cell = buildCell({ spec: SPECS, baseEntries, headEntries, base: baseArm, head, basis, rubric, opts });
      cells[head][scope] = cell;
      const n = Math.min(cell.outcomes.base.n, cell.outcomes.head.n);
      if (n < MIN_RUNS_FOR_CI) anecdotal.push({ head, scope, n, kind: 'runs' });
      else {
        const reps = Math.min(cell.minReplicates.base, cell.minReplicates.head);
        if (reps < MIN_RUNS_FOR_CI) anecdotal.push({ head, scope, n: reps, kind: 'replicates' });
      }
    }
  }
  return {
    schemaVersion: 1, harness: run.harness ?? 'kiro-cli', costUnit: basis.unit,
    run: { dir: run.dir, suite: run.config.suite ?? null, model: run.config.model ?? run.runs[0].result.model, effort: run.config.effort ?? run.runs[0].result.effort },
    base: baseArm, heads: headArms, minRel, rule, scopes, arms, cells, anecdotal, notes,
  };
}

// ---- markdown ----

const sig = (v, d) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(d));
const signed = (s, v) => (v > 0 ? `+${s}` : s);

function fmtValue(m, v, n) {
  if (v === null) return '-';
  switch (m.fmt) {
    case 'time': return `${(v / 1000).toFixed(0)} s`;
    case 'count': return sig(v, 1);
    case 'pct': return `${(v * 100).toFixed(1)}%`;
    case 'score': case 'num': return v.toFixed(2);
    case 'rate': return `${Math.round(v * n)}/${n}`;
    default: return sig(v, 2);
  }
}

function fmtDelta(m) {
  if (m.abs === null) return ['-', '-'];
  const unitless = m.fmt === 'rate' || m.fmt === 'pct';
  const abs = unitless ? `${signed(`${(m.abs * 100).toFixed(1)}`, m.abs)} pts` : signed(fmtValue(m, m.abs, 1), m.abs);
  const rel = m.rel === Infinity ? 'from 0' : signed(`${(m.rel * 100).toFixed(0)}%`, m.rel);
  return [abs, rel];
}

function tableFor(cell) {
  const rows = ['| metric | base (n) | head (n) | delta | delta % | verdict |', '| --- | --- | --- | --- | --- | --- |'];
  for (const spec of SPECS) {
    const m = cell.metrics[spec.name];
    if (spec.optional && m.nBase === 0 && m.nHead === 0) continue;
    const label = spec.name === 'cost' ? `cost (${m.unit})` : LABELS[spec.name];
    const [abs, rel] = fmtDelta(m);
    const extra = m.unscoredHead || m.unscoredBase ? ` (unscored runs: base ${m.unscoredBase}, head ${m.unscoredHead})` : '';
    rows.push(`| ${label} | ${fmtValue(m, m.base, m.nBase)} (n=${m.nBase}) | ${fmtValue(m, m.head, m.nHead)} (n=${m.nHead}) | ${abs} | ${rel} | ${m.verdict}${extra} |`);
  }
  return rows.join('\n');
}

function outcomeLine(arm, o) {
  const parts = OUTCOMES.map((k) => `${k} ${o[k]} of ${o.n}`);
  return `${arm}: ${parts.join(', ')}${o.skipped ? `; ${o.skipped} budget-skipped (not counted)` : ''}`;
}

const aheadOf = (a) => (a.commitsAhead === null ? '-' : `${a.commitsAhead} ahead`);
const filesOf = (a) => (a.filesChanged ? `${a.filesChanged.count} (${a.filesChanged.topLevel.join(', ')})` : '-');
const stateOf = (a) => (a.dirty === null ? '-' : a.dirty ? 'dirty working tree' : 'clean');

function renderContrast(c) {
  const out = [];
  out.push(`# Contrast: ${c.heads.join(', ')} vs ${c.base}`, '');
  out.push(`Run: ${c.run.dir} (suite ${c.run.suite ?? 'n/a'}, model ${c.run.model}, effort ${c.run.effort})`);
  out.push(`Noise rule: a change counts when it is at least ${(c.minRel * 100).toFixed(0)}% and, with ${MIN_RUNS_FOR_CI} or more runs a side, outside the bootstrap CIs (rule ${c.rule}, as in compare). With fewer than ${MIN_RUNS_FOR_CI} runs on either side the verdict is "n too small" and only the raw delta is shown. Cost and wall clock include timeouts and errors.`, '');
  out.push('| arm | source | ref | commit or content hash | vs origin/main | files changed (top-level paths) | state |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const [id, a] of Object.entries(c.arms)) {
    const ident = a.commitSha ? a.commitSha.slice(0, 10) : a.contentHash ? `dir:${a.contentHash.slice(0, 10)}${a.baseSha ? ` base ${a.baseSha.slice(0, 10)}` : ''}` : '-';
    out.push(`| ${id === c.base ? `${id} (base)` : id} | ${a.source ?? '-'} | ${a.ref ?? '-'} | ${ident} | ${aheadOf(a)} | ${filesOf(a)} | ${stateOf(a)} |`);
  }
  out.push('');
  for (const n of c.notes) out.push(`Note: ${n}`);
  if (c.notes.length) out.push('');
  for (const head of c.heads) {
    out.push(`## ${head} vs ${c.base}`, '');
    for (const [scope, cell] of Object.entries(c.cells[head])) {
      out.push(`### ${scope}`, '', tableFor(cell), '');
      out.push(outcomeLine(c.base, cell.outcomes.base), outcomeLine(head, cell.outcomes.head), '');
      for (const n of cell.notes) out.push(`Note: ${n}`);
      if (cell.notes.length) out.push('');
      for (const a of c.anecdotal.filter((x) => x.head === head && x.scope === scope)) {
        out.push(a.kind === 'runs'
          ? `Anecdotal: ${scope} has n=${a.n} run(s) on the smaller side of ${head} vs ${c.base}. Read it as an example, not a measurement.`
          : `Anecdotal: ${scope} has n=${a.n} replicate(s) for its least-run task. Task-to-task differences dominate; read it as an example, not a measurement.`, '');
      }
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

module.exports = { contrastRun, renderContrast, pickBase, orderedArms, SPECS };
