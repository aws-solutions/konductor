// SPDX-License-Identifier: Apache-2.0
'use strict';

// Schema v3 task fields that the JSON Schema subset cannot express, and the mapping of the old `target` field.
// `target` held an agent, a skill or an SOP in one string; v3 splits it into targetSkills, targetSop and targetAgent.

const path = require('node:path');
const { listCatalogDir, has } = require('./skills.js');

const V3_TARGETS = ['targetSkills', 'targetSop', 'targetAgent'];
const hasV3Targets = (t) => V3_TARGETS.some((k) => t[k] !== undefined);

// The konductor tree the bench lives in: skills/, agent-sops/ and agents/ one level above bench/.
const catalogOfRepo = (benchDir) => listCatalogDir(path.resolve(benchDir, '..'));

// An old `target` may carry a kind prefix (`skill:x`, `sop:x`, `agent:x`); otherwise the repo listing decides.
function kindOfTarget(target, catalog) {
  const m = /^(skill|sop|agent):(.+)$/.exec(target);
  if (m) return { kind: m[1], name: m[2] };
  for (const [kind, list] of [['sop', catalog?.sops], ['skill', catalog?.skills], ['agent', catalog?.agents]]) {
    if (list && has(list, target)) return { kind, name: target };
  }
  return { kind: null, name: target };
}

/**
 * The v3 target fields of a task. Explicit v3 fields win. Otherwise an old `target` is mapped by kind; one the
 * catalog does not know is returned as `targetUnresolved` and maps to nothing.
 */
function targetsOf(task, catalog) {
  if (hasV3Targets(task)) return { targetSkills: task.targetSkills ?? [], targetSop: task.targetSop ?? null, targetAgent: task.targetAgent ?? null, targetUnresolved: null };
  const out = { targetSkills: [], targetSop: null, targetAgent: null, targetUnresolved: null };
  if (typeof task.target !== 'string' || !task.target) return out;
  const { kind, name } = kindOfTarget(task.target, catalog);
  if (kind === 'skill') out.targetSkills = [name];
  else if (kind === 'sop') out.targetSop = name;
  else if (kind === 'agent') out.targetAgent = name;
  else out.targetUnresolved = name;
  return out;
}

/** Cross-field rules for the v3 fields. Returns a list of error strings, empty when the task is fine. */
function v3Errors(task) {
  const errors = [];
  if (task.target === undefined && !hasV3Targets(task)) errors.push('needs "target" (old form) or one of targetSkills, targetSop, targetAgent');
  if (task.target !== undefined && hasV3Targets(task)) errors.push('"target" and the v3 target fields cannot both be set');
  if (task.controlKind === 'twin' && !task.twinOf) errors.push('controlKind "twin" needs twinOf');
  if (task.twinOf !== undefined && task.controlKind !== 'twin') errors.push('twinOf is only for controlKind "twin"');
  if (task.twinOf !== undefined && task.twinOf === task.id) errors.push('twinOf cannot name the task itself');
  if (task.questions === 'scripted' && !task.scriptedUser) errors.push('questions "scripted" needs scriptedUser');
  if (task.scriptedUser && task.autonomy) errors.push('scriptedUser and autonomy cannot both be set: a scripted task plays its own facts');
  if (task.scriptedUser && task.questions !== 'scripted') errors.push('scriptedUser is only for questions "scripted"');
  if (task.limits && task.limits.softSec > task.limits.hardSec) errors.push('limits.softSec must not exceed limits.hardSec');
  if (task.phase && (task.phases2 ?? []).includes(task.phase)) errors.push('phases2 must not repeat the main phase');
  const must = task.loadCheck?.mustLoad ?? [];
  const both = (task.loadCheck?.mustNotLoad ?? []).filter((n) => must.includes(n));
  if (both.length) errors.push(`loadCheck lists ${both.join(', ')} as both mustLoad and mustNotLoad`);
  // The schema subset has no maxItems: an expert key names 3 to 5 weak answers.
  if ((task.expertKey?.weakAnswers?.length ?? 0) > 5) errors.push('expertKey.weakAnswers holds 3 to 5 answers');
  // A v3 task (one with a phase) records where its idea came from; old tasks are exempt.
  if (task.phase !== undefined && !task.authorship) errors.push('a v3 task (with phase) needs authorship with a source');
  if (task.authorship && task.review && task.authorship.family === task.review.family) errors.push('review.family must differ from authorship.family');
  // Owner rule (2026-11-19): a task someone other than its author edited is re-checked by a non-Claude reviewer before lock.
  if (task.handEdited && task.lockedAt && !task.review?.recheck) errors.push('a hand-edited task needs review.recheck before lock');
  if (/^(claude|anthropic)$/i.test(task.review?.recheck?.family ?? '')) errors.push('review.recheck must come from a non-Claude family');
  return errors;
}

module.exports = { V3_TARGETS, hasV3Targets, catalogOfRepo, kindOfTarget, targetsOf, v3Errors };
