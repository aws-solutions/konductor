// SPDX-License-Identifier: Apache-2.0
// Tests for task assembly (scripts/bench/lib/tasks.js): headings, section names, the condition record, the answer
// digests and the blinding of task metadata. No model call: the arms are built from the fixture repo.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const tasks = require('../../../scripts/bench/lib/tasks');
const {
  ARM_BLINDING_VERSION,
  buildArms,
  removeArms,
} = require('../../../scripts/bench/lib/arms');
const { loadBaseline } = require('../../../scripts/bench/lib/baseline');
const { createLayout } = require('../../../scripts/bench/lib/layout');
const { fileSha256 } = require('../../../scripts/bench/lib/provenance');
const { forSkill, profile } = require('../../../scripts/bench/lib/runner');
const { AgentSpecError } = require('../../../scripts/bench/lib/skills');
const helpers = require('./helpers');

const {
  sectionsOf,
  resolveSection,
  answerInputs,
  conditionRecord,
  assembleTasks,
  loadTaskSet,
  subjectRequest,
  judgeRequest,
  TaskSetError,
} = tasks;

const CONFIG = helpers.exampleConfig();
const SKILL = helpers.SKILL;
const LAYOUT = createLayout({ root: helpers.fixtureRoot() });

/** Arms for brew-log on the fixture repo; the scratch folder is removed after `check` runs. */
function withArms(check, { explicitInstruction = true, layout = LAYOUT } = {}) {
  const arms = buildArms(SKILL, {
    skillsDir: layout.skillsDir,
    agentsDir: layout.agentsDir,
    agent: 'k-developer',
    explicitInstruction,
  });
  try {
    return check(arms);
  } finally {
    removeArms(arms);
  }
}

/** assembleTasks over a layout's brew-log baseline, with arms built from it. */
function assembleFixture(layout = LAYOUT, runner = forSkill(SKILL)) {
  return withArms(
    (arms) =>
      assembleTasks({
        skill: SKILL,
        baseline: loadBaseline(layout, SKILL),
        skillMd: fs.readFileSync(layout.skillMd(SKILL), 'utf8'),
        skillMdSha256: fileSha256(layout.skillMd(SKILL)),
        agent: 'k-developer',
        armManifests: arms.manifests,
        runner,
        subjectModel: CONFIG.models.subject,
      }),
    { layout, explicitInstruction: runner.explicitInstruction },
  );
}

test('sectionsOf: ## and ### headings in order, without # or ####; maxLevel 4 adds ####', () => {
  const markdown = [
    '# Title',
    '## One',
    'text',
    '### Two',
    '#### Three',
    '##No space',
    '## One',
    '##### Five',
  ].join('\r\n');
  assert.deepEqual(sectionsOf(markdown), ['One', 'Two', 'One']);
  assert.deepEqual(sectionsOf(markdown, { maxLevel: 4 }), [
    'One',
    'Two',
    'Three',
    'One',
  ]);
  assert.throws(() => sectionsOf(markdown, { maxLevel: 5 }), /maxLevel/);
  assert.throws(() => sectionsOf(null), /must be a string/);
});

test('resolveSection: a heading without its list number resolves to the exact heading, nothing else is forgiven', () => {
  const headings = [
    '1. Service Definition',
    '2. Operation Modeling',
    '3) Shape Design',
    '2.1 Backoff',
    '2024 Review',
    'Plain',
    '4. Dup',
    '5. Dup',
  ];
  const resolve = (name) => resolveSection(headings, name);
  assert.equal(resolve('2. Operation Modeling'), '2. Operation Modeling');
  assert.equal(resolve('Operation Modeling'), '2. Operation Modeling');
  assert.equal(resolve('Shape Design'), '3) Shape Design');
  assert.equal(resolve('Backoff'), '2.1 Backoff');
  assert.equal(resolve('Plain'), 'Plain');
  assert.equal(resolve('Review'), null, 'a bare year is not a list number');
  assert.equal(resolve('3. Operation Modeling'), null, 'a wrong number');
  assert.equal(resolve('operation modeling'), null, 'case');
  assert.equal(resolve('Operation  Modeling'), null, 'spacing');
  assert.equal(resolve(' Operation Modeling'), null, 'leading space');
  assert.equal(resolve('Dup'), null, 'a name that fits two headings');
  assert.equal(resolve('Nothing like a heading'), null);
  assert.equal(resolve(''), null);
  assert.equal(resolve(undefined), null);
  // The same heading listed twice (sectionsOf keeps repeats) is still one heading.
  assert.equal(resolveSection(['2. Foo', '2. Foo'], 'Foo'), '2. Foo');
});

