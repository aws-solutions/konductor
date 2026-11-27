// SPDX-License-Identifier: Apache-2.0
'use strict';

// Delegation sections of the run report, read from what each run left on disk.
// Review compliance: on tasks whose konductor rules require a review (profiles/review-required.json), did the run
// make a reviewer spawn. Needs result.orch, so call report/orch.js enrichOrch first.
// Cost split: how much of each arm's turn time and tool calls ran in sub-executions (kiro-cli v3 keeps one transcript
// per spawn, session/<sid>/sub-executions/<subtask id>.jsonl) and how much of that was reviewer spawns. Credits are
// metered per turn, not per spawn, so the split is in time and calls; credits are only shown per run.

const fs = require('node:fs');
const path = require('node:path');
const D = require('./doc.js');
const { readJson } = require('../runner/lib/util.js');
const { parseStream } = require('../runner/lib/stream.js');
const { spawnTree, kindOf, loadMetricsSpec } = require('../runner/lib/orch-metrics.js');

const RULES_FILE = path.join(__dirname, '..', 'profiles', 'review-required.json');

/** The review rules, validated: { rules: [{ id, why, targetSkills, taskIds }] }. */
function loadReviewRules(file = RULES_FILE) {
  const raw = readJson(file);
  if (!Array.isArray(raw.rules) || !raw.rules.length) throw new Error(`${file}: "rules" must be a non-empty list`);
  for (const r of raw.rules) {
    if (!r.id || !r.why) throw new Error(`${file}: every rule needs an id and a why`);
    if (!(r.targetSkills?.length || r.taskIds?.length)) throw new Error(`${file}: rule "${r.id}" needs targetSkills or taskIds`);
  }
  return raw;
}

/** The first rule that makes the task need a review, or null. task: a loaded task (id, targetSkills) or undefined. */
function requiredReview(task, rules) {
  if (!task) return null;
  const skills = task.targetSkills || [];
  return rules.rules.find((r) => (r.taskIds || []).includes(task.id) || (r.targetSkills || []).some((s) => skills.includes(s))) ?? null;
}

const executed = (run) => run.runs.filter((e) => e.result.status !== 'budget_skipped');
const armsOf = (run) => [...new Set(executed(run).map((e) => e.armId))].sort();

/** Per arm with any required run: { arm, required, reviewed, missing: ['task#rep'] }. Runs without orch data are left out. */
function reviewCompliance(run, tasks, rules = loadReviewRules()) {
  const out = [];
  for (const arm of armsOf(run)) {
    const req = executed(run).filter((e) => e.armId === arm && e.result.orch && requiredReview(tasks.get(e.taskId), rules));
    if (!req.length) continue;
    const missing = req.filter((e) => !(e.result.orch.reviewerSpawns > 0)).map((e) => `${e.taskId}#${e.replicate}`).sort();
    out.push({ arm, required: req.length, reviewed: req.length - missing.length, missing });
  }
  return out;
}

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : 'n/a');

function complianceBlocks(rows, rules = loadReviewRules()) {
  if (!rows.length) return [];
  return [
    D.h(2, 'Review compliance'),
    D.table(['arm', 'runs a rule requires a review for', 'with a reviewer spawn', 'share', 'runs without one'], rows.map((r) => [r.arm, r.required, r.reviewed, pct(r.reviewed, r.required), r.missing.join(', ') || 'none'])),
    D.note(`A run complied when it made at least one reviewer spawn (see Orchestration). The rules come from profiles/review-required.json: ${rules.rules.map((r) => `${r.id} (${r.why})`).join('; ')}. Only the konductor arms are bound by these rules; other arms are shown for reference.`),
  ];
}

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const listDir = (dir) => { try { return fs.readdirSync(dir).sort(); } catch { return []; } };

/** Every sub-execution transcript of a run directory: [{ id, startMs, endMs, toolCalls }], spans from the first to the last timestamp. */
function subExecutions(runDir) {
  const out = [];
  for (const sid of listDir(path.join(runDir, 'session'))) {
    const dir = path.join(runDir, 'session', sid, 'sub-executions');
    for (const f of listDir(dir).filter((x) => x.endsWith('.jsonl'))) {
      let startMs = Infinity;
      let endMs = -Infinity;
      let toolCalls = 0;
      for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        const t = Date.parse(rec.timestamp);
        if (fin(t)) { startMs = Math.min(startMs, t); endMs = Math.max(endMs, t); }
        if (rec.payload?.type === 'tool_call') toolCalls++;
      }
      if (fin(startMs) && fin(endMs)) out.push({ id: f.replace(/\.jsonl$/, ''), startMs, endMs, toolCalls });
    }
  }
  return out;
}

