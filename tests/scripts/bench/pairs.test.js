// SPDX-License-Identifier: Apache-2.0
// Tests for the pairs job (scripts/bench/lib/pairs.js). No model and no AWS call: the process runner is a stub that
// answers like Claude Code, the credentials are made-up strings, and everything is written to a copy of the fixture
// repo in a temp folder.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pairs = require('../../../scripts/bench/lib/pairs');
const {
  SCRATCH_PREFIX: ARMS_PREFIX,
} = require('../../../scripts/bench/lib/arms');
const {
  CredentialError,
} = require('../../../scripts/bench/lib/aws-credentials');
const {
  NEVER_LOADED_PROBLEM,
  userMessage,
  SecurityStopError,
  runProblems,
  runSubjectTask,
} = require('../../../scripts/bench/lib/claude-run');
const { callCost } = require('../../../scripts/bench/lib/cost-profile');
const { createLayout } = require('../../../scripts/bench/lib/layout');
const {
  LedgerError,
  readLedger,
  SpendStopError,
} = require('../../../scripts/bench/lib/ledger');
const { fileSha256, sha256 } = require('../../../scripts/bench/lib/provenance');
const { buildPlan } = require('../../../scripts/bench/lib/plan');
const { forSkill } = require('../../../scripts/bench/lib/runner');
const { loadTaskSet } = require('../../../scripts/bench/lib/tasks');
const helpers = require('./helpers');

const {
  runPairs,
  answerCurrent,
  supersede,
  readSkillsVersion,
  writeRecord,
  setupProblemsOf,
  moneyPair,
  WRONG_MODEL_PROBLEM,
  SUPERSEDED_MARK,
} = pairs;

const SKILL = helpers.SKILL;
const CONFIG = helpers.exampleConfig();
const MODEL = CONFIG.models.subject;
const CLI_VERSION = '9.9.9-fixture';
const CREDENTIALS = Object.freeze({
  accessKeyId: 'ASIA' + 'EXAMPLEFIXTURE11',
  secretAccessKey: 'fixture-secret-' + 'pairs-job',
  sessionToken: 'fixture-session-' + 'pairs-job',
  expiration: null,
});
const mode = (file) => fs.statSync(file).mode & 0o777;
const event = (value) => JSON.stringify(value);

/** A Claude Code trace: init, an optional Skill call and its result, the answer and the result event. */
function subjectTrace({
  skill = `bench:${SKILL}`,
  models = [MODEL],
  tools = ['Skill'],
  text = 'Water at 80 C, two minutes.',
  cost = 0.001,
} = {}) {
  const lines = [
    event({
      type: 'system',
      subtype: 'init',
      tools,
      claude_code_version: CLI_VERSION,
    }),
  ];
  if (skill)
    lines.push(
      event({
        type: 'assistant',
        message: {
          model: MODEL,
          content: [
            {
              type: 'tool_use',
              id: 'toolu_skill',
              name: 'Skill',
              input: { skill },
            },
          ],
        },
      }),
      event({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_skill',
              is_error: false,
              content: 'loaded',
            },
          ],
        },
      }),
    );
  lines.push(
    event({
      type: 'assistant',
      message: { model: MODEL, content: [{ type: 'text', text }] },
    }),
    event({
      type: 'result',
      result: text,
      is_error: false,
      usage: { input_tokens: 1000, output_tokens: 200 },
      total_cost_usd: cost,
      modelUsage: Object.fromEntries(models.map((name) => [name, {}])),
    }),
  );
  return `${lines.join('\n')}\n`;
}

/** The arm of one stub call, from the plugin folder Claude Code was given. */
const armOf = (args) => path.basename(args[args.indexOf('--plugin-dir') + 1]);
/** The request the stub was sent, from the stream-json user message on stdin. */
const requestOf = (options) =>
  JSON.parse(options.stdin).message.content[0].text;

/** Default stub answer: the with arm loads the skill, the without arm does not, each answer names its request. */
const answerFor = ({ arm, request }) => ({
  stdout: subjectTrace({
    skill: arm === 'with' ? `bench:${SKILL}` : null,
    text: `${arm} answer to ${sha256(request).slice(0, 8)}`,
  }),
});

/** A stub for proc.run that records each call and answers with respond({ arm, request, args, options }). */
function stubRun(respond = answerFor) {
  const calls = [];
  let live = 0;
  let maxLive = 0;
  const run = async (command, args, options) => {
    live += 1;
    maxLive = Math.max(maxLive, live);
    const call = {
      command,
      args,
      options,
      arm: armOf(args),
      request: requestOf(options),
    };
    calls.push(call);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      return {
        code: 0,
        stdout: '',
        stderr: '',
        ms: 5,
        timedOut: false,
        overflow: false,
        ...(await respond(call)),
      };
    } finally {
      live -= 1;
    }
  };
  return { run, calls, maxLive: () => maxLive };
}

/**
 * Runs callback({ dir, layout, tmpRoot, options }) on a copy of the fixture repo. `options(extra)` gives runPairs
 * options with test defaults: the stub process runner, made-up credentials, no retry pause and a fixed skills version.
 */
async function withRepo(callback) {
  return helpers.withTmpAsync(async (dir) => {
    const root = path.join(dir, 'repo');
    fs.cpSync(helpers.fixtureRoot(), root, { recursive: true });
    const layout = createLayout({ root });
    const tmpRoot = path.join(dir, 'tmp');
    const userHome = path.join(dir, 'user-home');
    for (const folder of [tmpRoot, userHome])
      fs.mkdirSync(folder, { mode: 0o700 });
    const options = ({
      run,
      config = CONFIG,
      subject = {},
      ...extra
    } = {}) => ({
      layout,
      config,
      skills: [SKILL],
      skillsVersion: 'fixture-commit',
      armsTmpRoot: tmpRoot,
      subject: {
        run,
        getCredentials: async () => CREDENTIALS,
        tmpRoot,
        userHome,
        repoRoot: root,
        sleep: async () => {},
        retryBaseMs: 0,
        ...subject,
      },
      ...extra,
    });
    return callback({ dir, layout, tmpRoot, options });
  });
}

/** The answer record the default stub must leave for one task and arm, field by field (`ms` is the stub's 5). */
const expectedAnswer = ({ task, arm, runner, rawSha256 }) => {
  const withArm = arm === 'with';
  const text = `${arm} answer to ${sha256(task.prompt).slice(0, 8)}`;
  return {
    kind: 'answer',
    skill: SKILL,
    batch: 'b1',
    task_id: task.id,
    arm,
    status: 'ok',
    valid: true,
    condition: 'explicit',
    load_mode: 'explicit',
    runner: runner.info,
    arm_blinding_version: 1,
    agent: 'k-developer',
    skill_present: withArm,
    load_instruction: withArm,
    inputs: task.inputs[arm],
    answer_sha256: sha256(text),
    raw_sha256: rawSha256,
    text,
    problems: [],
    tries: [
      { ok: true, valid: true, problems: [], error: null, rejected: null },
    ],
    ms: 5,
    expected_model: MODEL,
    models_used: [MODEL],
    model_ok: true,
    tools_reported: ['Skill'],
    skill_load: {
      loaded: withArm,
      attempts: withArm
        ? [{ name: `bench:${SKILL}`, status: 'completed' }]
        : [],
      otherSkillLoads: [],
    },
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_tokens: null,
      cache_write_tokens: null,
    },
    est_usd: 0.06693,
    reported_usd: 0.001,
    tool_call_count: withArm ? 1 : 0,
    tool_errors: 0,
    permission_denials: [],
    sweep_warning: '',
    error: null,
    skills_version: 'fixture-commit',
    claude_code_version: CLI_VERSION,
  };
};