test('fixture tasks: every target_section is a heading of the fixture SKILL.md', () => {
  const sections = sectionsOf(fs.readFileSync(LAYOUT.skillMd(SKILL), 'utf8'));
  const baseline = loadBaseline(LAYOUT, SKILL);
  assert.ok(baseline.batches.length > 0);
  for (const { tasks: taskFile } of baseline.batches)
    for (const task of taskFile.scenarios)
      assert.equal(
        resolveSection(sections, task.target_section),
        task.target_section,
        task.id,
      );
});

test('condition record: explicit profile tells the with arm only; natural tells neither', () => {
  const explicit = conditionRecord(SKILL, forSkill(SKILL));
  assert.equal(explicit.condition, 'explicit');
  assert.match(explicit.with_arm.load_instruction, /bench:brew-log/);
  assert.equal(explicit.without_arm.load_instruction, null);
  assert.equal(explicit.without_arm.skill_present, false);
  assert.equal(explicit.with_arm.skill_present, true);
  assert.match(
    explicit.asymmetry,
    /Only the "with" arm has bench:brew-log and is told to load it/,
  );
  assert.deepEqual(explicit.runner, forSkill(SKILL).info);
  assert.equal(explicit.arm_blinding_version, 1);

  const natural = conditionRecord(SKILL, forSkill(SKILL, 'natural'));
  assert.equal(natural.condition, 'natural');
  assert.equal(natural.load_mode, 'natural');
  assert.equal(natural.with_arm.load_instruction, null);
  assert.match(natural.asymmetry, /Neither arm is told to load anything/);
  assert.ok(!('noise_arm' in natural), 'no same-arm sample is recorded');
  assert.throws(() => conditionRecord(SKILL, {}), /forSkill/);
});

test('answerInputs: the digest moves with each input; the skill file hash is in the with arm only', () => {
  withArms((arms) => {
    const task = loadBaseline(LAYOUT, SKILL).batches[0].tasks.scenarios[0];
    const base = {
      skill: SKILL,
      batch: 'b1',
      task,
      runner: forSkill(SKILL),
      subjectModel: 'model-a',
      skillMdSha256: 'a'.repeat(64),
    };
    const withInputs = answerInputs({
      ...base,
      arm: 'with',
      armManifest: arms.manifests.with,
    });
    const withoutInputs = answerInputs({
      ...base,
      arm: 'without',
      armManifest: arms.manifests.without,
    });
    assert.equal(withInputs.skill_md_sha256, 'a'.repeat(64));
    assert.ok(!('skill_md_sha256' in withoutInputs));
    assert.notEqual(withInputs.input_sha256, withoutInputs.input_sha256);
    const digestOf = (arm, changes) =>
      answerInputs({
        ...base,
        arm,
        armManifest: arms.manifests[arm],
        ...changes,
      }).input_sha256;
    for (const [what, changes] of [
      ['model', { subjectModel: 'model-b' }],
      ['batch', { batch: 'b2' }],
      ['request', { task: { ...task, prompt: `${task.prompt} More.` } }],
      ['task id', { task: { ...task, id: 'other-id' } }],
      ['runner', { runner: forSkill(SKILL, 'natural') }],
    ]) {
      assert.notEqual(digestOf('with', changes), withInputs.input_sha256, what);
      assert.notEqual(
        digestOf('without', changes),
        withoutInputs.input_sha256,
        what,
      );
    }
    assert.notEqual(
      digestOf('with', { skillMdSha256: 'b'.repeat(64) }),
      withInputs.input_sha256,
    );
    // The agent definition and the plugin folder are inputs of both arms.
    for (const arm of ['with', 'without'])
      for (const field of ['agents_json_sha256', 'plugin_tree_sha256'])
        assert.notEqual(
          digestOf(arm, {
            armManifest: { ...arms.manifests[arm], [field]: 'f'.repeat(64) },
          }),
          arm === 'with' ? withInputs.input_sha256 : withoutInputs.input_sha256,
          `${field} (${arm})`,
        );
    assert.equal(withInputs.arm_blinding_version, ARM_BLINDING_VERSION);
    assert.equal(withoutInputs.arm_blinding_version, ARM_BLINDING_VERSION);
    assert.equal(withInputs.skill, SKILL);
    for (const arm of ['with', 'without'])
      assert.notEqual(
        digestOf(arm, { skill: 'other-skill' }),
        arm === 'with' ? withInputs.input_sha256 : withoutInputs.input_sha256,
        `skill (${arm})`,
      );
    assert.equal(
      digestOf('without', { skillMdSha256: 'b'.repeat(64) }),
      withoutInputs.input_sha256,
      'a skill edit does not make the without answers stale',
    );
    // Only the request reaches the subject: the title, the section and the checklist are not answer inputs.
    for (const field of ['title', 'target_section', 'rubric'])
      assert.equal(
        digestOf('with', { task: { ...task, [field]: ['changed'] } }),
        withInputs.input_sha256,
        field,
      );
    assert.throws(
      () =>
        answerInputs({
          ...base,
          arm: 'with',
          armManifest: arms.manifests.without,
        }),
      /not the with arm's/,
    );
    assert.throws(
      () =>
        answerInputs({
          ...base,
          arm: 'with2',
          armManifest: arms.manifests.with,
        }),
      /arm must be one of with, without/,
    );
    assert.throws(
      () =>
        answerInputs({
          ...base,
          subjectModel: '',
          arm: 'with',
          armManifest: arms.manifests.with,
        }),
      /subject_model is required/,
    );
    assert.throws(
      () =>
        answerInputs({
          ...base,
          skillMdSha256: undefined,
          arm: 'with',
          armManifest: arms.manifests.with,
        }),
      /skill_md_sha256 is required/,
    );
  });
});