/** Milliseconds covered by the union of [startMs, endMs] spans, so parallel spawns are not counted twice. */
function unionMs(spans) {
  let total = 0;
  let end = -Infinity;
  for (const s of [...spans].sort((a, b) => a.startMs - b.startMs)) {
    if (s.startMs > end) { total += s.endMs - s.startMs; end = s.endMs; } else if (s.endMs > end) { total += s.endMs - end; end = s.endMs; }
  }
  return total;
}

/** subtask id -> 'review' | 'fix' | 'other', from the run's stream (v3 spawn calls carry the sub-execution id). */
function kindsBySubtask(runDir, spec) {
  const file = path.join(runDir, 'stream.jsonl');
  if (!fs.existsSync(file)) return new Map();
  const { events } = parseStream(fs.readFileSync(file, 'utf8'));
  return new Map(spawnTree(events).calls.filter((c) => c.subtaskId).map((c) => [c.subtaskId, kindOf(c, spec)]));
}

/** The split of one run, cached on the entry: { subMs, reviewerSubMs, subCalls, subs }. */
function splitOf(e, spec) {
  if (e.delegationSplit) return e.delegationSplit;
  const subs = subExecutions(e.dir);
  const kinds = subs.length ? kindsBySubtask(e.dir, spec) : new Map();
  e.delegationSplit = { subs: subs.length, subMs: unionMs(subs), reviewerSubMs: unionMs(subs.filter((x) => kinds.get(x.id) === 'review')), subCalls: sum(subs.map((x) => x.toolCalls)) };
  return e.delegationSplit;
}

/** Per arm: runs, runs with sub-executions, turn time, sub-execution and reviewer time (ms), tool calls on each side, credits. */
function costSplit(run, spec = loadMetricsSpec()) {
  return armsOf(run).map((arm) => {
    const es = executed(run).filter((e) => e.armId === arm);
    const sp = es.map((e) => ({ e, s: splitOf(e, spec) }));
    const num = (v) => (fin(v) ? v : 0);
    return {
      arm, runs: es.length, withSubs: sp.filter((x) => x.s.subs).length,
      turnMs: sum(es.map((e) => num(e.result.turnDurationMs))), subMs: sum(sp.map((x) => x.s.subMs)), reviewerSubMs: sum(sp.map((x) => x.s.reviewerSubMs)),
      mainCalls: sum(es.map((e) => num(e.result.toolCalls))), subCalls: sum(sp.map((x) => x.s.subCalls)),
      credits: sum(es.map((e) => num(e.result.credits))), creditsWithSubs: sum(sp.filter((x) => x.s.subs).map((x) => num(x.e.result.credits))),
    };
  });
}

const minutes = (ms) => (ms / 60000).toFixed(1);

function costSplitBlocks(rows) {
  if (!rows.length) return [];
  return [
    D.h(2, 'Main session and sub-executions'),
    D.table(['arm', 'runs', 'runs with sub-executions', 'turn time (min, sum)', 'in sub-executions', 'in reviewer sub-executions', 'main-session tool calls', 'sub-execution tool calls', 'credits (sum)', 'credits of runs with sub-executions'],
      rows.map((r) => [r.arm, r.runs, r.withSubs, minutes(r.turnMs), pct(r.subMs, r.turnMs), pct(r.reviewerSubMs, r.turnMs), r.mainCalls, r.subCalls, r.credits.toFixed(1), r.creditsWithSubs.toFixed(1)])),
    D.note('Sub-execution time is the union of each spawn transcript\'s first-to-last timestamp (session/*/sub-executions/*.jsonl), so parallel spawns count once; the main agent mostly waits meanwhile. Reviewer sub-executions are the spawns classed as reviews (see Orchestration). kiro-cli meters credits once per turn, not per spawn, so credits cannot be split; the last column is the whole cost of the runs that spawned.'),
  ];
}


module.exports = { loadReviewRules, requiredReview, reviewCompliance, complianceBlocks, subExecutions, unionMs, costSplit, costSplitBlocks, RULES_FILE };