const answerFiles = (layout) => {
  const folder = path.join(layout.runDir, 'answers', SKILL, 'b1');
  return fs.existsSync(folder) ? fs.readdirSync(folder).sort() : [];
};
const armsLeft = (tmpRoot) =>
  fs.readdirSync(tmpRoot).filter((name) => name.startsWith(ARMS_PREFIX));

test('runPairs: writes a current answer per task and arm to the run folder, and a rerun has nothing to do', async () => {
  await withRepo(async ({ layout, tmpRoot, options }) => {
    const stub = stubRun();
    const lines = [];
    const summary = await runPairs(
      options({ run: stub.run, log: (line) => lines.push(line) }),
    );
    assert.equal(summary.status, 'done', JSON.stringify(summary));
    assert.equal(summary.jobs, 10);
    assert.equal(summary.pending, 10);
    assert.equal(stub.calls.length, 10);
    assert.deepEqual(
      summary.results.map((entry) => entry.status),
      Array(10).fill('ok'),
    );
    for (const entry of summary.results)
      assert.deepEqual(
        Object.keys(entry).sort(),
        ['arm', 'batch', 'skill', 'status', 'task_id'],
        'no internal field is left in a result',
      );
    assert.deepEqual(
      armsLeft(tmpRoot),
      [],
      'the arms are removed after the job',
    );
    for (const call of stub.calls)
      assert.ok(
        path
          .resolve(call.args[call.args.indexOf('--plugin-dir') + 1])
          .startsWith(path.resolve(tmpRoot) + path.sep),
        'the arms are built under armsTmpRoot',
      );
    const ledgerRows = fs
      .readFileSync(layout.ledgerFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.ok(layout.runId && ledgerRows.length > 0);
    assert.ok(
      ledgerRows.every((row) => row.run === layout.runId),
      'every ledger row carries the run id of the layout',
    );

    const { taskSet, runner } = loadTaskSet({
      layout,
      config: CONFIG,
      skill: SKILL,
    });
    for (const task of taskSet.batches[0].tasks) {
      for (const arm of ['with', 'without']) {
        const file = layout.answerFile(SKILL, 'b1', task.id, arm);
        assert.equal(mode(file), 0o600);
        assert.equal(mode(path.dirname(file)), 0o700);
        const record = helpers.readJson(file);
        const rawLog = path.join(
          layout.subjectRunDir(SKILL, 'b1', task.id, arm),
          'raw.jsonl',
        );
        assert.deepEqual(
          record,
          expectedAnswer({
            task,
            arm,
            runner,
            rawSha256: fileSha256(rawLog),
          }),
          `${task.id}:${arm}: every field of the stored record`,
        );
        assert.equal(record.kind, 'answer');
        assert.equal(record.status, 'ok');
        assert.equal(record.valid, true);
        assert.deepEqual(record.inputs, task.inputs[arm]);
        assert.equal(
          record.text,
          `${arm} answer to ${sha256(task.prompt).slice(0, 8)}`,
        );
        assert.equal(record.answer_sha256, sha256(record.text));
        assert.equal(record.skill_present, arm === 'with');
        assert.equal(record.load_instruction, arm === 'with');
        assert.equal(record.skill_load.loaded, arm === 'with');
        assert.equal(record.model_ok, true);
        assert.equal(record.condition, 'explicit');
        assert.equal(record.agent, 'k-developer');
        assert.equal(record.skills_version, 'fixture-commit');
        assert.equal(record.claude_code_version, CLI_VERSION);
        assert.equal(record.expected_model, MODEL);
        // The estimate stored with an answer is the subject model's mean in the cost profile.
        assert.equal(record.est_usd, 0.06693);
        assert.ok(
          record.raw_sha256 && /^[0-9a-f]{64}$/.test(record.raw_sha256),
        );
        assert.ok(answerCurrent(file, task.inputs[arm]));
        const rawFile = path.join(
          layout.subjectRunDir(SKILL, 'b1', task.id, arm),
          'raw.jsonl',
        );
        assert.equal(mode(rawFile), 0o600);
        assert.equal(mode(path.dirname(rawFile)), 0o700);
      }
    }
    assert.ok(
      lines[0].startsWith(
        'pairs: skills brew-log; subject runs 0/10 current, 10 to run',
      ),
    );
    // The ledger holds one settled call per run and no live reservation.
    const ledger = readLedger(layout.ledgerFile);
    assert.equal(ledger.reserved, 0);
    assert.ok(ledger.total > 0);
    // Every run reported its cost, so the summary counts no estimated call.
    assert.equal(summary.estimated, null);
    assert.ok(!lines.some((line) => line.includes('charged at the estimate')));

    const again = await runPairs(options({ run: stub.run }));
    assert.equal(again.status, 'done');
    assert.equal(again.jobs, 10, 'jobs counts every run, current or not');
    assert.equal(again.pending, 0);
    assert.equal(
      stub.calls.length,
      10,
      'a current answer is never answered again',
    );
  });
});

test('runPairs: the summary counts the runs charged at the estimate, per model, and logs them', async () => {
  await withRepo(async ({ layout, options }) => {
    // The without arm's runs report no cost, so the ledger charges their reservation.
    const stub = stubRun((call) =>
      call.arm === 'with'
        ? answerFor(call)
        : {
            stdout: subjectTrace({
              skill: null,
              text: `without answer to ${sha256(call.request).slice(0, 8)}`,
              cost: null,
            }),
          },
    );
    const lines = [];
    const summary = await runPairs(
      options({ run: stub.run, log: (line) => lines.push(line) }),
    );
    assert.equal(summary.status, 'done', JSON.stringify(summary));
    assert.deepEqual(summary.estimated, { calls: 5, models: { [MODEL]: 5 } });
    assert.ok(
      lines.includes(
        `pairs: 5 call(s) charged at the estimate because the CLI reported no usable cost: ${MODEL} 5`,
      ),
      lines.join('\n'),
    );
    assert.equal(readLedger(layout.ledgerFile).estimated.calls, 5);
  });
});

test('runPairs: the first run goes alone, then at most subject_concurrency run at once', async () => {
  await withRepo(async ({ options }) => {
    const order = [];
    const stub = stubRun(async (call) => {
      order.push(`start ${call.arm}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end ${call.arm}`);
      return answerFor(call);
    });
    const config = helpers.exampleConfig({ subject_concurrency: 2 });
    const summary = await runPairs(options({ run: stub.run, config }));
    assert.equal(summary.status, 'done');
    assert.equal(stub.maxLive(), 2);
    assert.deepEqual(
      order.slice(0, 2),
      ['start with', 'end with'],
      'nothing starts before the first run ends',
    );
    const serial = await withRepo(async (fresh) => {
      const one = stubRun();
      await runPairs(
        fresh.options({
          run: one.run,
          config: helpers.exampleConfig({ subject_concurrency: 1 }),
        }),
      );
      return one.maxLive();
    });
    assert.equal(serial, 1);
  });
});

test('runPairs: a stale answer is superseded and answered again; the old answer and log are kept', async () => {
  await withRepo(async ({ layout, options }) => {
    await runPairs(options({ run: stubRun().run }));
    const natural = helpers.exampleConfig({ runner_profile: 'natural' });
    const stub = stubRun();
    const summary = await runPairs(
      options({
        run: stub.run,
        config: natural,
        subject: { now: () => Date.parse('2026-02-01T00:00:00Z') },
      }),
    );
    assert.equal(summary.status, 'done');
    assert.equal(
      summary.pending,
      10,
      'another runner profile makes every answer stale',
    );
    assert.equal(stub.calls.length, 10);
    const files = answerFiles(layout);
    assert.equal(files.filter((name) => name.endsWith('.json')).length, 10);
    assert.equal(
      files.filter((name) =>
        name.includes(`.json${SUPERSEDED_MARK}2026-02-01T00-00-00-000Z`),
      ).length,
      10,
    );
    const { taskSet } = loadTaskSet({ layout, config: natural, skill: SKILL });
    const task = taskSet.batches[0].tasks[0];
    const record = helpers.readJson(
      layout.answerFile(SKILL, 'b1', task.id, 'with'),
    );
    assert.equal(record.condition, 'natural');
    assert.equal(record.load_instruction, false);
    assert.deepEqual(record.inputs, task.inputs.with);
    const runFolder = fs.readdirSync(
      layout.subjectRunDir(SKILL, 'b1', task.id, 'with'),
    );
    assert.ok(runFolder.includes('raw.jsonl'));
    assert.ok(
      runFolder.some((name) => name.startsWith('raw.jsonl.superseded-')),
      runFolder.join(', '),
    );
  });
});

// ---- answers that are out of date are priced before the run -------------------------------------------------------------

/** The settings with the natural runner profile (every stored legacy answer is out of date) and these limits. */
const naturalWith = (limits = {}) =>
  helpers.exampleConfig({ runner_profile: 'natural', ...limits });
const SUBJECT_P90 = callCost(CONFIG, 'subject', MODEL).p90;
/** What this run has spent or reserved in the ledger. */
const runSpend = (layout) => {
  const run = readLedger(layout.ledgerFile).runs.get(layout.runId);
  return run ? run.spent + run.reserved : 0;
};
/** The upper estimate plan gives, which counts an answer as done when its file exists. */
const planP90 = (layout, config) =>
  buildPlan({ layout, config, skills: [SKILL] }).pending_usd_p90_unrounded;
/** The files of the run folder with their text, to show that a refused job changed none. */
const runFolderState = (layout) => {
  const state = {};
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file);
      else
        state[path.relative(layout.runDir, file)] = fs.readFileSync(
          file,
          'utf8',
        );
    }
  };
  walk(layout.runDir);
  return state;
};

