// SPDX-License-Identifier: Apache-2.0
// Tests for the offline `plan` command (scripts/bench/bench.js and lib/plan.js), run against the committed
// fixture skill in tests/fixtures/bench/ or throw-away copies of it. No network, no AWS, no run output.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { main } = require('../../../scripts/bench/bench');
const { buildPlan, renderPlan } = require('../../../scripts/bench/lib/plan');
const {
  EXAMPLE_CONFIG_FILE,
  rubricWriterModel,
} = require('../../../scripts/bench/lib/config');
const { callCost } = require('../../../scripts/bench/lib/cost-profile');
const {
  createLayout,
  LayoutError,
} = require('../../../scripts/bench/lib/layout');
const { fileSha256 } = require('../../../scripts/bench/lib/provenance');
const helpers = require('./helpers');

const SKILL = helpers.SKILL;
const ROOT = helpers.fixtureRoot();
const BENCH_JS = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'bench',
  'bench.js',
);
const GOLDEN = path.join(helpers.FIXTURE_DIR, 'plan.brew-log.expected.txt');

/** Runs the driver in-process; returns { code, out, err }. */
function run(...argv) {
  const result = { out: '', err: '' };
  result.code = main(argv, {
    out: (text) => (result.out += text),
    err: (text) => (result.err += text),
  });
  return result;
}
const planOn = (root, ...args) =>
  run('plan', '--skills', SKILL, '--root', root, ...args);
const planFor = (root, overrides, runId) =>
  buildPlan({
    layout: createLayout({ root, runId }),
    config: helpers.exampleConfig(overrides),
    skills: [SKILL],
  });
const findStage = (plan, id) => plan.stages.find((stage) => stage.id === id);
const touchFiles = (...files) =>
  files.forEach(
    (file) => (
      fs.mkdirSync(path.dirname(file), { recursive: true }),
      fs.writeFileSync(file, '{}')
    ),
  );
const buildExclusionsWithScales = (scales) =>
  helpers.edit(
    helpers.goodExclusions(),
    'batches.b1.scenarios.0.scales',
    scales,
  );

test('plan on the fixture prints the committed expected output, as text and as JSON', () => {
  // Worked out by hand, from the committed cost profile (bench/profiles/cost-observed.json), per call as mean and p90:
  // subject 0.06693 and 0.12123; judge seats anthropic 0.0478 and 0.07183, openai 0.01336 and 0.02052, xai 0.05061
  // and 0.09822 (one call per seat: 0.11177 and 0.19057); writer (the anthropic model) 0.02586 and 0.03746.
  // Each seat judges each answer on its own, so a task takes 2 judge calls per seat in each reading.
  // Stage 2: 10 subject runs + 30 judge calls: mean 0.6693 + 1.1177 = $1.787, shown as $1.79; p90 1.2123 + 1.9057 =
  // $3.118. Stage 3 (4 of 5 tasks, one is excluded): 4 writer calls + 24 judge calls: mean 0.10344 + 0.89416 = $0.9976,
  // shown as $1.00; p90 0.14984 + 1.52456 = $1.6744.
  // Together a mean of $2.7846, shown as $2.78, and a p90 of $4.7924, shown as $4.79 and checked against max_usd.
  const result = run(
    'plan',
    '--skills',
    'brew-log,pantry-note',
    '--root',
    ROOT,
  );
  assert.deepEqual(
    [result.code, result.err, result.out],
    [0, '', fs.readFileSync(GOLDEN, 'utf8')],
  );
  assert.deepEqual(
    JSON.parse(planOn(ROOT, '--json').out),
    JSON.parse(JSON.stringify(planFor(ROOT))),
  );
});

test('plan with no skills selected, or --help, shows usage and plans nothing', () => {
  const result = run('plan', '--root', ROOT);
  assert.equal(result.code, 0);
  assert.match(
    result.out,
    /^Usage: node scripts\/bench\/bench\.js plan --skills/,
  );
  assert.match(
    result.out,
    /nothing was planned and nothing was spent\.\nSkills with a baseline: brew-log/,
  );
  assert.doesNotMatch(result.out, /Stages|\$\d/);
  assert.match(run().out, /^Usage:/);
  assert.match(run('--help').out, /^Usage:/);
});

