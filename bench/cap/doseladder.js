// SPDX-License-Identifier: Apache-2.0
// Copied from Michael Lin's scripts/bench/lib/dose-ladder.js (pull request #251, commit 33b385f9), same repository and Apache-2.0 licence. Audit rules unchanged; the run-layout writer is left out.
/**
 * Dose ladder: authored answer pairs that check the prune side of the decision rule without a subject model.
 *
 * Why it exists. A deliberately wrong skill cannot serve as a prune control: a task prompt has to state its
 * requirement to be scorable, and stating it tells the model what correct looks like, so the model overrides the
 * bad instruction and writes a good answer anyway. A ladder has no model in the loop, so a refusal is impossible.
 *
 * Shape. Each task carries one good `base_answer`, a list of declared `defects` (each naming the one rubric item it
 * breaks, as find/replace edits on the baseline), and a `paraphrase` (find/replace edits that change wording only).
 * A dose applies N defects:
 *
 *   D0  baseline vs paraphrase        null test: equal quality, different words, so the gap must contain 0
 *   D1  baseline vs 1 defect          a small, known amount of harm
 *   D2  baseline vs 2 defects
 *   D4  baseline vs 4 defects         the largest harm, so the lowest gap
 *
 * The DEFECTIVE answer goes in the `with` arm and the baseline in the `without` arm, so a dose reads as a negative
 * gap. That is the direction the prune rule tests, and the gap should grow with the dose.
 *
 * Expressing a defect as a find/replace on one baseline is what makes the ladder auditable: the task facts, the
 * structure and the style are the baseline's by construction, so the only thing that varies with the dose is
 * correctness. `validateLadder` enforces the rest of the audit list: the file has the expected shape, task ids stay
 * distinct on a file system that ignores case, D0 applies no defect and the counts grow with the dose number, each
 * `find` occurs exactly once, each defect names a real rubric item, no two defects overlap, the paraphrase carries no
 * defect, the lengths stay close, and no text mentions a skill, a plugin, guidance, the benchmark or Konductor, which
 * would leak into a judge prompt.
 *
 * Each dose is its own item (`fixture-d0`, `fixture-d1`, ...), so the per-skill aggregation, the decision rule and
 * the result file work on it unchanged: a dose IS the unit a verdict is computed over.
 *
 * In `cap` the pairs go straight to the keep-or-prune judges (keepprune.js), so the copy leaves out his answer writer
 * and judge-job planner, which wrote into his run layout. This module only reads files (when given a path): it never
 * writes one, starts a process or calls a model.
 */
'use strict';

const crypto = require('node:crypto');
const { readJsonFile } = require('./checkedjson.js');

// The helpers below stand in for his names.js and provenance.js; JSON is read with his checked reader (checkedjson.js),
// so a ladder file with a repeated key is refused, as in his code.
/** A name that may become one path segment (a task id). */
const SAFE_SEGMENT = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** A batch name: lowercase letters, digits and "-". */
const BATCH_NAME = /^[a-z0-9][a-z0-9-]{0,127}$/;
const sortKeysDeep = (value) =>
  Array.isArray(value)
    ? value.map(sortKeysDeep)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]))
      : value;
/** The sha256 of a string as is, or of any other value as JSON with its keys sorted at every level. */
const sha256 = (value) =>
  crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(sortKeysDeep(value))).digest('hex');

