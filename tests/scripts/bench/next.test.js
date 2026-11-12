// SPDX-License-Identifier: Apache-2.0
// Tests for the driver's `next` command (scripts/bench/lib/next.js and bench.js next): the job it names in stage
// order, the spend and time limits, a refused plan, a run that ends partial, the usage errors, and that it writes
// nothing. The jobs it names run with the stub provider on a copy of the fixture repo: no model, AWS or network call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const bench = require('../../../scripts/bench/bench');
const job = require('../../../scripts/bench/job');
const { createLayout } = require('../../../scripts/bench/lib/layout');
const {
  MINUTES_PER_CALL,
  START_SKEW_MS,
  STEPS,
} = require('../../../scripts/bench/lib/next');
const { sha256 } = require('../../../scripts/bench/lib/provenance');
const opencode = require('../../../scripts/bench/lib/opencode');
const { stubProcess } = require('../../../scripts/bench/lib/stub-provider');
const helpers = require('./helpers');

const SKILL = helpers.SKILL;
// A stub run id holds stub data and takes only --provider stub, so the tests of the live provider use another id.
const RUN = 'stub-next';
const LIVE_RUN = 'next-live';
const LADDER_FILE = path.join(
  helpers.FIXTURE_DIR,
  'dose-ladder',
  'ladder-small.json',
);
const START = '2026-11-12T10:00:00Z';
const START_MS = Date.parse(START);
const minutes = (count) => START_MS + count * 60000;

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

/** Runs callback({ root, layout, next, runJob }) on a copy of the fixture repo, in the run `run`. */
function withRepo(callback, run = RUN) {
  return helpers.withTmpAsync(async (dir) => {
    const root = path.join(dir, 'repo');
    fs.cpSync(helpers.fixtureRoot(), root, { recursive: true });
    const layout = createLayout({ root, runId: run });
    const base = ['--skills', SKILL, '--run', run, '--root', root];
    /** `next` with `args` after the common ones: { code, result, errors }. */
    const next = async (args = [], nextOptions = {}) => {
      const io = capture();
      const code = await bench.main(
        ['next', ...base, ...args],
        io,
        {},
        nextOptions,
      );
      return {
        code,
        result: io.text ? JSON.parse(io.text) : null,
        errors: io.errors,
      };
    };
    /** Runs the job a `next` result names, in this process; `options` are job.main test options. */
    const runJob = async (result, options = {}) => {
      const io = capture();
      const code = await job.main(result.command.slice(2), io, options);
      assert.ok([0, 3].includes(code), io.text + io.errors);
      return code;
    };
    return callback({ root, layout, next, runJob });
  });
}

/** withRepo in the run LIVE_RUN, for the tests that use the live provider (the default). */
const withLiveRepo = (callback) => withRepo(callback, LIVE_RUN);

/** Every file under `dir` with its size, to show that a command wrote nothing. */
const tree = (dir) =>
  fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .sort()
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return `${name}:${stat.isDirectory() ? 'dir' : stat.size}`;
    });

test('next on a fresh run names the pairs job with its command, and writes no file', () =>
  withLiveRepo(async ({ root, next }) => {
    const before = tree(root);
    const { code, result } = await next();
    assert.equal(code, 0);
    assert.equal(result.next, 'job');
    assert.equal(result.job, 'pairs');
    assert.equal(result.stage, 2);
    assert.equal(result.run_id, LIVE_RUN);
    assert.deepEqual(result.skills, [SKILL]);
    assert.equal(result.pending, 10);
    // 10 runs at the subject model's upper estimate (p90) in the cost profile, the amount the ledger reserves.
    assert.equal(result.estimated_usd, 1.2123);
    // 10 runs at the default 6 at once: 2 waves.
    assert.equal(result.estimated_minutes, 2 * MINUTES_PER_CALL.subject);
    assert.equal('scale' in result, false);
    assert.deepEqual(result.command, [
      'node',
      'scripts/bench/job.js',
      'pairs',
      '--skills',
      SKILL,
      '--run',
      LIVE_RUN,
      '--root',
      root,
    ]);
    assert.deepEqual(tree(root), before, 'next writes no file');
  }));

