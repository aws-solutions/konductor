// SPDX-License-Identifier: Apache-2.0
'use strict';

// The "quality dimensions" table: per-dimension scores from judgments-quality.json, laid out by arm (report) or by cell
// (report-2x2). It reads files and calls no model. Nothing here feeds the quality score, the diligence scorecard or any
// existing table; a report built without --criteria-pack never touches this module.

const path = require('node:path');
const { readQuality, FILE } = require('../judge/packrun.js');
const { taskRevision } = require('../judge/revision.js');
const { DEFAULTS } = require('../judge/config.js');
const D = require('./doc.js');
const { summarizeProcess, processBlocks } = require('./process.js');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const uniq = (xs) => [...new Set(xs)];

const NOTE = 'Dimension scores are indicative: no person has rated a sample for this pack yet, so judge-versus-human agreement is unknown. They are not part of the quality score or the scorecard. A dimension marked n/a did not apply to that run (the task did not ask for it, or the change was too small to judge); n/a is never counted as a fail.';
const scoredNote = (w) => `Dimension scores are indicative: no person has rated a sample for this pack yet, so judge-versus-human agreement is unknown. The pack is part of the quality score in this report, with weight ${w}: each run contributes one pack score, the mean over all criteria that applied to it, beside hidden tests, checks and the rubric. The table below splits that score by dimension. A dimension marked n/a did not apply to that run; n/a is never counted as a fail, and a run where nothing applied has no pack component.`;

/** Records of one run (or merged runs) with the replicate numbers the report uses. */
function recordsOf(run) {
  const dirs = run.dirs || [run.dir];
  const out = [];
  const files = [];
  for (const dir of dirs) {
    const q = readQuality(dir);
    if (!q) continue;
    files.push({ dir, q });
    const remap = new Map();
    if (run.merged) for (const e of run.runs) if (e.sourceDir === path.resolve(dir)) remap.set(`${e.armId}\u0000${e.taskId}\u0000${e.sourceReplicate}`, e.replicate);
    for (const r of q.records) out.push({ ...r, replicate: remap.get(`${r.armId}\u0000${r.taskId}\u0000${r.replicate}`) ?? r.replicate });
  }
  return { records: out, files };
}

/** Judging spend, counted once per judgments file. Several groups (one per arm) can read the same run directory. */
function spendOf(loaded) {
  const files = [...new Map(loaded.flatMap((l) => l.files).map((f) => [path.resolve(f.dir), f])).values()];
  const hasUsd = files.some((f) => f.q.spentUsd !== undefined);
  return {
    credits: files.reduce((n, f) => n + (f.q.spentCredits || 0), 0),
    usd: hasUsd ? files.reduce((n, f) => n + (f.q.spentUsd || 0), 0) : null,
  };
}

/**
 * groups: [{ id, label, run, arm? }]. Each group is a loaded run (loadRun or loadRuns); `arm` limits it to one arm.
 * Throws when a group has no quality file or the groups were judged by different panels, backends or pack revisions.
 */