/** The `kind` of every record made here: the answers are authored, not generated. */
const FIXTURE_KIND = 'fixture';
/** How far a dose's answer may drift from the baseline's length before the audit fails. */
const LENGTH_TOLERANCE = 0.15;
/** How far the paraphrase (D0) may drift from the baseline's length: tighter, because D0 is the null test. */
const PARAPHRASE_LENGTH_TOLERANCE = 0.08;
/** The fewest rubric items a task may have. */
const MIN_RUBRIC_ITEMS = 3;
/** Words that must not appear in ladder text: they would tell a judge the text came from a harness. */
const FORBIDDEN_WORDS = Object.freeze([
  /\bskills?\b/i,
  /\bplugins?\b/i,
  /\bbenchmark(?:s|ing)?\b/i,
  /\bguidance\b/i,
  /\bdirectives?\b/i,
  /\bwith[-\s]?arm\b/i,
  /\bkonductor\b/i,
]);
const DOSE_NAME = /^D[0-9]{1,2}$/;
/** The number in a dose name: `D4` gives 4. */
const doseNumber = (dose) => Number(dose.slice(1));
// The fields each part of a ladder file may have. Anything else is refused, so a misspelled key cannot pass as
// a missing optional one.
const LADDER_FIELDS = Object.freeze({
  required: ['set', 'doses', 'tasks'],
  optional: ['author', 'purpose', 'why_not_a_control_skill', 'audit_checklist'],
});
const TASK_FIELDS = Object.freeze({
  required: ['id', 'prompt', 'rubric', 'base_answer', 'defects', 'paraphrase'],
  optional: ['domain'],
});
const DEFECT_FIELDS = Object.freeze({
  required: ['rubric_item', 'breaks'],
  optional: ['find', 'replace', 'edits'],
});
const EDIT_FIELDS = Object.freeze({
  required: ['find', 'replace'],
  optional: [],
});

/** A ladder that cannot be used: a bad file, a failed audit, or an answer file the writer must not replace. */
class LadderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LadderError';
  }
}

/** Reads a ladder file; a repeated key throws. The shape is checked by validateLadder, so a draft can be audited whole. */
const loadLadder = (file) => readJsonFile(file);

/** A ladder object as given, or the ladder in the file a string names. */
const resolveLadder = (ladder) =>
  typeof ladder === 'string' ? loadLadder(ladder) : ladder;

/** The find/replace edits of one defect. A defect may need more than one, so `edits` is the general form. */
const editsOf = (defect) =>
  Array.isArray(defect.edits)
    ? defect.edits
    : [{ find: defect.find, replace: defect.replace }];

/** Applies find/replace edits in order, requiring each `find` to be present exactly once. */
function applyEdits(text, edits, where) {
  let result = text;
  for (const [index, edit] of edits.entries()) {
    const at = result.indexOf(edit.find);
    if (at < 0)
      throw new LadderError(
        `${where} edit ${index}: find string is not present`,
      );
    if (result.indexOf(edit.find, at + edit.find.length) >= 0)
      throw new LadderError(
        `${where} edit ${index}: find string occurs more than once, so the edit is ambiguous`,
      );
    result = `${result.slice(0, at)}${edit.replace}${result.slice(at + edit.find.length)}`;
  }
  return result;
}

/** The answer for one dose of one task: `defectCount` defects applied, or the paraphrase when it is 0. */
function answerAtDose(task, defectCount) {
  if (!Number.isInteger(defectCount) || defectCount < 0)
    throw new LadderError(
      `${task.id}: a dose needs a whole number of defects, 0 or more, not ${JSON.stringify(defectCount)}`,
    );
  if (defectCount === 0)
    return applyEdits(
      task.base_answer,
      task.paraphrase,
      `${task.id} paraphrase`,
    );
  if (defectCount > task.defects.length)
    throw new LadderError(
      `${task.id}: dose ${defectCount} needs ${defectCount} defects, only ${task.defects.length} declared`,
    );
  return applyEdits(
    task.base_answer,
    task.defects.slice(0, defectCount).flatMap(editsOf),
    `${task.id} defects`,
  );
}

/**
 * The item name of a dose (`D1` gives `fixture-d1`). Each dose is its own item, so the existing per-skill
 * aggregation, decision rule and result file work on it unchanged.
 */
const itemName = (dose) => `${FIXTURE_KIND}-${String(dose).toLowerCase()}`;

/** Every item name a ladder produces, for the code that has to accept them next to the real skills. */
const itemNames = (ladder) =>
  Object.keys(resolveLadder(ladder).doses).map(itemName);

/**
 * One pair per task per dose: { set, dose, defects, task_id, item, domain, prompt, rubric, broken_items,
 * with, without }. `with` carries the defective answer, so the expected gap is negative and grows with the dose.
 */
