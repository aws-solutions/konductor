// SPDX-License-Identifier: Apache-2.0
// Tests for the checklist job (scripts/bench/lib/checklist-job.js) and its entry points (job.js checklists, the
// launcher's request check): what is planned, what the writer is given, exclusions, resume, the dose ladder's copies,
// dry runs, refusals, provider blocks and every stop. The judge call is a stub and the credentials are injected, on a
// copy of the fixture repo in a temp folder: no process is started, no model and no AWS call is made.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const job = require('../../../scripts/bench/job');
const {
  CredentialError,
} = require('../../../scripts/bench/lib/aws-credentials');
const checklistJob = require('../../../scripts/bench/lib/checklist-job');
const requestChecklist = require('../../../scripts/bench/lib/request-checklist');
const {
  loadConfig,
  rubricWriterModel,
} = require('../../../scripts/bench/lib/config');
const {
  itemNames,
  validateLadder,
} = require('../../../scripts/bench/lib/dose-ladder');
const { createLayout } = require('../../../scripts/bench/lib/layout');
const { buildPlan } = require('../../../scripts/bench/lib/plan');
const { fileSha256 } = require('../../../scripts/bench/lib/provenance');
const {
  LedgerError,
  SpendStopError,
} = require('../../../scripts/bench/lib/ledger');
const launchLib = require('../../../scripts/bench/lib/launch');
const { UsageError } = require('../../../scripts/bench/lib/cli-args');
const {
  CallError,
  SystemicFailureError,
} = require('../../../scripts/bench/lib/retry');
const { createRedactor } = require('../../../scripts/bench/lib/redact');
const helpers = require('./helpers');

const SKILL = helpers.SKILL;
const LADDER_FILE = path.join(
  helpers.FIXTURE_DIR,
  'dose-ladder',
  'ladder-small.json',
);
const EXCLUDED = 'brew-log-rules-3';
const NOW_MS = Date.parse('2026-11-10T12:00:00Z');
const FRESH = {
  accessKeyId: 'fixture-key',
  secretAccessKey: 'fixture-secret',
  sessionToken: 'fixture-token',
  expiration: '2026-11-10T13:00:00Z',
};
const NO_WAIT = { sleep: async () => {}, delayMs: () => 0 };

const itemsReply = (count, tag = 'point') =>
  JSON.stringify({
    items: Array.from(
      { length: count },
      (_, index) =>
        `The answer covers requested ${tag} number ${index + 1} of this task.`,
    ),
  });
const countIn = (prompt) =>
  Number(/^Write exactly (\d+) checklist items\.$/m.exec(prompt)?.[1]);

/**
 * A judgeCall stub that records every call and answers with `answer(args, index)` (default: a valid reply for the
 * count the prompt asks for). It checks the credential guard first, like the real call.
 */
function stubCall(answer) {
  const calls = [];
  const judgeCall = async (args) => {
    // The real call checks the credentials before it starts anything, so a refused call is not recorded.
    if (args.credentialGuard) args.credentialGuard.assertFresh(args.label);
    calls.push(args);
    if (answer) return answer(args, calls.length - 1);
    return okReply(args);
  };
  return { calls, judgeCall };
}
const okReply = (args) => ({
  ok: true,
  text: itemsReply(countIn(args.prompt) || 5),
  usage: { input_tokens: 100, output_tokens: 50 },
  reportedUsd: 0.002,
  ms: 4,
  error: null,
  stderr: '',
});
const failedReply = (error) => ({
  ok: false,
  text: '',
  usage: null,
  reportedUsd: null,
  ms: 2,
  error,
  stderr: '',
});

/** Runs runChecklists on `layout` with the stub and fresh credentials. */
function run(layout, stub, options = {}) {
  return checklistJob.runChecklists({
    layout,
    config: loadConfig({ defaultFile: layout.configFile }),
    skills: [SKILL],
    judgeCall: stub.judgeCall,
    getCredentials: async () => FRESH,
    now: () => NOW_MS,
    writer: NO_WAIT,
    ...options,
  });
}

const checklistFiles = (layout) => {
  const dir = path.join(layout.runDir, 'checklists');
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true })
        .filter((name) => name.endsWith('.json'))
        .sort()
    : [];
};

/** Adds batch b2 to the fixture copy: the same tasks (and so the same ids) as b1. */
function addBatchB2(layout) {
  const tasks = helpers.readJson(layout.tasksFile(SKILL, 'b1'));
  helpers.write(layout.tasksFile(SKILL, 'b2'), { ...tasks, batch: 'b2' });
  fs.copyFileSync(
    layout.bucketsFile(SKILL, 'b1'),
    layout.bucketsFile(SKILL, 'b2'),
  );
  helpers.update(layout.bucketsFile(SKILL, 'b2'), (buckets) => {
    buckets.batch = 'b2';
  });
}

/**
 * Adds a skill that is a copy of brew-log under another name, with its own baseline and no agent that declares it,
 * so `plan` gives it the status `no agent`. Its tasks are 5 more checklists a careless job would pay for.
 */
function addUndeclaredSkill(layout, name) {
  const rename = (file) =>
    fs.writeFileSync(
      file,
      fs.readFileSync(file, 'utf8').replaceAll(SKILL, name),
    );
  fs.cpSync(
    path.dirname(layout.skillMd(SKILL)),
    path.dirname(layout.skillMd(name)),
    {
      recursive: true,
    },
  );
  fs.cpSync(
    path.dirname(layout.rulesFile(SKILL)),
    path.dirname(layout.rulesFile(name)),
    {
      recursive: true,
    },
  );
  for (const file of [
    layout.skillMd(name),
    layout.rulesFile(name),
    layout.tasksFile(name, 'b1'),
    layout.bucketsFile(name, 'b1'),
  ])
    rename(file);
  // The renamed files change the hashes the baseline is checked against.
  helpers.update(layout.rulesFile(name), (rules) => {
    rules.skill_md_sha256 = fileSha256(layout.skillMd(name));
  });
  helpers.update(layout.tasksFile(name, 'b1'), (tasks) => {
    tasks.rules_sha256 = fileSha256(layout.rulesFile(name));
  });
}

// ---- runChecklists -----------------------------------------------------------------------------------------------