test('runPairs: plan counts an answer file as done, so the runs of out-of-date answers are priced before the job and refused above max_usd', async () => {
  await withRepo(async ({ layout, tmpRoot, options }) => {
    await runPairs(options({ run: stubRun().run }));
    const spent = runSpend(layout);
    assert.ok(spent > 0);
    const reach = spent + (planP90(layout, naturalWith()) + 10 * SUBJECT_P90);
    // Another runner profile makes all 10 answers out of date. Plan sees 10 files and prices no subject run.
    const plan = buildPlan({ layout, config: naturalWith(), skills: [SKILL] });
    const rules = plan.stages.find((stage) => stage.id === 2);
    assert.equal(rules.calls.subject.done, 10);
    // A limit a cent under what the 10 reruns need: plan passes it, the job does not.
    const tight = naturalWith({ max_usd: reach - 0.01 });
    assert.equal(
      buildPlan({ layout, config: tight, skills: [SKILL] }).ok,
      true,
    );
    const before = runFolderState(layout);
    const ledgerBefore = fs.readFileSync(layout.ledgerFile, 'utf8');
    for (const dryRun of [false, true]) {
      const stub = stubRun();
      const lines = [];
      const refused = await runPairs(
        options({
          run: stub.run,
          config: tight,
          dryRun,
          log: (line) => lines.push(line),
        }),
      );
      assert.equal(refused.status, 'refused', JSON.stringify(refused));
      assert.equal(refused.refused.length, 1);
      assert.match(
        refused.refused[0],
        /^10 stored answer\(s\) are out of date and will be run again, and plan counts them as done; adding their upper estimate \(p90\) of \$\d+\.\d\d to the plan's figure, this run would reach \$\d+\.\d\d \(it has spent or reserved \$\d+\.\d\d already\), above max_usd \$\d+\.\d\d; raise max_usd \(it cannot pass total_cap_usd \$100\.00\), or select fewer skills$/,
      );
      assert.deepEqual([refused.jobs, refused.pending], [10, 10]);
      assert.ok(
        lines.some((line) =>
          line.includes(
            '10 of the 10 runs replace an answer that is out of date',
          ),
        ),
        lines.join('\n'),
      );
      assert.equal(stub.calls.length, 0);
      assert.deepEqual(armsLeft(tmpRoot), []);
    }
    assert.deepEqual(
      runFolderState(layout),
      before,
      'nothing was set aside or written',
    );
    assert.equal(fs.readFileSync(layout.ledgerFile, 'utf8'), ledgerBefore);
    // A limit that is exactly what the reruns need is allowed, as the ledger allows a call that reaches its limit.
    const stub = stubRun();
    const done = await runPairs(
      options({ run: stub.run, config: naturalWith({ max_usd: reach }) }),
    );
    assert.equal(done.status, 'done', JSON.stringify(done));
    assert.equal(stub.calls.length, 10);
  });
});

test("runPairs: only an answer that exists and is out of date adds to the figure: an edit of the skill counts the with answers, an unreadable file counts, a missing one is plan's own", async () => {
  await withRepo(async ({ layout, options }) => {
    await runPairs(options({ run: stubRun().run }));
    const spent = runSpend(layout);
    // An edit of the skill makes the 5 answers of the with arm out of date; the without arm never has the skill.
    fs.appendFileSync(
      layout.skillMd(SKILL),
      '\nA new section changes the skill.\n',
    );
    const config = helpers.exampleConfig();
    const reach = (stale) =>
      spent + (planP90(layout, config) + stale * SUBJECT_P90);
    const dryRunAt = async (maxUsd) => {
      const stub = stubRun();
      const summary = await runPairs(
        options({
          run: stub.run,
          config: helpers.exampleConfig({ max_usd: maxUsd }),
          dryRun: true,
        }),
      );
      assert.equal(stub.calls.length, 0);
      return summary;
    };
    const five = await dryRunAt(reach(5) - 0.01);
    assert.equal(five.status, 'refused', JSON.stringify(five));
    assert.match(five.refused[0], /^5 stored answer\(s\) are out of date/);
    // 5 reruns fit where 6 would not: the count is the answers that are out of date, not all answers.
    const fits = await dryRunAt(reach(5));
    assert.equal(fits.status, 'dry-run');
    assert.equal(fits.pending, 5);
    // An answer file that cannot be read is out of date too.
    const { taskSet } = loadTaskSet({ layout, config, skill: SKILL });
    const task = taskSet.batches[0].tasks[0];
    const file = layout.answerFile(SKILL, 'b1', task.id, 'without');
    fs.writeFileSync(file, 'not json');
    const six = await dryRunAt(reach(6) - 0.01);
    assert.equal(six.status, 'refused', JSON.stringify(six));
    assert.match(six.refused[0], /^6 stored answer\(s\) are out of date/);
    // A missing file is a run plan already prices itself, so it adds nothing here.
    fs.rmSync(file);
    const missing = await dryRunAt(reach(5));
    assert.equal(missing.status, 'dry-run');
    assert.equal(missing.pending, 6);
  });
});

test('runPairs: a fresh run has no answer to replace, so no line mentions an out-of-date answer', async () => {
  await withRepo(async ({ options }) => {
    const lines = [];
    const summary = await runPairs(
      options({ run: stubRun().run, log: (line) => lines.push(line) }),
    );
    assert.equal(summary.status, 'done');
    assert.ok(
      !lines.some((line) => line.includes('out of date')),
      lines.join('\n'),
    );
  });
});