test('assembleTasks: the fixture baseline gives one batch of tasks with exact headings and both digests', () => {
  const taskSet = assembleFixture();
  assert.equal(taskSet.skill, SKILL);
  assert.equal(taskSet.agent, 'k-developer');
  assert.equal(taskSet.rules_stale, false);
  assert.deepEqual(taskSet.skill_sections, ['Rules']);
  assert.deepEqual(taskSet.warnings, []);
  assert.equal(taskSet.batches.length, 1);
  const [batch] = taskSet.batches;
  assert.equal(batch.batch, 'b1');
  assert.equal(batch.read_b, true);
  assert.equal(batch.tasks.length, 5);
  for (const task of batch.tasks) {
    assert.equal(task.exercises_section, 'Rules');
    assert.equal(task.inputs.with.task_id, task.id);
    assert.equal(task.inputs.without.arm, 'without');
    assert.equal(task.inputs.with.task_sha256, task.task_sha256);
  }
  // Rebuilt from the same files, the digests are the same: a resumed run finds its answers current.
  assert.deepEqual(
    assembleFixture().batches[0].tasks.map((task) => task.inputs),
    batch.tasks.map((task) => task.inputs),
  );
});

test('assembleTasks: a target_section without its list number is stored as the exact heading; an unknown one is a warning', () => {
  helpers.withFixtureCopy((dir, layout) => {
    const skillMd = layout.skillMd(SKILL);
    fs.writeFileSync(
      skillMd,
      fs.readFileSync(skillMd, 'utf8').replace('## Rules', '## 1. Rules'),
    );
    const tasksFile = layout.tasksFile(SKILL, 'b1');
    helpers.update(tasksFile, (data) => {
      data.scenarios[1].target_section = 'Not a heading';
    });
    const baseline = loadBaseline(layout, SKILL);
    // The rules quote SKILL.md, whose hash changed: the skill is rules stale, which is not a problem.
    assert.deepEqual(baseline.problems, []);
    const taskSet = withArms(
      (arms) =>
        assembleTasks({
          skill: SKILL,
          baseline,
          skillMd: fs.readFileSync(skillMd, 'utf8'),
          skillMdSha256: fileSha256(skillMd),
          agent: 'k-developer',
          armManifests: arms.manifests,
          runner: forSkill(SKILL),
          subjectModel: CONFIG.models.subject,
        }),
      { layout },
    );
    const [first, second] = taskSet.batches[0].tasks;
    assert.equal(first.target_section, 'Rules');
    assert.equal(first.exercises_section, '1. Rules');
    assert.equal(second.exercises_section, null);
    assert.equal(taskSet.rules_stale, true);
    assert.equal(taskSet.batches[0].read_b, false, 'reading B waits');
    assert.deepEqual(taskSet.warnings, [
      `b1/${second.id}: target_section "Not a heading" is not a heading of SKILL.md`,
    ]);
  });
});