test('runChecklists: one writer call per task read by A, the files are written, and the excluded task gets none', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const stub = stubCall();
    const summary = await run(layout, stub);
    assert.equal(summary.status, 'done');
    assert.equal(summary.stop, null);
    assert.equal(summary.tasks, 4);
    assert.equal(summary.pending, 4);
    assert.equal(stub.calls.length, 4);
    assert.deepEqual(summary.results.written, [
      'brew-log/b1/brew-log-rules-1',
      'brew-log/b1/brew-log-rules-2',
      'brew-log/b1/brew-log-rules-4',
      'brew-log/b1/brew-log-rules-5',
    ]);
    assert.deepEqual(checklistFiles(layout), [
      path.join(SKILL, 'b1', 'brew-log-rules-1.json'),
      path.join(SKILL, 'b1', 'brew-log-rules-2.json'),
      path.join(SKILL, 'b1', 'brew-log-rules-4.json'),
      path.join(SKILL, 'b1', 'brew-log-rules-5.json'),
    ]);
    assert.ok(!stub.calls.some((args) => args.label.includes(EXCLUDED)));
    assert.equal(summary.remaining, 0);
    assert.equal(
      summary.writer_model,
      rubricWriterModel(helpers.exampleConfig()),
    );
    for (const args of stub.calls) {
      assert.equal(args.modelId, summary.writer_model);
      assert.match(
        args.label,
        /^checklist brew-log\/b1\/brew-log-rules-\d #1$/,
      );
      // The keys exported for the configured profile go to every writer call, so no AWS_PROFILE is needed.
      assert.equal(args.credentials, FRESH);
    }
    assert.ok(summary.usd > 0);
  }));

test('runChecklists: the writer sees the request and the item count only, never the skill, the rules checklist or the title', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const tasks = helpers.readJson(layout.tasksFile(SKILL, 'b1')).scenarios;
    const rules = helpers.readJson(layout.rulesFile(SKILL)).rules;
    const skillMd = fs.readFileSync(layout.skillMd(SKILL), 'utf8');
    const stub = stubCall();
    await run(layout, stub);
    for (const args of stub.calls) {
      const id = /brew-log-rules-\d/.exec(args.label)[0];
      const entry = tasks.find((candidate) => candidate.id === id);
      assert.ok(args.prompt.includes(entry.prompt), id);
      assert.equal(countIn(args.prompt), entry.rubric.length);
      for (const leak of [
        SKILL,
        entry.title,
        ...entry.rubric,
        ...rules.map((rule) => rule.id),
        skillMd.split('\n').find((line) => line.length > 40),
      ])
        assert.ok(!args.prompt.includes(leak), `${id} leaks ${leak}`);
    }
  }));

test('runChecklists: a rerun finds every checklist current and makes no call', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    await run(layout, stubCall());
    const again = stubCall();
    const summary = await run(layout, again);
    assert.equal(summary.status, 'done');
    assert.equal(again.calls.length, 0);
    assert.equal(summary.done, 4);
    assert.equal(summary.pending, 0);
  }));

test('runChecklists: a rerun with every checklist current exports no credentials, so expired ones do not stop it', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    await run(layout, stubCall());
    let exported = 0;
    const again = stubCall();
    const summary = await run(layout, again, {
      getCredentials: async () => {
        exported += 1;
        throw new CredentialError('the credentials expired');
      },
    });
    assert.equal(summary.status, 'done');
    assert.equal(summary.stop, null);
    assert.equal(exported, 0);
    assert.equal(again.calls.length, 0);
  }));

test('runChecklists: a selected skill that plan does not plan is skipped: listed, no call, no file', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    addUndeclaredSkill(layout, 'brew-two');
    const stub = stubCall();
    const lines = [];
    const summary = await run(layout, stub, {
      skills: [SKILL, 'brew-two', 'pantry-note'],
      log: (line) => lines.push(line),
    });
    assert.equal(summary.status, 'done');
    assert.deepEqual(
      [...summary.skipped].sort((a, b) => a.skill.localeCompare(b.skill)),
      [
        { skill: 'brew-two', status: 'no agent' },
        { skill: 'pantry-note', status: 'no baseline' },
      ],
    );
    assert.ok(lines.includes('  skipped brew-two (no agent)'));
    assert.equal(summary.tasks, 4);
    assert.equal(stub.calls.length, 4);
    assert.ok(!stub.calls.some((args) => args.label.includes('brew-two')));
    assert.ok(
      checklistFiles(layout).every((name) =>
        name.startsWith(`${SKILL}${path.sep}`),
      ),
      checklistFiles(layout).join(', '),
    );
  }));

// The recipes of plan.test.js that give a skill each status.
const STATUS_CASES = [
  ['ready', () => {}],
  [
    'rules stale',
    (layout) => fs.appendFileSync(layout.skillMd(SKILL), '\nA new line.\n'),
  ],
  ['tasks stale', (layout) => fs.appendFileSync(layout.rulesFile(SKILL), '\n')],
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
];

test('runChecklists: a skill whose rules or tasks are stale still gets its checklists', () =>
  Promise.all(
    STATUS_CASES.filter(([status]) => status.endsWith('stale')).map(
      ([status, damage]) =>
        helpers.withTmpAsync(async (dir) => {
          fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
          const layout = createLayout({ root: dir });
          damage(layout);
          const config = loadConfig({ defaultFile: layout.configFile });
          assert.equal(
            buildPlan({ layout, config, skills: [SKILL] }).skills[0].status,
            status,
          );
          const stub = stubCall();
          const summary = await run(layout, stub);
          assert.equal(summary.status, 'done', status);
          assert.deepEqual(summary.skipped, [], status);
          assert.equal(stub.calls.length, 4, status);
        }),
    ),
  ));

test('runChecklists: the statuses the job writes for are the statuses plan plans', () =>
  Promise.all(
    STATUS_CASES.map(([status, damage]) =>
      helpers.withTmpAsync(async (dir) => {
        fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
        const layout = createLayout({ root: dir });
        damage(layout);
        const config = loadConfig({ defaultFile: layout.configFile });
        const plan = buildPlan({ layout, config, skills: [SKILL] });
        assert.equal(plan.skills[0].status, status);
        // `plan` refuses a selection with no skill it can plan, so it is ok exactly when it plans the status.
        assert.equal(
          plan.ok,
          checklistJob.RUNNABLE_STATUSES.has(status),
          status,
        );
      }),
    ),
  ));

test('runChecklists: the excluded task is listed with batch, reason and date; the same id in another batch is written', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    addBatchB2(layout);
    const stub = stubCall();
    const summary = await run(layout, stub);
    const record = helpers.readJson(layout.exclusionsFile).batches.b1
      .scenarios[0];
    assert.deepEqual(summary.excluded, [
      {
        skill: SKILL,
        batch: 'b1',
        id: EXCLUDED,
        reason: record.reason,
        date: record.date,
      },
    ]);
    assert.equal(summary.tasks, 9);
    assert.ok(summary.results.written.includes(`brew-log/b2/${EXCLUDED}`));
    assert.ok(!summary.results.written.includes(`brew-log/b1/${EXCLUDED}`));
    assert.ok(fs.existsSync(layout.checklistFile(SKILL, 'b2', EXCLUDED)));
    assert.ok(!fs.existsSync(layout.checklistFile(SKILL, 'b1', EXCLUDED)));
    // Same request and item count across the two batches: the b2 tasks are copies of b1's, except the one b1 left out.
    assert.equal(stub.calls.length, 5);
    assert.equal(summary.results.copied.length, 4);
  }));

