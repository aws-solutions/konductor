// SPDX-License-Identifier: Apache-2.0
// Tests for the controls check (scripts/bench/lib/controls.js and its wiring): the control skill and the dose ladder
// are found where the layout puts them, are selected with --skills, and run through the same driver as a skill.
// convention-control runs every job of a skill; the dose ladder has no subject runs and no reading B, only its
// request-only checklists and reading A. `report` evaluates both controls, and a control whose judgments are not
// current is NOT RUN, never a pass. Every run is on a copy of the fixture repository with the stub provider: no
// model, AWS or network call is made.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const bench = require('../../../scripts/bench/bench');
const job = require('../../../scripts/bench/job');
const { knownTaskIds } = require('../../../scripts/bench/lib/baseline');
const {
  DOSE_LADDER,
  selectedLadder,
  splitSelection,
} = require('../../../scripts/bench/lib/controls');
const {
  LadderError,
  judgingSets,
} = require('../../../scripts/bench/lib/dose-ladder');
const { runChecklists } = require('../../../scripts/bench/lib/checklist-job');
const { createJudgeInput } = require('../../../scripts/bench/lib/judge-input');
const {
  planJudging,
  runJudging,
} = require('../../../scripts/bench/lib/judge-job');
const { loadConfig } = require('../../../scripts/bench/lib/config');
const {
  ARMS,
  CONTROL_SKILLS,
  REPO_ROOT,
  createLayout,
} = require('../../../scripts/bench/lib/layout');
const { resolveJobRequest } = require('../../../scripts/bench/lib/launch');
const { removeArms } = require('../../../scripts/bench/lib/arms');
const { nextStep } = require('../../../scripts/bench/lib/next');
const { buildPlan } = require('../../../scripts/bench/lib/plan');
const {
  listControlSkills,
  listStrayControlFolders,
  resolveAgent,
} = require('../../../scripts/bench/lib/skills');
const { stubLayout } = require('../../../scripts/bench/lib/stub-provider');
const {
  TaskSetError,
  loadTaskSet,
} = require('../../../scripts/bench/lib/tasks');
const helpers = require('./helpers');

const CONVENTION = 'convention-control';
const SMALL_LADDER = path.join(
  helpers.FIXTURE_DIR,
  'dose-ladder',
  'ladder-small.json',
);
const ITEMS = ['fixture-d0', 'fixture-d1', 'fixture-d2', 'fixture-d4'];
const SEATS = 3;

const capture = () => {
  const io = { text: '', errors: '' };
  io.out = (text) => {
    io.text += text;
  };
  io.err = (text) => {
    io.errors += text;
  };
  return io;
};

/**
 * A copy of the fixture root with the controls in place: the committed convention-control files and, as the dose
 * ladder, the small test ladder (2 tasks), so a stub run stays short.
 */
function controlRoot(dir) {
  const root = path.join(dir, 'repo');
  fs.cpSync(helpers.fixtureRoot(), root, { recursive: true });
  const layout = createLayout({ root });
  const real = createLayout({ root: REPO_ROOT });
  fs.cpSync(real.skillDir(CONVENTION), layout.skillDir(CONVENTION), {
    recursive: true,
  });
  fs.cpSync(real.baselineDir(CONVENTION), layout.baselineDir(CONVENTION), {
    recursive: true,
  });
  fs.copyFileSync(SMALL_LADDER, layout.ladderFile);
  return root;
}

/** Runs `next` and returns { code, result }. */
async function next(args) {
  const io = capture();
  const code = await bench.main(['next', ...args], io, {});
  assert.equal(io.errors, '', io.errors);
  return { code, result: JSON.parse(io.text) };
}

/** `next` and the job it names, in this process, until `next` says done. Returns the job commands in order. */
async function runToDone(args) {
  const commands = [];
  for (let round = 0; round < 10; round += 1) {
    const { result } = await next(args);
    if (result.next === 'done') return { commands, done: result };
    assert.equal(result.next, 'job', JSON.stringify(result));
    commands.push(result.command.slice(2));
    const io = capture();
    const code = await job.main(result.command.slice(2), io);
    assert.equal(code, 0, io.text + io.errors);
  }
  throw new Error('the loop did not end within 10 rounds');
}