test('assembleTasks: a tasks-stale batch is not read by B; a bad or missing baseline lists every problem', () => {
  helpers.withFixtureCopy((dir, layout) => {
    helpers.update(layout.tasksFile(SKILL, 'b1'), (data) => {
      data.rules_sha256 = helpers.makeFakeSha256('c');
    });
    const stale = assembleFixture(layout);
    assert.equal(stale.batches[0].stale, true);
    assert.equal(stale.batches[0].read_b, false);

    helpers.update(layout.tasksFile(SKILL, 'b1'), (data) => {
      data.scenarios[0].rubric = ['short'];
      data.scenarios[1].rubric[0] = 'tiny';
    });
    assert.throws(
      () => assembleFixture(layout),
      (thrown) =>
        thrown instanceof TaskSetError &&
        thrown.skill === SKILL &&
        thrown.problems.length >= 2 &&
        /scenarios\[0\]\.rubric/.test(thrown.message) &&
        /scenarios\[1\]\.rubric\[0\]/.test(thrown.message),
    );
  });
  assert.throws(
    () =>
      assembleTasks({
        skill: 'pantry-note',
        baseline: loadBaseline(LAYOUT, 'pantry-note'),
      }),
    /pantry-note: the tasks cannot be assembled:\n {2}no baseline folder/,
  );
  assert.throws(
    () =>
      assembleTasks({
        skill: SKILL,
        baseline: loadBaseline(LAYOUT, 'pantry-note'),
      }),
    /baseline must be loadBaseline/,
  );
});

test('loadTaskSet: picks the agent from the agent specs and the profile from the settings and removes the arms unless kept', () => {
  const { taskSet, runner, arms } = loadTaskSet({
    layout: LAYOUT,
    config: CONFIG,
    skill: SKILL,
  });
  assert.equal(arms, null);
  assert.equal(
    taskSet.agent,
    'k-developer',
    'k-developer wins when several agents list the skill',
  );
  assert.equal(runner.id, CONFIG.runner_profile);
  assert.deepEqual(
    taskSet.batches[0].tasks.map((task) => task.inputs),
    assembleFixture().batches[0].tasks.map((task) => task.inputs),
  );

  const natural = helpers.exampleConfig({ runner_profile: 'natural' });
  const kept = loadTaskSet({
    layout: LAYOUT,
    config: natural,
    skill: SKILL,
    keepArms: true,
  });
  try {
    assert.ok(fs.existsSync(kept.arms.withDir));
    assert.equal(kept.arms.explicitInstruction, false);
    assert.equal(kept.taskSet.condition.condition, 'natural');
    assert.notEqual(
      kept.taskSet.batches[0].tasks[0].inputs.with.input_sha256,
      taskSet.batches[0].tasks[0].inputs.with.input_sha256,
      'another profile makes other answers',
    );
  } finally {
    removeArms(kept.arms);
  }
  assert.equal(profile('natural').loadMode, 'natural');
});

test('loadTaskSet: no agent, no baseline and a bad agent spec are refused before any arm is built', () => {
  // Building an arm in a folder that does not exist fails with ENOENT, so a refusal that comes first as the
  // error shows no arm was built.
  const noSuchFolder = path.join(LAYOUT.root, 'no-such-folder');
  const refuse = (config, skill, pattern) =>
    assert.throws(
      () =>
        loadTaskSet({ layout: LAYOUT, config, skill, tmpRoot: noSuchFolder }),
      (error) => error instanceof TaskSetError && pattern.test(error.message),
    );
  refuse(CONFIG, 'pantry-note', /no baseline folder/);
  helpers.withFixtureCopy((dir, layout) => {
    fs.rmSync(path.join(layout.agentsDir, 'k-architect.agent-spec.json'));
    helpers.update(
      path.join(layout.agentsDir, 'k-developer.agent-spec.json'),
      (spec) => {
        spec.dependencies.skills.skillNames = ['pantry-note'];
      },
    );
    assert.throws(
      () => loadTaskSet({ layout, config: CONFIG, skill: SKILL }),
      /no agent lists the skill/,
    );
    fs.writeFileSync(
      path.join(layout.agentsDir, 'k-developer.agent-spec.json'),
      '{',
    );
    assert.throws(
      () => loadTaskSet({ layout, config: CONFIG, skill: SKILL }),
      AgentSpecError,
    );
  });
});

test('arms: a skill is built with its own agent; an agent that does not declare it is refused', () => {
  withArms((arms) => {
    assert.equal(arms.agent, 'k-developer');
    assert.deepEqual(
      arms.skillNames.filter((name) => !arms.withoutNames.includes(name)),
      [SKILL],
    );
  });
  assert.throws(
    () =>
      buildArms('pantry-note', {
        skillsDir: LAYOUT.skillsDir,
        agentsDir: LAYOUT.agentsDir,
        agent: 'k-architect',
      }),
    /not declared by k-architect/,
  );
});

