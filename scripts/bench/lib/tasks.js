// SPDX-License-Identifier: Apache-2.0
/**
 * Task assembly: one skill's frozen tasks, checked and joined with what each arm will be given.
 *
 * The baseline files are read and checked by baseline.js (formats.js holds the per-file rules). Assembly adds what
 * a run needs on top:
 *   - the skill's `##` and `###` headings, and for each task the exact heading its `target_section` stands for
 *     (resolveSection). A `target_section` that is not a heading is a warning: the format makes it a note for the
 *     reviewer, and `plan` does not refuse it, so a run must not refuse it either.
 *   - the condition record: what each arm was told, stored with every answer so the report can state it.
 *   - per task and arm, the answer inputs and their digest (answerInputs). An answer whose stored digest differs
 *     from today's is stale and is redone, never reused.
 *
 * Assembly is in memory. Nothing is written: the digests are cheap to rebuild from the baseline, the arms and the
 * settings, so there is no assembled file that could drift from the files it came from.
 *
 * Only the request reaches the subject (subjectRequest) and only the request and the checklist reach a judge
 * (judgeRequest). Every other task field (id, title, target_section, why_skill_matters, the digests) names the skill's
 * own vocabulary or the experiment, and would tell a model which arm it is in.
 */
'use strict';

const {
  ANSWER_STYLE_RULE,
  ARM_BLINDING_VERSION,
  PLUGIN,
  buildArms,
  loadInstruction,
  removeArms,
} = require('./arms');
const { loadBaseline } = require('./baseline');
const { ARMS } = require('./layout');
const { PROVENANCE_VERSION, fileSha256, sha256 } = require('./provenance');
const { readFile } = require('./read-file');
const { forSkill } = require('./runner');
const { resolveAgent } = require('./skills');

const ANSWER_KIND = 'answer';
const HEADING_LEVELS = Object.freeze([3, 4]);
// A list number a heading may start with: "2. ", "2) " or "2.1 ". A bare "2024 " is not one.
const LIST_NUMBER = /^(?:\d+(?:\.\d+)+|\d+[.)])\s+/;

/** The baseline cannot be assembled. `problems` lists every reason, one line each. */
class TaskSetError extends Error {
  constructor(skill, problems) {
    super(
      `${skill}: the tasks cannot be assembled:\n  ${problems.join('\n  ')}`,
    );
    this.name = 'TaskSetError';
    this.skill = skill;
    this.problems = problems;
  }
}

/**
 * The `##` and `###` headings of a SKILL.md, in order and without the `#` marks. `maxLevel` 4 also takes `####`.
 * A repeated heading is listed each time it appears.
 */