/** Runs `report` (with the --max-usd of `args` left out: report spends nothing) and returns its line and report.json. */
function report(args, layout) {
  const io = capture();
  const reportArgs = args.filter(
    (arg, index) => arg !== '--max-usd' && args[index - 1] !== '--max-usd',
  );
  const code = bench.main(['report', ...reportArgs], io, {}, { now: () => 0 });
  assert.equal(code, 0, io.errors);
  return {
    line: JSON.parse(io.text),
    summary: helpers.readJson(layout.reportJson),
  };
}

const stubArgs = (root, skills, run) => [
  '--skills',
  skills,
  '--run',
  run,
  '--root',
  root,
  '--max-usd',
  '25',
  '--provider',
  'stub',
];

// ---- where the controls live -----------------------------------------------------------------------------------------

test('layout: a control skill and its baseline are under scripts/bench/, every other skill is where it was', () => {
  const root = path.join(path.sep, 'checkout');
  const layout = createLayout({ root });
  assert.deepEqual(CONTROL_SKILLS, [CONVENTION]);
  assert.equal(
    layout.skillMd(CONVENTION),
    path.join(root, 'scripts', 'bench', 'skills', CONVENTION, 'SKILL.md'),
  );
  assert.equal(
    layout.rulesFile(CONVENTION),
    path.join(root, 'scripts', 'bench', 'controls', CONVENTION, 'rules.json'),
  );
  assert.equal(
    layout.tasksFile(CONVENTION, CONVENTION),
    path.join(
      root,
      'scripts',
      'bench',
      'controls',
      CONVENTION,
      `tasks-${CONVENTION}.json`,
    ),
  );
  assert.equal(
    layout.ladderFile,
    path.join(root, 'scripts', 'bench', 'controls', 'dose-ladder-v1.json'),
  );
  assert.equal(
    layout.controlSkillsDir,
    path.join(root, 'scripts', 'bench', 'skills'),
  );
  assert.equal(
    layout.skillMd('brew-log'),
    path.join(root, 'skills', 'brew-log', 'SKILL.md'),
  );
  assert.equal(
    layout.rulesFile('brew-log'),
    path.join(root, 'bench', 'baselines', 'brew-log', 'rules.json'),
  );
});

test('agent: a control skill always runs under its fixed agent', () => {
  const agentsDir = path.join(helpers.fixtureRoot(), 'agents');
  assert.deepEqual(resolveAgent(CONVENTION, { agentsDir }), {
    agent: 'k-developer',
    why: 'control skill',
  });
  // resolveAgent reads only the agent specs: an agentFor option does not move a control off its agent.
  assert.deepEqual(
    resolveAgent(CONVENTION, {
      agentsDir,
      agentFor: { [CONVENTION]: 'k-architect' },
    }),
    { agent: 'k-developer', why: 'control skill' },
  );
  assert.equal(resolveAgent('no-such-skill', { agentsDir }).agent, null);
});

test('plan: the committed convention-control baseline is ready in this checkout', () => {
  const layout = createLayout({ root: REPO_ROOT });
  // bench/config.json is git-ignored, so a checkout has none: plan with the committed example settings.
  const config = helpers.exampleConfig();
  const plan = buildPlan({ layout, config, skills: [CONVENTION] });
  assert.deepEqual(plan.refused, []);
  assert.equal(plan.skills[0].status, 'ready');
  assert.equal(plan.skills[0].agent, 'k-developer');
});

test('exclusions: a control batch counts as known, so a record for it is matched, not a warning', () =>
  helpers.withTmp((dir) => {
    const layout = createLayout({ root: controlRoot(dir) });
    const known = knownTaskIds(layout);
    assert.ok(known.has(CONVENTION));
    assert.equal(known.get(CONVENTION).size, 8);
    assert.ok(known.has('b1'), 'the skill baselines are still read');
    // A folder in bench/baselines/ with a control's name is not read: the layout points that name at the control.
    fs.mkdirSync(path.join(layout.baselinesDir, CONVENTION));
    assert.equal(knownTaskIds(layout).get(CONVENTION).size, 8);
  }));

// ---- selection ---------------------------------------------------------------------------------------------------------

