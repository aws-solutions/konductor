// SPDX-License-Identifier: Apache-2.0
'use strict';

// Tasks a report leaves out (prompt-fix spec B.c1). load-fairness.json `needsAgent` maps a task to the one entry agent
// that has the feature it tests (t12-cmux-parallel-merge needs konductor-cmux-orchestrator). When no run of the task
// started in that agent, every arm's runs of it leave the report, so no arm is scored on a task its agent cannot do.

const { RULES } = require('../runner/lib/load-fairness.js');

/**
 * Drops, in place, the runs of each task in `needs` ({ taskId: agent }) whose agent started none of its runs.
 * Returns [{ task, needsAgent, runs }] for the tasks dropped, sorted by task id.
 */
function dropNeedsAgent(run, needs = RULES.needsAgent) {
  const byTask = new Map();
  for (const x of run.runs ?? []) {
    const id = x.result?.taskId;
    if (!needs[id]) continue;
    if (!byTask.has(id)) byTask.set(id, []);
    byTask.get(id).push(x);
  }
  const out = [];
  for (const [id, runs] of [...byTask].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (runs.some((x) => x.result?.agent === needs[id])) continue;
    out.push({ task: id, needsAgent: needs[id], runs: runs.length });
  }
  const gone = new Set(out.map((e) => e.task));
  if (gone.size) run.runs = run.runs.filter((x) => !gone.has(x.result?.taskId));
  return out;
}

/** One sentence for the report header, or null when nothing was dropped. */
function exclusionNote(excluded) {
  if (!excluded.length) return null;
  const list = excluded.map((e) => `${e.task} (needs ${e.needsAgent}; ${e.runs} run(s))`).join(', ');
  return `Left out of every table: ${list}. No arm started in the agent the task needs, so no arm is scored on it (bench/scenarios/load-fairness.json).`;
}

module.exports = { dropNeedsAgent, exclusionNote };