test('runChecklists: --dry-run lists every pending and copied checklist and makes no call, no file and no credential export', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const stub = stubCall();
    const lines = [];
    let exported = 0;
    const summary = await run(layout, stub, {
      dryRun: true,
      log: (line) => lines.push(line),
      getCredentials: async () => {
        exported += 1;
        return FRESH;
      },
    });
    assert.equal(summary.status, 'dry-run');
    assert.equal(stub.calls.length, 0);
    assert.equal(exported, 0);
    assert.deepEqual(checklistFiles(layout), []);
    assert.equal(
      lines.filter((line) => line.includes('would write')).length,
      4,
    );
    assert.ok(lines.some((line) => line.includes(`${EXCLUDED}: excluded`)));
    assert.ok(summary.projected_usd > 0);
    assert.ok(summary.worst_case_usd >= summary.projected_usd);
  }));

test('runChecklists: at most 4 writer calls run at once, and the file time is the job clock', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    // A second batch with other requests: 9 checklists to write, none a copy.
    addBatchB2(layout);
    helpers.update(layout.tasksFile(SKILL, 'b2'), (tasks) => {
      for (const entry of tasks.scenarios)
        entry.prompt = `${entry.prompt} This one is for the second batch.`;
    });
    let inFlight = 0;
    let most = 0;
    const stub = stubCall(async (args) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return okReply(args);
    });
    const summary = await run(layout, stub);
    assert.equal(summary.status, 'done');
    assert.equal(summary.results.written.length, 9);
    assert.equal(summary.results.copied.length, 0);
    assert.equal(most, checklistJob.CHECKLIST_CONCURRENCY);
    assert.equal(checklistJob.CHECKLIST_CONCURRENCY, 4);
    const written = helpers.readJson(
      layout.checklistFile(SKILL, 'b1', 'brew-log-rules-1'),
    );
    assert.equal(written.created_at, new Date(NOW_MS).toISOString());
  }));

test('runChecklists: a plan that refuses (no skill it can plan) is refused before anything is read or spent', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const stub = stubCall();
    const summary = await run(layout, stub, { skills: ['pantry-note'] });
    assert.equal(summary.status, 'refused');
    assert.ok(summary.refused.length > 0);
    assert.equal(stub.calls.length, 0);
  }));

test('runChecklists: a projection above max_usd with what the run already spent is refused, with no call', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const config = loadConfig({ defaultFile: layout.configFile });
    // Ladder items only, so no plan gate runs: the run has spent all but a cent of max_usd.
    const spent = config.max_usd - 0.01;
    helpers.writeLedger(layout.ledgerFile, [
      {
        type: 'reserve',
        id: 'e1',
        ts: '2026-11-10T09:00:00.000Z',
        run: 'default',
        label: 'earlier',
        usd: spent,
        expires: '2026-11-10T09:12:00.000Z',
      },
      {
        type: 'settle',
        id: 'e1',
        ts: '2026-11-10T09:01:00.000Z',
        run: 'default',
        label: 'earlier',
        usd: spent,
        status: 'ok',
        model: 'claude-sonnet-5-5',
        cost_source: 'reported',
      },
    ]);
    const ladder = helpers.readJson(LADDER_FILE);
    const stub = stubCall();
    const summary = await run(layout, stub, { skills: ['fixture-d0'], ladder });
    assert.equal(summary.status, 'refused');
    assert.match(summary.refused[0], /above max_usd/);
    assert.equal(stub.calls.length, 0);
    // In another run the same work fits.
    const other = createLayout({ root: dir, runId: 'r2' });
    const fits = await run(other, stubCall(), {
      skills: ['fixture-d0'],
      ladder,
    });
    assert.equal(fits.status, 'done');
  }));

test('runChecklists: a live reservation of the run counts toward the projection check, and so does an expired one', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const config = loadConfig({
      defaultFile: createLayout({ root: dir }).configFile,
    });
    const ladder = helpers.readJson(LADDER_FILE);
    // Two runs of the same ledger shape: a reservation nobody settled, live or past its expiry.
    for (const [runId, expires] of [
      ['live', '2999-01-01T00:00:00.000Z'],
      ['expired', '2026-11-10T09:12:00.000Z'],
    ]) {
      const layout = createLayout({ root: dir, runId });
      helpers.writeLedger(layout.ledgerFile, [
        {
          type: 'reserve',
          id: 'r1',
          ts: '2026-11-10T09:00:00.000Z',
          run: runId,
          label: 'another job of this run',
          usd: config.max_usd - 0.01,
          expires,
        },
      ]);
      const stub = stubCall();
      const summary = await run(layout, stub, {
        skills: ['fixture-d0'],
        ladder,
      });
      assert.equal(summary.status, 'refused', runId);
      assert.match(summary.refused[0], /above max_usd/, runId);
      assert.equal(stub.calls.length, 0, runId);
    }
  }));

test('runChecklists: the summary counts the calls charged at the estimate, per model, and logs them', () =>
  helpers.withTmpAsync(async (dir) => {
    // Like the real call: reserve in the ledger it is given, then settle with what the CLI reported.
    const settling = (reportedUsd) =>
      stubCall(async (args) => {
        const reservation = await args.ledger.reserve(
          args.config.estimate_usd_per_call.judge,
          args.label,
        );
        const reply = { ...okReply(args), reportedUsd };
        reservation.settle({
          model: args.modelId,
          usage: reply.usage,
          reportedUsd,
        });
        return reply;
      });
    const logs = [];
    const copy = (name) => {
      const root = path.join(dir, name);
      fs.cpSync(helpers.fixtureRoot(), root, { recursive: true });
      return createLayout({ root });
    };
    const estimated = await run(copy('a'), settling(undefined), {
      log: (line) => logs.push(line),
    });
    assert.equal(estimated.status, 'done');
    const calls = estimated.results.written.length;
    assert.ok(calls > 0);
    assert.deepEqual(estimated.estimated, {
      calls,
      models: { [estimated.writer_model]: calls },
    });
    assert.ok(
      logs.some((line) =>
        line.startsWith(
          `checklists: ${calls} call(s) charged at the estimate because the CLI reported no usable cost: ${estimated.writer_model} ${calls}`,
        ),
      ),
    );
    const reported = await run(copy('b'), settling(0.002));
    assert.equal(reported.status, 'done');
    assert.equal(reported.results.written.length, calls);
    assert.equal(reported.estimated, null);
  }));