test('selection: dose-ladder is split off the skills, and the ladder must pass its audit', () =>
  helpers.withTmp((dir) => {
    assert.deepEqual(splitSelection(['a', DOSE_LADDER, CONVENTION]), {
      skills: ['a', CONVENTION],
      ladder: true,
    });
    assert.deepEqual(splitSelection(['a']), { skills: ['a'], ladder: false });
    const layout = createLayout({ root: controlRoot(dir) });
    const { items, file } = selectedLadder(layout);
    assert.deepEqual(items, ITEMS);
    assert.equal(file, layout.ladderFile);
    helpers.update(layout.ladderFile, (ladder) => {
      ladder.tasks[0].defects[0].find = 'text that is not in the answer';
    });
    assert.throws(() => selectedLadder(layout), LadderError);
    helpers.write(layout.ladderFile, '{ not json');
    assert.throws(() => selectedLadder(layout), /cannot be read/);
  }));

test('driver: the controls are known names, plan refuses the ladder, and a missing or broken ladder is a usage error', () =>
  helpers.withTmp((dir) => {
    const root = controlRoot(dir);
    const layout = createLayout({ root });
    const run = (...args) => {
      const io = capture();
      return { code: bench.main(args, io, {}), io };
    };
    assert.equal(run('plan', '--skills', CONVENTION, '--root', root).code, 0);
    const refused = run('plan', '--skills', DOSE_LADDER, '--root', root);
    assert.equal(refused.code, bench.EX_USAGE);
    assert.match(
      refused.io.errors,
      /dose-ladder is a control of next and report/,
    );
    // The listing of skills with a baseline (the future --all) never shows a control.
    const listing = run('plan', '--root', root);
    assert.equal(listing.code, 0);
    assert.match(listing.io.text, /Skills with a baseline: brew-log\n/);

    helpers.update(layout.ladderFile, (ladder) => {
      ladder.tasks[0].defects[0].find = 'text that is not in the answer';
    });
    const broken = run('report', '--skills', DOSE_LADDER, '--root', root);
    assert.equal(broken.code, bench.EX_USAGE);
    assert.match(broken.io.errors, /--skills dose-ladder: .*fails its audit/);
    fs.rmSync(layout.ladderFile);
    const missing = run('report', '--skills', DOSE_LADDER, '--root', root);
    assert.equal(missing.code, bench.EX_USAGE);
    assert.match(
      missing.io.errors,
      /unknown skill\(s\) in --skills: dose-ladder/,
    );
  }));

test('launch: a judge job takes --ladder, and a control skill is a known name for every job', () =>
  helpers.withTmp((dir) => {
    const root = controlRoot(dir);
    const layout = createLayout({ root });
    const judge = resolveJobRequest('judge', {
      skills: 'fixture-d0,fixture-d4',
      root,
      scale: 'outcome',
      ladder: layout.ladderFile,
    });
    assert.deepEqual(judge.skills, ['fixture-d0', 'fixture-d4']);
    assert.equal(judge.ladderFile, layout.ladderFile);
    assert.equal(
      resolveJobRequest('pairs', { skills: CONVENTION, root }).skills[0],
      CONVENTION,
    );
    assert.throws(
      () => resolveJobRequest('pairs', { skills: 'fixture-d0', root }),
      /unknown skill\(s\) in --skills: fixture-d0/,
    );
    assert.throws(
      () =>
        resolveJobRequest('pairs', {
          skills: 'fixture-d0',
          root,
          ladder: layout.ladderFile,
        }),
      /--ladder is not an option of the pairs job/,
    );
  }));

// ---- the dose ladder through the judge job and next -------------------------------------------------------------------

test('judge planning: a ladder item has reading A jobs only, with its authored answers, waiting for its checklist', () =>
  helpers.withTmp((dir) => {
    const layout = createLayout({ root: controlRoot(dir) });
    const config = loadConfig({ defaultFile: layout.configFile });
    const { ladder } = selectedLadder(layout);
    const plan = (scale) =>
      planJudging({
        layout,
        config,
        skills: ITEMS,
        scale,
        judgeInput: createJudgeInput(),
        ladder,
      });
    assert.equal(plan('items').jobs.length, 0, 'no reading B for the ladder');
    const { jobs } = plan('outcome');
    // One job per item, task, seat and arm: each authored answer is judged on its own.
    assert.equal(
      jobs.length,
      ITEMS.length * ladder.tasks.length * SEATS * ARMS.length,
    );
    for (const judgeJob of jobs) {
      assert.equal(judgeJob.batch, ladder.set);
      assert.equal(judgeJob.state, 'waiting');
      assert.match(judgeJob.reason, /request-only checklist is missing/);
    }
  }));