test('next names the jobs in stage order and ends done; the stub provider is passed on', () =>
  withRepo(async ({ next, runJob }) => {
    const seen = [];
    for (let round = 0; round < STEPS.length + 1; round += 1) {
      const { code, result } = await next(['--provider', 'stub']);
      assert.equal(code, 0);
      if (result.next === 'done') {
        assert.deepEqual(result, {
          next: 'done',
          status: 'done',
          run_id: RUN,
          skills: [SKILL],
          not_loaded: 0,
          ineligible: 0,
          blocked: 0,
        });
        break;
      }
      assert.deepEqual(result.command.slice(-2), ['--provider', 'stub']);
      seen.push(`${result.job}${result.scale ? `:${result.scale}` : ''}`);
      assert.equal(await runJob(result), 0);
    }
    assert.deepEqual(seen, [
      'pairs',
      'judge:items',
      'checklists',
      'judge:outcome',
    ]);
  }));

test('a finished run is done whatever limit it has reached: time elapsed, or more spent than max_usd', () =>
  withRepo(async ({ next, runJob }) => {
    for (let round = 0; round < STEPS.length + 1; round += 1) {
      const { result } = await next(['--provider', 'stub']);
      if (result.next === 'done') break;
      assert.equal(await runJob(result), 0);
    }
    const expected = {
      next: 'done',
      status: 'done',
      run_id: RUN,
      skills: [SKILL],
      not_loaded: 0,
      ineligible: 0,
      blocked: 0,
    };
    const late = await next(
      ['--provider', 'stub', '--max-minutes', '10', '--started-at', START],
      { now: () => minutes(600) },
    );
    assert.equal(late.code, 0, JSON.stringify(late.result));
    assert.deepEqual(late.result, expected);
    const spent = await next(['--provider', 'stub', '--max-usd', '0.01']);
    assert.equal(spent.code, 0, JSON.stringify(spent.result));
    assert.deepEqual(spent.result, expected);
  }));

test('a run with work left still stops at a limit that is reached: max_minutes elapsed, or max_usd below what is spent', () =>
  withRepo(async ({ next, runJob }) => {
    const first = await next(['--provider', 'stub']);
    assert.equal(first.result.job, 'pairs');
    assert.equal(await runJob(first.result), 0);
    const late = await next(
      ['--provider', 'stub', '--max-minutes', '10', '--started-at', START],
      { now: () => minutes(600) },
    );
    assert.equal(late.code, 1);
    assert.equal(late.result.kind, 'time');
    const spent = await next(['--provider', 'stub', '--max-usd', '0.01']);
    assert.equal(spent.code, 1);
    assert.equal(spent.result.kind, 'spend');
  }));

test('next stops at max_minutes, and before a job whose estimate does not fit in the time left', () =>
  withLiveRepo(async ({ next }) => {
    const limit = ['--max-minutes', '30', '--started-at', START];
    const reached = await next(limit, { now: () => minutes(30) });
    assert.equal(reached.code, 1);
    assert.equal(reached.result.next, 'stop');
    assert.equal(reached.result.kind, 'time');
    assert.match(reached.result.reason, /max_minutes 30 is reached/);

    // The pairs job is estimated at 6 minutes: it starts with exactly 6 left and not with less.
    const fits = await next(limit, { now: () => minutes(24) });
    assert.equal(fits.result.next, 'job');
    assert.equal(fits.result.estimated_minutes, 6);
    const tooLong = await next(limit, { now: () => minutes(24.5) });
    assert.equal(tooLong.code, 1);
    assert.equal(tooLong.result.kind, 'time');
    assert.match(
      tooLong.result.reason,
      /the next job \(pairs, 10 call\(s\)\) needs about 6 minute\(s\) and 5 of max_minutes 30 are left; finished work is kept, rerun to continue$/,
    );
    // The 6 minutes of the pairs job do not fit in a limit of 5 even at the start: a rerun cannot help.
    const alone = await next(['--max-minutes', '5', '--started-at', START], {
      now: () => minutes(0),
    });
    assert.equal(alone.code, 1);
    assert.equal(alone.result.kind, 'time');
    assert.match(
      alone.result.reason,
      /needs about 6 minute\(s\) and 5 of max_minutes 5 are left; finished work is kept, and this job needs more than max_minutes on its own, so raise max_minutes$/,
    );
    // A job that fits the whole limit exactly is not "longer than max_minutes".
    const exact = await next(['--max-minutes', '6', '--started-at', START], {
      now: () => minutes(0),
    });
    assert.equal(exact.result.next, 'job');
    const late = await next(['--max-minutes', '6', '--started-at', START], {
      now: () => minutes(1),
    });
    assert.match(late.result.reason, /rerun to continue$/);
  }));