const CUT_OFF_LINE = (count) =>
  `checklists: ${count} reply(ies) cut off at the output limit and not used; raise judge_max_output_tokens, or the seat's entry in judge_max_output_tokens_by_seat, if this keeps happening`;

test('runChecklists: a try cut off at the output limit is counted in cut_off and logged with the two settings; a retry that works still finishes the task', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    // The first try of one task stops at the limit (the call fails), its second try is cut off with a reply that is not
    // usable, and the third works.
    const stub = stubCall((args) => {
      if (!args.label.includes('brew-log-rules-4')) return okReply(args);
      if (args.label.endsWith('#1'))
        return {
          ...failedReply('reply cut off at the output limit of 9000 tokens'),
          cutOff: true,
        };
      if (args.label.endsWith('#2'))
        return { ...okReply(args), text: '{"items": [', cutOff: true };
      return okReply(args);
    });
    const logs = [];
    const summary = await run(layout, stub, { log: (line) => logs.push(line) });
    assert.equal(summary.status, 'done');
    assert.equal(summary.cut_off, 2);
    assert.ok(logs.includes(CUT_OFF_LINE(2)), logs.join('\n'));
  }));

test('runChecklists: with no cut off the count is 0 and nothing is logged about the limit; a reply that used the whole limit and passed is not counted', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const logs = [];
    const quiet = await run(layout, stubCall(), {
      log: (line) => logs.push(line),
    });
    assert.equal(quiet.status, 'done');
    assert.equal(quiet.cut_off, 0);
    const second = path.join(dir, 'second');
    fs.cpSync(helpers.fixtureRoot(), second, { recursive: true });
    const passed = await run(
      createLayout({ root: second }),
      stubCall((args) => ({ ...okReply(args), cutOff: true })),
      { log: (line) => logs.push(line) },
    );
    assert.equal(passed.status, 'done');
    assert.equal(passed.cut_off, 0);
    assert.equal(
      logs.some((line) => /cut off at the output limit/.test(line)),
      false,
    );
  }));

test('runChecklists: every try of a task cut off makes it partial and counts each try; a stop keeps the count of the tries before it; a dry run counts none', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const cutOffReply = (args) => ({
      ...okReply(args),
      text: '{"items": [',
      cutOff: true,
    });
    const partial = await run(
      layout,
      stubCall((args) =>
        args.label.includes('brew-log-rules-4')
          ? cutOffReply(args)
          : okReply(args),
      ),
    );
    assert.equal(partial.status, 'partial');
    assert.equal(partial.cut_off, 3, 'three tries of one task');
    // A stop after one cut off try: the first call is cut off, the next one is a spend stop.
    const stopLogs = [];
    const second = path.join(dir, 'second');
    fs.cpSync(helpers.fixtureRoot(), second, { recursive: true });
    const stopped = await run(
      createLayout({ root: second }),
      stubCall((args, index) => {
        if (index === 0) return cutOffReply(args);
        throw new SpendStopError('max_usd reached', 'max_usd');
      }),
      {
        writer: { ...NO_WAIT, concurrency: 1 },
        log: (line) => stopLogs.push(line),
      },
    );
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.cut_off, 1);
    assert.ok(stopLogs.includes(CUT_OFF_LINE(1)), stopLogs.join('\n'));
    const third = path.join(dir, 'third');
    fs.cpSync(helpers.fixtureRoot(), third, { recursive: true });
    const dry = await run(createLayout({ root: third }), stubCall(), {
      dryRun: true,
    });
    assert.equal(dry.status, 'dry-run');
    assert.equal(dry.cut_off, 0);
  }));

test('runChecklists: a request the writer cannot be given refuses the whole job; nothing is spent', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    // A valid ladder whose tasks have 4 checklist items: the writer is only ever asked for 5 to 8.
    const short = helpers.readJson(LADDER_FILE);
    for (const entry of short.tasks) {
      entry.rubric = entry.rubric.slice(0, 4);
      entry.defects = entry.defects.filter(
        (defect) => defect.rubric_item !== 4 && defect.rubric_item !== 5,
      );
    }
    delete short.doses.D4;
    assert.deepEqual(validateLadder(short).problems, []);
    const stub = stubCall();
    const summary = await run(layout, stub, {
      skills: [SKILL, 'fixture-d0'],
      ladder: short,
    });
    assert.equal(summary.status, 'refused');
    assert.equal(stub.calls.length, 0);
    assert.deepEqual(checklistFiles(layout), []);
    assert.match(
      summary.refused[0],
      /^2 request\(s\) cannot be given to the checklist writer/,
    );
    assert.match(
      summary.refused[1],
      /fixture-d0\/dose-ladder-test\/fx-1-chunk: .*4 items/,
    );
  }));

test('runChecklists: a copy that cannot be written is reported under its full label, and the other copies are still written', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const ladder = helpers.readJson(LADDER_FILE);
    const items = itemNames(ladder);
    const stub = stubCall();
    const failing = items[1];
    const summary = await run(layout, stub, {
      skills: items,
      ladder,
      writer: {
        ...NO_WAIT,
        write: (file, record) => {
          if (record.copied_from && file.includes(failing))
            throw new Error('EIO: input/output error');
          return requestChecklist.writeChecklistFile(file, record);
        },
      },
    });
    assert.equal(summary.results.failed.length, ladder.tasks.length);
    assert.ok(
      summary.results.failed.every(
        (entry) =>
          entry.task.startsWith(`${failing}/${ladder.set}/`) &&
          /EIO/.test(entry.reason),
      ),
      JSON.stringify(summary.results.failed),
    );
    assert.equal(
      summary.results.copied.length,
      ladder.tasks.length * (items.length - 2),
      'the copies for the other doses are written',
    );
  }));

test('runChecklists: a projection exactly at max_usd runs; a hair above it is refused', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const base = loadConfig({ defaultFile: layout.configFile });
    const ladder = helpers.readJson(LADDER_FILE);
    const only = { skills: itemNames(ladder), ladder };
    const dry = await run(layout, stubCall(), { ...only, dryRun: true });
    const projected = dry.projected_usd;
    assert.ok(projected > 0);
    const atLimit = await run(layout, stubCall(), {
      ...only,
      config: { ...base, max_usd: projected, total_cap_usd: projected + 10 },
    });
    assert.notEqual(atLimit.status, 'refused', atLimit.refused.join('; '));
    const fresh = createLayout({ root: dir, runId: 'other-run' });
    const over = await run(fresh, stubCall(), {
      ...only,
      config: {
        ...base,
        max_usd: Number((projected - 0.0001).toFixed(4)),
        total_cap_usd: projected + 10,
      },
    });
    assert.equal(over.status, 'refused');
    assert.match(over.refused[0], /above max_usd/);
  }));