test('next: the ladder alone starts at the checklists, with its items and --ladder; a skill keeps its own steps', () =>
  helpers.withTmpAsync(async (dir) => {
    const root = controlRoot(dir);
    const layout = createLayout({ root });
    const ladderOnly = await next(stubArgs(root, DOSE_LADDER, 'stub-controls'));
    assert.equal(ladderOnly.result.next, 'job');
    assert.equal(ladderOnly.result.job, 'checklists');
    assert.deepEqual(ladderOnly.result.skills, [DOSE_LADDER]);
    const command = ladderOnly.result.command;
    assert.equal(command[command.indexOf('--skills') + 1], ITEMS.join(','));
    assert.equal(command[command.indexOf('--ladder') + 1], layout.ladderFile);
    // The doses share their tasks, so the writer is called once per task and the other doses get copies.
    assert.equal(ladderOnly.result.pending, 2);

    const mixed = await next(
      stubArgs(root, `brew-log,${DOSE_LADDER}`, 'stub-controls'),
    );
    assert.equal(mixed.result.job, 'pairs');
    const pairsCommand = mixed.result.command;
    assert.equal(
      pairsCommand[pairsCommand.indexOf('--skills') + 1],
      'brew-log',
    );
    assert.ok(!pairsCommand.includes('--ladder'));
  }));

test('next: ladder work whose upper estimate does not fit max_usd or total_cap_usd is a spend stop, not a job', () =>
  helpers.withTmpAsync(async (dir) => {
    const root = controlRoot(dir);
    const layout = createLayout({ root, runId: 'stub-ladder-spend' });
    const ladderArgs = (maxUsd) =>
      stubArgs(root, DOSE_LADDER, 'stub-ladder-spend').map((arg, index, all) =>
        all[index - 1] === '--max-usd' ? maxUsd : arg,
      );
    const stopOf = async (args) => {
      const io = capture();
      const code = await bench.main(['next', ...args], io, {});
      return { code, result: JSON.parse(io.text) };
    };

    // `plan` does not price the ladder, so without this check `next` would name the checklist job and the job would refuse.
    const overMax = await stopOf(ladderArgs('0.0001'));
    assert.equal(overMax.code, 1);
    assert.equal(overMax.result.next, 'stop');
    assert.equal(overMax.result.kind, 'spend');
    assert.match(
      overMax.result.reason,
      /the next job \(checklists, 2 call\(s\)\) has an upper estimate \(p90\) of USD \d+\.\d\d; on top of USD 0\.00 already spent or reserved in run stub-ladder-spend that comes to USD \d+\.\d+, above max_usd 0\.0001/,
    );

    // Another run holds all but a cent of total_cap_usd in the stub run's own ledger (a stub run reads its limits
    // there): the ladder's next job does not fit on top of it.
    const config = loadConfig({ defaultFile: layout.configFile });
    const otherUsd = config.total_cap_usd - 0.0001;
    helpers.writeLedger(stubLayout(layout).ledgerFile, [
      {
        type: 'reserve',
        id: 'other1',
        ts: '2026-11-12T09:00:00.000Z',
        run: 'other',
        label: 'subject other',
        usd: otherUsd,
        expires: '2026-11-12T09:12:00.000Z',
      },
      {
        type: 'settle',
        id: 'other1',
        ts: '2026-11-12T09:01:00.000Z',
        run: 'other',
        label: 'subject other',
        usd: otherUsd,
        status: 'ok',
        model: 'claude-sonnet-5-5',
        cost_source: 'reported',
      },
    ]);
    const overCap = await stopOf(ladderArgs('25'));
    assert.equal(overCap.code, 1);
    assert.equal(overCap.result.kind, 'spend');
    assert.match(overCap.result.reason, /above total_cap_usd/);
  }));

