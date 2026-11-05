// SPDX-License-Identifier: Apache-2.0
'use strict';

// The quality-pack score of a run, for a scoring file that gives the pack a weight. One number per run, 0..1: the weighted mean over
// every criterion that applied to it (pass 1, partial 0.5, fail 0, weighted by criterion), averaged over the judges. It does not
// depend on how many dimensions or criteria apply, so a one-line fix and a design document are scored on the same scale.
// A run where nothing applied has no pack score. A run the pack never judged, or judged against another pack or task revision,
// is an error here: a score that quietly dropped the component for some runs would compare arms on different inputs.

const { taskRevision } = require('../judge/revision.js');
const { VERDICT_VALUE } = require('../judge/config.js');
const { notJudgedReason } = require('../judge/run.js');
const { FILE } = require('../judge/packrun.js');
const { recordsOf } = require('./quality.js');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const runKey = (arm, task, rep) => `${arm}\u0000${task}\u0000${rep}`;

/** Weighted mean of one judge's criterion verdicts for one run, or null when no criterion applied. */
function recordScore(pack, record) {
  const weight = new Map(pack.criteria.map((c) => [c.id, c.weight]));
  let got = 0;
  let total = 0;
  for (const c of record.criteria) {
    const w = weight.get(c.id);
    if (w === undefined) continue;
    total += w;
    got += w * VERDICT_VALUE[c.verdict];
  }
  return total ? got / total : null;
}

/**
 * run: a loaded run (loadRun or loadRuns). Returns { scoreOf(arm, task, rep), runs: [{ arm, task, rep, score, judges }] }.
 * Throws, naming how many runs and why, when an executed run has no usable pack record.
 */
function packScores({ run, tasks, pack }) {
  const { records, files } = recordsOf(run);
  if (!files.length) throw new Error(`the scoring file weights the quality pack, but ${(run.dirs || [run.dir]).join(', ')} has no ${FILE}; run bench.js judge --criteria-pack ${pack.id} --run DIR first`);
  const revisionOf = new Map();
  const currentTask = (id) => {
    if (!revisionOf.has(id)) revisionOf.set(id, tasks.has(id) ? taskRevision(tasks.get(id)) : null);
    return revisionOf.get(id);
  };
  const seen = new Map();
  const usable = new Map();
  for (const r of records) {
    const k = runKey(r.armId, r.taskId, r.replicate);
    seen.set(k, (seen.get(k) || 0) + 1);
    if (r.packRevision !== pack.revision || r.taskRevision !== currentTask(r.taskId) || r.judgeError || !r.dimensions) continue;
    if (!usable.has(k)) usable.set(k, []);
    usable.get(k).push(recordScore(pack, r));
  }
  const out = new Map();
  const missing = { never: [], stale: [] };
  for (const e of run.runs) {
    if (e.result.status === 'budget_skipped' || notJudgedReason(e)) continue;
    const k = runKey(e.armId, e.taskId, e.replicate);
    const judged = usable.get(k);
    if (!judged) { (seen.has(k) ? missing.stale : missing.never).push(`${e.armId}/${e.taskId}/${e.replicate}`); continue; }
    const scores = judged.filter(fin);
    out.set(k, { arm: e.armId, task: e.taskId, rep: e.replicate, score: scores.length ? mean(scores) : null, judges: judged.length });
  }
  const gaps = [];
  if (missing.never.length) gaps.push(`${missing.never.length} run(s) were never judged by the pack (${missing.never.slice(0, 3).join(', ')}${missing.never.length > 3 ? ', ...' : ''})`);
  if (missing.stale.length) gaps.push(`${missing.stale.length} run(s) were judged against another pack revision or another task revision (${missing.stale.slice(0, 3).join(', ')}${missing.stale.length > 3 ? ', ...' : ''}); the current pack revision is ${pack.revision}`);
  if (gaps.length) throw new Error(`the scoring file weights the quality pack, so every run needs a current pack judgment: ${gaps.join('; ')}. Run bench.js judge --criteria-pack ${pack.id} --run DIR to refresh them.`);
  return { scoreOf: (arm, task, rep) => out.get(runKey(arm, task, rep))?.score ?? null, runs: [...out.values()] };
}

module.exports = { packScores, recordScore };