test('next stops with kind spend when the plan is above max_usd or the ledger is past total_cap_usd', () =>
  withLiveRepo(async ({ layout, next }) => {
    const over = await next(['--max-usd', '1']);
    assert.equal(over.code, 1);
    assert.equal(over.result.next, 'stop');
    assert.equal(over.result.kind, 'spend');
    assert.match(over.result.reason, /above max_usd/);

    // Another run spent 99.5 of the 100 total_cap_usd: this run's own spend is 0, but the ledger has no room.
    helpers.writeLedger(
      path.join(layout.root, 'bench', 'out', 'ledger.jsonl'),
      [
        {
          type: 'reserve',
          id: 'other1',
          ts: '2026-11-12T09:00:00.000Z',
          run: 'other',
          label: 'subject other',
          usd: 99.5,
          expires: '2026-11-12T09:12:00.000Z',
        },
        {
          type: 'settle',
          id: 'other1',
          ts: '2026-11-12T09:01:00.000Z',
          run: 'other',
          label: 'subject other',
          usd: 99.5,
          status: 'ok',
          model: 'claude-sonnet-5-5',
          cost_source: 'reported',
        },
      ],
    );
    const ledgerFull = await next();
    assert.equal(ledgerFull.code, 1);
    assert.equal(ledgerFull.result.kind, 'spend');
    assert.match(ledgerFull.result.reason, /the ledger holds/);
    assert.match(ledgerFull.result.reason, /above total_cap_usd \$100\.00/);
  }));

test('next stops with kind refused when the plan refuses the baseline', () =>
  withLiveRepo(async ({ layout, next }) => {
    fs.writeFileSync(layout.rulesFile(SKILL), '{ not json');
    const { code, result } = await next();
    assert.equal(code, 1);
    assert.equal(result.next, 'stop');
    assert.equal(result.kind, 'refused');
    assert.match(result.reason, /brew-log/);
  }));

test('next stops with kind refused, not a crash, when the ledger cannot be read', () =>
  withLiveRepo(async ({ layout, next }) => {
    const ledgerFile = path.join(layout.root, 'bench', 'out', 'ledger.jsonl');
    fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
    fs.writeFileSync(ledgerFile, 'not json\n{"type":"note"}\n');
    const { code, result, errors } = await next();
    assert.equal(code, 1, errors);
    assert.equal(result.next, 'stop');
    assert.equal(result.kind, 'refused');
    assert.match(result.reason, /corrupt ledger line 1/);
  }));

test('next stops with kind refused when a job refuses what the plan passed', () =>
  withRepo(async ({ next, runJob }) => {
    for (const expected of ['pairs', 'judge']) {
      const step = await next(['--provider', 'stub']);
      assert.equal(step.result.job, expected);
      await runJob(step.result);
    }
    // A dose ladder whose tasks have 4 checklist items: the writer is only ever asked for 5 to 8, so the checklists
    // job refuses it while it has no call pending. Without the stop, `next` would go on to the outcome judge.
    const short = helpers.readJson(LADDER_FILE);
    for (const entry of short.tasks) {
      entry.rubric = entry.rubric.slice(0, 4);
      entry.defects = entry.defects.filter(
        (defect) => defect.rubric_item !== 4 && defect.rubric_item !== 5,
      );
    }
    delete short.doses.D4;
    const { code, result } = await next(['--provider', 'stub'], {
      jobOptions: { checklists: { skills: ['fixture-d0'], ladder: short } },
    });
    assert.equal(code, 1);
    assert.equal(result.next, 'stop');
    assert.equal(result.kind, 'refused');
    assert.match(
      result.reason,
      /request\(s\) cannot be given to the checklist writer/,
    );
  }));