test('runChecklists: the dose ladder items share their tasks, so each task is written once and copied for every other dose', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const ladder = helpers.readJson(LADDER_FILE);
    const items = itemNames(ladder);
    const stub = stubCall();
    const summary = await run(layout, stub, { skills: items, ladder });
    assert.equal(summary.status, 'done');
    assert.equal(stub.calls.length, ladder.tasks.length);
    assert.equal(summary.results.written.length, ladder.tasks.length);
    assert.equal(
      summary.results.copied.length,
      ladder.tasks.length * (items.length - 1),
    );
    for (const item of items)
      for (const entry of ladder.tasks)
        assert.ok(
          fs.existsSync(layout.checklistFile(item, ladder.set, entry.id)),
          `${item}/${entry.id}`,
        );
    // A task id repeats in every item, so a result names the item too.
    const labels = items.flatMap((item) =>
      ladder.tasks.map((entry) => `${item}/${ladder.set}/${entry.id}`),
    );
    assert.deepEqual(
      [...summary.results.written, ...summary.results.copied].sort(),
      [...labels].sort(),
    );
    assert.ok(summary.results.copied.every((label) => labels.includes(label)));
  }));

test('runChecklists: a copy whose source failed fails with the item in its name; the source is named too', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const ladder = helpers.readJson(LADDER_FILE);
    const items = itemNames(ladder);
    const stub = stubCall((args) =>
      args.label.includes('fx-1-chunk')
        ? { ...okReply(args), text: 'not json' }
        : okReply(args),
    );
    const summary = await run(layout, stub, { skills: items, ladder });
    assert.equal(summary.status, 'partial');
    assert.deepEqual(
      summary.results.failed.map((entry) => entry.task).sort(),
      items.map((item) => `${item}/${ladder.set}/fx-1-chunk`).sort(),
    );
    const copies = summary.results.failed.filter((entry) =>
      /has no checklist$/.test(entry.reason),
    );
    assert.equal(copies.length, items.length - 1);
    assert.equal(summary.results.written.length, ladder.tasks.length - 1);
    assert.equal(summary.remaining, items.length);
  }));

test('runChecklists: a non-fatal error inside a task is a failure of that task, named with its skill and batch', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const summary = await run(layout, stubCall(), {
      writer: {
        ...NO_WAIT,
        now: () => {
          throw new Error('the clock broke');
        },
      },
    });
    assert.equal(summary.status, 'partial');
    assert.deepEqual(
      summary.results.failed.map((entry) => entry.task).sort(),
      [1, 2, 4, 5].map((n) => `${SKILL}/b1/brew-log-rules-${n}`),
    );
    assert.ok(
      summary.results.failed.every((entry) => /clock broke/.test(entry.reason)),
    );
    assert.deepEqual(checklistFiles(layout), []);
  }));

test('runChecklists: a skill and ladder items together: plan gates the skill, the ladder gives the items', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const ladder = helpers.readJson(LADDER_FILE);
    const stub = stubCall();
    const summary = await run(layout, stub, {
      skills: [SKILL, 'fixture-d0'],
      ladder,
    });
    assert.equal(summary.status, 'done');
    assert.equal(stub.calls.length, 4 + ladder.tasks.length);
  }));

test('runChecklists: a malformed exclusions file refuses a run of ladder items alone, as it does for a skill, and calls nothing', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const ladder = helpers.readJson(LADDER_FILE);
    const items = itemNames(ladder);
    for (const content of [
      '{"format_version": 1, "batches": ',
      JSON.stringify({
        format_version: 1,
        batches: { b1: { scenarios: [{ id: 'x' }] } },
      }),
    ]) {
      fs.writeFileSync(layout.exclusionsFile, content);
      const stub = stubCall();
      const summary = await run(layout, stub, { skills: items, ladder });
      assert.equal(summary.status, 'refused');
      assert.equal(summary.refused.length, 1);
      assert.ok(
        summary.refused[0].startsWith(
          `${layout.exclusionsFile}: not a valid exclusions file`,
        ),
        summary.refused[0],
      );
      assert.equal(stub.calls.length, 0);
      assert.deepEqual(checklistFiles(layout), []);
      // The same file refuses a skill through `plan`.
      const forSkill = await run(layout, stubCall());
      assert.equal(forSkill.status, 'refused');
    }
    // A file that cannot be read at all is not a format problem and still throws.
    fs.rmSync(layout.exclusionsFile);
    fs.mkdirSync(layout.exclusionsFile);
    await assert.rejects(
      run(layout, stubCall(), { skills: items, ladder }),
      (error) => error.code === 'EISDIR',
    );
  }));

test('runChecklists: a provider block on every try makes the job partial and names the task for the exclusions file', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const stub = stubCall((args) =>
      args.label.includes('brew-log-rules-2')
        ? failedReply('Provider blocked the response')
        : okReply(args),
    );
    const summary = await run(layout, stub);
    assert.equal(summary.status, 'partial');
    assert.deepEqual(
      summary.results.blocked.map((entry) => entry.task),
      ['brew-log/b1/brew-log-rules-2'],
    );
    assert.equal(summary.results.written.length, 3);
    assert.equal(summary.remaining, 1);
    assert.ok(
      summary.warnings.some(
        (line) =>
          line.startsWith('brew-log/b1/brew-log-rules-2:') &&
          line.includes('bench/exclusions.json'),
      ),
    );
    assert.ok(
      !fs.existsSync(layout.checklistFile(SKILL, 'b1', 'brew-log-rules-2')),
    );
  }));

test('runChecklists: once a person records the blocked task in bench/exclusions.json, the rerun is done with no call', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    await run(
      layout,
      stubCall((args) =>
        args.label.includes('brew-log-rules-2')
          ? failedReply('Provider blocked the response')
          : okReply(args),
      ),
    );
    helpers.update(layout.exclusionsFile, (data) => {
      data.batches.b1.scenarios.push({
        id: 'brew-log-rules-2',
        scales: ['outcome'],
        reason: 'the provider blocked the checklist writer on both tries',
        date: '2026-11-10',
      });
    });
    const again = stubCall();
    const summary = await run(layout, again);
    assert.equal(summary.status, 'done');
    assert.equal(again.calls.length, 0);
    assert.deepEqual(
      summary.excluded.map((entry) => entry.id),
      ['brew-log-rules-2', EXCLUDED],
    );
  }));

test('runChecklists: a task whose calls all fail is partial; its file is not written and a rerun tries it again', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const stub = stubCall((args) =>
      args.label.includes('brew-log-rules-4')
        ? { ...okReply(args), text: 'not json' }
        : okReply(args),
    );
    const summary = await run(layout, stub);
    assert.equal(summary.status, 'partial');
    assert.deepEqual(
      summary.results.failed.map((entry) => entry.task),
      ['brew-log/b1/brew-log-rules-4'],
    );
    const again = stubCall();
    const rerun = await run(layout, again);
    assert.equal(rerun.status, 'done');
    assert.equal(again.calls.length, 1);
  }));

