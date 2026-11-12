// SPDX-License-Identifier: Apache-2.0
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
 * defect, the lengths stay close, and no text a judge reads (the task id and domain, the baseline, the prompt, the
 * rubric and every dose answer) holds a word of FORBIDDEN_WORDS: skill, plugin, benchmark, guidance, directive,
 * with-arm or Konductor.
 *
 * Each dose is its own item (`fixture-d0`, `fixture-d1`, ...), so the per-skill aggregation, the decision rule and
 * the result file work on it unchanged: a dose IS the unit a verdict is computed over.
 *
 * `writeLadderAnswers` writes the answers as answer records in the run layout
 * (answers/<item>/<set>/<task>.<with|without>.json). It refuses a ladder that fails its audit before it writes
 * anything. Everything else here only reads files (when given a path): it never writes one, starts a process or
 * calls a model.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { ARM_BLINDING_VERSION } = require('./arms');
const { ARMS } = require('./layout');
const { BATCH_NAME, SAFE_SEGMENT } = require('./names');
const { PROVENANCE_VERSION, sha256 } = require('./provenance');
const { readJsonFile } = require('./read-file');

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
/**
 * Stands in for the skill-load check of a generated answer (claude-run.js checkSkillLoad), in the same shape and with
 * the same meaning of `loaded`: true for the `with` arm, false for the `without` arm. No answer here loads anything,
 * so the note says that; `loaded` says what a run of that arm would have shown.
 */
const authoredSkillLoad = (arm) => ({
  loaded: arm === 'with',
  attempts: [],
  otherSkillLoads: [],
  note: 'authored answer, nothing was loaded',
});

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

/** Reads a ladder file. The shape is checked by validateLadder, not here, so a draft can be audited whole. */
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

/**
 * The digested inputs of one authored answer. The digest covers THIS task and THIS arm's answer, not the whole
 * ladder: hashing the ladder would make appending a task invalidate the tasks already judged, and the ladder is
 * meant to grow. Editing a task still moves its own digests, which is the property that matters.
 */
function answerInputs({ set, taskSha256, dose, taskId, prompt, arm, text }) {
  const fields = {
    provenance_version: PROVENANCE_VERSION,
    kind: FIXTURE_KIND,
    set,
    task_sha256: taskSha256,
    dose,
    request_sha256: sha256({ task_id: taskId, prompt }),
    arm,
    answer_sha256: sha256(text),
  };
  return { ...fields, input_sha256: sha256(fields) };
}

/**
 * The tasks and answer records of a ladder, in memory:
 *   { set, sha256, pairCount, items: { [item]: itemRecord }, answers: [{ item, taskId, arm, record }] }.
 * An item record lists the dose and, per task, the prompt, the rubric and the rubric items its defects break.
 * Each pair gives two answer records, one per arm. The ladder is not audited here; writeLadderAnswers audits it.
 */
function assembleLadder(ladder) {
  const spec = resolveLadder(ladder);
  const taskSha256 = new Map(spec.tasks.map((task) => [task.id, sha256(task)]));
  const items = {};
  const answers = [];
  const pairs = buildPairs(spec);

  for (const pair of pairs) {
    const inputs = Object.fromEntries(
      ARMS.map((arm) => [
        arm,
        answerInputs({
          set: spec.set,
          taskSha256: taskSha256.get(pair.task_id),
          dose: pair.dose,
          taskId: pair.task_id,
          prompt: pair.prompt,
          arm,
          text: pair[arm],
        }),
      ]),
    );
    const item = (items[pair.item] ||= {
      item: pair.item,
      kind: FIXTURE_KIND,
      set: spec.set,
      dose: pair.dose,
      declared_defects: pair.defects,
      tasks: [],
    });
    item.tasks.push({
      id: pair.task_id,
      title: `${pair.task_id} at ${pair.dose}`,
      domain: pair.domain,
      prompt: pair.prompt,
      rubric: pair.rubric,
      broken_items: pair.broken_items,
      input_sha256: {
        with: inputs.with.input_sha256,
        without: inputs.without.input_sha256,
      },
    });

    for (const arm of ARMS)
      answers.push({
        item: pair.item,
        taskId: pair.task_id,
        arm,
        record: {
          kind: FIXTURE_KIND,
          set: spec.set,
          dose: pair.dose,
          skill: pair.item,
          task_id: pair.task_id,
          arm,
          arm_blinding_version: ARM_BLINDING_VERSION,
          inputs: inputs[arm],
          answer_sha256: inputs[arm].answer_sha256,
          ok: true,
          text: pair[arm],
          // Authored, not generated: there was no run to load anything. `loaded` follows the arm, so a stored
          // `without` answer never says it loaded the skill. Nothing reads this entry to decide whether a pair counts.
          skill_load: authoredSkillLoad(arm),
          est_usd: 0,
          reported_usd: 0,
        },
      });
  }
  return {
    set: spec.set,
    sha256: sha256(spec),
    pairCount: pairs.length,
    items,
    answers,
  };
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) =>
  typeof value === 'string' && value.length > 0;

