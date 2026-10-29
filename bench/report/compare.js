// SPDX-License-Identifier: Apache-2.0
'use strict';

const { loadRun } = require('./load.js');
const { loadTasks } = require('../runner/lib/tasks.js');
const { buildReport } = require('./aggregate.js');
const { medianCI, meanCI, ratioCI } = require('./stats.js');

const MIN_RUNS_FOR_CI = 3;

const METRICS = [
  { name: 'successRate', better: 'higher', kind: 'mean' },
  { name: 'checkPassRate', better: 'higher', kind: 'mean' },
  { name: 'rubricScore', better: 'higher', kind: 'mean' },
  { name: 'credits', better: 'lower', kind: 'median' },
  { name: 'modelCalls', better: 'lower', kind: 'median' },
  { name: 'toolCalls', better: 'lower', kind: 'median' },
  { name: 'subagentCalls', better: 'lower', kind: 'median' },
  { name: 'wallClockMs', better: 'lower', kind: 'median' },
  { name: 'estTokens', better: 'lower', kind: 'median' },
  { name: 'creditsPerSuccessfulRun', series: 'creditsPerSuccess', better: 'lower', kind: 'ratio' },
  // opencode runs: a metric whose series a run lacks is skipped, so these never meet the kiro-cli ones.
  { name: 'costUsd', better: 'lower', kind: 'median' },
  { name: 'tokens', better: 'lower', kind: 'median' },
  { name: 'costUsdPerSuccessfulRun', series: 'costPerSuccess', better: 'lower', kind: 'ratio' },
];

function relChange(base, head) {
  if (base === 0) return head === 0 ? 0 : Infinity;
  return (head - base) / Math.abs(base);
}

function describe(run) {
  const results = run.runs.map((r) => r.result);
  return {
    model: run.config.model ?? results[0].model,
    effort: run.config.effort ?? results[0].effort,
    tasks: [...(run.config.taskIds ?? new Set(run.runs.map((r) => r.taskId)))].sort().join(','),
    judges: [...(run.judgments?.judges || [])].sort().join(','),
    contentHash: run.config.contentHash ?? '',
    harness: run.harness ?? 'kiro-cli',
    harnessVersion: (run.harness === 'opencode' ? run.config.harnessVersion ?? results[0].harnessVersion : run.config.kiroCliVersion ?? results[0].kiroCliVersion) ?? '',
    isolation: run.config.isolation?.mode ?? results[0].isolation ?? '',
  };
}

function refusalsFor(base, head) {
  const a = describe(base);
  const b = describe(head);
  const labels = {
    harness: 'harness', model: 'model pin', effort: 'effort', tasks: 'suite task set', judges: 'judge set',
    contentHash: 'task/fixture/suite content hash', harnessVersion: `${a.harness} version`, isolation: 'isolation mode',
  };
  return Object.keys(labels).filter((k) => a[k] !== b[k]).map((k) => `${labels[k]} differs: base "${a[k] || 'none'}" vs head "${b[k] || 'none'}"`);
}

function statFor(metric, values) {
  if (metric.kind === 'ratio') return ratioCI(values);
  if (metric.kind === 'mean') {
    const s = meanCI(values);
    return { n: s.n, value: s.mean, ciLow: s.ciLow, ciHigh: s.ciHigh };
  }
  const s = medianCI(values);
  return { n: s.n, value: s.median, ciLow: s.ciLow, ciHigh: s.ciHigh };
}

// Default rule: the change must be material (>= minRel) and, with enough runs, outside the CIs.
// With fewer than 3 runs a side, the CI carries no information, so size alone decides.
function classify(metric, base, head, { minRel, rule }) {
  const rel = relChange(base.value, head.value);
  if (rel === 0) return null;
  const worse = metric.better === 'lower' ? head.value > base.value : head.value < base.value;
  const material = Math.abs(rel) >= minRel;
  const disjoint = head.ciLow > base.ciHigh || head.ciHigh < base.ciLow;
  const lowN = base.n < MIN_RUNS_FOR_CI || head.n < MIN_RUNS_FOR_CI;
  const flagged = rule === 'any' ? material || (disjoint && !lowN) : material && (disjoint || lowN);
  if (!flagged) return null;
  return { direction: worse ? 'worse' : 'better', rel, lowN };
}

