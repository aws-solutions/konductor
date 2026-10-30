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
  // autonomy tier: series exist only for runs of tasks with an autonomy block, so other runs never meet these.
  { name: 'interjections', better: 'lower', kind: 'mean' },
  { name: 'unmatchedQuestions', better: 'lower', kind: 'mean' },
  { name: 'intendedFraction', better: 'higher', kind: 'mean' },
  { name: 'invariantFraction', better: 'higher', kind: 'mean' },
  { name: 'completedWithoutHelp', better: 'higher', kind: 'mean' },
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
    // Runs written before --agent-engine existed all used v2.
    agentEngine: run.harness === 'opencode' ? '' : run.config.agentEngine ?? results[0].agentEngine ?? 'v2',
  };
}

function refusalsFor(base, head) {
  const a = describe(base);
  const b = describe(head);
  const labels = {
    harness: 'harness', model: 'model pin', effort: 'effort', tasks: 'suite task set', judges: 'judge set',
    contentHash: 'task/fixture/suite content hash', harnessVersion: `${a.harness} version`, isolation: 'isolation mode',
    agentEngine: 'agent engine',
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

// What an arm resolved to, from its result.json fields (a directory arm by content hash), else the run-config record.
function armIdentity(rec) {
  if (!rec) return null;
  if (rec.source === 'dir') return rec.contentHash ? `dir:${rec.contentHash}` : null;
  return rec.commitSha || null;
}

function armRecords(run) {
  const out = new Map((run.config.arms || []).map((a) => [a.id, a]));
  for (const r of run.runs) if (armIdentity(r.result)) out.set(r.armId, r.result);
  return out;
}

const shortId = (id) => (id ? (id.startsWith('dir:') ? `dir:${id.slice(4, 16)}` : id.slice(0, 12)) : '-');

// Same name first; then a base-only arm pairs with a head-only arm that resolved to the same commit or snapshot.
function matchArms(baseArms, headArms, baseIds, headIds) {
  const pairs = baseArms.filter((a) => headArms.includes(a)).map((a) => ({ base: a, head: a, by: 'name' }));
  const free = headArms.filter((a) => !baseArms.includes(a));
  for (const a of baseArms.filter((x) => !headArms.includes(x))) {
    const id = baseIds.get(a);
    const hit = id && free.find((h) => headIds.get(h) === id);
    if (hit) { pairs.push({ base: a, head: hit, by: 'commit' }); free.splice(free.indexOf(hit), 1); }
  }
  return pairs;
}

function compareRuns({ baseDir, headDir, benchDir, minRel = 0.15, rule = 'both', force = false }) {
  const base = loadRun(baseDir);
  const head = loadRun(headDir);
  const tasks = loadTasks(benchDir);
  const refusals = refusalsFor(base, head);
  const result = { refusals, forced: force && refusals.length > 0, regressions: [], improvements: [], onlyInBase: [], onlyInHead: [], armChanged: [], matchedBySha: [], minRel, rule };
  if (refusals.length && !force) return { ...result, exitCode: 2 };

  const b = buildReport({ run: base, tasks });
  const h = buildReport({ run: head, tasks });
  const baseArms = Object.keys(b.report.arms);
  const headArms = Object.keys(h.report.arms);
  const baseRecs = armRecords(base);
  const headRecs = armRecords(head);
  const ids = (recs, arms) => new Map(arms.map((a) => [a, armIdentity(recs.get(a))]));
  const baseIds = ids(baseRecs, baseArms);
  const headIds = ids(headRecs, headArms);
  const pairs = matchArms(baseArms, headArms, baseIds, headIds);
  result.onlyInBase = baseArms.filter((a) => !pairs.some((p) => p.base === a));
  result.onlyInHead = headArms.filter((a) => !pairs.some((p) => p.head === a));
  result.matchedBySha = pairs.filter((p) => p.by === 'commit').map(({ base: b0, head: h0 }) => ({ base: b0, head: h0 }));
  for (const p of pairs.filter((x) => x.by === 'name')) {
    const bi = baseIds.get(p.base);
    const hi = headIds.get(p.head);
    if (bi && hi && bi !== hi) result.armChanged.push({ arm: p.head, base: pick(baseRecs.get(p.base)), head: pick(headRecs.get(p.head)) });
  }

  for (const { base: ba, head: ha } of pairs) {
    const arm = ba === ha ? ha : `${ba}->${ha}`;
    for (const scope of Object.keys(b.series[ba])) {
      if (!h.series[ha][scope]) continue;
      for (const m of METRICS) {
        const bs = b.series[ba][scope][m.series || m.name];
        const hs = h.series[ha][scope][m.series || m.name];
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

// The fields shown when an arm changed between runs; no contents.
function pick(rec) {
  return {
    ref: rec?.ref ?? null, source: rec?.source ?? null, commitSha: rec?.commitSha ?? null, contentHash: rec?.contentHash ?? null,
    baseSha: rec?.baseSha ?? null, commitsAhead: rec?.commitsAhead ?? null, dirty: rec?.dirty ?? null,
  };
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
  for (const c of r.armChanged || []) {
    const ahead = (x) => (x.commitsAhead === null ? '' : ` (${x.commitsAhead} ahead of origin/main)`);
    lines.push(`Arm changed: ${c.arm} was ${shortId(armIdentity(c.base))}${ahead(c.base)} in base and is ${shortId(armIdentity(c.head))}${ahead(c.head)} in head; the differences below include the new commits`);
  }
  for (const m of r.matchedBySha || []) lines.push(`Arms matched by commit: ${m.base} (base) = ${m.head} (head)`);
  if (r.onlyInBase.length) lines.push(`Arms only in base (not compared): ${r.onlyInBase.join(', ')}`);
  if (r.onlyInHead.length) lines.push(`Arms only in head (not compared): ${r.onlyInHead.join(', ')}`);
  lines.push(`REGRESSIONS (${r.regressions.length}):`, ...(r.regressions.length ? r.regressions.map(row) : ['  none']));
  lines.push(`IMPROVEMENTS (${r.improvements.length}):`, ...(r.improvements.length ? r.improvements.map(row) : ['  none']));
  return lines.join('\n');
}

module.exports = { compareRuns, formatCompare, relChange, statFor, classify, armIdentity, METRICS, MIN_RUNS_FOR_CI };