test('runPairs: the reruns of out-of-date answers are held to total_cap_usd as the ledger holds a call, and both limits can refuse at once', async () => {
  await withRepo(async ({ layout, options }) => {
    await runPairs(options({ run: stubRun().run }));
    // Spend of another run: it counts against the ledger and not against this run.
    fs.appendFileSync(
      layout.ledgerFile,
      `${JSON.stringify({ type: 'settle', id: 'old-1', ts: '2026-01-15T09:00:00Z', run: 'old', usd: 60 })}\n`,
    );
    const state = readLedger(layout.ledgerFile);
    const ledgerUsd = state.total + state.reserved;
    const needed = planP90(layout, naturalWith()) + 10 * SUBJECT_P90;
    const capAt = (cap) => naturalWith({ max_usd: 30, total_cap_usd: cap });
    const tight = capAt(ledgerUsd + needed - 0.01);
    assert.equal(
      buildPlan({ layout, config: tight, skills: [SKILL] }).ok,
      true,
    );
    const stub = stubRun();
    const refused = await runPairs(options({ run: stub.run, config: tight }));
    assert.equal(refused.status, 'refused', JSON.stringify(refused));
    assert.equal(refused.refused.length, 1);
    assert.match(
      refused.refused[0],
      /^10 stored answer\(s\) are out of date and will be run again, and plan counts them as done; adding their upper estimate \(p90\) of \$\d+\.\d\d to the plan's figure, the ledger would reach \$\d+\.\d\d \(it holds \$60\.\d\d spent and \$0\.00 reserved\), above total_cap_usd \$\d+\.\d\d; raise total_cap_usd in bench\/config\.json, or move the ledger file aside to start a new count$/,
    );
    assert.equal(stub.calls.length, 0);
    // Both limits refuse when each is a cent under what the reruns need.
    const both = naturalWith({
      max_usd: runSpend(layout) + needed - 0.01,
      total_cap_usd: ledgerUsd + needed - 0.01,
    });
    const bothRefused = await runPairs(
      options({ run: stub.run, config: both }),
    );
    assert.equal(bothRefused.status, 'refused', JSON.stringify(bothRefused));
    assert.equal(bothRefused.refused.length, 2);
    assert.match(bothRefused.refused[0], /above max_usd/);
    assert.match(bothRefused.refused[1], /above total_cap_usd/);
    // A cap that is exactly what the reruns need is allowed.
    const done = await runPairs(
      options({ run: stub.run, config: capAt(ledgerUsd + needed) }),
    );
    assert.equal(done.status, 'done', JSON.stringify(done));
    assert.equal(stub.calls.length, 10);
  });
});

test("runPairs: live reservations count: this run's against max_usd, every run's against total_cap_usd", async () => {
  await withRepo(async ({ layout, options }) => {
    await runPairs(options({ run: stubRun().run }));
    const reserve = (id, run, usd) =>
      `${JSON.stringify({ type: 'reserve', id, ts: '2026-01-15T09:00:00Z', run, usd, expires: '2999-01-01T00:00:00Z' })}\n`;
    // A call of this run in flight (3 USD) and a call of another run in flight (4 USD).
    fs.appendFileSync(layout.ledgerFile, reserve('mine', layout.runId, 3));
    fs.appendFileSync(layout.ledgerFile, reserve('other', 'elsewhere', 4));
    const state = readLedger(layout.ledgerFile);
    assert.equal(state.reserved, 7);
    const needed = planP90(layout, naturalWith()) + 10 * SUBJECT_P90;
    const stub = stubRun();
    // This run has spent or reserved its own 3 USD of reservations, not the other run's.
    const mine = await runPairs(
      options({
        run: stub.run,
        config: naturalWith({ max_usd: runSpend(layout) + needed - 0.01 }),
      }),
    );
    assert.equal(mine.status, 'refused', JSON.stringify(mine));
    assert.match(mine.refused[0], /above max_usd/);
    assert.ok(
      mine.refused[0].includes(
        `(it has spent or reserved $${runSpend(layout).toFixed(2)} already)`,
      ),
      mine.refused[0],
    );
    assert.equal(runSpend(layout) - state.runs.get(layout.runId).spent, 3);
    // The ledger as a whole holds both reservations.
    const ledgerUsd = state.total + state.reserved;
    const cap = await runPairs(
      options({
        run: stub.run,
        config: naturalWith({
          max_usd: ledgerUsd + needed - 0.01,
          total_cap_usd: ledgerUsd + needed - 0.01,
        }),
      }),
    );
    assert.equal(cap.status, 'refused', JSON.stringify(cap));
    assert.match(cap.refused[0], /above total_cap_usd/);
    assert.ok(cap.refused[0].includes('and $7.00 reserved)'), cap.refused[0]);
    assert.equal(stub.calls.length, 0);
  });
});

test('moneyPair: cents, or four decimals when cents would show two different amounts as equal', () => {
  assert.deepEqual(moneyPair(3, 2.5), ['3.00', '2.50']);
  assert.deepEqual(moneyPair(2.5201, 2.5199), ['2.5201', '2.5199']);
  assert.deepEqual(moneyPair(2.52, 2.52), ['2.5200', '2.5200']);
});

test('runPairs: three invalid tries store the task as not loaded with no text; a rerun leaves it alone', async () => {
  await withRepo(async ({ layout, options }) => {
    const stub = stubRun((call) => ({
      stdout: subjectTrace({ skill: null, text: `${call.arm} text` }),
    }));
    const summary = await runPairs(options({ run: stub.run }));
    assert.equal(summary.status, 'partial');
    assert.equal(
      stub.calls.length,
      5 * 3 + 5,
      'three tries per with run, one per without run',
    );
    const statuses = Object.fromEntries(
      summary.results.map((entry) => [
        `${entry.task_id}:${entry.arm}`,
        entry.status,
      ]),
    );
    const { taskSet } = loadTaskSet({ layout, config: CONFIG, skill: SKILL });
    for (const task of taskSet.batches[0].tasks) {
      assert.equal(statuses[`${task.id}:with`], 'not_loaded');
      assert.equal(statuses[`${task.id}:without`], 'ok');
      const record = helpers.readJson(
        layout.answerFile(SKILL, 'b1', task.id, 'with'),
      );
      assert.equal(record.status, 'not_loaded');
      assert.equal(record.valid, false);
      assert.equal(record.text, null);
      assert.equal(record.answer_sha256, null);
      assert.equal(record.raw_sha256, null);
      assert.equal(record.tries.length, 3);
      assert.match(record.problems.join(' '), /never loaded the skill/);
      const rejected = fs
        .readdirSync(layout.subjectRunDir(SKILL, 'b1', task.id, 'with'))
        .filter((name) => name.startsWith('raw.jsonl.rejected-'));
      assert.equal(rejected.length, 3, 'every rejected log is kept');
    }
    const again = await runPairs(options({ run: stub.run }));
    assert.equal(again.pending, 0);
    assert.equal(stub.calls.length, 20);
  });
});

test('runPairs: a failed run writes nothing and is tried again on the next run', async () => {
  await withRepo(async ({ layout, options }) => {
    const { taskSet } = loadTaskSet({ layout, config: CONFIG, skill: SKILL });
    const failing = taskSet.batches[0].tasks[2];
    let broken = true;
    const stub = stubRun((call) =>
      broken && call.request === failing.prompt && call.arm === 'without'
        ? { code: 1, stdout: '', stderr: 'boom: connection reset' }
        : answerFor(call),
    );
    const summary = await runPairs(options({ run: stub.run }));
    assert.equal(summary.status, 'partial');
    const failed = summary.results.filter((entry) => entry.status === 'failed');
    assert.deepEqual(
      failed.map((entry) => `${entry.task_id}:${entry.arm}`),
      [`${failing.id}:without`],
    );
    assert.ok(
      !fs.existsSync(layout.answerFile(SKILL, 'b1', failing.id, 'without')),
    );
    assert.equal(
      stub.calls.length,
      9 + 3,
      'a transient failure is tried three times',
    );
    broken = false;
    const again = await runPairs(options({ run: stub.run }));
    assert.equal(again.status, 'done');
    assert.equal(again.pending, 1);
    assert.ok(
      answerCurrent(
        layout.answerFile(SKILL, 'b1', failing.id, 'without'),
        failing.inputs.without,
      ),
    );
  });
});