function buildPairs(ladder) {
  const spec = resolveLadder(ladder);
  const pairs = [];
  for (const [dose, defectCount] of Object.entries(spec.doses))
    for (const task of spec.tasks)
      pairs.push({
        set: spec.set,
        dose,
        defects: defectCount,
        task_id: task.id,
        item: itemName(dose),
        domain: task.domain ?? null,
        prompt: task.prompt,
        rubric: [...task.rubric],
        broken_items: task.defects
          .slice(0, defectCount)
          .map((defect) => defect.rubric_item),
        with: answerAtDose(task, defectCount),
        without: task.base_answer,
      });
  return pairs;
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) =>
  typeof value === 'string' && value.length > 0;

/** Problems with the keys of one object: a missing required key or a key the format does not have. */
function fieldProblems(where, value, fields) {
  if (!isPlainObject(value)) return [`${where} must be an object`];
  const problems = [];
  for (const key of fields.required)
    if (!Object.hasOwn(value, key)) problems.push(`${where} is missing ${key}`);
  const known = new Set([...fields.required, ...fields.optional]);
  for (const key of Object.keys(value))
    if (!known.has(key))
      problems.push(`${where} has an unknown field ${JSON.stringify(key)}`);
  return problems;
}

function editListProblems(where, edits) {
  if (!Array.isArray(edits) || edits.length === 0)
    return [`${where} must be a non-empty list of edits`];
  return edits.flatMap((edit, index) => {
    const problems = fieldProblems(`${where} edit ${index}`, edit, EDIT_FIELDS);
    if (problems.length) return problems;
    if (!isNonEmptyString(edit.find))
      problems.push(`${where} edit ${index} has no find string`);
    if (typeof edit.replace !== 'string')
      problems.push(`${where} edit ${index} replace must be a string`);
    return problems;
  });
}

function defectShapeProblems(where, defect) {
  const problems = fieldProblems(where, defect, DEFECT_FIELDS);
  if (problems.length) return problems;
  if (!Number.isInteger(defect.rubric_item))
    problems.push(`${where} rubric_item must be an integer`);
  if (!isNonEmptyString(defect.breaks))
    problems.push(`${where} does not say what it breaks`);
  const hasEdits = defect.edits !== undefined;
  const hasPair = defect.find !== undefined || defect.replace !== undefined;
  if (hasEdits && hasPair)
    problems.push(`${where} has both edits and find/replace; use one form`);
  else if (hasEdits) problems.push(...editListProblems(where, defect.edits));
  else
    problems.push(
      ...editListProblems(where, [
        { find: defect.find, replace: defect.replace },
      ]),
    );
  return problems;
}

function taskShapeProblems(where, task) {
  const problems = fieldProblems(where, task, TASK_FIELDS);
  if (problems.length) return problems;
  if (typeof task.id !== 'string' || !SAFE_SEGMENT.test(task.id))
    problems.push(`${where} id ${JSON.stringify(task.id)} is not a safe name`);
  if (!isNonEmptyString(task.prompt))
    problems.push(`${where} prompt must be a non-empty string`);
  if (!isNonEmptyString(task.base_answer))
    problems.push(`${where} base_answer must be a non-empty string`);
  if (task.domain !== undefined && !isNonEmptyString(task.domain))
    problems.push(`${where} domain must be a non-empty string`);
  if (!Array.isArray(task.rubric) || !task.rubric.every(isNonEmptyString))
    problems.push(`${where} rubric must be a list of non-empty strings`);
  if (!Array.isArray(task.defects))
    problems.push(`${where} defects must be a list`);
  else
    task.defects.forEach((defect, index) =>
      problems.push(...defectShapeProblems(`${where} defect ${index}`, defect)),
    );
  problems.push(...editListProblems(`${where} paraphrase`, task.paraphrase));
  return problems;
}