test('next: the committed dose ladder is accepted by the checklist job, one writer call per task', () =>
  helpers.withTmpAsync(async (dir) => {
    const root = controlRoot(dir);
    const layout = createLayout({ root });
    // The committed ladder, not the small test one: the checklist job must take every one of its tasks.
    fs.copyFileSync(
      createLayout({ root: REPO_ROOT }).ladderFile,
      layout.ladderFile,
    );
    const { ladder } = selectedLadder(layout);
    const { result } = await next(
      stubArgs(root, DOSE_LADDER, 'stub-committed-ladder'),
    );
    assert.equal(result.next, 'job', JSON.stringify(result));
    assert.equal(result.job, 'checklists');
    assert.equal(result.pending, ladder.tasks.length);
  }));

test('stubbed run of the dose ladder: checklists, reading A, and a report that evaluates the ladder; a changed ladder is NOT RUN', () =>
  helpers.withTmpAsync(async (dir) => {
    const root = controlRoot(dir);
    const run = 'stub-ladder';
    const layout = createLayout({ root, runId: run });
    const args = stubArgs(root, DOSE_LADDER, run);
    const { commands, done } = await runToDone(args);
    assert.equal(done.status, 'done');
    assert.deepEqual(
      commands.map((command) => command[0]),
      ['checklists', 'judge'],
    );
    assert.equal(commands[1][commands[1].indexOf('--scale') + 1], 'outcome');
    assert.equal(
      fs.existsSync(path.join(layout.runDir, 'answers')),
      false,
      'no subject run: the answers are authored',
    );

    const first = report(args, layout);
    const ladderControl = first.summary.controls.ladder;
    assert.ok(ladderControl, 'the report has the ladder control');
    // The stub judge scores both authored answers alike, so the gap is flat and the rule fails: a verdict, not NOT RUN.
    assert.equal(ladderControl.status, 'FAIL');
    assert.deepEqual(ladderControl.missing, []);
    assert.equal(first.line.controls_status, 'FAIL');
    assert.equal(first.line.labels_published, false);
    assert.deepEqual(first.summary.skills, []);

    // Each arm is judged with the ladder's own authored answer for that arm: with the defects in `with` and the
    // baseline in `without`, so every dose above D0 compares two different answers.
    const authored = judgingSets(selectedLadder(layout).ladder, ITEMS);
    const { jobs } = planJudging({
      layout,
      config: loadConfig({ defaultFile: layout.configFile }),
      skills: ITEMS,
      scale: 'outcome',
      judgeInput: createJudgeInput(),
      ladder: selectedLadder(layout).ladder,
    });
    assert.equal(jobs.length, ITEMS.length * 2 * SEATS * ARMS.length);
    const answerOf = new Map();
    for (const judgeJob of jobs) {
      assert.equal(judgeJob.state, 'done', judgeJob.reason);
      assert.equal(
        judgeJob.answer.answer_sha256,
        authored.answer(judgeJob.skill, judgeJob.task.id, judgeJob.arm)
          .answer_sha256,
        `${judgeJob.skill} ${judgeJob.task.id} ${judgeJob.arm}`,
      );
      answerOf.set(
        `${judgeJob.skill} ${judgeJob.task.id} ${judgeJob.seat} ${judgeJob.arm}`,
        judgeJob.answer.answer_sha256,
      );
    }
    // D0 carries the paraphrase, the other doses the defects: no dose gives both arms the same answer.
    for (const judgeJob of jobs.filter((entry) => entry.arm === 'with'))
      assert.notEqual(
        answerOf.get(
          `${judgeJob.skill} ${judgeJob.task.id} ${judgeJob.seat} with`,
        ),
        answerOf.get(
          `${judgeJob.skill} ${judgeJob.task.id} ${judgeJob.seat} without`,
        ),
        `${judgeJob.skill} ${judgeJob.task.id}: the arms carry different answers`,
      );

    // A changed answer changes its digest, so the judgments of that dose are no longer current: they do not count.
    helpers.update(layout.ladderFile, (ladder) => {
      ladder.tasks[0].paraphrase[0].replace += ' ';
    });
    const changed = report(args, layout);
    assert.equal(changed.summary.controls.ladder.status, 'NOT RUN');
    assert.match(changed.summary.controls.ladder.missing.join(' '), /D0/);
  }));

