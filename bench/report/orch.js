// SPDX-License-Identifier: Apache-2.0
'use strict';

// Orchestration metrics of a loaded run: spawns, depth, review rounds, reworks after a PASS and phase documents.
// A result.json written by a current runner carries `orch`; an older run directory is read from its stream.jsonl and
// workspace/ and marked `backfilled`. The review and rework figures come from text heuristics (profiles/orch-metrics.json).

const D = require('./doc.js');
const { orchMetricsOfRunDir } = require('../runner/lib/orch-metrics.js');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f = (v, d = 1) => (fin(v) ? v.toFixed(d) : 'n/a');

/** Fills result.orch of every run that has none, from its directory. Sets entry.orchSource to 'stored' or 'backfilled'. */
function enrichOrch(run) {
  for (const e of run.runs) {
    if (e.result.orch) { e.orchSource = 'stored'; continue; }
    if (e.result.status === 'budget_skipped') continue;
    let m = null;
    try { m = orchMetricsOfRunDir(e.dir); } catch { /* an unreadable stream leaves the run without orch */ }
    if (m) { e.result.orch = m; e.orchSource = 'backfilled'; }
  }
  return run;
}

/** { present, total, complete } over the selected phase ids (null or 'all': every phase), or null when the run recorded no documents. */
function phaseTotals(orch, phases = null) {
  const all = orch?.phaseDocs?.phases;
  if (!all) return null;
  const ids = phases && phases !== 'all' ? phases : Object.keys(all);
  const picked = ids.map((id) => all[id]).filter(Boolean);
  if (!picked.length) return null;
  return { present: picked.reduce((n, p) => n + p.present, 0), total: picked.reduce((n, p) => n + p.total, 0), complete: picked.every((p) => p.complete) };
}

/** One record per arm over the runs that were executed. */
function summarize(run, { phases = null } = {}) {
  const arms = [...new Set(run.runs.map((e) => e.armId))];
  return arms.map((arm) => {
    const entries = run.runs.filter((e) => e.armId === arm && e.result.status !== 'budget_skipped');
    const have = entries.filter((e) => e.result.orch);
    const get = (k) => have.map((e) => e.result.orch[k]).filter(fin);
    const totals = have.map((e) => phaseTotals(e.result.orch, phases)).filter(Boolean);
    return {
      arm, runs: entries.length, withData: have.length,
      spawns: mean(get('spawns')), maxDepth: get('maxSpawnDepth').length ? Math.max(...get('maxSpawnDepth')) : null,
      reviewRounds: mean(get('reviewRounds')), reworksAfterPass: mean(get('reworksAfterPass')),
      phaseDocsPresent: totals.length ? mean(totals.map((t) => (t.total ? t.present / t.total : 0))) : null,
      phaseDocsComplete: totals.length ? mean(totals.map((t) => Number(t.complete))) : null,
      backfilled: have.filter((e) => e.orchSource === 'backfilled').length,
    };
  });
}

/** Blocks for the run report: a table per arm and the caveat. Empty when no run has orch data. */
function orchBlocks(run, { phases = null } = {}) {
  const sums = summarize(run, { phases });
  if (!sums.some((s) => s.withData)) return [];
  const showDocs = Boolean(phases);
  const head = ['arm', 'runs', 'with data', 'spawns (mean)', 'max spawn depth', 'review rounds (mean)', 'reworks after a pass (mean)', ...(showDocs ? ['phase documents present (mean)', 'every document present'] : [])];
  const rows = sums.map((s) => [s.arm, s.runs, s.withData, f(s.spawns), fin(s.maxDepth) ? s.maxDepth : 'n/a', f(s.reviewRounds), f(s.reworksAfterPass), ...(showDocs ? [fin(s.phaseDocsPresent) ? `${(s.phaseDocsPresent * 100).toFixed(0)}%` : 'n/a', fin(s.phaseDocsComplete) ? `${(s.phaseDocsComplete * 100).toFixed(0)}%` : 'n/a'] : [])]);
  const backfilled = sums.reduce((n, s) => n + s.backfilled, 0);
  return [
    D.h(2, 'Orchestration'),
    D.table(head, rows),
    D.note(`Spawns count the agents handed work through the subagent tool (one per stage); depth is how many spawns deep the deepest one sits (1 = spawned by the main agent). Review rounds and reworks after a pass are heuristic: a spawn is a review or a fix from its brief, and a pass is read from its returned text (profiles/orch-metrics.json), so read a sample of runs before leaning on them.${showDocs ? ' Phase documents come from profiles/phase-documents.json.' : ' Pass --phases to count phase documents.'}${backfilled ? ` ${backfilled} run(s) were read from their stream and workspace because result.json predates these fields.` : ''}`),
  ];
}

module.exports = { enrichOrch, summarize, orchBlocks, phaseTotals };
