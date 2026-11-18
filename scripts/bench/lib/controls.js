// SPDX-License-Identifier: Apache-2.0
/**
 * The controls: the two cases whose right answer is known in advance, run through the same driver as the skills, so
 * a run that includes them shows whether its judging can be trusted.
 *
 *   convention-control  a control skill (layout.js CONTROL_SKILLS): five arbitrary, harmless conventions and one guard
 *                       rule. Selected with --skills convention-control. Its baseline is in scripts/bench/controls/, so
 *                       `plan`, `next`, the jobs and `report` run it like a skill: subject runs and both readings. The
 *                       report reads it as a control, never as a label.
 *   dose ladder         selected with --skills dose-ladder (DOSE_LADDER). Its answers are authored
 *                       (layout.ladderFile, dose-ladder.js), so it has no subject runs and no rules checklist. Its items
 *                       (fixture-d0, fixture-d1, ...) get request-only checklists and reading A judgments only: `next`
 *                       names those two jobs with the items and --ladder, and `report` reads them (run-report.js).
 *
 * The pass rules are PASS_RULES in readings-report.js. A control counts only through judgments that are current for
 * today's judge prompt, judges, checklist and answers (judge-job.js planJudging lists them), so a control whose
 * judgments are stale or missing has no interval and is NOT RUN, never a pass.
 *
 * This module only reads the selection and the ladder file. It loads no job module, so `plan` can use it.
 */
'use strict';

const {
  LadderError,
  itemNames,
  loadLadder,
  validateLadder,
} = require('./dose-ladder');

/** The --skills name that selects the dose ladder. It always means the ladder, so a skill folder of this name could not be selected (none exists). */
const DOSE_LADDER = 'dose-ladder';
const LISTED_PROBLEMS = 3;

/** `names` (a --skills selection) split into the skills and control skills, and whether the dose ladder is in it. */
function splitSelection(names) {
  return {
    skills: names.filter((name) => name !== DOSE_LADDER),
    ladder: names.includes(DOSE_LADDER),
  };
}

/**
 * The dose ladder of `layout` (layout.ladderFile): { ladder, items, file }. Throws LadderError when the file cannot be
 * read as JSON or fails its audit, so no job is named for a ladder that would be refused.
 */
function selectedLadder(layout) {
  const file = layout.ladderFile;
  let ladder;
  try {
    ladder = loadLadder(file);
  } catch (error) {
    throw new LadderError(
      `the dose ladder ${file} cannot be read: ${error.message}`,
    );
  }
  const audit = validateLadder(ladder);
  if (!audit.ok)
    throw new LadderError(
      `the dose ladder ${file} fails its audit: ${audit.problems.slice(0, LISTED_PROBLEMS).join('; ')}`,
    );
  return { ladder, items: itemNames(ladder), file };
}

module.exports = { DOSE_LADDER, splitSelection, selectedLadder };