test('stubbed run of convention-control: every job of a skill runs, and the report reads it as a control, not a label', () =>
  helpers.withTmpAsync(async (dir) => {
    const root = controlRoot(dir);
    const run = 'stub-convention';
    const layout = createLayout({ root, runId: run });
    const args = stubArgs(root, CONVENTION, run);
    const { commands, done } = await runToDone(args);
    assert.equal(done.status, 'done');
    assert.deepEqual(
      commands.map((command) =>
        command.includes('--scale')
          ? `${command[0]} ${command[command.indexOf('--scale') + 1]}`
          : command[0],
      ),
      ['pairs', 'judge items', 'checklists', 'judge outcome'],
    );
    const { line, summary } = report(args, layout);
    assert.deepEqual(summary.skills, [], 'a control is never labeled');
    assert.deepEqual(line.labels, {});
    const convention = summary.controls[CONVENTION];
    assert.ok(convention, 'the report has the convention-control control');
    assert.notEqual(convention.status, 'NOT RUN');
    assert.deepEqual(convention.missing, []);
  }));

// ---- the spend check of `next` for ladder work -------------------------------------------------------------------------

test('next: the ladder spend check counts run and ledger reservations, allows the ledger tolerance and refuses an unreadable ledger', () =>
  helpers.withTmpAsync(async (dir) => {
    const root = controlRoot(dir);
    const run = 'stub-ladder-limits';
    const layout = createLayout({ root, runId: run });
    const ledgerFile = stubLayout(layout).ledgerFile;
    const config = loadConfig({ defaultFile: layout.configFile });
    const { ladder } = selectedLadder(layout);
    // The p90 of the checklist job `next` names for the ladder, unrounded: the figure the check compares.
    const dry = await runChecklists({
      layout,
      config,
      skills: ITEMS,
      ladder,
      dryRun: true,
      log: () => {},
    });
    const usd = dry.projected_usd;
    assert.ok(usd > 0.001, `the checklist job has a cost, got ${usd}`);

    const decimal = (value) => value.toFixed(12);
    const answer = async (maxUsd) => {
      const args = stubArgs(root, DOSE_LADDER, run).map((arg, index, all) =>
        all[index - 1] === '--max-usd' ? decimal(maxUsd) : arg,
      );
      const io = capture();
      const code = await bench.main(['next', ...args], io, {});
      return { code, result: JSON.parse(io.text) };
    };
    const reservation = (id, forRun, amount) => ({
      type: 'reserve',
      id,
      ts: '2026-11-12T09:00:00.000Z',
      run: forRun,
      label: `subject ${id}`,
      usd: amount,
      // Far ahead of any clock, so the reservation is live.
      expires: '2099-01-01T00:00:00.000Z',
    });

    // Over max_usd by 1e-10 is within the ledger's tolerance, so the job is named; over by 1e-4 is a stop that
    // prints enough decimals to show the total is above the limit.
    const within = await answer(usd - 1e-10);
    assert.equal(within.result.next, 'job', JSON.stringify(within.result));
    const over = await answer(usd - 1e-4);
    assert.equal(over.code, 1);
    assert.equal(over.result.kind, 'spend');
    const shown = /comes to USD ([\d.]+), above max_usd ([\d.]+)/.exec(
      over.result.reason,
    );
    assert.ok(shown, over.result.reason);
    assert.ok(Number(shown[1]) > Number(shown[2]), over.result.reason);

    // A live reservation of this run counts toward max_usd.
    helpers.writeLedger(ledgerFile, [reservation('mine1', run, 0.5)]);
    const heldByRun = await answer(usd + 0.4);
    assert.equal(heldByRun.result.kind, 'spend');
    assert.match(
      heldByRun.result.reason,
      /on top of USD 0\.50 already spent or reserved in run stub-ladder-limits/,
    );
    assert.equal((await answer(usd + 0.6)).result.next, 'job');

    // A live reservation of another run counts toward total_cap_usd, and the same tolerance applies.
    helpers.writeLedger(ledgerFile, [
      reservation('other1', 'other', config.total_cap_usd - usd + 1e-10),
    ]);
    assert.equal((await answer(25)).result.next, 'job');
    helpers.writeLedger(ledgerFile, [
      reservation('other1', 'other', config.total_cap_usd - usd + 1e-4),
    ]);
    const heldByOther = await answer(25);
    assert.equal(heldByOther.result.kind, 'spend');
    assert.match(heldByOther.result.reason, /above total_cap_usd/);

    // An unreadable ledger is a refusal, not a job.
    fs.writeFileSync(ledgerFile, 'not json\nnot json\n');
    const unreadable = await answer(25);
    assert.equal(unreadable.code, 1);
    assert.equal(unreadable.result.kind, 'refused');
    assert.match(unreadable.result.reason, /corrupt ledger line 1/);
  }));