test('runChecklists: credentials missing, or less than 3 minutes from expiry, stop the job before any call', async () => {
  for (const getCredentials of [
    async () => {
      throw new CredentialError('no AWS profile is named');
    },
    async () => ({ ...FRESH, expiration: '2026-11-10T12:02:00Z' }),
  ])
    await helpers.withTmpAsync(async (dir) => {
      fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
      const layout = createLayout({ root: dir });
      const stub = stubCall();
      const summary = await run(layout, stub, { getCredentials });
      assert.equal(summary.status, 'stopped');
      assert.equal(summary.stop.kind, 'credentials');
      assert.equal(stub.calls.length, 0);
      assert.deepEqual(checklistFiles(layout), []);
      assert.equal(summary.remaining, 4);
      // Checked once before the job starts, not only by the first call.
      assert.match(
        summary.stop.message,
        /no AWS profile|so the checklist job was not started/,
      );
    });
});

test('runChecklists: credentials that near expiry during the job stop it at the next call; finished checklists are kept', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    let clock = NOW_MS;
    const stub = stubCall((args) => {
      clock = Date.parse('2026-11-10T12:58:00Z');
      return okReply(args);
    });
    const summary = await run(layout, stub, {
      now: () => clock,
      writer: { ...NO_WAIT, concurrency: 1 },
    });
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.stop.kind, 'credentials');
    assert.equal(stub.calls.length, 1);
    assert.equal(checklistFiles(layout).length, 1);
    assert.equal(summary.remaining, 3);
  }));

test('runChecklists: a spend stop from the ledger stops the job; what was written is kept', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const stub = stubCall((args, index) => {
      if (index === 0) return okReply(args);
      throw new SpendStopError('max_usd reached', 'max_usd');
    });
    const summary = await run(layout, stub, {
      writer: { ...NO_WAIT, concurrency: 1 },
    });
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.stop.kind, 'spend');
    assert.equal(checklistFiles(layout).length, 1);
  }));

test('runChecklists: a stopped job still reports the spend and the checklist written before the stop', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const stub = stubCall((args, index) => {
      if (index === 0) return okReply(args);
      throw new SpendStopError('max_usd reached', 'max_usd');
    });
    const summary = await run(layout, stub, {
      writer: { ...NO_WAIT, concurrency: 1 },
    });
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.usd, 0.002, 'the cost the CLI reported');
    assert.equal(summary.results.written.length, 1);
    assert.match(summary.results.written[0], new RegExp(`^${SKILL}/b1/`));
    assert.deepEqual(summary.results.copied, []);
    assert.equal(summary.remaining, 3);
  }));

test('runChecklists: a stop keeps what finished before it: the written, the failed and the blocked tasks, each named', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    // All four tasks are in flight together: one fails, one is blocked, one is written, and the fourth stops the job.
    const stub = stubCall((args) => {
      if (args.label.includes('brew-log-rules-1'))
        return failedReply('connection reset by peer');
      if (args.label.includes('brew-log-rules-2'))
        return failedReply('Provider blocked the response');
      if (args.label.includes('brew-log-rules-5'))
        throw new SpendStopError('max_usd reached', 'max_usd');
      return okReply(args);
    });
    const summary = await run(layout, stub);
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.stop.kind, 'spend');
    assert.deepEqual(summary.results.written, [`${SKILL}/b1/brew-log-rules-4`]);
    assert.deepEqual(
      summary.results.failed.map((entry) => entry.task),
      [`${SKILL}/b1/brew-log-rules-1`],
    );
    assert.deepEqual(
      summary.results.blocked.map((entry) => entry.task),
      [`${SKILL}/b1/brew-log-rules-2`],
    );
    assert.equal(summary.remaining, 3);
  }));

test('runChecklists: 4 tasks in a row whose every call failed stop the job as systemic', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const stub = stubCall(() => failedReply('connection reset by peer'));
    const summary = await run(layout, stub, {
      writer: { ...NO_WAIT, concurrency: 1 },
    });
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.stop.kind, 'systemic');
    assert.match(summary.stop.message, /ABORT-SYSTEMIC/);
  }));

test('runChecklists: the job passes a redactor with the exported values to the ledger and the breaker, so a bare value is removed from a label and from the systemic stop message', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const bare = FRESH.secretAccessKey;
    const labelled = stubCall(async (args) => {
      (await args.ledger.reserve(0.001, `note ${bare}`)).cancel();
      return okReply(args);
    });
    assert.equal((await run(layout, labelled)).status, 'done');
    const ledgerText = fs.readFileSync(layout.ledgerFile, 'utf8');
    assert.ok(ledgerText.includes('note [REDACTED]'), 'the label was written');
    assert.ok(!ledgerText.includes(bare), 'no bare value in the ledger');

    const failing = stubCall(() => failedReply(`connection reset ${bare}`));
    fs.rmSync(path.join(layout.runDir, 'checklists'), {
      recursive: true,
      force: true,
    });
    const summary = await run(layout, failing, {
      writer: { ...NO_WAIT, concurrency: 1 },
    });
    assert.equal(summary.stop.kind, 'systemic');
    assert.match(
      summary.stop.message,
      /\(last: connection reset \[REDACTED\]\)/,
    );
    assert.ok(!summary.stop.message.includes(bare));
  }));

test('runChecklists: a ledger error from a call stops the job', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const stub = stubCall();
    const summary = await run(layout, stub, {
      judgeCall: async () => {
        throw new LedgerError('the ledger lock cannot be taken');
      },
    });
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.stop.kind, 'ledger');
    assert.deepEqual(checklistFiles(layout), []);
  }));

test('runChecklists: an error that is not a stop is a bug and is thrown', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    await assert.rejects(
      run(layout, stubCall(), {
        getCredentials: async () => {
          throw new TypeError('a bug');
        },
      }),
      TypeError,
    );
  }));

test('runChecklists: an expired-token error from a writer call stops the job as credentials and reports the spend and the checklist written before it', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const stub = stubCall((args, index) =>
      index === 0
        ? okReply(args)
        : failedReply(
            'ExpiredToken: The security token included in the request is expired',
          ),
    );
    const summary = await run(layout, stub, {
      writer: { ...NO_WAIT, concurrency: 1 },
    });
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.stop.kind, 'credentials');
    assert.match(summary.stop.message, /^AWS credentials missing or expired/);
    assert.equal(stub.calls.length, 2, 'no retry after an expired token');
    assert.equal(checklistFiles(layout).length, 1);
    assert.equal(summary.results.written.length, 1);
    assert.ok(summary.usd > 0, 'the first call is reported');
  }));