function summarizeQuality({ groups, tasks, pack, disagreeScore = DEFAULTS.disagreeScore, strictPanel = false, scoredWeight = null }) {
  const loaded = groups.map((g) => ({ g, ...recordsOf(g.run) }));
  for (const l of loaded) if (!l.files.length) throw new Error(`no ${FILE} in ${(l.g.run.dirs || [l.g.run.dir]).join(', ')}; run bench.js judge --criteria-pack ${pack.id} --run DIR first`);
  const panels = uniq(loaded.flatMap((l) => l.files.map((f) => JSON.stringify({ judges: f.q.judges, backend: f.q.backend ?? 'kiro' }))));
  if (strictPanel && panels.length > 1) throw new Error(`the quality-pack judgments in the cells come from different panels or backends (${panels.join(' vs ')})`);
  const revisions = new Map();
  const currentRevision = (id) => {
    if (!revisions.has(id)) revisions.set(id, tasks.has(id) ? taskRevision(tasks.get(id)) : null);
    return revisions.get(id);
  };
  const declaredOnlyIds = new Set(pack.criteria.filter((c) => c.appliesTo.every((t) => (pack.declaredOnly || []).includes(t))).map((c) => c.id));
  const stale = { pack: 0, task: 0 };
  let errors = 0;
  const staleRevisions = new Set();
  const out = loaded.map((l) => {
    const usable = l.records.filter((r) => {
      if (l.g.arm && r.armId !== l.g.arm) return false;
      if (r.packRevision !== pack.revision) { stale.pack++; staleRevisions.add(r.packRevision); return false; }
      if (r.taskRevision !== currentRevision(r.taskId)) { stale.task++; return false; }
      if (r.judgeError || !r.dimensions) { errors++; return false; }
      return true;
    });
    const runs = uniq(usable.map((r) => `${r.armId}\u0000${r.taskId}\u0000${r.replicate}`));
    const dimensions = {};
    for (const d of pack.dimensions) {
      const perRun = runs.map((k) => {
        const recs = usable.filter((r) => `${r.armId}\u0000${r.taskId}\u0000${r.replicate}` === k);
        const scores = recs.map((r) => r.dimensions[d.id]?.score).filter(fin);
        const mine = recs.flatMap((r) => r.na.filter((x) => x.dimension === d.id));
        // A criterion that only a task naming its type can use (a plan's assignments) is not why the dimension is n/a.
        const reasons = (mine.some((x) => !declaredOnlyIds.has(x.id)) ? mine.filter((x) => !declaredOnlyIds.has(x.id)) : mine).map((x) => x.reason);
        return { score: scores.length ? mean(scores) : null, spread: scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : null, reasons };
      });
      const scored = perRun.filter((x) => x.score !== null);
      const spreads = perRun.map((x) => x.spread).filter(fin);
      const reasonCounts = {};
      // Criteria of one dimension differ in how many artifact types their reason lists ("not asked for comments" and "not asked for comments or readme"); the longest names them all.
      for (const x of perRun.filter((y) => y.score === null && y.reasons.length)) {
        const reason = [...x.reasons].sort((a, b) => b.length - a.length || (a < b ? -1 : 1))[0];
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      }
      dimensions[d.id] = {
        score: scored.length ? mean(scored.map((x) => x.score)) * 100 : null,
        n: scored.length, na: perRun.length - scored.length,
        spread: spreads.length ? mean(spreads) : null, disagree: spreads.length > 0 && mean(spreads) > disagreeScore,
        naReasons: Object.entries(reasonCounts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([reason, count]) => ({ reason, count })),
      };
    }
    return { id: l.g.id, label: l.g.label, runs: runs.length, judges: uniq(usable.map((r) => r.judge)).sort(), dimensions };
  });
  return {
    pack: { id: pack.id, revision: pack.revision }, indicative: true, disagreeScore,
    dimensions: pack.dimensions.map((d) => ({ id: d.id, label: d.label })), groups: out,
    judges: uniq(loaded.flatMap((l) => l.files.flatMap((f) => f.q.judges))).sort(), backend: loaded[0].files[0].q.backend ?? 'kiro',
    spend: spendOf(loaded),
    process: summarizeProcess({ groups, tasks }),
    stale: stale.pack + stale.task, staleBy: stale, staleRevisions: [...staleRevisions].sort(), usable: out.reduce((n, g) => n + g.runs, 0), errors, ...(scoredWeight > 0 ? { scoredWeight } : {}), note: scoredWeight > 0 ? scoredNote(scoredWeight) : NOTE,
  };
}

const f1 = (v) => (fin(v) ? v.toFixed(1) : 'n/a');

function cellText(c) {
  if (c.score === null) return `n/a (${c.na} run${c.na === 1 ? '' : 's'})`;
  return `${f1(c.score)} (n=${c.n}${c.na ? `, n/a ${c.na}` : ''})${c.disagree ? ' JUDGES DIFFER' : ''}`;
}

/** Markdown blocks for a summary. */
function qualityBlocks(s) {
  const head = ['dimension', ...s.groups.map((g) => g.label)];
  const rows = s.dimensions.map((d) => [d.label, ...s.groups.map((g) => cellText(g.dimensions[d.id]))]);
  const blocks = [
    D.h(2, s.scoredWeight > 0 ? 'Quality dimensions (indicative, part of the quality score)' : 'Quality dimensions (indicative, not in the quality score)'),
    D.note(s.note),
    D.table(head, rows),
    D.p(`Score is 0 to 100: the mean over runs of the judge mean of pass 1, partial 0.5, fail 0, weighted by criterion. n is the number of runs where the dimension applied. JUDGES DIFFER marks a mean spread between the highest and lowest judge above ${s.disagreeScore} on a 0 to 1 scale. Pack ${s.pack.id}, revision ${s.pack.revision}; judges: ${s.judges.join(', ')}.`),
  ];
  const reasons = s.dimensions.flatMap((d) => s.groups.flatMap((g) => g.dimensions[d.id].naReasons.slice(0, 2).map((r) => `${d.label}, ${g.label}: ${r.count} run(s) n/a, ${r.reason}`)));
  if (reasons.length) blocks.push(D.h(3, 'Why a dimension was n/a'), D.list(reasons));
  blocks.push(D.p(`Pack judging spend: ${s.spend.usd !== null ? `$${s.spend.usd.toFixed(4)} USD` : `${s.spend.credits.toFixed(2)} credits`}, kept in judgments-quality.json and not in the credit ledger.`));
  if (s.stale || s.errors) {
    const parts = [];
    if (s.staleBy.pack) parts.push(`${s.staleBy.pack} record(s) made against pack revision ${s.staleRevisions.join(', ')} (the pack is now ${s.pack.revision})`);
    if (s.staleBy.task) parts.push(`${s.staleBy.task} record(s) made against an earlier version of the task prompt, rubric or answer key`);
    if (s.errors) parts.push(`${s.errors} record(s) with a judge error`);
    blocks.push(D.p(`Left out, not mixed in: ${parts.join('; ')}. Rerun bench.js judge --criteria-pack ${s.pack.id} --run DIR to refresh them; a rerun replaces the old record.`));
    if (!s.usable) blocks.push(D.note('No run has a current pack record, so every cell above is n/a for that reason, not because the dimensions did not apply.'));
  }
  blocks.push(...processBlocks(s.process, D));
  return blocks;
}

module.exports = { summarizeQuality, qualityBlocks, recordsOf, NOTE };