test('next: a ladder that fails its audit is a refused stop when nextStep is called directly', () =>
  helpers.withTmpAsync(async (dir) => {
    const root = controlRoot(dir);
    const layout = createLayout({ root, runId: 'stub-ladder-audit' });
    helpers.update(layout.ladderFile, (ladder) => {
      ladder.tasks[0].defects[0].find = 'text that is not in the answer';
    });
    const result = await nextStep({
      layout: stubLayout(layout),
      config: loadConfig({ defaultFile: layout.configFile }),
      skills: [DOSE_LADDER],
      provider: 'stub',
      maxUsdText: '25',
    });
    assert.equal(result.next, 'stop');
    assert.equal(result.kind, 'refused');
    assert.match(result.reason, /the dose ladder .* fails its audit/);
  }));

test('judge job: a ladder that fails its audit is refused before any job is planned', () =>
  helpers.withTmpAsync(async (dir) => {
    const layout = createLayout({
      root: controlRoot(dir),
      runId: 'stub-ladder-judge-audit',
    });
    const { ladder } = selectedLadder(layout);
    const config = loadConfig({ defaultFile: layout.configFile });
    const run = (candidate) =>
      runJudging({
        layout,
        config,
        skills: ITEMS,
        scale: 'outcome',
        ladder: candidate,
        dryRun: true,
        log: () => {},
      });
    // The audit forbids words that tell a judge about the harness; one in a baseline answer fails it.
    const leaking = structuredClone(ladder);
    leaking.tasks[0].base_answer +=
      ' This benchmark skill guidance is mentioned.';
    const refused = await run(leaking);
    assert.equal(refused.status, 'refused');
    assert.equal(refused.jobs, 0);
    assert.match(refused.refused.join(' '), /the dose ladder fails its audit/);
    // The unchanged ladder is planned.
    const planned = await run(ladder);
    assert.notEqual(planned.status, 'refused', planned.refused.join(' '));
    assert.ok(planned.jobs > 0);
  }));

test('judge job: a malformed exclusions file refuses a run of ladder items alone, with no job planned', () =>
  helpers.withTmpAsync(async (dir) => {
    const layout = createLayout({
      root: controlRoot(dir),
      runId: 'stub-ladder-judge-exclusions',
    });
    const { ladder } = selectedLadder(layout);
    const config = loadConfig({ defaultFile: layout.configFile });
    const run = (skills) =>
      runJudging({
        layout,
        config,
        skills,
        scale: 'outcome',
        ladder,
        dryRun: true,
        log: () => {},
      });
    for (const content of [
      '{"format_version": 1, "batches": ',
      JSON.stringify({
        format_version: 1,
        batches: { b1: { scenarios: [{ id: 'x' }] } },
      }),
    ]) {
      fs.writeFileSync(layout.exclusionsFile, content);
      const refused = await run(ITEMS);
      assert.equal(refused.status, 'refused');
      assert.equal(refused.jobs, 0);
      assert.equal(refused.refused.length, 1);
      assert.ok(
        refused.refused[0].startsWith(
          `${layout.exclusionsFile}: not a valid exclusions file`,
        ),
        refused.refused[0],
      );
    }
    // A file that cannot be read at all is not a format problem and still throws.
    fs.rmSync(layout.exclusionsFile);
    fs.mkdirSync(layout.exclusionsFile);
    await assert.rejects(run(ITEMS), (error) => error.code === 'EISDIR');
  }));