test('plan writes nothing, and its sources use no network, process or AWS module', () => {
  helpers.withFixtureCopy((dir) => {
    const before = fs.readdirSync(dir, { recursive: true }).sort();
    assert.deepEqual(
      [planOn(dir).code, planOn(dir, '--run', 'other').code],
      [0, 0],
    );
    assert.deepEqual(fs.readdirSync(dir, { recursive: true }).sort(), before);
  });
  const lib = path.join(path.dirname(BENCH_JS), 'lib');
  for (const file of [
    BENCH_JS,
    ...fs.readdirSync(lib).map((fileName) => path.join(lib, fileName)),
  ]) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      text,
      /require\(['"](node:)?(http|https|http2|net|tls|dgram|dns|child_process|worker_threads)['"]\)/,
      file,
    );
    assert.doesNotMatch(
      text,
      /\bfetch\(|XMLHttpRequest|@aws-sdk|aws-cli/,
      file,
    );
  }
});

test('stages are marked from the files on disk, per run id; an excluded task is not counted for reading A', () => {
  helpers.withFixtureCopy((dir) => {
    const layout = createLayout({ root: dir, runId: 'first' });
    const id = 'brew-log-rules-1';
    touchFiles(
      layout.answerFile(SKILL, 'b1', id, 'with'),
      layout.answerFile(SKILL, 'b1', id, 'without'),
      layout.judgmentFile('items', SKILL, 'b1', id, 'anthropic', 'with'),
    );
    touchFiles(
      layout.checklistFile(SKILL, 'b1', id),
      layout.judgmentFile('outcome', SKILL, 'b1', id, 'anthropic', 'with'),
    );
    // Present for the excluded task, but not planned for reading A, so not counted.
    touchFiles(
      layout.checklistFile(SKILL, 'b1', 'brew-log-rules-3'),
      layout.judgmentFile(
        'outcome',
        SKILL,
        'b1',
        'brew-log-rules-3',
        'xai',
        'with',
      ),
    );

    const plan = planFor(dir, undefined, 'first');
    // Pending: 8 subject runs and 29 items judgments (9 anthropic, 10 openai, 10 xai) in stage 2; 3 writer calls and
    // 23 outcome judgments (7 anthropic, 8 openai, 8 xai) in stage 3. As means:
    // stage 2: 8 x 0.06693 + 9 x 0.0478 + 10 x 0.01336 + 10 x 0.05061 = 1.60534
    // stage 3: 3 x 0.02586 + 7 x 0.0478 + 8 x 0.01336 + 8 x 0.05061 = 0.92394
    assert.deepEqual(
      [
        findStage(plan, 2).done,
        findStage(plan, 2).total,
        findStage(plan, 2).usd,
      ],
      [3, 40, 1.61],
    );
    assert.deepEqual(
      [
        findStage(plan, 3).done,
        findStage(plan, 3).total,
        findStage(plan, 3).usd,
      ],
      [2, 28, 0.92],
    );
    assert.equal(plan.pending_usd, 2.53); // 2.52928
    // As p90s: stage 2: 8 x 0.12123 + 9 x 0.07183 + 10 x 0.02052 + 10 x 0.09822 = 2.80371;
    // stage 3: 3 x 0.03746 + 7 x 0.07183 + 8 x 0.02052 + 8 x 0.09822 = 1.56511.
    assert.equal(findStage(plan, 2).usd_p90, 2.8);
    assert.equal(findStage(plan, 3).usd_p90, 1.57);
    assert.equal(plan.pending_usd_p90, 4.37); // 4.36882
    assert.equal(
      findStage(planFor(dir, undefined, 'second'), 2).done,
      0,
      'another run id has its own progress',
    );

    for (let taskNumber = 1; taskNumber <= 5; taskNumber++) {
      const task = `brew-log-rules-${taskNumber}`;
      touchFiles(
        layout.answerFile(SKILL, 'b1', task, 'with'),
        layout.answerFile(SKILL, 'b1', task, 'without'),
      );
      for (const seat of ['anthropic', 'openai', 'xai'])
        for (const arm of ['with', 'without'])
          touchFiles(
            layout.judgmentFile('items', SKILL, 'b1', task, seat, arm),
            ...(taskNumber === 3
              ? []
              : [layout.judgmentFile('outcome', SKILL, 'b1', task, seat, arm)]),
          );
      if (taskNumber !== 3) touchFiles(layout.checklistFile(SKILL, 'b1', task));
    }
    let done = planFor(dir, undefined, 'first');
    assert.deepEqual(
      [1, 2, 3, 4].map((stageId) => findStage(done, stageId).state),
      ['pending', 'done', 'done', 'pending'],
    );
    assert.equal(done.pending_usd, 0);
    assert.equal(done.pending_usd_p90, 0);
    touchFiles(layout.reportJson);
    done = planFor(dir, undefined, 'first');
    assert.deepEqual(
      [findStage(done, 1).state, findStage(done, 4).state],
      ['pending', 'done'],
    );
  });
});

test('the settings drive the plan: model prices and judge seats; each answer is judged on its own; a second batch adds its tasks', () => {
  const plan = planFor(ROOT);
  assert.deepEqual(
    [
      findStage(plan, 2).total,
      findStage(plan, 3).total,
      plan.pending_usd,
      plan.pending_usd_p90,
    ],
    [10 + 5 * 3 * 2, 4 + 4 * 3 * 2, 2.78, 4.79],
  ); // 2 judge calls per seat per task per reading; the amounts are worked out in the first test
  assert.ok(!('orders_per_pair' in plan));
  assert.throws(
    () => planFor(ROOT, { orders_per_pair: 2 }),
    /orders_per_pair: removed: each answer is scored on its own/,
  );
  // Models the cost profile has no entry for are priced at estimate_usd_per_call, with a p90 of 1.5 times it.
  const cheap = planFor(ROOT, {
    estimate_usd_per_call: { subject: 1, judge: 0, writer: 0 },
    models: {
      subject: 'no-history-subject',
      judges: { anthropic: 'no-history-judge', openai: null, xai: null },
    },
  });
  assert.deepEqual(
    [
      cheap.seats,
      findStage(cheap, 2).total,
      cheap.pending_usd,
      cheap.pending_usd_p90,
    ],
    [['anthropic'], 10 + 5 * 2, 10, 15],
  );
  // The judge seat of a model with an entry is priced from the profile, whatever estimate_usd_per_call says.
  const priced = planFor(ROOT, {
    estimate_usd_per_call: { subject: 0, judge: 0, writer: 0 },
    models: { judges: { openai: null, xai: null } },
  });
  // 10 x 0.06693 + 18 x 0.0478 + 4 x 0.02586 = 1.63314
  assert.equal(priced.pending_usd, 1.63);
  helpers.withFixtureCopy((dir, layout) => {
    helpers.write(
      layout.tasksFile(SKILL, 'b2'),
      helpers.edit(
        helpers.readJson(layout.tasksFile(SKILL, 'b1')),
        'batch',
        'b2',
      ),
    );
    helpers.write(
      layout.bucketsFile(SKILL, 'b2'),
      helpers.edit(
        helpers.readJson(layout.bucketsFile(SKILL, 'b1')),
        'batch',
        'b2',
      ),
    );
    const plan = planFor(dir);
    assert.deepEqual(
      plan.skills[0].batches.map((batchEntry) => [
        batchEntry.batch,
        batchEntry.tasks,
        batchEntry.tasks_a,
      ]),
      [
        ['b1', 5, 4],
        ['b2', 5, 5],
      ],
      'the exclusion names batch b1 only',
    );
    assert.deepEqual(
      [findStage(plan, 2).total, findStage(plan, 3).total],
      [20 + 60, 9 + 54],
    );
  });
});

const WHY = '2 declare it, k-developer preferred';
const removeAgents = (layout) =>
  fs
    .readdirSync(layout.agentsDir)
    .forEach((name) => fs.unlinkSync(path.join(layout.agentsDir, name)));
// [name, damage to a copy of the fixture, settings, expected [status, agent_why, stage 2 calls, stage 3 calls, warnings]]
const STATUSES = [
  [
    'rules stale: reading B is not planned, reading A still is',
    (layout) => fs.appendFileSync(layout.skillMd(SKILL), '\nA new line.\n'),
    {},
    ['rules stale', WHY, 10, 28, 1],
  ],
  [
    'tasks stale: reading B is not planned for the batch',
    (layout) => fs.appendFileSync(layout.rulesFile(SKILL), '\n'),
    {},
    ['tasks stale', WHY, 10, 28, 1],
  ],
  ['no agent', removeAgents, {}, ['no agent', 'no agent declares it', 0, 0, 0]],
  [
    'no exclusions file: every task is read by A, no warning',
    (layout) => fs.unlinkSync(layout.exclusionsFile),
    {},
    ['ready', WHY, 40, 35, 0],
  ],
];
for (const [name, damage, settings, expected] of STATUSES) {
  test(`plan status: ${name}`, () => {
    helpers.withFixtureCopy((dir, layout) => {
      if (damage) damage(layout);
      const plan = planFor(dir, settings);
      assert.deepEqual(
        [
          plan.skills[0].status,
          plan.skills[0].agent_why,
          findStage(plan, 2).total,
          findStage(plan, 3).total,
          plan.warnings.length,
        ],
        expected,
      );
      assert.equal(findStage(plan, 2).state, expected[2] ? 'pending' : 'n/a');
      assert.equal(
        /B waits for a baseline refresh/.test(renderPlan(plan)),
        expected[2] === 10,
      );
    });
  });
}

// A selection where no skill can be run (no baseline, no agent) has nothing to plan, so it is refused with one line.
const NOTHING_TO_RUN = [
  ['no baseline', null, {}, 'pantry-note', 'no baseline'],
  ['no agent', removeAgents, {}, SKILL, 'no agent'],
];
for (const [name, damage, settings, skill, status] of NOTHING_TO_RUN) {
  test(`a selection whose only skill is ${name} is refused with one line, and plan exits 1`, () => {
    helpers.withFixtureCopy((dir, layout) => {
      if (damage) damage(layout);
      const plan = buildPlan({
        layout: createLayout({ root: dir }),
        config: helpers.exampleConfig(settings),
        skills: [skill],
      });
      const reason = `no selected skill can be run: ${skill} (${status})`;
      assert.deepEqual([plan.ok, plan.refused], [false, [reason]]);
      assert.ok(renderPlan(plan).endsWith(`\nRefused\n  ${reason}\n`));
      // The same settings through the command line, as a settings file.
      const configFile = path.join(dir, 'settings.json');
      fs.writeFileSync(
        configFile,
        JSON.stringify(helpers.settingsWith(settings)),
      );
      const result = run(
        'plan',
        '--skills',
        skill,
        '--root',
        dir,
        '--config',
        configFile,
      );
      assert.deepEqual([result.code, result.err], [1, '']);
    });
  });
}

test('a skill that cannot be run does not refuse a selection that has a skill that can; a problem is not repeated as "nothing to run"', () => {
  // brew-log can be run, pantry-note has no baseline: the golden plan, exit 0.
  const plan = buildPlan({
    layout: createLayout({ root: ROOT }),
    config: helpers.exampleConfig(),
    skills: [SKILL, 'pantry-note'],
  });
  assert.deepEqual([plan.ok, plan.refused], [true, []]);
  // An invalid baseline is already a refusal with its own lines; no second line says nothing can be run.
  helpers.withFixtureCopy((dir, layout) => {
    fs.writeFileSync(layout.rulesFile(SKILL), BAD_JSON);
    const broken = buildPlan({
      layout: createLayout({ root: dir }),
      config: helpers.exampleConfig(),
      skills: [SKILL, 'pantry-note'],
    });
    assert.equal(broken.ok, false);
    assert.doesNotMatch(broken.refused.join('\n'), /no selected skill/);
  });
});

const agentSpec = (layout, name) =>
  path.join(layout.agentsDir, `${name}.agent-spec.json`);
const BAD_JSON = '{ "format_version": ';

test('an agent spec that cannot be parsed is a problem of the skill that needs an agent: named, refused, never a different agent', () => {
  helpers.withFixtureCopy((dir, layout) => {
    const spec = agentSpec(layout, 'k-developer');
    fs.writeFileSync(spec, '{ not json');
    const plan = planFor(dir);
    const [row] = plan.skills;
    assert.deepEqual(
      [plan.ok, row.status, row.agent],
      [false, 'invalid agent spec', null],
    );
    assert.match(
      plan.refused.join('\n'),
      /^brew-log: k-developer\.agent-spec\.json: cannot be read as JSON/,
    );
    assert.match(renderPlan(plan), /invalid agent spec/);
    assert.equal(planOn(dir).code, 1);
  });
  // The agent comes only from the agent specs, so a broken spec is always read: agent_for and needs_tools are refused.
  helpers.withFixtureCopy((dir) => {
    assert.throws(
      () => planFor(dir, { agent_for: { [SKILL]: 'k-architect' } }),
      /agent_for: removed: the agent comes from the agent specs/,
    );
    assert.throws(
      () => planFor(dir, { needs_tools: [SKILL] }),
      /needs_tools: removed: not in the MVP/,
    );
  });
});

test('an agent spec that starts with a byte order mark still declares its skills', () => {
  helpers.withFixtureCopy((dir, layout) => {
    const spec = agentSpec(layout, 'k-developer');
    fs.writeFileSync(spec, `\uFEFF${fs.readFileSync(spec, 'utf8')}`);
    const [row] = planFor(dir).skills;
    assert.deepEqual(
      [row.status, row.agent, row.agent_why],
      ['ready', 'k-developer', WHY],
    );
  });
});

test('an invalid baseline is reported with every problem of the skill, also when no agent declares it', () => {
  helpers.withFixtureCopy((dir, layout) => {
    removeAgents(layout);
    fs.writeFileSync(layout.rulesFile(SKILL), BAD_JSON);
    const plan = planFor(dir);
    const [row] = plan.skills;
    assert.deepEqual([plan.ok, row.status], [false, 'invalid baseline']);
    assert.match(
      row.problems.join('\n'),
      /rules\.json: cannot be read as JSON/,
    );
    assert.match(
      plan.refused.join('\n'),
      /brew-log: rules\.json: cannot be read as JSON/,
    );
    assert.equal(planOn(dir).code, 1);
  });
  // A broken spec and a broken baseline are both listed.
  helpers.withFixtureCopy((dir, layout) => {
    fs.writeFileSync(agentSpec(layout, 'k-developer'), '{ not json');
    fs.writeFileSync(layout.rulesFile(SKILL), BAD_JSON);
    const plan = planFor(dir);
    assert.equal(plan.skills[0].status, 'invalid baseline');
    const refused = plan.refused.join('\n');
    assert.match(refused, /rules\.json: cannot be read as JSON/);
    assert.match(
      refused,
      /k-developer\.agent-spec\.json: cannot be read as JSON/,
    );
  });
});

test('a skill with rules but no task file is not ready: the problem names the skill and the missing tasks', () => {
  helpers.withFixtureCopy((dir, layout) => {
    fs.unlinkSync(layout.tasksFile(SKILL, 'b1'));
    fs.unlinkSync(layout.bucketsFile(SKILL, 'b1'));
    const plan = planFor(dir);
    const [row] = plan.skills;
    assert.deepEqual([plan.ok, row.status], [false, 'invalid baseline']);
    assert.match(
      plan.refused.join('\n'),
      /brew-log: tasks-<batch>\.json: no task file for skill "brew-log"/,
    );
    assert.equal(planOn(dir).code, 1);
  });
});

test('the --json plan names the unrounded costs pending_usd_unrounded and pending_usd_p90_unrounded, next to the costs rounded to cents', () => {
  const plan = JSON.parse(planOn(ROOT, '--json').out);
  assert.equal(plan.pending_usd, 2.78);
  assert.ok(Math.abs(plan.pending_usd_unrounded - PROJECTED_MEAN_USD) < 1e-9);
  assert.equal(plan.pending_usd_p90, 4.79);
  assert.ok(Math.abs(plan.pending_usd_p90_unrounded - PROJECTED_USD) < 1e-9);
  assert.equal('pending_usd_exact' in plan, false);
  assert.deepEqual(
    plan.stages.map((stage) => [stage.usd, stage.usd_p90]),
    [
      [0, 0],
      [1.79, 3.12],
      [1, 1.67],
      [0, 0],
    ],
  );
});

test('plan prints the mean and the upper estimate (p90); worst_case_usd is the p90 and the limit is checked against it', () => {
  const plan = JSON.parse(planOn(ROOT, '--json').out);
  assert.equal(plan.worst_case_usd, 4.79);
  assert.equal(plan.worst_case_usd, plan.pending_usd_p90);
  const text = planOn(ROOT);
  assert.equal(text.code, 0);
  assert.match(
    text.out,
    /\nEstimated cost \(mean\) of pending work: \$2\.78\n/,
  );
  assert.match(
    text.out,
    /\nUpper estimate \(p90\) of pending work: \$4\.79 of max_usd \$30\.00: within the limit\n/,
  );
  assert.doesNotMatch(text.out, /Worst case|x 1\.5/);
  // The limit is checked against the p90, not the mean: a max_usd between the two is refused.
  const between = planOn(ROOT, '--max-usd', '3');
  assert.equal(between.code, 1);
  assert.match(
    between.out,
    /Upper estimate \(p90\) of pending work: \$4\.79 of max_usd \$3\.00: OVER the limit/,
  );
});

test('a model with no measured cost is priced at estimate_usd_per_call with one warning that names it', () => {
  const plan = planFor(ROOT, {
    models: { subject: 'no-history-subject' },
  });
  const warnings = plan.warnings.filter((warning) => /^cost:/.test(warning));
  assert.deepEqual(warnings, [
    'cost: no measured cost for subject no-history-subject; priced at estimate_usd_per_call, with a p90 of that x 1.5',
  ]);
  // 10 subject runs at 0.078125 replace 10 at the subject model's mean 0.06693 (2.7846 - 0.6693 + 0.78125); the p90
  // at 0.078125 x 1.5 (4.7924 - 1.2123 + 1.171875).
  assert.equal(plan.pending_usd_unrounded.toFixed(5), '2.89655');
  assert.equal(plan.pending_usd_p90_unrounded.toFixed(4), '4.7520');
  assert.match(
    renderPlan(plan),
    /\n {2}cost: no measured cost for subject no-history-subject;/,
  );
  // Several unpriced models are named in one warning, sorted.
  const two = planFor(ROOT, {
    models: {
      subject: 'no-history-subject',
      rubric_writer: 'no-history-writer',
    },
  });
  assert.deepEqual(
    two.warnings.filter((warning) => /^cost:/.test(warning)),
    [
      'cost: no measured cost for subject no-history-subject, writer no-history-writer; priced at estimate_usd_per_call, with a p90 of that x 1.5',
    ],
  );
  // Every model has an entry: no cost warning.
  assert.equal(
    planFor(ROOT).warnings.some((warning) => /^cost:/.test(warning)),
    false,
  );
});

test('buildPlan prices calls from the cost profile it is given: the exact entry, then the kind "*" entry', () => {
  const entry = (kind, model, mean, p90) => ({
    kind,
    model,
    mean,
    median: mean,
    p90,
  });
  const costProfile = {
    entries: [
      entry('subject', '*', 1, 2),
      entry('judge', '*', 0, 0),
      entry('writer', '*', 0, 0),
      entry('judge', 'us.anthropic.claude-opus-5-5', 0.1, 0.5),
    ],
  };
  const plan = buildPlan({
    layout: createLayout({ root: ROOT }),
    config: helpers.exampleConfig(),
    skills: [SKILL],
    costProfile,
  });
  // 10 subject runs at the "*" entry; 18 anthropic judgments at its own entry; the rest at 0.
  assert.equal(plan.pending_usd, 10 * 1 + 18 * 0.1);
  assert.equal(plan.pending_usd_p90, 10 * 2 + 18 * 0.5);
  assert.equal(
    plan.warnings.some((warning) => /^cost:/.test(warning)),
    false,
  );
});

test('a rules file with no generic rule is planned, with the guard warning', () => {
  helpers.withFixtureCopy((dir, layout) => {
    helpers.update(
      layout.rulesFile(SKILL),
      (rulesDocument) => (rulesDocument.rules[3].class = 'useful'),
    );
    helpers.update(layout.bucketsFile(SKILL, 'b1'), (bucketsDocument) => {
      bucketsDocument.rules['brew-log-r04'] = {
        class: 'useful',
        kept: true,
        bucket: 'value',
      };
      for (const items of Object.values(bucketsDocument.scenarios))
        items['4'].bucket = 'value';
    });
    const plan = planFor(dir);
    assert.ok(plan.warnings.some((warning) => /no guard data/.test(warning)));
    assert.equal(
      plan.skills[0].status,
      'tasks stale',
      'the rules file changed, so its tasks are stale',
    );
  });
});

test('an invalid baseline or exclusions file refuses the plan, names the file, and exits 1', () => {
  helpers.withFixtureCopy((dir, layout) => {
    helpers.update(
      layout.tasksFile(SKILL, 'b1'),
      (tasksDocument) => (tasksDocument.scenarios[0].rubric = ['too short']),
    );
    const result = planOn(dir);
    assert.equal(result.code, 1);
    assert.match(result.out, /invalid baseline/);
    assert.match(
      result.out,
      /Refused\n  brew-log: tasks-b1\.json: scenarios\[0\]\.rubric: needs at least 5 entries, got 1/,
    );
    assert.match(
      result.out,
      /brew-log: tasks-b1\.json: scenarios\[0\]\.rubric\[0\]: must be at least 12 characters, got 9/,
    );
    assert.equal(planFor(dir).ok, false);
  });
  helpers.withFixtureCopy((dir, layout) => {
    helpers.write(layout.exclusionsFile, buildExclusionsWithScales(['items']));
    const result = planOn(dir);
    assert.equal(result.code, 1);
    assert.match(
      result.out,
      /exclusions\.json: batches\.b1\.scenarios\[0\]\.scales: "items" \(reading B\) cannot be excluded/,
    );
  });
});

test('max_usd: a plan above it is refused (exit 1), one at or below it is not; above total_cap_usd is a settings error (64)', () => {
  const over = planOn(ROOT, '--max-usd', '4');
  assert.equal(over.code, 1);
  assert.match(over.out, /OVER the limit/);
  assert.match(
    over.out,
    /Refused\n  the plan's upper estimate \(p90\) is \$4\.79, above max_usd \$4\.00/,
  );
  assert.deepEqual(
    [planOn(ROOT, '--max-usd', '4.8').code, planOn(ROOT, '--max-usd=4.8').code],
    [0, 0],
  );
  assert.equal(
    planOn(ROOT, '--max-usd', '4.79').code,
    1,
    'the upper estimate is 4.7924, above 4.79',
  );
  // The mean (2.7846) is under a limit of 4, but the p90 is what is checked.
  assert.equal(over.code, 1);
  const tooHigh = planOn(ROOT, '--max-usd', '200');
  assert.equal(tooHigh.code, 64);
  assert.match(tooHigh.err, /need max_usd <= total_cap_usd, got 200, 100/);
  helpers.withFixtureCopy((dir, layout) => {
    helpers.write(
      layout.configFile,
      helpers.settingsWith({ total_cap_usd: 300 }),
    );
    assert.deepEqual(
      [
        planOn(dir, '--max-usd', '200').code,
        planOn(dir, '--max-usd', '500').code,
      ],
      [0, 64],
      'a config file can raise the limits',
    );
  });
  helpers.withFixtureCopy((dir, layout) => {
    // A stale settings file that still sets an old limit is a settings error that names the replacement.
    helpers.write(
      layout.configFile,
      helpers.settingsWith({ stop_usd: 300, hard_cap_usd: 400 }),
    );
    const stale = planOn(dir);
    assert.equal(stale.code, 64);
    assert.match(
      stale.err,
      /stop_usd: replaced by total_cap_usd[\s\S]*hard_cap_usd: replaced by total_cap_usd/,
    );
  });
});

// The fixture plan's upper estimate (p90) is 4.7924 USD and its mean 2.7846 USD (see the first test). A limit of 4.79
// is below the p90, but both round to $4.79, so the message must write more decimals or it reads "is $4.79, above
// max_usd $4.79".
const PROJECTED_USD = 4.7924;
const PROJECTED_MEAN_USD = 2.7846;
const readMoney = (text) => Number(text.slice(1));
const REFUSAL =
  /the plan's upper estimate \(p90\) is (\$[\d.]+), above max_usd (\$[\d.]+);/;

test('max_usd: a plan whose upper estimate is exactly the limit is allowed', () => {
  for (const argv of [
    ['--max-usd', String(PROJECTED_USD)],
    [`--max-usd=${PROJECTED_USD}`],
  ]) {
    const result = planOn(ROOT, ...argv);
    assert.equal(result.code, 0, argv.join(' '));
    assert.match(result.out, /\$4\.79 of max_usd \$4\.79: within the limit/);
    assert.doesNotMatch(result.out, /Refused|OVER/);
  }
});

test('max_usd: just below the upper estimate is refused, and the message tells the two amounts apart', () => {
  const result = planOn(ROOT, '--max-usd', '4.79239');
  assert.equal(result.code, 1);
  assert.match(
    result.out,
    /the plan's upper estimate \(p90\) is \$4\.79240, above max_usd \$4\.79239;/,
  );
  assert.match(result.out, /\$4\.79240 of max_usd \$4\.79239: OVER the limit/);
});

test('max_usd: a limit above 0 that rounds to $0.00 is shown with the decimals it needs', () => {
  const plan = planFor(ROOT, { max_usd: 0.000000001 });
  const text = renderPlan(plan);
  assert.match(text, /\| max_usd: \$0\.000000001 \|/);
  assert.match(text, /of max_usd \$0\.000000001: OVER the limit/);
  assert.match(
    text,
    /upper estimate \(p90\) is \$4\.79, above max_usd \$0\.000000001;/,
  );
  assert.doesNotMatch(text, /max_usd \$0\.00(?!0)/);
});

test('max_usd: the refusal never says "above" about two amounts that read the same', () => {
  const result = planOn(ROOT, '--max-usd', '4.79');
  assert.equal(result.code, 1);
  assert.match(
    result.out,
    /the plan's upper estimate \(p90\) is \$4\.792, above max_usd \$4\.790;/,
  );
  for (let thousandths = 4700; thousandths < 4793; thousandths += 1) {
    const limit = (thousandths / 1000).toFixed(3);
    const refusal = REFUSAL.exec(planOn(ROOT, '--max-usd', limit).out);
    assert.ok(refusal, `a limit of ${limit} refuses the plan`);
    const [projected, shownLimit] = [refusal[1], refusal[2]].map(readMoney);
    assert.ok(
      projected > shownLimit,
      `limit ${limit}: the message says ${refusal[1]} is above ${refusal[2]}`,
    );
  }
});

// A second skill with a baseline that shares the batch name b1 with the fixture skill.
const SECOND = 'pantry-note';
/** Makes `pantry-note` a valid skill with a baseline: the fixture skill's files with the name changed and the hashes redone. */
function addSecondSkill(layout, { excludeTask } = {}) {
  const renameSkill = (file) =>
    JSON.parse(fs.readFileSync(file, 'utf8').replaceAll(SKILL, SECOND));
  fs.copyFileSync(layout.skillMd(SKILL), layout.skillMd(SECOND));
  fs.mkdirSync(layout.baselineDir(SECOND), { recursive: true });
  const rules = renameSkill(layout.rulesFile(SKILL));
  rules.skill_md_sha256 = fileSha256(layout.skillMd(SECOND));
  helpers.write(layout.rulesFile(SECOND), rules);
  const tasks = renameSkill(layout.tasksFile(SKILL, 'b1'));
  tasks.rules_sha256 = fileSha256(layout.rulesFile(SECOND));
  helpers.write(layout.tasksFile(SECOND, 'b1'), tasks);
  helpers.write(
    layout.bucketsFile(SECOND, 'b1'),
    renameSkill(layout.bucketsFile(SKILL, 'b1')),
  );
  if (excludeTask)
    helpers.update(layout.exclusionsFile, (exclusionsDocument) =>
      exclusionsDocument.batches.b1.scenarios.push({
        id: `${SECOND}-rules-${excludeTask}`,
        scales: ['outcome'],
        reason: 'the request-only writer exceeded the item limit twice',
        date: '2026-01-16',
      }),
    );
}
const planTwoSkills = (root) =>
  run('plan', '--skills', `${SKILL},${SECOND}`, '--root', root);

test('exclusion warnings count a record unmatched only if no skill has that task, however many skills are planned', () => {
  helpers.withFixtureCopy((dir, layout) => {
    addSecondSkill(layout, { excludeTask: 2 });
    const both = planTwoSkills(dir);
    assert.deepEqual([both.code, both.err], [0, '']);
    const warnings = both.out
      .slice(both.out.indexOf('Warnings'))
      .trim()
      .split('\n')
      .slice(1);
    // The record of the other skill (pantry-note-rules-2) and the fixture's own (brew-log-rules-3) are both matched. Only the typo is reported, once.
    assert.deepEqual(warnings, [
      '  exclusions.json: batch b1: "brew-log-rules-9" names no task of any skill with a baseline, so it excludes nothing',
    ]);
    const plan = buildPlan({
      layout: createLayout({ root: dir }),
      config: helpers.exampleConfig(),
      skills: [SKILL, SECOND],
    });
    assert.deepEqual(
      plan.skills.map((skillRow) => [
        skillRow.skill,
        skillRow.status,
        skillRow.batches.map((batchEntry) => [
          batchEntry.batch,
          batchEntry.tasks,
          batchEntry.tasks_a,
          batchEntry.excluded,
        ]),
      ]),
      [
        [SKILL, 'ready', [['b1', 5, 4, ['brew-log-rules-3']]]],
        [SECOND, 'ready', [['b1', 5, 4, ['pantry-note-rules-2']]]],
      ],
    );
    assert.deepEqual(plan.warnings.length, 1);

    // One skill selected, the other skill's record still has a task: no warning about it.
    const one = planFor(dir);
    assert.deepEqual(one.warnings, [
      'exclusions.json: batch b1: "brew-log-rules-9" names no task of any skill with a baseline, so it excludes nothing',
    ]);
    const second = buildPlan({
      layout: createLayout({ root: dir }),
      config: helpers.exampleConfig(),
      skills: [SECOND],
    });
    assert.deepEqual(
      second.warnings,
      one.warnings,
      'the same single typo whichever skill is planned',
    );
  });
});

test('a record that matches no task in any skill is reported even when the batch has a single skill; a typo in a file for a skill that is not planned is not', () => {
  helpers.withFixtureCopy((dir, layout) => {
    helpers.update(layout.exclusionsFile, (exclusionsDocument) => {
      exclusionsDocument.batches.b1.scenarios.splice(1, 1); // drop the typo "brew-log-rules-9"
      exclusionsDocument.batches.b7 = {
        scenarios: [
          {
            id: 'nobody-rules-1',
            scales: ['outcome'],
            reason: 'a batch no planned skill has',
            date: '2026-01-16',
          },
        ],
      };
    });
    assert.deepEqual(
      planFor(dir).warnings,
      [],
      'no unmatched record in a planned batch; batch b7 belongs to no planned skill',
    );
    helpers.update(layout.exclusionsFile, (exclusionsDocument) =>
      exclusionsDocument.batches.b1.scenarios.push({
        id: 'brew-log-rules-0',
        scales: ['outcome'],
        reason: 'a task that does not exist',
        date: '2026-01-16',
      }),
    );
    assert.deepEqual(planFor(dir).warnings, [
      'exclusions.json: batch b1: "brew-log-rules-0" names no task of any skill with a baseline, so it excludes nothing',
    ]);
  });
});

// A name the layout cannot use must come out as a listed problem and exit 1, never as a stack trace.
test('a task id or batch name that cannot be a file name makes the baseline invalid, names the file, and exits 1 without a stack trace', () => {
  const runCli = (dir) =>
    spawnSync(
      process.execPath,
      [BENCH_JS, 'plan', '--skills', SKILL, '--root', dir],
      { encoding: 'utf8' },
    );
  const cases = [
    [
      'task id ../evil',
      (layout) =>
        helpers.update(
          layout.tasksFile(SKILL, 'b1'),
          (tasksDocument) => (tasksDocument.scenarios[0].id = '../evil'),
        ),
      /Refused\n  brew-log: tasks-b1\.json: scenarios\[0\]\.id: must be a task id usable in a file name/,
    ],
    [
      'batch -x in the task file',
      (layout) =>
        helpers.update(
          layout.tasksFile(SKILL, 'b1'),
          (tasksDocument) => (tasksDocument.batch = '-x'),
        ),
      /tasks-b1\.json: batch: must be lowercase letters, digits and "-", starting with a letter or digit/,
    ],
    [
      'task id ../evil in the sidecar',
      (layout) =>
        helpers.update(
          layout.bucketsFile(SKILL, 'b1'),
          (bucketsDocument) =>
            (bucketsDocument.scenarios['../evil'] =
              bucketsDocument.scenarios['brew-log-rules-1']),
        ),
      /tasks-b1\.buckets\.json: scenarios\.\.\.\/evil: key must be a task id usable in a file name/,
    ],
  ];
  for (const [name, damage, expected] of cases) {
    helpers.withFixtureCopy((dir, layout) => {
      damage(layout);
      const result = planOn(dir);
      assert.deepEqual([result.code, result.err], [1, ''], name);
      assert.match(result.out, /invalid baseline/, name);
      assert.match(result.out, expected, name);
      const child = runCli(dir);
      assert.equal(child.status, 1, `${name}: exit code`);
      assert.doesNotMatch(
        child.stderr + child.stdout,
        /\n\s+at .*\(|node:internal|Error:/,
        `${name}: no stack trace`,
      );
      assert.equal(child.stderr, '', name);
    });
  }
  // A file for a batch called "-x" is not a batch, so it is ignored instead of reaching the layout.
  helpers.withFixtureCopy((dir, layout) => {
    const before = planOn(dir);
    fs.copyFileSync(
      layout.tasksFile(SKILL, 'b1'),
      path.join(layout.baselineDir(SKILL), 'tasks--x.json'),
    );
    const result = planOn(dir);
    assert.deepEqual(
      [result.code, result.err, result.out],
      [0, '', before.out],
    );
  });
});

test('a layout error raised while planning a skill is reported for that skill, with none of its calls counted; any other error still throws', () => {
  const layout = createLayout({ root: ROOT });
  const failing = {
    ...layout,
    answerFile: () => {
      throw new LayoutError('unsafe task id for a file name: "../evil"');
    },
  };
  const plan = buildPlan({
    layout: failing,
    config: helpers.exampleConfig(),
    skills: [SKILL, 'pantry-note'],
  });
  assert.deepEqual(
    plan.skills.map((skillRow) => [skillRow.skill, skillRow.status]),
    [
      [SKILL, 'invalid baseline'],
      ['pantry-note', 'no baseline'],
    ],
  );
  assert.deepEqual(plan.refused, [
    'brew-log: unsafe task id for a file name: "../evil"',
  ]);
  assert.deepEqual(
    [
      plan.ok,
      plan.pending_usd,
      findStage(plan, 2).total,
      findStage(plan, 3).total,
      plan.skills[0].batches,
    ],
    [false, 0, 0, 0, []],
  );
  assert.match(
    renderPlan(plan),
    /invalid baseline[\s\S]*Refused\n {2}brew-log: unsafe task id/,
  );

  const broken = {
    ...layout,
    answerFile: () => {
      throw new TypeError('a bug');
    },
  };
  assert.throws(
    () =>
      buildPlan({
        layout: broken,
        config: helpers.exampleConfig(),
        skills: [SKILL],
      }),
    TypeError,
  );
});

test('plan prints the budget note: the per-call costs are measured, so budget $35 per skill', () => {
  assert.match(
    run('plan', '--skills', SKILL, '--root', ROOT).out,
    /\nThe per-call costs were measured on earlier runs and can differ on this one\. Budget about \$35 per skill\.\n/,
  );
  // The rule behind the $35: about twice the upper estimate (p90) of one skill read over two batches of 8 tasks with
  // the 3 default judge seats, rounded up to a multiple of 5.
  const config = helpers.exampleConfig();
  const p90 = (kind, model) => callCost(config, kind, model).p90;
  const judgeRound = Object.values(config.models.judges).reduce(
    (total, model) => total + p90('judge', model),
    0,
  );
  const tasks = 2 * 8;
  const oneSkill =
    tasks * 2 * p90('subject', config.models.subject) +
    tasks * 2 * 2 * judgeRound +
    tasks * p90('writer', rubricWriterModel(config));
  assert.equal(oneSkill.toFixed(2), '16.68');
  assert.equal(Math.ceil((2 * oneSkill) / 5) * 5, 35);
});

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const maxUsdError = (text) =>
  new RegExp(
    `--max-usd: must be a plain decimal number above 0 such as 2\\.5, got ${escapeRegExp(JSON.stringify(text))}`,
  );
const NOT_PLAIN_DECIMALS = [
  '0x10',
  '1e1',
  ' 5 ',
  '1_0',
  '+5',
  '-5',
  '.5',
  '5.',
  '0',
  '0.0',
  'Infinity',
  'NaN',
];

const USAGE_ERRORS = [
  [
    /unknown skill\(s\) in --skills: nope/,
    'plan',
    '--skills',
    'brew-log,nope',
    '--root',
    ROOT,
  ],
  [/--all is not available yet/, 'plan', '--all', '--root', ROOT],
  [
    /--changed-since is not available yet/,
    'plan',
    '--changed-since=main',
    '--root',
    ROOT,
  ],
  [/unknown option --frobnicate/, 'plan', '--frobnicate'],
  [/--skills needs a value/, 'plan', '--skills'],
  [/--skills needs a value/, 'plan', '--skills', '--json'],
  [
    /--skills needs at least one skill name/,
    'plan',
    '--skills',
    ' , ',
    '--root',
    ROOT,
  ],
  [/unknown command "run"/, 'run'],
  [
    /unsafe run id/,
    'plan',
    '--skills',
    SKILL,
    '--run',
    '../escape',
    '--root',
    ROOT,
  ],
  [
    /unknown skill\(s\) in --skills: \.\.\/etc/,
    'plan',
    '--skills',
    '../etc',
    '--root',
    ROOT,
  ],
  [
    /no skills\/ folder/,
    'plan',
    '--skills',
    'x',
    '--root',
    path.join(helpers.FIXTURE_DIR, 'nowhere'),
  ],
  [
    /cannot read the config file/,
    'plan',
    '--skills',
    SKILL,
    '--config',
    path.join(helpers.FIXTURE_DIR, 'absent.json'),
    '--root',
    ROOT,
  ],
  [
    /--max-usd: must be a plain decimal number above 0 such as 2\.5, got "lots"/,
    'plan',
    '--skills',
    SKILL,
    '--max-usd',
    'lots',
    '--root',
    ROOT,
  ],
  // A value on a flag that takes none must not be ignored: `--json=false` would turn JSON on.
  [/--json does not take a value/, 'plan', '--json=false', '--root', ROOT],
  [/--json does not take a value/, 'plan', '--json=', '--root', ROOT],
  [/--help does not take a value/, 'plan', '--help=anything'],
  [/-h does not take a value/, 'plan', '-h=1'],
  // `Number()` reads hex, exponents, spaces and an empty string; the limit is a plain decimal.
  ...NOT_PLAIN_DECIMALS.map((text) => [
    maxUsdError(text),
    'plan',
    '--skills',
    SKILL,
    '--max-usd',
    text,
    '--root',
    ROOT,
  ]),
  [
    /--max-usd: must be a plain decimal number above 0 such as 2\.5, got "0x10"/,
    'plan',
    '--skills',
    SKILL,
    '--max-usd=0x10',
    '--root',
    ROOT,
  ],
];
test('a --max-usd of plain digits that is too large for a number is refused', () => {
  const tooLarge = '9'.repeat(309);
  const result = planOn(ROOT, '--max-usd', tooLarge);
  assert.deepEqual([result.code, result.out], [64, '']);
  assert.match(result.err, maxUsdError(tooLarge));
});

test('--max-usd takes a plain decimal, as --max-usd N or --max-usd=N', () => {
  for (const [argv, expectedMaxUsd] of [
    [['--max-usd', '25'], 25],
    [['--max-usd', '3.5'], 3.5],
    [['--max-usd=12.25'], 12.25],
    [['--max-usd', '0.01'], 0.01],
    [['--max-usd', '007'], 7],
  ]) {
    const result = planOn(ROOT, '--json', ...argv);
    assert.equal(
      JSON.parse(result.out).max_usd,
      expectedMaxUsd,
      argv.join(' '),
    );
  }
});

test('with no --max-usd, plan --json on the fixture shows the default max_usd of 30', () => {
  const result = planOn(ROOT, '--json');
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.out).max_usd, 30);
});

