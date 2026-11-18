// SPDX-License-Identifier: Apache-2.0
/**
 * What a judge of each scale is shown of a task: the scale view over the tasks of a run.
 *
 *   items    reading B. The task's own rules checklist. The view returns the sets it was given, unchanged.
 *   outcome  reading A. The checklist is the request-only checklist of the task (request-checklist.js, file
 *            layout.checklistFile(skill, batch, task)), not the task's `rubric`. A task with no current checklist
 *            file gets an empty checklist and `checklist_status` 'missing', 'stale' or 'unsafe', and is listed in
 *            `missing`: a judge job that reads this view leaves its judgments waiting and never judges it against the
 *            wrong checklist.
 *
 * On `outcome`, a task a person has excluded from reading A (exclusions.js, bench/exclusions.json) is not in the
 * view at all: it is not judged, not pending, and does not wait for a checklist. It is listed in `excluded` with
 * its reason and date.
 *
 * A checklist is current only for the same request (stripped as the writer saw it), item count, writer model,
 * writer prompt and version (request-checklist.js checklistCurrent). The judgment digest (provenance.js
 * judgmentInputs) holds the hash of the checklist the judge was shown, so a judgment made against one checklist is
 * pending, not done, under another. The view reads files and writes nothing.
 */
'use strict';

const { loadBaseline } = require('./baseline');
const { checklistSha256 } = require('./provenance');
const {
  checklistCurrent,
  readChecklistFile,
  requestOnlyInput,
} = require('./request-checklist');
const { EXCLUDED_SCALE, splitTasks } = require('./exclusions');
const { SCALES } = require('./layout');
const { redact } = require('./redact');

const REASON_CHARS = 300;

function requireScale(scale) {
  if (!SCALES.includes(scale))
    throw new TypeError(
      `scale must be one of ${SCALES.join(', ')}, got ${JSON.stringify(scale)}`,
    );
  return scale;
}

/**
 * The `outcome` view of one task. Returns { task, status, reason }: status 'ok', or 'missing', 'stale' or 'unsafe'
 * for a task whose checklist file is absent, was written for another request, count, writer or prompt, or whose
 * request cannot be given to the writer at all. `ruleIds` are the rule ids the writer's request was stripped of.
 */
function viewOutcomeTask(task, { skill, batch, layout, model, ruleIds = [] }) {
  const waiting = (status, reason) => ({
    task: { ...task, rubric: [], checklist_status: status },
    status,
    reason: redact(reason, { maxChars: REASON_CHARS }),
  });
  let input;
  try {
    input = requestOnlyInput(task, { skill, ruleIds });
  } catch (error) {
    return waiting('unsafe', error.message);
  }
  const file = layout.checklistFile(skill, batch, task.id);
  const record = readChecklistFile(file);
  if (!record) return waiting('missing', `no checklist file ${file}`);
  if (!checklistCurrent(record, input, model))
    return waiting(
      'stale',
      `${file} was written for another request, item count, writer model or writer prompt`,
    );
  return {
    task: {
      ...task,
      rubric: [...record.items],
      checklist_status: 'ok',
      checklist: {
        checklist_version: record.checklist_version,
        prompt_sha256: record.prompt_sha256,
        writer_model: record.writer_model,
        request_sha256: record.request_sha256,
        items_sha256: checklistSha256(record.items),
      },
    },
    status: 'ok',
    reason: null,
  };
}

/**
 * The view of `sets` for `scale`. `sets` is [{ skill, batch, tasks, ruleIds }] (the shape the checklist job plans
 * from); `exclusions` is loadExclusions(layout), required for `outcome` (a TypeError without it, so a caller can never
 * get a view that silently leaves nothing out); `model` is the checklist writer (config.js rubricWriterModel).
 * Returns { sets, missing, excluded }:
 *   sets      for `items`, the input itself; for `outcome`, new set objects whose tasks are the kept tasks with the
 *             request-only checklist as `rubric` (the input is not changed)
 *   missing   [{ skill, batch, id, status, reason }] the outcome tasks that wait for a checklist
 *   excluded  [{ skill, batch, id, reason, date }] the outcome tasks a person left out of reading A
 */
function viewSets(sets, scale, { layout, exclusions, model } = {}) {
  if (requireScale(scale) !== EXCLUDED_SCALE)
    return { sets, missing: [], excluded: [] };
  if (!layout || typeof layout.checklistFile !== 'function')
    throw new TypeError('viewSets: layout is required (createLayout)');
  if (typeof model !== 'string' || !model)
    throw new TypeError('viewSets: model is the checklist writer model');
  // Without the loaded file no task would be left out, and a caller that forgot it would never notice.
  if (
    !exclusions ||
    !exclusions.batches ||
    typeof exclusions.batches !== 'object'
  )
    throw new TypeError('viewSets: exclusions is loadExclusions(layout)');
  const missing = [];
  const excluded = [];
  const viewed = sets.map((set) => {
    const { skill, batch, ruleIds = [] } = set;
    const split = splitTasks(exclusions, batch, set.tasks);
    excluded.push(...split.excluded.map((record) => ({ skill, ...record })));
    return {
      ...set,
      tasks: split.kept.map((task) => {
        const view = viewOutcomeTask(task, {
          skill,
          batch,
          layout,
          model,
          ruleIds,
        });
        if (view.status !== 'ok')
          missing.push({
            skill,
            batch,
            id: task.id,
            status: view.status,
            reason: view.reason,
          });
        return view.task;
      }),
    };
  });
  return { sets: viewed, missing, excluded };
}

/**
 * The sets the views and the checklist job read, from each skill's baseline (baseline.js loadBaseline):
 * [{ skill, batch, tasks, ruleIds }], one per task file, in skill and batch order. `tasks` are the task file's
 * scenarios as written; `ruleIds` are the ids of the skill's rules, which the writer's request is stripped of.
 * Reading A needs only the tasks, so a baseline whose rules or tasks are stale still gives its tasks. A task file
 * that fails its format check gives nothing; `plan` reports it and refuses the skill.
 */
function baselineSets(layout, skills) {
  const sets = [];
  for (const skill of skills) {
    const baseline = loadBaseline(layout, skill);
    const ruleIds = baseline.rules
      ? baseline.rules.rules.map((rule) => rule.id)
      : [];
    for (const { batch, tasks } of baseline.batches)
      sets.push({ skill, batch, tasks: tasks.scenarios, ruleIds });
  }
  return sets;
}

module.exports = { baselineSets, viewOutcomeTask, viewSets };