// ---- the control skills folder ------------------------------------------------------------------------------------------

test('task assembly: the arms use the control skill of the root they are built for, not the running checkout', () =>
  helpers.withTmp((dir) => {
    const root = controlRoot(dir);
    const layout = createLayout({ root });
    const config = loadConfig({ defaultFile: layout.configFile });
    const edited = `${fs.readFileSync(layout.skillMd(CONVENTION), 'utf8')}\nThis root's own line.\n`;
    fs.writeFileSync(layout.skillMd(CONVENTION), edited);
    const real = fs.readFileSync(
      createLayout({ root: REPO_ROOT }).skillMd(CONVENTION),
      'utf8',
    );
    assert.notEqual(edited, real);
    const { arms } = loadTaskSet({
      layout,
      config,
      skill: CONVENTION,
      keepArms: true,
      tmpRoot: dir,
    });
    try {
      assert.equal(
        fs.readFileSync(
          path.join(arms.withDir, 'skills', CONVENTION, 'SKILL.md'),
          'utf8',
        ),
        edited,
      );
    } finally {
      removeArms(arms);
    }
  }));

test('control skills folder: a folder that is not on the fixed list is refused, whatever skill is assembled', () =>
  helpers.withTmp((dir) => {
    const root = controlRoot(dir);
    const layout = createLayout({ root });
    const config = loadConfig({ defaultFile: layout.configFile });
    assert.deepEqual(listStrayControlFolders(layout.controlSkillsDir), []);
    assert.deepEqual(
      listStrayControlFolders(path.join(dir, 'no-such-folder')),
      [],
    );
    // A folder with a real skill's name would otherwise be installed in place of skills/brew-log/SKILL.md.
    const planted = path.join(layout.controlSkillsDir, 'brew-log');
    fs.mkdirSync(planted);
    fs.writeFileSync(path.join(planted, 'SKILL.md'), 'PLANTED CONTENT\n');
    // A folder without a SKILL.md is not a skill and is not listed.
    fs.mkdirSync(path.join(layout.controlSkillsDir, 'notes'));
    assert.deepEqual(listStrayControlFolders(layout.controlSkillsDir), [
      'brew-log',
    ]);
    for (const skill of ['brew-log', CONVENTION])
      assert.throws(
        () => loadTaskSet({ layout, config, skill, tmpRoot: dir }),
        (error) =>
          error instanceof TaskSetError &&
          /holds brew-log, which is not a control skill/.test(error.message),
      );
    assert.deepEqual(
      fs.readdirSync(dir).filter((name) => name.includes('arms')),
      [],
      'no arms are left on disk',
    );
    // Two strays are listed sorted whatever order they were made in, and the message is in the plural.
    const second = path.join(layout.controlSkillsDir, 'aaa-skill');
    fs.mkdirSync(second);
    fs.writeFileSync(path.join(second, 'SKILL.md'), 'PLANTED CONTENT\n');
    assert.deepEqual(listStrayControlFolders(layout.controlSkillsDir), [
      'aaa-skill',
      'brew-log',
    ]);
    assert.throws(
      () => loadTaskSet({ layout, config, skill: CONVENTION, tmpRoot: dir }),
      (error) =>
        error instanceof TaskSetError &&
        /holds aaa-skill, brew-log, which are not a control skill.*install them in place/.test(
          error.message,
        ),
    );
  }));

test('control skills: a root without the control files lists none, and --skills convention-control is unknown there', () =>
  helpers.withTmp((dir) => {
    const bare = createLayout({ root: helpers.fixtureRoot() });
    assert.deepEqual(listControlSkills(bare), []);
    const equipped = createLayout({ root: controlRoot(dir) });
    assert.deepEqual(listControlSkills(equipped), [CONVENTION]);
    const io = capture();
    const code = bench.main(
      ['plan', '--skills', CONVENTION, '--root', helpers.fixtureRoot()],
      io,
      {},
    );
    assert.equal(code, bench.EX_USAGE);
    assert.match(
      io.errors,
      /unknown skill\(s\) in --skills: convention-control/,
    );
  }));