/** Problems with the shape of a ladder. Content checks only make sense once this list is empty. */
function shapeProblems(spec) {
  const problems = fieldProblems('ladder', spec, LADDER_FIELDS);
  if (problems.length) return problems;
  if (typeof spec.set !== 'string' || !BATCH_NAME.test(spec.set))
    problems.push(
      `set ${JSON.stringify(spec.set)} must be lowercase letters, digits and "-", because it names the answers' batch folder`,
    );
  if (!isPlainObject(spec.doses) || Object.keys(spec.doses).length === 0)
    problems.push('doses must be an object with at least one dose');
  else {
    const seenCounts = new Map();
    const seenNumbers = new Map();
    for (const [dose, defectCount] of Object.entries(spec.doses)) {
      if (!DOSE_NAME.test(dose))
        problems.push(`dose ${JSON.stringify(dose)} must be D and a number`);
      else if (seenNumbers.has(doseNumber(dose)))
        problems.push(
          `doses ${seenNumbers.get(doseNumber(dose))} and ${dose} have the same number`,
        );
      else seenNumbers.set(doseNumber(dose), dose);
      if (!Number.isInteger(defectCount) || defectCount < 0)
        problems.push(
          `dose ${dose} must be a whole number of defects, 0 or more`,
        );
      else if (seenCounts.has(defectCount))
        problems.push(
          `doses ${seenCounts.get(defectCount)} and ${dose} both apply ${defectCount} defects`,
        );
      else seenCounts.set(defectCount, dose);
    }
  }
  if (!Array.isArray(spec.tasks) || spec.tasks.length === 0)
    problems.push('tasks must be a non-empty list');
  else {
    // The id becomes a file name, so ids that differ only by case would share one file on a file system that
    // ignores case (macOS, Windows) and one task's answer would overwrite the other's.
    const seenIds = new Map();
    spec.tasks.forEach((task, index) => {
      const taskProblems = taskShapeProblems(`task ${index}`, task);
      problems.push(...taskProblems);
      if (taskProblems.length === 0) {
        const folded = task.id.toLowerCase();
        if (seenIds.get(folded) === task.id)
          problems.push(`task ${index} id ${task.id} is used twice`);
        else if (seenIds.has(folded))
          problems.push(
            `task ${index} id ${task.id} differs only by case from ${seenIds.get(folded)}, and a file system that ignores case would give them one answer file`,
          );
        else seenIds.set(folded, task.id);
      }
    });
  }
  return problems;
}

/** The content audit of one task whose shape is already checked. */
function taskAuditProblems(task, spec, maxDose) {
  const problems = [];
  const add = (message) => problems.push(`${task.id}: ${message}`);
  if (task.rubric.length < MIN_RUBRIC_ITEMS)
    add(`needs at least ${MIN_RUBRIC_ITEMS} rubric items`);
  if (task.defects.length < maxDose)
    add(`declares ${task.defects.length} defects, the ladder needs ${maxDose}`);

  const seenItems = new Set();
  for (const [index, defect] of task.defects.entries()) {
    if (defect.rubric_item < 0 || defect.rubric_item >= task.rubric.length)
      add(
        `defect ${index} names rubric item ${defect.rubric_item}, which does not exist`,
      );
    else if (seenItems.has(defect.rubric_item))
      add(`defect ${index} breaks rubric item ${defect.rubric_item} again`);
    else seenItems.add(defect.rubric_item);
    for (const [editIndex, edit] of editsOf(defect).entries()) {
      const at = task.base_answer.indexOf(edit.find);
      if (at < 0)
        add(
          `defect ${index} edit ${editIndex} find string is not in the baseline`,
        );
      else if (task.base_answer.indexOf(edit.find, at + edit.find.length) >= 0)
        add(
          `defect ${index} edit ${editIndex} find string occurs more than once`,
        );
      if (edit.find === edit.replace)
        add(`defect ${index} edit ${editIndex} changes nothing`);
    }
  }
  // Overlapping edits would make the dose count a lie: two defects editing one region are one edit.
  const defectEdits = task.defects.map(editsOf);
  for (let first = 0; first < defectEdits.length; first++)
    for (let second = first + 1; second < defectEdits.length; second++)
      if (
        defectEdits[first].some((edit) =>
          defectEdits[second].some(
            (other) =>
              edit.find.includes(other.find) || other.find.includes(edit.find),
          ),
        )
      )
        add(`defects ${first} and ${second} edit overlapping text`);

  const lengths = {};
  const baseLength = task.base_answer.length;
  for (const [dose, defectCount] of Object.entries(spec.doses)) {
    let text;
    try {
      text = answerAtDose(task, defectCount);
    } catch (error) {
      add(`${dose}: ${error.message}`);
      continue;
    }
    lengths[dose] = text.length;
    const drift = Math.abs(text.length - baseLength) / baseLength;
    const tolerance =
      defectCount === 0 ? PARAPHRASE_LENGTH_TOLERANCE : LENGTH_TOLERANCE;
    if (drift > tolerance)
      add(
        defectCount === 0
          ? `${dose} paraphrase changes the length by ${(drift * 100).toFixed(0)}%, over the ${tolerance * 100}% tolerance, so it is not a clean null test`
          : `${dose} answer is ${(drift * 100).toFixed(0)}% off the baseline length, over the ${tolerance * 100}% tolerance`,
      );
    if (defectCount === 0 && text === task.base_answer)
      add(`${dose} paraphrase does not change the wording`);
    // A defect's replacement in the paraphrase would make the null test a dose. A replacement that is already part
    // of the baseline (an empty one always is) is no sign of a defect.
    if (defectCount === 0)
      for (const [index, defect] of task.defects.entries())
        for (const [editIndex, edit] of editsOf(defect).entries())
          if (
            !task.base_answer.includes(edit.replace) &&
            text.includes(edit.replace)
          )
            add(
              `${dose} paraphrase carries the replacement of defect ${index} edit ${editIndex}, so it is not a clean null test`,
            );
    for (const pattern of FORBIDDEN_WORDS)
      if (pattern.test(text))
        add(
          `${dose} answer contains ${pattern} which must never reach a judge`,
        );
  }
  for (const pattern of FORBIDDEN_WORDS) {
    if (pattern.test(task.base_answer))
      add(`base_answer contains ${pattern} which must never reach a judge`);
    if (pattern.test(task.prompt)) add(`prompt contains ${pattern}`);
    for (const rubricItem of task.rubric)
      if (pattern.test(rubricItem)) add(`rubric item contains ${pattern}`);
  }
  return { problems, lengths };
}