// Every task field but the request and the checklist, each with a value found nowhere else.
const SENTINELS = Object.freeze({
  id: 'zz-id-sentinel-7',
  title: 'ZZ-TITLE-SENTINEL',
  target_section: 'ZZ-SECTION-SENTINEL',
  why_skill_matters: 'ZZ-WHY-SENTINEL',
  exercises_section: 'ZZ-EXERCISES-SENTINEL',
  task_sha256: 'ZZ-TASK-SHA-SENTINEL',
  unlisted_future_field: 'ZZ-FUTURE-SENTINEL',
});
const BLIND_TASK = Object.freeze({
  ...SENTINELS,
  prompt: 'Walk me through logging a sharp morning sencha.',
  rubric: ['Names the water temperature.', 'Names the steep time.'],
  inputs: { with: { input_sha256: 'ZZ-INPUTS-SENTINEL' } },
});
const ALL_SENTINELS = [...Object.values(SENTINELS), 'ZZ-INPUTS-SENTINEL'];

test('blinding: the subject is given the request alone, a judge the request and the checklist alone', () => {
  assert.equal(subjectRequest(BLIND_TASK), BLIND_TASK.prompt);
  const judged = judgeRequest(BLIND_TASK);
  assert.deepEqual(Object.keys(judged).sort(), ['checklist', 'request']);
  assert.equal(judged.request, BLIND_TASK.prompt);
  assert.deepEqual(judged.checklist, BLIND_TASK.rubric);
  assert.notEqual(
    judged.checklist,
    BLIND_TASK.rubric,
    'a copy, so a judge job cannot change the task',
  );
  const everything = JSON.stringify([subjectRequest(BLIND_TASK), judged]);
  for (const sentinel of ALL_SENTINELS)
    assert.ok(!everything.includes(sentinel), `${sentinel} reached a model`);
});

test('blinding: the rendered judge prompt holds the request and the numbered checklist and no other task field', () => {
  const {
    renderJudgePrompt,
  } = require('../../../scripts/bench/lib/judge-prompt');
  const {
    createJudgeInput,
  } = require('../../../scripts/bench/lib/judge-input');
  const judgeInput = createJudgeInput();
  const prepare = (text) => judgeInput.prepare(text, { skill: SKILL });
  for (const scale of ['items', 'outcome']) {
    for (const arm of ['with', 'without']) {
      const { prompt } = renderJudgePrompt({
        scale,
        ...judgeRequest(BLIND_TASK),
        answer: prepare(arm === 'with' ? 'First body.' : 'Second body.'),
        marker: 'fixedmarker0001',
      });
      for (const sentinel of ALL_SENTINELS)
        assert.ok(
          !prompt.includes(sentinel),
          `${sentinel} reached the ${scale} judge prompt (${arm})`,
        );
      assert.ok(prompt.includes(BLIND_TASK.prompt));
      assert.ok(
        prompt.includes(
          '1. Names the water temperature.\n2. Names the steep time.',
        ),
      );
    }
  }
});

test('blinding: the arm builders take no task, so the agent prompts and plugin folders cannot depend on one', () => {
  const stripComments = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const file of [
    'arms.js',
    'claude-run.js',
    'runner.js',
    'subject-isolation.js',
  ]) {
    const code = stripComments(
      fs.readFileSync(
        path.join(__dirname, '..', '..', '..', 'scripts', 'bench', 'lib', file),
        'utf8',
      ),
    );
    assert.ok(
      !/\b(?:task|scenario)\s*(?:\.\s*[A-Za-z_]|\[)/i.test(code) &&
        !/[({,]\s*(?:task|scenario)\s*[,})=:]/i.test(code),
      `${file} reads a task`,
    );
  }
});

test('loadTaskSet: a step that throws after the arms are built leaves no arm on disk, kept or not', () => {
  helpers.withTmp((tmpRoot) => {
    // An empty subject model is refused when the answer inputs are made, which is after the arms are built.
    const broken = {
      ...CONFIG,
      models: { ...CONFIG.models, subject: '' },
    };
    for (const keepArms of [true, false]) {
      assert.throws(
        () =>
          loadTaskSet({
            layout: LAYOUT,
            config: broken,
            skill: SKILL,
            keepArms,
            tmpRoot,
          }),
        /subject_model is required/,
      );
      assert.deepEqual(
        fs.readdirSync(tmpRoot),
        [],
        `keepArms ${keepArms}: nothing is left`,
      );
    }
  });
});