test('job main: an expired-token error from a writer call ends the job with exit 4 and a last line', async () => {
  const stub = stubCall((args, index) =>
    index === 0
      ? okReply(args)
      : failedReply(
          'ExpiredToken: The security token included in the request is expired',
        ),
  );
  const result = await runJobMain(CHECKLISTS, stub, {
    writer: { ...NO_WAIT, concurrency: 1 },
  });
  assert.equal(result.code, 4, result.err);
  assert.equal(result.last.status, 'stopped');
  assert.equal(result.last.stop.kind, 'credentials');
});

test('runChecklists: a ladder that fails its audit is refused before any call, when it reaches the job without the launcher', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const ladder = helpers.readJson(LADDER_FILE);
    delete ladder.doses.D0;
    const stub = stubCall();
    const summary = await run(layout, stub, { skills: ['fixture-d1'], ladder });
    assert.equal(summary.status, 'refused');
    assert.match(summary.refused[0], /fails its audit: .*no D0/);
    assert.equal(stub.calls.length, 0);
  }));

test('job main: a ladder file that fails its audit is a usage error (64) that names the problem', async () => {
  await helpers.withTmpAsync(async (folder) => {
    const ladder = helpers.readJson(LADDER_FILE);
    delete ladder.doses.D0;
    const file = path.join(folder, 'ladder.json');
    helpers.write(file, ladder);
    const stub = stubCall();
    const result = await runJobMain(
      [
        'checklists',
        '--skills',
        'fixture-d1',
        '--root',
        '<root>',
        '--ladder',
        file,
      ],
      stub,
    );
    assert.equal(result.code, 64, result.err);
    assert.match(result.err, /fails the dose ladder audit: .*no D0/);
    assert.equal(stub.calls.length, 0);
  });
});

test('stopFor: each stop error has its kind; anything else is not a stop', () => {
  assert.equal(
    checklistJob.stopFor(new CredentialError('x')).kind,
    'credentials',
  );
  assert.equal(checklistJob.stopFor(new SpendStopError('x')).kind, 'spend');
  assert.equal(checklistJob.stopFor(new LedgerError('x')).kind, 'ledger');
  assert.equal(
    checklistJob.stopFor(new SystemicFailureError('x')).kind,
    'systemic',
  );
  assert.equal(checklistJob.stopFor(new Error('x')), null);
  assert.equal(checklistJob.stopFor(new TypeError('x')), null);
  assert.equal(
    checklistJob.stopFor(new CallError('credential', 'expired', 1)).kind,
    'credentials',
    'a credential failure that a writer call returned',
  );
  assert.equal(
    checklistJob.stopFor(new CallError('permanent', 'no', 1)),
    null,
    'another class of call error is not a stop',
  );
});

test('stopFor: the message is cleaned by the redactor it is given, and cut to 400 characters', () => {
  const bare = 'bareValueOnlyTheRunKnows123456';
  const runRedactor = createRedactor({ literals: [bare] });
  const text = `session ${bare} expired ${'x'.repeat(600)}`;
  const withRun = checklistJob.stopFor(new SpendStopError(text), runRedactor);
  assert.ok(!withRun.message.includes(bare));
  assert.match(withRun.message, /\[truncated \d+ characters\]$/);
  assert.ok(
    checklistJob.stopFor(new SpendStopError(text)).message.includes(bare),
    'the module redactor does not know the value',
  );
});

test('runChecklists: the stop message cannot quote a value only the run knows', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const layout = createLayout({ root: dir });
    const stub = stubCall((args, index) => {
      if (index === 0) return okReply(args);
      throw new SpendStopError(
        `over the cap for ${FRESH.sessionToken}`,
        'max_usd',
      );
    });
    const summary = await run(layout, stub, {
      writer: { ...NO_WAIT, concurrency: 1 },
    });
    assert.equal(summary.stop.kind, 'spend');
    assert.ok(!summary.stop.message.includes(FRESH.sessionToken));
  }));

// ---- job.js checklists ---------------------------------------------------------------------------------------------

/** Runs job.main checklists on a copy of the fixture repo with the stub. Returns { code, out, err, last }. */
function runJobMain(argv, stub, options = {}) {
  return helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    let out = '';
    let err = '';
    const code = await job.main(
      argv.map((word) => (word === '<root>' ? dir : word)),
      { out: (text) => (out += text), err: (text) => (err += text) },
      {
        env: {},
        checklistOptions: {
          judgeCall: stub.judgeCall,
          getCredentials: async () => FRESH,
          now: () => NOW_MS,
          writer: NO_WAIT,
          ...options,
        },
      },
    );
    let last = null;
    try {
      last = JSON.parse(out.trim().split('\n').at(-1));
    } catch {
      last = null;
    }
    return { code, out, err, last };
  });
}
const CHECKLISTS = ['checklists', '--skills', SKILL, '--root', '<root>'];

test('job main checklists: a spend stop after a paid call prints that spend on the last line', async () => {
  const stub = stubCall((args, index) => {
    if (index === 0) return okReply(args);
    throw new SpendStopError('max_usd reached', 'max_usd');
  });
  const result = await runJobMain(CHECKLISTS, stub, {
    writer: { ...NO_WAIT, concurrency: 1 },
  });
  assert.equal(result.code, 5, result.err);
  assert.equal(result.last.status, 'stopped');
  assert.equal(result.last.usd, 0.002, 'the cost the CLI reported');
  assert.equal(result.last.results.written, 1);
});

test('job main checklists: done is exit 0 with the counts on the last line', async () => {
  const stub = stubCall();
  const result = await runJobMain(CHECKLISTS, stub);
  assert.equal(result.code, 0, result.err);
  assert.deepEqual(
    {
      ...result.last,
      usd: undefined,
    },
    {
      job: 'checklists',
      run_id: 'default',
      skills: [SKILL],
      status: 'done',
      exit_code: 0,
      stop: null,
      tasks: 4,
      done: 0,
      pending: 4,
      copies: 0,
      remaining: 0,
      excluded: 1,
      results: { written: 4, copied: 0, failed: 0, blocked: 0 },
      usd: undefined,
      skipped: [],
    },
  );
  assert.ok(result.last.usd > 0);
  assert.match(result.out, /brew-log-rules-3: excluded from reading A/);
});