/**
 * The audit, as checks rather than prose. Returns { ok, problems, tasks, set, sha256 } and never throws on a
 * content problem, so a draft can be inspected whole instead of one failure at a time. A file that cannot be read
 * or parsed still throws.
 */
function validateLadder(ladder) {
  const spec = resolveLadder(ladder);
  const shape = shapeProblems(spec);
  const set =
    isPlainObject(spec) && typeof spec.set === 'string' ? spec.set : null;
  if (shape.length)
    return { ok: false, problems: shape, tasks: [], set, sha256: sha256(spec) };

  const problems = [];
  const tasks = [];
  const maxDose = Math.max(...Object.values(spec.doses));
  if (!Object.hasOwn(spec.doses, 'D0'))
    problems.push('doses: no D0, so there is no null test');
  else if (spec.doses.D0 !== 0)
    problems.push(
      `doses: D0 applies ${spec.doses.D0} defects, but D0 is the null test and applies none`,
    );
  // The prune rule reads a gap that grows with the dose, so the defect count must grow with the dose number.
  const byNumber = Object.entries(spec.doses).sort(
    ([first], [second]) => doseNumber(first) - doseNumber(second),
  );
  for (let index = 1; index < byNumber.length; index++) {
    const [dose, defectCount] = byNumber[index];
    const [lower, lowerCount] = byNumber[index - 1];
    if (defectCount <= lowerCount)
      problems.push(
        `doses: ${dose} applies ${defectCount} defects, not more than ${lower} (${lowerCount}), so the count does not grow with the dose number`,
      );
  }

  for (const task of spec.tasks) {
    const audit = taskAuditProblems(task, spec, maxDose);
    problems.push(...audit.problems);
    tasks.push({
      id: task.id,
      domain: task.domain ?? null,
      rubric: task.rubric.length,
      defects: task.defects.length,
      lengths: audit.lengths,
    });
  }
  return {
    ok: problems.length === 0,
    problems,
    tasks,
    set,
    sha256: sha256(spec),
  };
}

module.exports = {
  FIXTURE_KIND,
  LENGTH_TOLERANCE,
  PARAPHRASE_LENGTH_TOLERANCE,
  MIN_RUBRIC_ITEMS,
  FORBIDDEN_WORDS,
  LadderError,
  loadLadder,
  editsOf,
  applyEdits,
  answerAtDose,
  itemName,
  itemNames,
  buildPairs,
  validateLadder,
};
