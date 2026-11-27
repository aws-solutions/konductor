// SPDX-License-Identifier: Apache-2.0
'use strict';

// Delegation sections of the run report, read from what each run left on disk.
// Review compliance: on tasks whose konductor rules require a review (profiles/review-required.json), did the run
// make a reviewer spawn. Needs result.orch, so call report/orch.js enrichOrch first.

const path = require('node:path');
const D = require('./doc.js');
const { readJson } = require('../runner/lib/util.js');

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

module.exports = { loadReviewRules, requiredReview, reviewCompliance, complianceBlocks, RULES_FILE };