test('runPairs: a credential error stops the job at the first run, sets the old log aside and leaves no reservation', async () => {
  await withRepo(async ({ layout, options }) => {
    const { taskSet } = loadTaskSet({ layout, config: CONFIG, skill: SKILL });
    const first = taskSet.batches[0].tasks[0];
    const runDir = layout.subjectRunDir(SKILL, 'b1', first.id, 'with');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'raw.jsonl'),
      '{"type":"result","is_error":true,"result":"old failure"}\n',
    );
    const stub = stubRun(() => ({
      code: 1,
      stdout: `${event({ type: 'result', subtype: 'error', is_error: true, result: 'The security token included in the request is expired' })}\n`,
    }));
    const summary = await runPairs(options({ run: stub.run }));
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.stop.kind, 'credentials');
    assert.equal(stub.calls.length, 1, 'no other run may start');
    assert.deepEqual(
      summary.results.map((entry) => entry.status),
      ['failed', ...Array(9).fill('skipped')],
    );
    assert.deepEqual(answerFiles(layout), [], 'no answer for a failed run');
    const kept = fs.readdirSync(runDir);
    assert.ok(
      kept.some((name) => name.startsWith('raw.jsonl.superseded-')),
      kept.join(', '),
    );
    assert.ok(!kept.includes('raw.jsonl'));
    assert.equal(
      readLedger(layout.ledgerFile).reserved,
      0,
      'the reservation was settled',
    );
  });
});

test('runPairs: credentials that expire within the call timeout start no run', async () => {
  await withRepo(async ({ layout, options }) => {
    const stub = stubRun();
    const now = Date.parse('2026-02-01T00:00:00Z');
    const summary = await runPairs(
      options({
        run: stub.run,
        subject: {
          now: () => now,
          getCredentials: async () => ({
            ...CREDENTIALS,
            expiration: new Date(now + 60000).toISOString(),
          }),
        },
      }),
    );
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.stop.kind, 'credentials');
    assert.match(summary.stop.message, /less than 5 minutes away/);
    assert.equal(stub.calls.length, 0);
    assert.deepEqual(answerFiles(layout), []);
  });
});

test('runPairs: a first run answered by another model stops the job and stores nothing', async () => {
  await withRepo(async ({ layout, options }) => {
    const stub = stubRun(() => ({
      stdout: subjectTrace({ models: ['some-other-model'] }),
    }));
    const summary = await runPairs(options({ run: stub.run }));
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.stop.kind, 'model');
    assert.match(summary.stop.message, /some-other-model/);
    assert.deepEqual(
      Object.keys(summary.results[0]).sort(),
      ['arm', 'batch', 'skill', 'status', 'task_id'],
      'no internal field is left in a result',
    );
    assert.equal(
      stub.calls.length,
      3,
      'the first task is tried three times, then nothing else starts',
    );
    assert.deepEqual(
      summary.results.map((entry) => entry.status),
      ['failed', ...Array(9).fill('skipped')],
    );
    assert.deepEqual(
      answerFiles(layout),
      [],
      'a wrong model is not stored as not loaded',
    );
  });
});

test('runPairs: a first run that exits with an error after another model answered stops the job and names the model', async () => {
  await withRepo(async ({ layout, options }) => {
    const stub = stubRun(() => ({
      code: 1,
      stdout: subjectTrace({ models: ['some-other-model'] }),
    }));
    const summary = await runPairs(options({ run: stub.run }));
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.stop.kind, 'model');
    assert.match(
      summary.stop.message,
      /^the first run was answered by \["some-other-model"\], not /,
    );
    assert.deepEqual(answerFiles(layout), []);
  });
});

test('runPairs: a spend, security or ledger stop ends the job; a bug is thrown and the arms are still removed', async () => {
  for (const [error, kind] of [
    [
      new SpendStopError(
        'the call would take the ledger past total_cap_usd',
        'total_cap_usd',
      ),
      'spend',
    ],
    [
      new SecurityStopError(
        'a value handed to the child was found in raw.jsonl',
        { clean: false },
      ),
      'security',
    ],
    [new LedgerError('the ledger cannot be used'), 'ledger'],
  ]) {
    await withRepo(async ({ tmpRoot, options }) => {
      let calls = 0;
      const summary = await runPairs(
        options({
          runTask: async () => {
            calls += 1;
            throw error;
          },
        }),
      );
      assert.equal(summary.status, 'stopped');
      assert.equal(summary.stop.kind, kind);
      assert.equal(calls, 1);
      assert.deepEqual(armsLeft(tmpRoot), []);
    });
  }
  await withRepo(async ({ tmpRoot, options }) => {
    await assert.rejects(
      runPairs(
        options({
          runTask: async () => {
            throw new TypeError('a bug');
          },
        }),
      ),
      /a bug/,
    );
    assert.deepEqual(armsLeft(tmpRoot), []);
  });
});

test('runPairs: an error that carries a quarantine is a security stop whatever its kind, and names the copy; without it a ledger error stays a ledger stop', async () => {
  const note =
    'SECURITY STOP: a value the run knows is secret is in text the run returned: the answer text (literal x1). The raw log is quarantined as raw.jsonl~quarantined-2026-01-15T10-00-00-000Z. The matching text is not shown.';
  const carrying = (error) =>
    Object.assign(error, {
      traceQuarantine: {
        quarantined: 'raw.jsonl~quarantined-2026-01-15T10-00-00-000Z',
        note,
      },
    });
  for (const [error, kind, text] of [
    [
      carrying(new LedgerError('ledger write failed: no space left')),
      'security',
      /^SECURITY STOP: .*quarantined as raw\.jsonl~quarantined-2026-01-15T10-00-00-000Z\. .* The run also ended with: ledger write failed: no space left$/,
    ],
    [
      carrying(new TypeError('a bug that came with a quarantine')),
      'security',
      /quarantined as raw\.jsonl~quarantined-.*The run also ended with: a bug that came with a quarantine$/,
    ],
    [
      new LedgerError('ledger write failed: no space left'),
      'ledger',
      /^ledger write failed: no space left$/,
    ],
    // A quarantine without a usable note still stops the job as a security stop, with a generic note.
    ...['', 123, undefined].map((badNote) => [
      Object.assign(new LedgerError('ledger write failed: no space left'), {
        traceQuarantine: {
          quarantined: 'raw.jsonl~quarantined-x',
          note: badNote,
        },
      }),
      'security',
      /^SECURITY STOP: a raw log was quarantined for a value the run knows is secret\. The run also ended with: ledger write failed: no space left$/,
    ]),
  ]) {
    await withRepo(async ({ tmpRoot, options }) => {
      let calls = 0;
      const summary = await runPairs(
        options({
          runTask: async () => {
            calls += 1;
            throw error;
          },
        }),
      );
      assert.equal(summary.status, 'stopped');
      assert.equal(summary.stop.kind, kind);
      assert.match(summary.stop.message, text);
      assert.equal(calls, 1, 'no run starts after the stop');
      assert.deepEqual(armsLeft(tmpRoot), []);
    });
  }
});