test('the stop line stays whole JSON when the plan lists hundreds of problems, and its reason is cut', () =>
  withLiveRepo(async ({ root, next }) => {
    helpers.update(
      path.join(root, 'bench', 'baselines', SKILL, 'tasks-b1.json'),
      (tasks) => {
        tasks.scenarios = Array.from({ length: 400 }, () => ({}));
      },
    );
    // `next` parses the line, so a line cut in the middle of a string fails here.
    const { code, result } = await next();
    assert.equal(code, 1);
    assert.equal(result.next, 'stop');
    assert.equal(result.kind, 'refused');
    assert.match(result.reason, /^brew-log: tasks-b1\.json: scenarios\[/);
    assert.match(result.reason, /\[truncated \d+ characters\]$/);
    assert.ok(
      result.reason.length < 2050,
      `reason has ${result.reason.length} characters`,
    );
  }));

test('the next line is redacted: a secret-shaped value in a baseline file or in a path is not printed', () =>
  withLiveRepo(async ({ root, layout, next }) => {
    const key = 'AKIAABCDEFGHIJKLMNOP';
    // The refusal text echoes the bad value.
    helpers.update(
      path.join(root, 'bench', 'baselines', SKILL, 'tasks-b1.json'),
      (tasks) => {
        tasks.format_version = key;
      },
    );
    const refused = await next();
    assert.equal(refused.result.kind, 'refused');
    assert.match(
      refused.result.reason,
      /unsupported value "\[REDACTED_AWS_KEY_ID\]"/,
    );
    assert.equal(JSON.stringify(refused.result).includes(key), false);

    // The settings path goes into the job's command, which is not text the reason code touches.
    helpers.update(
      path.join(root, 'bench', 'baselines', SKILL, 'tasks-b1.json'),
      (tasks) => {
        tasks.format_version = 1;
      },
    );
    const settings = path.join(root, `${key}.json`);
    fs.copyFileSync(layout.configFile, settings);
    const named = await next(['--config', settings]);
    assert.equal(named.result.next, 'job', named.errors);
    const text = JSON.stringify(named.result);
    assert.equal(text.includes(key), false);
    assert.ok(text.includes('[REDACTED_AWS_KEY_ID].json'), text);
  }));

test('next makes a relative --config absolute in the job command', () =>
  withLiveRepo(async ({ root, layout, next }) => {
    const settings = path.join(root, 'relative-settings.json');
    fs.copyFileSync(layout.configFile, settings);
    const relative = path.relative(process.cwd(), settings);
    assert.ok(!path.isAbsolute(relative));
    const named = await next(['--config', relative]);
    assert.equal(named.result.next, 'job', named.errors);
    const command = named.result.command;
    assert.equal(command[command.indexOf('--config') + 1], settings);
  }));

test('next refuses a start time ahead of the clock by more than the allowed skew', () =>
  withRepo(async ({ next }) => {
    const now = () => START_MS;
    const startedAt = (offsetMs) => [
      '--provider',
      'stub',
      '--max-minutes',
      '30',
      '--started-at',
      new Date(START_MS + offsetMs).toISOString().replace('.000Z', 'Z'),
    ];
    for (const offsetMs of [START_SKEW_MS + 1000, 24 * 3600 * 1000]) {
      const { code, result, errors } = await next(startedAt(offsetMs), { now });
      assert.equal(code, 64, String(offsetMs));
      assert.equal(result, null);
      assert.match(errors, /--started-at 20\d\d-.* is in the future/);
    }
    // A few seconds of clock difference between hosts is not a typo.
    for (const offsetMs of [0, 30000, START_SKEW_MS]) {
      const { code, result } = await next(startedAt(offsetMs), { now });
      assert.equal(code, 0, String(offsetMs));
      assert.equal(result.next, 'job');
    }
  }));

test('an answer stored as not loaded is counted in the done line, and its task is judged by no one', () =>
  withRepo(async ({ layout, next, runJob }) => {
    const step = await next(['--provider', 'stub']);
    assert.equal(step.result.job, 'pairs');
    await runJob(step.result);
    // What the pairs job stores when the with arm never loaded the skill on any try: no text, no hash.
    const taskId = `${SKILL}-rules-2`;
    helpers.update(layout.answerFile(SKILL, 'b1', taskId, 'with'), (record) => {
      record.status = 'not_loaded';
      record.valid = false;
      record.text = null;
      record.answer_sha256 = null;
    });
    let done = null;
    for (let round = 0; round < STEPS.length + 1 && !done; round += 1) {
      const { result } = await next(['--provider', 'stub']);
      if (result.next === 'done') done = result;
      else await runJob(result);
    }
    assert.ok(done, 'the run ends');
    assert.equal(done.status, 'done');
    // The with answer has one judgment job per seat in each reading: 3 seats and 2 readings.
    assert.equal(done.not_loaded, 6);
    assert.equal(done.ineligible, 0);
    assert.equal(done.blocked, 0);
  }));

test('an answer that is not eligible is judge work until the job records it with no call', () =>
  withRepo(async ({ layout, next, runJob }) => {
    for (const expected of ['pairs', 'judge']) {
      const step = await next(['--provider', 'stub']);
      assert.equal(step.result.job, expected);
      await runJob(step.result);
    }
    // The with answer of task 2 now narrates the skill load: the leak scan makes it ineligible, so its 3 judgments
    // of reading B (one per seat, with arm only) are stale and can only be recorded as ineligible, with no call.
    const taskId = `${SKILL}-rules-2`;
    helpers.update(layout.answerFile(SKILL, 'b1', taskId, 'with'), (record) => {
      record.text = 'I loaded the skill and followed it. Brew at 80 C.';
      record.answer_sha256 = sha256(record.text);
    });
    const judge = await next(['--provider', 'stub']);
    assert.equal(judge.result.job, 'judge');
    assert.equal(judge.result.scale, 'items');
    assert.equal(judge.result.pending, 3);
    assert.equal(judge.result.estimated_minutes, 0, 'no call is made');
    await runJob(judge.result);
    const record = helpers.readJson(
      layout.judgmentFile('items', SKILL, 'b1', taskId, 'anthropic', 'with'),
    );
    assert.equal(record.status, 'ineligible');
    assert.equal(
      helpers.readJson(
        layout.judgmentFile(
          'items',
          SKILL,
          'b1',
          taskId,
          'anthropic',
          'without',
        ),
      ).status,
      'valid',
      'the without arm keeps its judgment',
    );
    const after = await next(['--provider', 'stub']);
    assert.equal(after.result.job, 'checklists');
  }));

test('a judgment the provider blocks for good ends the run partial', () =>
  withRepo(async ({ next, runJob }) => {
    const blocked = `${SKILL}/b1/${SKILL}-rules-4:items:openai:with`;
    const judgeCall = (args) =>
      args.label === blocked
        ? Promise.resolve({
            ok: false,
            text: '',
            usage: null,
            usageSource: 'none',
            reportedUsd: null,
            ms: 1,
            error: 'provider blocked the response: safeguards flagged it',
            stderr: '',
          })
        : opencode.judgeCall({ ...args, run: stubProcess });
    let result;
    for (let round = 0; round < 8; round += 1) {
      ({ result } = await next(['--provider', 'stub']));
      if (result.next !== 'job') break;
      await runJob(result, { judgeOptions: { judgeCall } });
    }
    assert.equal(result.next, 'done');
    assert.equal(result.status, 'partial');
    assert.equal(result.blocked, 1);
  }));

test('next usage errors exit 64 and print no JSON line', () =>
  withRepo(async ({ root, next }) => {
    const cases = [
      [['--json'], /--json is an option of plan/],
      [['--max-minutes', '30'], /go together/],
      [['--started-at', START], /go together/],
      [['--max-minutes', '0', '--started-at', START], /--max-minutes/],
      [
        ['--max-minutes', '30', '--started-at', '2026-02-30T10:00:00Z'],
        /--started-at/,
      ],
      [
        ['--max-minutes', '30', '--started-at', '2026-11-12T10:00:00'],
        /--started-at/,
      ],
      [['--provider', 'other'], /--provider must be one of live, stub/],
      // A stub run id takes only the stub; the live provider is the default when --provider is missing.
      [[], /takes --provider stub only/],
      [['--provider', 'live'], /takes --provider stub only/],
    ];
    for (const [args, pattern] of cases) {
      const { code, result, errors } = await next(args);
      assert.equal(code, 64, args.join(' '));
      assert.equal(result, null);
      assert.match(errors, pattern);
    }
    const io = capture();
    const missing = await bench.main(['next', '--root', root], io);
    assert.equal(missing, 64);
    assert.match(io.errors, /--skills is required/);
    const notStub = capture();
    assert.equal(
      await bench.main(
        ['next', '--skills', SKILL, '--root', root, '--provider', 'stub'],
        notStub,
      ),
      64,
    );
    assert.match(notStub.errors, /only in a run whose id is "stub"/);
  }));

test('plan refuses the options that only next takes', () =>
  withRepo(async ({ root }) => {
    for (const flag of ['--max-minutes', '--started-at', '--provider']) {
      const io = capture();
      const code = bench.main(
        ['plan', '--skills', SKILL, '--root', root, flag, 'x'],
        io,
      );
      assert.equal(code, 64, flag);
      assert.match(io.errors, new RegExp(`${flag} is an option of next`));
    }
  }));