function compareRuns({ baseDir, headDir, benchDir, minRel = 0.15, rule = 'both', force = false }) {
  const base = loadRun(baseDir);
  const head = loadRun(headDir);
  const tasks = loadTasks(benchDir);
  const refusals = refusalsFor(base, head);
  const result = { refusals, forced: force && refusals.length > 0, regressions: [], improvements: [], onlyInBase: [], onlyInHead: [], minRel, rule };
  if (refusals.length && !force) return { ...result, exitCode: 2 };

  const b = buildReport({ run: base, tasks });
  const h = buildReport({ run: head, tasks });
  const baseArms = Object.keys(b.report.arms);
  const headArms = Object.keys(h.report.arms);
  result.onlyInBase = baseArms.filter((a) => !headArms.includes(a));
  result.onlyInHead = headArms.filter((a) => !baseArms.includes(a));

  for (const arm of baseArms.filter((a) => headArms.includes(a))) {
    for (const scope of Object.keys(b.series[arm])) {
      if (!h.series[arm][scope]) continue;
      for (const m of METRICS) {
        const bs = b.series[arm][scope][m.series || m.name];
        const hs = h.series[arm][scope][m.series || m.name];
        if (!bs?.length || !hs?.length) continue;
        const sb = statFor(m, bs);
        const sh = statFor(m, hs);
        if (sb.value === null || sh.value === null) continue;
        const verdict = classify(m, sb, sh, { minRel, rule });
        if (!verdict) continue;
        const row = { arm, scope, metric: m.name, base: sb.value, head: sh.value, baseCI: [sb.ciLow, sb.ciHigh], headCI: [sh.ciLow, sh.ciHigh], nBase: sb.n, nHead: sh.n, rel: verdict.rel, lowN: verdict.lowN, direction: verdict.direction };
        (verdict.direction === 'worse' ? result.regressions : result.improvements).push(row);
      }
    }
  }
  return { ...result, exitCode: result.regressions.length ? 1 : 0 };
}

function formatCompare(r) {
  const lines = [];
  if (r.refusals.length) {
    lines.push(`${r.forced ? 'Comparing despite (--force)' : 'Refusing to compare'}:`, ...r.refusals.map((x) => `  - ${x}`));
    if (!r.forced) return lines.join('\n');
  }
  const row = (x) => {
    const rel = Number.isFinite(x.rel) ? `${x.rel >= 0 ? '+' : ''}${(x.rel * 100).toFixed(0)}%` : 'from 0';
    const g = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3));
    return `  ${x.arm} / ${x.scope} / ${x.metric}: ${g(x.base)} -> ${g(x.head)} (${rel})${x.lowN ? ' [few runs, CI not used]' : ''}`;
  };
  lines.push(`Rule: ${r.rule}, minimum relative change ${(r.minRel * 100).toFixed(0)}%`);
  if (r.onlyInBase.length) lines.push(`Arms only in base (not compared): ${r.onlyInBase.join(', ')}`);
  if (r.onlyInHead.length) lines.push(`Arms only in head (not compared): ${r.onlyInHead.join(', ')}`);
  lines.push(`REGRESSIONS (${r.regressions.length}):`, ...(r.regressions.length ? r.regressions.map(row) : ['  none']));
  lines.push(`IMPROVEMENTS (${r.improvements.length}):`, ...(r.improvements.length ? r.improvements.map(row) : ['  none']));
  return lines.join('\n');
}

module.exports = { compareRuns, formatCompare, relChange };