test('a flag without a value does not change the output: --json=false is refused, not read as --json', () => {
  const refused = planOn(ROOT, '--json=false');
  assert.deepEqual([refused.code, refused.out], [64, '']);
  assert.equal(planOn(ROOT).out.startsWith('Skill benchmark plan'), true);
});

for (const [expected, ...argv] of USAGE_ERRORS) {
  test(`usage error exits 64: ${argv.join(' ').replace(ROOT, '<fixture>')}`, () => {
    const result = run(...argv);
    assert.deepEqual([result.code, result.out], [64, '']);
    assert.match(result.err, expected);
  });
}

test('the command line entry point exits with the same codes', () => {
  const runCli = (...args) =>
    spawnSync(process.execPath, [BENCH_JS, ...args], { encoding: 'utf8' });
  const goodRun = runCli(
    'plan',
    '--skills',
    'brew-log,pantry-note',
    '--root',
    ROOT,
  );
  assert.deepEqual(
    [goodRun.status, goodRun.stdout],
    [0, fs.readFileSync(GOLDEN, 'utf8')],
  );
  assert.equal(runCli('plan', '--skills', 'nope', '--root', ROOT).status, 64);
  assert.equal(
    runCli('plan', '--skills', SKILL, '--root', ROOT, '--max-usd', '1').status,
    1,
  );
  assert.match(runCli('--help').stdout, /^Usage:/);
});