test('job main checklists: a rerun with every checklist current is exit 0 even when the credentials have expired', () =>
  helpers.withTmpAsync(async (dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const main = async (checklistOptions) => {
      let out = '';
      const code = await job.main(
        ['checklists', '--skills', SKILL, '--root', dir],
        { out: (text) => (out += text), err: () => {} },
        {
          env: {},
          checklistOptions: { now: () => NOW_MS, ...checklistOptions },
        },
      );
      return { code, out };
    };
    const first = await main({
      judgeCall: stubCall().judgeCall,
      getCredentials: async () => FRESH,
      writer: NO_WAIT,
    });
    assert.equal(first.code, 0, first.out);
    const again = stubCall();
    const second = await main({
      judgeCall: again.judgeCall,
      getCredentials: async () => {
        throw new CredentialError('the credentials expired');
      },
      writer: NO_WAIT,
    });
    assert.equal(second.code, 0, second.out);
    assert.equal(again.calls.length, 0);
    assert.equal(
      JSON.parse(second.out.trim().split('\n').at(-1)).status,
      'done',
    );
  }));

test('job main checklists: a provider block is exit 3 and the task is printed by name', async () => {
  const stub = stubCall((args) =>
    args.label.includes('brew-log-rules-5')
      ? failedReply('Provider blocked the response')
      : okReply(args),
  );
  const result = await runJobMain(CHECKLISTS, stub);
  assert.equal(result.code, 3);
  assert.match(
    result.out,
    /blocked by the provider: brew-log\/b1\/brew-log-rules-5/,
  );
  assert.equal(result.last.results.blocked, 1);
});

test('job main checklists: each stop has its exit code: credentials 4, spend 5, ledger 6, systemic 9', async () => {
  const cases = [
    [
      4,
      {
        getCredentials: async () =>
          Promise.reject(new CredentialError('expired')),
      },
      stubCall(),
    ],
    [
      5,
      {},
      stubCall(() => {
        throw new SpendStopError('total_cap_usd reached', 'total_cap_usd');
      }),
    ],
    [
      6,
      {},
      stubCall(() => {
        throw new LedgerError('lock busy');
      }),
    ],
    [9, {}, stubCall(() => failedReply('connection reset by peer'))],
  ];
  for (const [code, options, stub] of cases) {
    const result = await runJobMain(CHECKLISTS, stub, {
      writer: { ...NO_WAIT, concurrency: 1 },
      ...options,
    });
    assert.equal(result.code, code, result.out);
    assert.equal(result.last.exit_code, code);
    assert.match(result.out, /STOP \(/);
  }
});

test('job main checklists: --dry-run is exit 0 and makes no call; --ladder lets --skills name the ladder items', async () => {
  const stub = stubCall();
  const dry = await runJobMain([...CHECKLISTS, '--dry-run'], stub);
  assert.equal(dry.code, 0, dry.err);
  assert.equal(dry.last.status, 'dry-run');
  assert.equal(stub.calls.length, 0);
  const ladder = await runJobMain(
    [
      'checklists',
      '--skills',
      'fixture-d0,fixture-d1',
      '--root',
      '<root>',
      '--ladder',
      LADDER_FILE,
    ],
    stub,
  );
  assert.equal(ladder.code, 0, ladder.err);
  assert.equal(ladder.last.results.written, 2);
  assert.equal(ladder.last.results.copied, 2);
});

test('job main: a ladder item without --ladder, --ladder on pairs, and a ladder that fails its audit are usage errors (64)', async () => {
  const broken = path.join(helpers.FIXTURE_DIR, 'dose-ladder', 'missing.json');
  for (const argv of [
    ['checklists', '--skills', 'fixture-d0', '--root', '<root>'],
    ['pairs', '--skills', SKILL, '--root', '<root>', '--ladder', LADDER_FILE],
    ['checklists', '--skills', SKILL, '--root', '<root>', '--ladder', broken],
  ]) {
    const stub = stubCall();
    const result = await runJobMain(argv, stub);
    assert.equal(result.code, 64, `${argv.join(' ')}: ${result.err}`);
    assert.equal(stub.calls.length, 0);
  }
});

// ---- the launcher's request check -----------------------------------------------------------------------------

test('resolveJobRequest checklists: --ladder adds its item names to what --skills may name, and the job gets the file', () =>
  helpers.withTmp((dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const resolved = launchLib.resolveJobRequest('checklists', {
      skills: `fixture-d1,${SKILL}`,
      root: dir,
      ladder: LADDER_FILE,
    });
    assert.deepEqual(resolved.skills, [SKILL, 'fixture-d1']);
    assert.equal(resolved.ladderFile, LADDER_FILE);
    assert.deepEqual(resolved.ladder, helpers.readJson(LADDER_FILE));
    assert.deepEqual(launchLib.jobArguments(resolved, { dryRun: false }), [
      'checklists',
      '--skills',
      `${SKILL},fixture-d1`,
      '--run',
      'default',
      '--root',
      dir,
      '--ladder',
      LADDER_FILE,
    ]);
    const plain = launchLib.resolveJobRequest('checklists', {
      skills: SKILL,
      root: dir,
    });
    assert.equal(plain.ladder, null);
    assert.ok(
      !launchLib.jobArguments(plain, { dryRun: false }).includes('--ladder'),
    );
  }));

test('resolveJobRequest: a relative --ladder is made absolute for the job, and an unreadable or malformed ladder file is a usage error that names the problem', () =>
  helpers.withTmp((dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const relative = path.relative(process.cwd(), LADDER_FILE);
    assert.ok(!path.isAbsolute(relative));
    const resolved = launchLib.resolveJobRequest('checklists', {
      skills: SKILL,
      root: dir,
      ladder: relative,
    });
    assert.equal(resolved.ladderFile, LADDER_FILE);
    const args = launchLib.jobArguments(resolved, { dryRun: false });
    assert.equal(args[args.indexOf('--ladder') + 1], LADDER_FILE);
    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, 'this is not json');
    for (const [file, pattern] of [
      [broken, /^--ladder: /],
      [path.join(dir, 'absent.json'), /^--ladder: .*(ENOENT|no such file)/],
    ])
      assert.throws(
        () =>
          launchLib.resolveJobRequest('checklists', {
            skills: SKILL,
            root: dir,
            ladder: file,
          }),
        (error) => error instanceof UsageError && pattern.test(error.message),
        file,
      );
  }));

test('resolveJobRequest: a ladder that fails its audit is refused with the audit problem', () =>
  helpers.withTmp((dir) => {
    fs.cpSync(helpers.fixtureRoot(), dir, { recursive: true });
    const ladder = helpers.readJson(LADDER_FILE);
    delete ladder.doses.D0;
    const file = path.join(dir, 'ladder.json');
    helpers.write(file, ladder);
    assert.throws(
      () =>
        launchLib.resolveJobRequest('checklists', {
          skills: SKILL,
          root: dir,
          ladder: file,
        }),
      /fails the dose ladder audit: .*no D0/,
    );
  }));