/**
 * What the judge job plans the ladder items in `items` from, without a file on disk:
 *   taskSets   { [item]: { skill, batches: [{ batch, read_b, tasks }], warnings } } in the shape jobs.js planJobs reads.
 *              The batch is the ladder's `set`. `read_b` is false: an item has no rules checklist, so it is read by
 *              A only. Each task holds the fields the request-only checklist is written from (id, prompt, rubric:
 *              the same three the checklist job gives the writer).
 *   answer     (item, taskId, arm) => the authored answer record (assembleLadder), or null
 * The answers come from the ladder itself. They are authored, so there is no run that could leave one missing or
 * stale; a changed ladder changes the answer hashes, and the judgment digest with them.
 */
function judgingSets(ladder, items) {
  const assembled = assembleLadder(ladder);
  const records = new Map(
    assembled.answers.map(({ item, taskId, arm, record }) => [
      `${item}\u0000${taskId}\u0000${arm}`,
      record,
    ]),
  );
  const taskSets = {};
  for (const item of items) {
    const itemRecord = assembled.items[item];
    if (!itemRecord)
      throw new LadderError(
        `${item} is not an item of dose ladder ${assembled.set}`,
      );
    taskSets[item] = {
      skill: item,
      batches: [
        {
          batch: assembled.set,
          read_b: false,
          tasks: itemRecord.tasks.map((task) => ({
            id: task.id,
            prompt: task.prompt,
            rubric: [...task.rubric],
          })),
        },
      ],
      warnings: [],
    };
  }
  return {
    taskSets,
    answer: (item, taskId, arm) =>
      records.get(`${item}\u0000${taskId}\u0000${arm}`) || null,
  };
}

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
    // assembleLadder builds the title `<id> at <dose>` and carries the domain, so both reach the judge job.
    if (pattern.test(task.id))
      add(`id contains ${pattern} which must never reach a judge`);
    if (task.domain !== undefined && pattern.test(task.domain))
      add(`domain contains ${pattern} which must never reach a judge`);
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
  // `undefined` has no JSON form to hash; it digests like `null`, and both are reported as "ladder must be an object".
  if (shape.length)
    return {
      ok: false,
      problems: shape,
      tasks: [],
      set,
      sha256: sha256(spec ?? null),
    };

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

/** Writes `text` to `file` through a temporary file in the same folder, so a reader never sees half a record. */
function writeFileAtomic(file, text) {
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

/** The stored record in `file`, null when there is none. A record that is not an authored answer is refused. */
function existingFixtureRecord(file) {
  if (!fs.existsSync(file)) return null;
  const record = readJsonFile(file);
  if (!isPlainObject(record) || record.kind !== FIXTURE_KIND)
    throw new LadderError(
      `${file} holds an answer that is not an authored ${FIXTURE_KIND} answer; refusing to replace it`,
    );
  return record;
}

/**
 * Audits the ladder, then writes each answer record to `layout.answerFile(item, batch, task, arm)`. The batch is
 * the ladder's `set` unless `batch` names another. A stored record that equals the new one in every field is left
 * as it is, so a second write of an unchanged ladder writes nothing; a record that differs in any field (the text,
 * an input digest, the cost, the skill-load entry, the blinding version) is rewritten. Returns
 * { set, batch, sha256, pairCount, written: [files], unchanged }. Files of a task or dose that the ladder no
 * longer has are not deleted and not reported.
 *
 * Throws LadderError, with nothing written, when the ladder fails its audit or the batch name is not a valid
 * batch name. Throws LadderError when an answer file already holds a record that is not an authored answer or one
 * from another set, and JsonFileError when it holds text that is not JSON: a real answer, or the answer of another
 * ladder, is never overwritten by this one.
 */
function writeLadderAnswers({ ladder, layout, batch } = {}) {
  if (!layout || typeof layout.answerFile !== 'function')
    throw new TypeError(
      'writeLadderAnswers: layout must be a run layout (layout.js createLayout)',
    );
  const spec = resolveLadder(ladder);
  const audit = validateLadder(spec);
  if (!audit.ok)
    throw new LadderError(
      `dose ladder ${audit.set ?? '(no set name)'} failed its audit:\n  ${audit.problems.join('\n  ')}`,
    );
  const batchName = batch ?? spec.set;
  if (typeof batchName !== 'string' || !BATCH_NAME.test(batchName))
    throw new LadderError(
      `batch ${JSON.stringify(batchName)} is not a valid batch name`,
    );

  const assembled = assembleLadder(spec);
  // Every path is built and every existing file checked before the first write, so a refusal writes nothing.
  const planned = assembled.answers.map((answer) => {
    const file = layout.answerFile(
      answer.item,
      batchName,
      answer.taskId,
      answer.arm,
    );
    const stored = existingFixtureRecord(file);
    if (
      stored &&
      typeof stored.set === 'string' &&
      stored.set !== answer.record.set
    )
      throw new LadderError(
        `${file} holds an authored answer from set ${JSON.stringify(stored.set)}, not ${JSON.stringify(answer.record.set)}; refusing to replace it`,
      );
    return { file, record: answer.record, stored };
  });
  const written = [];
  let unchanged = 0;
  for (const { file, record, stored } of planned) {
    // Unchanged only when every field of the stored record equals the new one (key order does not count).
    if (stored && sha256(stored) === sha256(record)) {
      unchanged += 1;
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileAtomic(file, `${JSON.stringify(record, null, 2)}\n`);
    written.push(file);
  }
  return {
    set: assembled.set,
    batch: batchName,
    sha256: assembled.sha256,
    pairCount: assembled.pairCount,
    written,
    unchanged,
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
  assembleLadder,
  judgingSets,
  validateLadder,
  writeLadderAnswers,
};