// SKILL.md is hashed by its bytes, and a rules file records that hash. A checkout that rewrites its line endings to
// CRLF would make every baseline of the skill read as stale, so git must keep it LF whatever the user's settings.
test('.gitattributes keeps every skills/*/SKILL.md at LF, so the hash in a rules file does not depend on the checkout', () => {
  helpers.withTmp((dir) => {
    const git = (...args) =>
      spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(git('init', '-q').status, 0);
    fs.copyFileSync(
      path.join(__dirname, '..', '..', '..', '.gitattributes'),
      path.join(dir, '.gitattributes'),
    );
    fs.mkdirSync(path.join(dir, 'skills', 'x'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'skills', 'x', 'SKILL.md'),
      '# Skill\r\nA line.\r\n',
    );
    assert.equal(git('add', '-A').status, 0);
    const stored = git('show', ':skills/x/SKILL.md').stdout;
    assert.equal(stored, '# Skill\nA line.\n');
    assert.match(
      git('check-attr', 'eol', '--', 'skills/x/SKILL.md').stdout,
      /eol: lf/,
    );
  });
});

test('package.json names the driver script skill-bench, and no script is called bench', () => {
  const { scripts } = helpers.readJson(
    path.join(__dirname, '..', '..', '..', 'package.json'),
  );
  assert.equal(scripts['skill-bench'], 'node scripts/bench/bench.js');
  assert.equal('bench' in scripts, false);
  assert.ok(
    fs.existsSync(
      path.join(__dirname, '..', '..', '..', 'scripts', 'bench', 'bench.js'),
    ),
  );
});

test('plan with no bench/config.json is a usage error that names its full path and gives the cp command, and plans nothing', () => {
  helpers.withFixtureCopy((dir, layout) => {
    fs.rmSync(layout.configFile);
    const result = planOn(dir);
    const looked = path.resolve(layout.configFile);
    assert.deepEqual(
      [result.code, result.out, result.err],
      [
        64,
        '',
        `error: ${looked} not found: run cp '${EXAMPLE_CONFIG_FILE}' '${looked}', then edit it\nRun with --help for usage.\n`,
      ],
    );
    // An explicit --config is enough on its own.
    const settings = path.join(dir, 'settings.json');
    helpers.write(settings, helpers.settingsWith());
    assert.equal(planOn(dir, '--config', settings).code, 0);
  });
});