test('runPairs: a stop thrown by a later run ends the job; no run starts after it and the first stop is the one reported', async () => {
  const notStarted = (results, from) =>
    results.slice(from).every((entry) => entry.status === 'skipped');
  await withRepo(async ({ layout, options }) => {
    const stub = stubRun();
    let calls = 0;
    const summary = await runPairs(
      options({
        run: stub.run,
        config: helpers.exampleConfig({ subject_concurrency: 1 }),
        runTask: async (taskOptions) => {
          calls += 1;
          if (calls === 3)
            throw new SpendStopError('past total_cap_usd', 'total_cap_usd');
          return runSubjectTask(taskOptions);
        },
      }),
    );
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.stop.kind, 'spend');
    assert.equal(calls, 3, 'no run starts after the stop');
    assert.deepEqual(
      summary.results.map((entry) => entry.status),
      ['ok', 'ok', 'failed', ...Array(7).fill('skipped')],
    );
    assert.equal(answerFiles(layout).length, 2, 'finished answers are kept');
  });
  await withRepo(async ({ options }) => {
    const stub = stubRun();
    let calls = 0;
    const summary = await runPairs(
      options({
        run: stub.run,
        config: helpers.exampleConfig({ subject_concurrency: 2 }),
        runTask: async (taskOptions) => {
          calls += 1;
          if (calls === 2)
            throw new SpendStopError('past total_cap_usd', 'total_cap_usd');
          if (calls === 3) {
            await new Promise((resolve) => setImmediate(resolve));
            throw new CredentialError('the credentials expired');
          }
          return runSubjectTask(taskOptions);
        },
      }),
    );
    assert.equal(summary.stop.kind, 'spend', 'the first stop is kept');
    assert.equal(calls, 3);
    assert.ok(notStarted(summary.results, 3));
  });
});

test('runPairs: a task whose target_section is not a heading is a warning of the job', async () => {
  await withRepo(async ({ layout, options }) => {
    const baselineWarnings = (await runPairs(options({ dryRun: true })))
      .warnings;
    helpers.update(layout.tasksFile(SKILL, 'b1'), (data) => {
      data.scenarios[0].target_section = 'Not a heading';
    });
    const summary = await runPairs(options({ dryRun: true }));
    assert.equal(summary.status, 'dry-run');
    const taskId = helpers.readJson(layout.tasksFile(SKILL, 'b1')).scenarios[0]
      .id;
    assert.deepEqual(summary.warnings.slice(baselineWarnings.length), [
      `${SKILL}: b1/${taskId}: target_section "Not a heading" is not a heading of SKILL.md`,
    ]);
  });
});

test('runPairs: a refused plan builds and spends nothing; a skill plan does not run is skipped', async () => {
  await withRepo(async ({ layout, tmpRoot, options }) => {
    const stub = stubRun();
    const tooSmall = helpers.exampleConfig({ max_usd: 0.1 });
    const refused = await runPairs(
      options({ run: stub.run, config: tooSmall }),
    );
    assert.equal(refused.status, 'refused');
    assert.match(refused.refused.join('\n'), /max_usd/);
    assert.equal(stub.calls.length, 0);
    assert.deepEqual(armsLeft(tmpRoot), []);

    helpers.update(layout.tasksFile(SKILL, 'b1'), (data) => {
      data.scenarios[0].rubric = ['short'];
    });
    const invalid = await runPairs(options({ run: stub.run }));
    assert.equal(invalid.status, 'refused');
    assert.match(
      invalid.refused.join('\n'),
      /brew-log: tasks-b1\.json: scenarios\[0\]\.rubric/,
    );
    assert.equal(stub.calls.length, 0);
  });
  await withRepo(async ({ options }) => {
    const stub = stubRun();
    const summary = await runPairs(
      options({ run: stub.run, skills: [SKILL, 'pantry-note'] }),
    );
    assert.equal(summary.status, 'done');
    assert.deepEqual(summary.skipped, [
      { skill: 'pantry-note', status: 'no baseline' },
    ]);
    assert.equal(stub.calls.length, 10);
  });
});

test('runPairs --dry-run: lists every pending run and builds, spends and writes nothing', async () => {
  await withRepo(async ({ layout, tmpRoot, options }) => {
    const stub = stubRun();
    const lines = [];
    const summary = await runPairs(
      options({ run: stub.run, dryRun: true, log: (line) => lines.push(line) }),
    );
    assert.equal(summary.status, 'dry-run');
    assert.equal(summary.pending, 10);
    assert.equal(stub.calls.length, 0);
    assert.ok(!fs.existsSync(layout.runDir));
    assert.ok(!fs.existsSync(layout.ledgerFile));
    assert.deepEqual(armsLeft(tmpRoot), []);
    const planned = lines.filter((line) => line.startsWith('  would run '));
    assert.equal(planned.length, 10);
    assert.match(
      planned[0],
      /^ {2}would run brew-log\/b1\/brew-log-rules-1:with \(agent k-developer, load instruction yes, tools Skill\)$/,
    );
    assert.match(
      planned[1],
      /:without \(agent k-developer, load instruction no, tools Skill\)$/,
    );
  });
});

test('blinding: the subject process is given the request and nothing else of the task', async () => {
  await withRepo(async ({ layout, options }) => {
    const sentinels = {
      title: 'ZZ-TITLE-SENTINEL',
      target_section: 'ZZ-SECTION-SENTINEL',
      why_skill_matters: 'ZZ-WHY-SENTINEL',
    };
    helpers.update(layout.tasksFile(SKILL, 'b1'), (data) => {
      for (const task of data.scenarios) Object.assign(task, sentinels);
    });
    const tasksData = helpers.readJson(layout.tasksFile(SKILL, 'b1'));
    const stub = stubRun();
    const summary = await runPairs(options({ run: stub.run }));
    assert.equal(summary.status, 'done');
    const prompts = new Set(tasksData.scenarios.map((task) => task.prompt));
    const forbidden = [
      ...Object.values(sentinels),
      ...tasksData.scenarios.map((task) => task.id),
      ...tasksData.scenarios.flatMap((task) => task.rubric),
    ];
    for (const call of stub.calls) {
      assert.ok(prompts.has(call.request));
      assert.equal(call.options.stdin, userMessage(call.request));
      const everything = `${call.args.join('\n')}\n${call.options.stdin}\n${JSON.stringify(call.options.env)}`;
      for (const value of forbidden)
        assert.ok(!everything.includes(value), `${value} reached the subject`);
    }
  });
});

test('answerCurrent: only an answer record with the same digest and an intact text, or a not-loaded record', () => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'answer.json');
    const inputs = { input_sha256: 'a'.repeat(64) };
    const good = {
      kind: 'answer',
      status: 'ok',
      inputs,
      text: 'hello',
      answer_sha256: sha256('hello'),
    };
    assert.equal(answerCurrent(file, inputs), false, 'no file');
    helpers.write(file, '{');
    assert.equal(answerCurrent(file, inputs), false, 'not JSON');
    for (const [what, record, expected] of [
      ['good', good, true],
      [
        'another digest',
        { ...good, inputs: { input_sha256: 'b'.repeat(64) } },
        false,
      ],
      ['a changed text', { ...good, text: 'hello!' }, false],
      ['an authored ladder answer', { ...good, kind: 'fixture' }, false],
      ['a status that is not ok', { ...good, status: 'failed' }, false],
      ['no text', { ...good, text: null }, false],
      [
        'a text that is not a string but hashes as it is stored',
        { ...good, text: 5, answer_sha256: sha256(5) },
        false,
      ],
      [
        'not loaded',
        { ...good, status: 'not_loaded', text: null, answer_sha256: null },
        true,
      ],
      ['not an object', [good], false],
      ['inputs null', { ...good, inputs: null }, false],
      ['no inputs', { ...good, inputs: undefined }, false],
    ]) {
      helpers.write(file, record);
      assert.equal(answerCurrent(file, inputs), expected, what);
    }
    helpers.write(file, good);
    assert.equal(answerCurrent(file, undefined), false, 'no inputs');
    // Neither side has a digest: an absent digest is not a match.
    helpers.write(file, { ...good, inputs: {} });
    assert.equal(answerCurrent(file, undefined), false, 'no digest on both');
  });
});