function sectionsOf(markdown, { maxLevel = 3 } = {}) {
  if (!HEADING_LEVELS.includes(maxLevel))
    throw new TypeError(`sectionsOf: maxLevel must be 3 or 4, got ${maxLevel}`);
  if (typeof markdown !== 'string')
    throw new TypeError('sectionsOf: markdown must be a string');
  const heading = new RegExp(`^#{2,${maxLevel}} `);
  return markdown
    .split(/\r?\n/)
    .filter((line) => heading.test(line))
    .map((line) => line.replace(/^#+ /, '').trim());
}

/**
 * The exact heading that `name` stands for, or null. A name equal to a heading is that heading. Otherwise it may
 * leave out the list number the heading starts with ("Operation Modeling" for "2. Operation Modeling"), and it must
 * then fit one heading only. Nothing else is forgiven: case, spacing, a wrong number, or a name that fits two
 * headings all give null.
 */
function resolveSection(headings, name) {
  if (typeof name !== 'string' || !name) return null;
  if (headings.includes(name)) return name;
  const hits = [
    ...new Set(
      headings.filter((heading) => heading.replace(LIST_NUMBER, '') === name),
    ),
  ];
  return hits.length === 1 ? hits[0] : null;
}

/** The request of a task: the one task field the subject is given. */
const subjectRequest = (task) => task.prompt;

/** What a judge is given of a task: the request and the checklist, nothing else. */
const judgeRequest = (task) => ({
  request: task.prompt,
  checklist: [...task.rubric],
});

/** Hash of what the subject sees of a task, with its id so two tasks with one request still differ. */
const taskSha256 = (task) => sha256({ id: task.id, prompt: task.prompt });

/**
 * The digested inputs of one answer: what decides the text the subject writes. The skill file hash is part of
 * the `with` arm's digest only: the `without` arm never has the skill, so an edit of the skill does not make its
 * answers stale. The arm manifest (arms.js) covers the agent definition and every file of the arm's plugin folder.
 *
 * The skills version and the Claude Code version are recorded on the answer, beside the digest, not in it: the
 * content they name is already covered here, and a new commit or CLI version alone must not make work stale.
 */
function answerInputs({
  skill,
  batch,
  task,
  arm,
  armManifest,
  runner,
  subjectModel,
  skillMdSha256,
}) {
  if (!ARMS.includes(arm))
    throw new TypeError(
      `answer inputs: arm must be one of ${ARMS.join(', ')}, got ${JSON.stringify(arm)}`,
    );
  if (!armManifest || armManifest.arm !== arm)
    throw new TypeError(
      `answer inputs: the arm manifest is not the ${arm} arm's (arms.js buildArms manifests.${arm})`,
    );
  if (!runner || typeof runner.profileSha256 !== 'string')
    throw new TypeError(
      'answer inputs: runner must come from runner.js forSkill',
    );
  const fields = {
    provenance_version: PROVENANCE_VERSION,
    kind: ANSWER_KIND,
    skill,
    batch,
    task_id: task.id,
    task_sha256: taskSha256(task),
    arm,
    arm_blinding_version: ARM_BLINDING_VERSION,
    agent: armManifest.agent,
    agents_json_sha256: armManifest.agents_json_sha256,
    plugin_tree_sha256: armManifest.plugin_tree_sha256,
    subject_model: subjectModel,
    runner_profile_sha256: runner.profileSha256,
    ...(arm === 'with' ? { skill_md_sha256: skillMdSha256 } : {}),
  };
  for (const [name, value] of Object.entries(fields))
    if (value === undefined || value === null || value === '')
      throw new TypeError(`answer inputs: ${name} is required`);
  return { ...fields, input_sha256: sha256(fields) };
}

/**
 * What each arm was told, stored with every answer and every result so the report can state it. `runner` comes from
 * runner.js forSkill. Under an explicit-load profile only the `with` arm is told to load the skill; under the natural
 * profile neither arm is told anything, so whether the agent picks the skill up is part of what is measured.
 */
function conditionRecord(skill, runner) {
  if (!runner || !runner.info)
    throw new TypeError(
      'conditionRecord: runner must come from runner.js forSkill',
    );
  const explicit = runner.explicitInstruction === true;
  const withoutArm = {
    skill_present: false,
    load_instruction: null,
    target_skill_references_removed: true,
    answer_style_rule: 'same as answer_style_rule',
  };
  const shared = `The "without" arm's agent prompt carries no reference to the skill. Both arms get the same answer-style rule and the same tool grant.`;
  return {
    condition: explicit ? 'explicit' : 'natural',
    load_mode: runner.loadMode,
    arm_blinding_version: ARM_BLINDING_VERSION,
    answer_style_rule: ANSWER_STYLE_RULE.trim(),
    with_arm: {
      skill_present: true,
      load_instruction: explicit ? loadInstruction(skill).trim() : null,
      answer_style_rule: 'same as answer_style_rule',
    },
    without_arm: withoutArm,
    asymmetry: explicit
      ? `Only the "with" arm has ${PLUGIN}:${skill} and is told to load it. ${shared} This measures the skill's content once loaded, not whether the agent would choose to load it.`
      : `Only the "with" arm has ${PLUGIN}:${skill} installed. Neither arm is told to load anything. ${shared} This measures the skill as an agent would use it: whether the agent picks it up and what it does with it.`,
    runner: runner.info,
  };
}

/** Throws TaskSetError, listing every reason, when the baseline is missing, has a problem or has no tasks. */
function requireUsableBaseline(skill, baseline) {
  const problems = [];
  if (!baseline.hasBaseline) problems.push('no baseline folder');
  problems.push(...baseline.problems);
  if (baseline.hasBaseline && !baseline.batches.length && !problems.length)
    problems.push('no task file could be read');
  if (problems.length) throw new TaskSetError(skill, problems);
}

/**
 * One skill's tasks, ready to run. Inputs:
 *   skill          the skill name
 *   baseline       baseline.js loadBaseline(layout, skill)
 *   skillMd        the text of skills/<skill>/SKILL.md, and skillMdSha256 the hash of its bytes
 *   agent          the agent that answers (skills.js resolveAgent)
 *   armManifests   { with, without } from arms.js buildArms
 *   runner         runner.js forSkill(skill, profile)
 *   subjectModel   config.models.subject
 * Returns { skill, agent, rules_stale, skill_sections, condition, batches: [{ batch, stale, read_b, tasks }],
 * warnings }. Each task keeps its baseline fields and gains `exercises_section` (the exact heading, or null),
 * `task_sha256` and `inputs` ({ with, without } answerInputs).
 *
 * Throws TaskSetError, listing every reason, when the skill has no baseline or its baseline has a problem.
 */
function assembleTasks({
  skill,
  baseline,
  skillMd,
  skillMdSha256,
  agent,
  armManifests,
  runner,
  subjectModel,
}) {
  if (!baseline || baseline.skill !== skill)
    throw new TypeError(
      'assembleTasks: baseline must be loadBaseline(layout, skill) for this skill',
    );
  requireUsableBaseline(skill, baseline);

  const sections = sectionsOf(skillMd);
  const warnings = [];
  const batches = baseline.batches.map(({ batch, tasks, stale }) => ({
    batch,
    stale,
    // Reading B scores against the rules checklist, which waits for a refreshed baseline once either file is stale.
    read_b: !baseline.rulesStale && !stale,
    tasks: tasks.scenarios.map((task) => {
      const exercisesSection = resolveSection(sections, task.target_section);
      if (exercisesSection === null)
        warnings.push(
          `${batch}/${task.id}: target_section ${JSON.stringify(task.target_section)} is not a heading of SKILL.md`,
        );
      return {
        ...task,
        rubric: [...task.rubric],
        exercises_section: exercisesSection,
        task_sha256: taskSha256(task),
        inputs: Object.fromEntries(
          ARMS.map((arm) => [
            arm,
            answerInputs({
              skill,
              batch,
              task,
              arm,
              armManifest: armManifests && armManifests[arm],
              runner,
              subjectModel,
              skillMdSha256,
            }),
          ]),
        ),
      };
    }),
  }));
  return {
    skill,
    agent,
    rules_stale: baseline.rulesStale,
    skill_sections: sections,
    condition: conditionRecord(skill, runner),
    batches,
    warnings,
  };
}

/**
 * assembleTasks for one skill of a checkout: reads the baseline and SKILL.md, picks the agent and the runner profile
 * from the settings, and builds both arms to take their manifests. Returns { taskSet, runner, arms }. With `keepArms`
 * the arms stay on disk for the subject runs and the caller removes them (arms.js removeArms); otherwise they are
 * removed here and `arms` is null. A call that throws leaves no arms on disk.
 *
 * Throws TaskSetError when the skill has no agent or its baseline cannot be assembled.
 * An agent spec that cannot be read is thrown as skills.js AgentSpecError.
 */
function loadTaskSet({
  layout,
  config,
  skill,
  keepArms = false,
  tmpRoot,
  controlSkillsDir,
}) {
  const baseline = loadBaseline(layout, skill);
  const { agent } = resolveAgent(skill, { agentsDir: layout.agentsDir });
  if (!agent) throw new TaskSetError(skill, ['no agent lists the skill']);
  requireUsableBaseline(skill, baseline);
  const runner = forSkill(skill, config.runner_profile);
  const arms = buildArms(skill, {
    skillsDir: layout.skillsDir,
    agentsDir: layout.agentsDir,
    agent,
    explicitInstruction: runner.explicitInstruction,
    ...(tmpRoot ? { tmpRoot } : {}),
    ...(controlSkillsDir ? { controlSkillsDir } : {}),
  });
  let taskSet;
  try {
    taskSet = assembleTasks({
      skill,
      baseline,
      skillMd: readFile(layout.skillMd(skill), 'utf8'),
      skillMdSha256: fileSha256(layout.skillMd(skill)),
      agent,
      armManifests: arms.manifests,
      runner,
      subjectModel: config.models.subject,
    });
  } catch (error) {
    // The caller gets no arms from a call that throws, so none may stay on disk, kept or not.
    removeArms(arms);
    throw error;
  }
  if (!keepArms) removeArms(arms);
  return { taskSet, runner, arms: keepArms ? arms : null };
}

module.exports = {
  ANSWER_KIND,
  TaskSetError,
  sectionsOf,
  resolveSection,
  subjectRequest,
  judgeRequest,
  taskSha256,
  answerInputs,
  conditionRecord,
  assembleTasks,
  loadTaskSet,
};
