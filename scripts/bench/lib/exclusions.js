// SPDX-License-Identifier: Apache-2.0
/**
 * Which tasks reading A leaves out, and why.
 *
 * A person may leave a task out of reading A (the request-only checklist, scale `outcome`) when the checklist
 * writer cannot make a usable checklist for it, for example when the provider blocks the writer's reply on every
 * try. The decision is a committed record in bench/exclusions.json, never an edit of the task file:
 *
 *   { "format_version": 1,
 *     "batches": { "<batch>": { "scenarios": [ { "id", "scales": ["outcome"], "reason", "date" } ] } } }
 *
 * The file is read and checked in one place, baseline.js loadExclusions, against the format in formats.js: every
 * record names a task id, the scale `outcome` and nothing else (reading B, `items`, can never be listed), a reason
 * and a date. A malformed file is refused as a whole, so a bad record can never silently keep a task in.
 *
 * Records are keyed by batch, because a task id can exist in more than one batch and a decision about one is not a
 * decision about the other. Batch names are shared by every skill, so a record applies to the task with that id
 * whichever skill it belongs to. A record that names no task of any skill with a baseline is reported by `plan`
 * (baseline.js unmatchedExclusions).
 *
 * The excluded task stays in its task file and in the run folder; nothing is moved or deleted. Its stored answers
 * still count for reading B. The checklist job writes no checklist for it, the scale view (scale-view.js) leaves it
 * out of reading A, and the plan prices no reading A call for it. The checklist job and the scale view ask
 * splitTasks. The plan and the job counts (plan.js, jobs.js) ask baseline.js exclusionsFor, which does not read
 * `scales`. The format allows only `outcome`, so the two cannot disagree.
 */
'use strict';

const { loadExclusions } = require('./baseline');

/** The one scale an exclusion can name: reading A. */
const EXCLUDED_SCALE = 'outcome';

/** The records of one batch of a loaded exclusions file, or [] when the batch has none. */
const recordsOf = (exclusions, batch) =>
  exclusions && exclusions.batches && Object.hasOwn(exclusions.batches, batch)
    ? exclusions.batches[batch].scenarios
    : [];

/**
 * Splits the tasks of one batch for reading A. `exclusions` is loadExclusions(layout); `tasks` is [{ id, ... }].
 * Returns
 *   kept      the tasks reading A reads, in their order (the same objects)
 *   excluded  [{ batch, id, reason, date }] for each record that names a task of the list, in task order
 * A record that names no task of the list is in neither: it may belong to another skill of the same batch.
 */
function splitTasks(exclusions, batch, tasks) {
  // The format allows only ["outcome"]; the filter keeps a record for any other scale from ever hiding a task.
  const byId = new Map(
    recordsOf(exclusions, batch)
      .filter(
        (record) =>
          Array.isArray(record.scales) &&
          record.scales.includes(EXCLUDED_SCALE),
      )
      .map((record) => [record.id, record]),
  );
  const kept = [];
  const excluded = [];
  for (const task of tasks) {
    const record = byId.get(task.id);
    if (!record) kept.push(task);
    else
      excluded.push({
        batch,
        id: record.id,
        reason: record.reason,
        date: record.date,
      });
  }
  return { kept, excluded };
}

module.exports = { EXCLUDED_SCALE, loadExclusions, splitTasks };