test('supersede: renames with the time and never overwrites a kept file', () => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'answer.json');
    const now = () => Date.parse('2026-02-01T00:00:00Z');
    assert.equal(supersede(file, now), null);
    fs.writeFileSync(file, 'one');
    const first = supersede(file, now);
    fs.writeFileSync(file, 'two');
    const second = supersede(file, now);
    assert.equal(
      path.basename(first),
      'answer.json.superseded-2026-02-01T00-00-00-000Z',
    );
    assert.equal(
      path.basename(second),
      'answer.json.superseded-2026-02-01T00-00-00-000Z-2',
    );
    assert.equal(fs.readFileSync(first, 'utf8'), 'one');
    assert.equal(fs.readFileSync(second, 'utf8'), 'two');
    assert.ok(!fs.existsSync(file));
  });
});

test('readSkillsVersion: the commit git names, or null when git cannot say', async () => {
  const commit = 'c'.repeat(40);
  const seen = [];
  const seenOptions = [];
  const run = (result) => async (command, args, options) => {
    seen.push([command, ...args]);
    seenOptions.push(options);
    return { code: 0, stdout: '', stderr: '', ...result };
  };
  assert.equal(
    await readSkillsVersion('/repo', { run: run({ stdout: `${commit}\n` }) }),
    commit,
  );
  assert.deepEqual(seen[0], [
    'git',
    '-C',
    '/repo',
    'log',
    '-1',
    '--format=%H',
    '--',
    'skills',
  ]);
  assert.equal(seenOptions[0].timeoutMs, 10000, 'git is given a time limit');
  assert.equal(
    await readSkillsVersion('/repo', {
      run: run({ code: 128, stdout: commit }),
    }),
    null,
  );
  assert.equal(
    await readSkillsVersion('/repo', { run: run({ stdout: 'abc1234\n' }) }),
    null,
    'a short hash is not a commit',
  );
  assert.equal(
    await readSkillsVersion('/repo', {
      run: run({ stdout: `${commit}\nwarning: something\n` }),
    }),
    null,
    'more than the one line git is asked for',
  );
  assert.equal(
    await readSkillsVersion('/repo', { run: run({ stdout: 'not a commit' }) }),
    null,
  );
  assert.equal(
    await readSkillsVersion('/repo', { run: run({ stdout: '' }) }),
    null,
  );
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-test-'));
  try {
    assert.equal(
      await readSkillsVersion(outside),
      null,
      'a folder that is not a checkout',
    );
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('runPairs: a stop message is redacted and cut before it reaches the caller and the log', async () => {
  const key = 'AKIA' + 'ZZZZYYYYXXXXWWWW';
  await withRepo(async ({ options }) => {
    const lines = [];
    const summary = await runPairs(
      options({
        log: (line) => lines.push(line),
        runTask: async () => {
          throw new CredentialError(`expired ${key} ${'x'.repeat(500)}`);
        },
      }),
    );
    assert.equal(summary.stop.kind, 'credentials');
    assert.ok(!summary.stop.message.includes(key));
    assert.ok(
      summary.stop.message.startsWith('expired [REDACTED_AWS_KEY_ID] x'),
    );
    assert.equal(
      summary.stop.message.indexOf('[truncated'),
      400,
      'cut at 400 characters',
    );
    assert.match(summary.stop.message, /\[truncated \d+ characters\]$/);
    assert.ok(!lines.join('\n').includes(key));
  });
});

test('runPairs: a bug in one of the parallel runs is thrown after the other runs finish, and the arms are removed', async () => {
  await withRepo(async ({ layout, tmpRoot, options }) => {
    const stub = stubRun();
    let calls = 0;
    await assert.rejects(
      runPairs(
        options({
          run: stub.run,
          runTask: async (taskOptions) => {
            calls += 1;
            if (calls === 3) throw new TypeError('bug in run 3');
            return runSubjectTask(taskOptions);
          },
        }),
      ),
      /bug in run 3/,
    );
    assert.equal(calls, 10, 'the runs after the bug were still made');
    assert.equal(stub.calls.length, 9);
    assert.equal(
      answerFiles(layout).filter((name) => name.endsWith('.json')).length,
      9,
      'the finished answers are kept',
    );
    assert.deepEqual(armsLeft(tmpRoot), []);
  });
});

test('runPairs: a skill named twice is planned and run once', async () => {
  await withRepo(async ({ options }) => {
    const stub = stubRun();
    const summary = await runPairs(
      options({ run: stub.run, skills: [SKILL, SKILL] }),
    );
    assert.equal(summary.status, 'done');
    assert.equal(summary.jobs, 10);
    assert.equal(stub.calls.length, 10);
  });
});

test('runPairs: the statuses the job runs are the statuses plan plans', async () => {
  // `plan` refuses a selection with no skill it can plan, so it is ok exactly when it plans the status.
  for (const [status, edit] of [
    ['ready', () => {}],
    [
      'rules stale',
      (layout) => fs.appendFileSync(layout.skillMd(SKILL), '\nA new line.\n'),
    ],
    [
      'tasks stale',
      (layout) => fs.appendFileSync(layout.rulesFile(SKILL), '\n'),
    ],
    [
      'no agent',
      (layout) =>
        fs
          .readdirSync(layout.agentsDir)
          .forEach((name) => fs.unlinkSync(path.join(layout.agentsDir, name))),
    ],
    [
      'invalid baseline',
      (layout) =>
        helpers.update(layout.tasksFile(SKILL, 'b1'), (tasks) => {
          tasks.scenarios[0].rubric = ['too short'];
        }),
    ],
  ]) {
    await withRepo(async ({ layout }) => {
      edit(layout);
      const plan = buildPlan({ layout, config: CONFIG, skills: [SKILL] });
      assert.equal(plan.skills[0].status, status);
      assert.equal(plan.ok, pairs.RUNNABLE_STATUSES.has(status), status);
    });
  }
});

test('runPairs: a skill that is rules stale or tasks stale is run like a ready one', async () => {
  for (const [status, edit] of [
    [
      'tasks stale',
      (layout) =>
        helpers.update(layout.tasksFile(SKILL, 'b1'), (data) => {
          data.rules_sha256 = helpers.makeFakeSha256('c');
        }),
    ],
    [
      'rules stale',
      (layout) =>
        fs.writeFileSync(
          layout.skillMd(SKILL),
          fs
            .readFileSync(layout.skillMd(SKILL), 'utf8')
            .replace('## Rules', '## 1. Rules'),
        ),
    ],
  ]) {
    await withRepo(async ({ layout, options }) => {
      edit(layout);
      assert.equal(
        buildPlan({ layout, config: CONFIG, skills: [SKILL] }).skills[0].status,
        status,
      );
      const stub = stubRun();
      const summary = await runPairs(options({ run: stub.run }));
      assert.deepEqual(summary.skipped, [], status);
      assert.equal(summary.status, 'done', status);
      assert.equal(stub.calls.length, 10, status);
    });
  }
});

test('setupProblemsOf leaves out the reason for a with run that did not load the skill and keeps the others', () => {
  const trace = {
    result_seen: true,
    models_used: [MODEL],
    available_tools: ['Skill'],
    tool_calls: [],
  };
  const problems = (arm, loaded) =>
    runProblems({
      arm,
      trace,
      skillLoad: { loaded },
      model: MODEL,
      runner: forSkill(SKILL),
    });
  const outcomeOf = (reasons) => ({
    status: 'failed',
    tries: [{ ok: true, valid: false, problems: reasons }],
  });
  assert.deepEqual(problems('with', false), [NEVER_LOADED_PROBLEM]);
  assert.deepEqual(setupProblemsOf(outcomeOf(problems('with', false))), []);
  assert.deepEqual(problems('with', true), []);
  assert.deepEqual(problems('without', true), [
    'the without arm loaded the skill',
  ]);
  assert.deepEqual(setupProblemsOf(outcomeOf(problems('without', true))), [
    'the without arm loaded the skill',
  ]);
  assert.deepEqual(
    setupProblemsOf(
      outcomeOf([NEVER_LOADED_PROBLEM, 'no result event ended the run']),
    ),
    ['no result event ended the run'],
  );
});

test('WRONG_MODEL_PROBLEM starts the reason claude-run.js gives for a model other than the subject', () => {
  const problems = runProblems({
    arm: 'without',
    trace: {
      result_seen: true,
      models_used: ['some-other-model'],
      available_tools: ['Skill'],
      tool_calls: [],
    },
    skillLoad: { loaded: false },
    model: MODEL,
    runner: forSkill(SKILL),
  });
  assert.equal(problems.length, 1);
  assert.ok(problems[0].startsWith(WRONG_MODEL_PROBLEM), problems[0]);
  assert.ok(
    problems[0].startsWith(`${WRONG_MODEL_PROBLEM}:`),
    'the constant is the whole reason up to the list of models',
  );
});

test('runPairs: an invalid run for a reason that is not the skill or the model is stored as nothing and stops the job as setup after the first run', async () => {
  for (const [what, trace, pattern] of [
    [
      'a result that names no model',
      { models: [] },
      /the result event reports no model usage/,
    ],
    [
      'tools beyond the grant',
      { tools: ['Skill', 'Bash'] },
      /the reported tools go beyond the grant: "Skill", "Bash"/,
    ],
    [
      'the skill not loaded and tools beyond the grant',
      { skill: null, tools: ['Skill', 'Bash'] },
      /the reported tools go beyond the grant/,
    ],
  ]) {
    await withRepo(async ({ layout, tmpRoot, options }) => {
      const stub = stubRun(() => ({ stdout: subjectTrace(trace) }));
      const summary = await runPairs(options({ run: stub.run }));
      assert.equal(summary.status, 'stopped', what);
      assert.equal(summary.stop.kind, 'setup', what);
      assert.match(
        summary.stop.message,
        /^the first run was invalid for a reason that is not the skill: /,
        what,
      );
      assert.match(summary.stop.message, pattern, what);
      assert.doesNotMatch(summary.stop.message, /never loaded/, what);
      assert.equal(stub.calls.length, 3, `${what}: the first run, three tries`);
      assert.deepEqual(
        summary.results.map((entry) => entry.status),
        ['failed', ...Array(9).fill('skipped')],
        what,
      );
      assert.deepEqual(Object.keys(summary.results[0]).sort(), [
        'arm',
        'batch',
        'skill',
        'status',
        'task_id',
      ]);
      assert.deepEqual(answerFiles(layout), [], `${what}: nothing is stored`);
      assert.deepEqual(armsLeft(tmpRoot), []);

      const fixed = stubRun();
      const again = await runPairs(options({ run: fixed.run }));
      assert.equal(again.status, 'done', what);
      assert.equal(again.pending, 10, `${what}: every run is still pending`);
    });
  }
});

test('runPairs: a without run that loaded the skill is a failed run, not a not-loaded answer', async () => {
  await withRepo(async ({ layout, options }) => {
    const stub = stubRun((call) => ({
      stdout: subjectTrace({ text: `${call.arm} text` }),
    }));
    const summary = await runPairs(options({ run: stub.run }));
    assert.equal(summary.status, 'partial');
    assert.equal(
      summary.stop,
      null,
      'the first run is a with run and is valid',
    );
    assert.deepEqual(
      summary.results.map((entry) => `${entry.arm}:${entry.status}`).sort(),
      [...Array(5).fill('with:ok'), ...Array(5).fill('without:failed')],
    );
    assert.equal(stub.calls.length, 5 + 5 * 3);
    assert.deepEqual(
      answerFiles(layout).filter((name) => name.includes('.without.')),
      [],
      'no record for a without run that loaded the skill',
    );
    const again = await runPairs(options({ run: stubRun().run }));
    assert.equal(again.pending, 5);
    assert.equal(again.status, 'done');
  });
});

test('runPairs: not loaded is stored only when every try had that one problem; a mix with another problem is a failed run', async () => {
  await withRepo(async ({ layout, options }) => {
    // Tries 1 and 2 are answered by another model; try 3 uses the subject model but never loads the skill.
    let tries = 0;
    const stub = stubRun(() => {
      tries += 1;
      return {
        stdout:
          tries < 3
            ? subjectTrace({ models: ['some-other-model'] })
            : subjectTrace({ skill: null }),
      };
    });
    const summary = await runPairs(options({ run: stub.run }));
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.stop.kind, 'model');
    assert.match(summary.stop.message, /some-other-model/);
    assert.doesNotMatch(summary.stop.message, /never loaded/);
    assert.equal(summary.results[0].status, 'failed');
    assert.deepEqual(answerFiles(layout), []);
  });
});

test('runPairs: a first run that fails outright does not stop the job, and a valid retry after an invalid try stores the answer', async () => {
  await withRepo(async ({ layout, options }) => {
    let firstKey = null;
    const stub = stubRun((call) => {
      firstKey = firstKey ?? `${call.arm}|${call.request}`;
      return firstKey === `${call.arm}|${call.request}`
        ? { code: 1, stdout: '', stderr: 'boom: connection reset' }
        : answerFor(call);
    });
    const summary = await runPairs(options({ run: stub.run }));
    assert.equal(
      summary.stop,
      null,
      'a transient failure is not a setup fault',
    );
    assert.equal(summary.status, 'partial');
    assert.deepEqual(
      summary.results.map((entry) => entry.status),
      ['failed', ...Array(9).fill('ok')],
    );
  });
  await withRepo(async ({ layout, options }) => {
    let calls = 0;
    const stub = stubRun((call) => {
      calls += 1;
      return calls === 1
        ? { stdout: subjectTrace({ models: ['some-other-model'] }) }
        : answerFor(call);
    });
    const summary = await runPairs(options({ run: stub.run }));
    assert.equal(summary.stop, null, 'the retry was valid');
    assert.equal(summary.status, 'done');
    assert.equal(stub.calls.length, 11);
    const { taskSet } = loadTaskSet({ layout, config: CONFIG, skill: SKILL });
    const first = taskSet.batches[0].tasks[0];
    const record = helpers.readJson(
      layout.answerFile(SKILL, 'b1', first.id, 'with'),
    );
    assert.equal(record.status, 'ok');
    assert.equal(record.tries.length, 2);
    assert.match(record.tries[0].problems.join(' '), /some-other-model/);
  });
});

test('writeRecord: writes through a temporary file with mode 0600 and removes it when the rename fails', () => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'sub', 'answer.json');
    writeRecord(file, { value: 1 });
    assert.deepEqual(helpers.readJson(file), { value: 1 });
    assert.equal(mode(file), 0o600);
    assert.equal(mode(path.dirname(file)), 0o700);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['answer.json']);

    // A folder where the file belongs makes the rename fail after the temporary file is written.
    const blocked = path.join(dir, 'blocked.json');
    fs.mkdirSync(blocked);
    fs.writeFileSync(path.join(blocked, 'kept'), 'x');
    assert.throws(() => writeRecord(blocked, { value: 2 }));
    assert.deepEqual(
      fs.readdirSync(dir).sort(),
      ['blocked.json', 'sub'],
      'no temporary file is left',
    );
  });
});
