// SPDX-License-Identifier: Apache-2.0
// The stubbed end-to-end run: on a copy of the fixture repo, `plan`, then `next` and the job it names, until `next`
// says done, down to the stored judgments of both readings. The first pass is cut by a spend STOP from the ledger and
// resumed with a higher max_usd. The stub provider (scripts/bench/lib/stub-provider.js) stands in for the claude and
// opencode processes: no model, AWS or network call is made. The expected steps and judgments are committed in
// tests/fixtures/bench/stub-run.expected.json.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const bench = require('../../../scripts/bench/bench');
const job = require('../../../scripts/bench/job');
const { createLayout } = require('../../../scripts/bench/lib/layout');
const { readLedger } = require('../../../scripts/bench/lib/ledger');
const helpers = require('./helpers');

const EXPECTED_FILE = path.join(helpers.FIXTURE_DIR, 'stub-run.expected.json');
const RUN = 'stub-e2e';
/**
 * One subject run at a time, so the spend STOP always lands on the same run. The stub reports 1 USD for each subject
 * run (SUBJECT_COST_USD), well above its upper estimate (p90) of about 0.12 USD. With max_usd 4.8 the plan (4.79 USD
 * upper estimate) passes and the ledger refuses the sixth subject run.
 */
const SETTINGS = helpers.settingsWith({ subject_concurrency: 1 });

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

/** `value` with the temp folder replaced by <dir>, so the steps compare across machines. */
const portable = (value, dir) =>
  JSON.parse(JSON.stringify(value).split(dir).join('<dir>'));

/** Runs `next` and returns { code, result }. */
async function next(args) {
  const io = capture();
  const code = await bench.main(['next', ...args], io, {});
  assert.equal(io.errors, '', io.errors);
  return { code, result: JSON.parse(io.text) };
}

/** Runs the job of a `next` result in this process, the way a shell loop would run its command. */
async function runJob(result) {
  assert.deepEqual(result.command.slice(0, 2), [
    'node',
    'scripts/bench/job.js',
  ]);
  const io = capture();
  const code = await job.main(result.command.slice(2), io);
  const lines = io.text.trim().split('\n');
  return { code, last: JSON.parse(lines[lines.length - 1]), log: io.text };
}

/** Every stored judgment: path under judgments/ -> "<status> <arm> <score>". */
function storedJudgments(layout) {
  const dir = path.join(layout.runDir, 'judgments');
  const files = fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('.json'))
    .sort();
  return Object.fromEntries(
    files.map((name) => {
      const record = helpers.readJson(path.join(dir, name));
      return [
        name.split(path.sep).join('/'),
        `${record.status} ${record.arm} ${record.score}`,
      ];
    }),
  );
}

/** A `next` result with its command joined into one string, for a short expected file. */
const stepLine = (result) =>
  result.command ? { ...result, command: result.command.join(' ') } : result;

test('stubbed run: plan, next until done, a spend STOP and a resume, down to the stored judgments', () =>
  helpers.withTmpAsync(async (dir) => {
    const root = path.join(dir, 'repo');
    fs.cpSync(helpers.fixtureRoot(), root, { recursive: true });
    const configFile = path.join(dir, 'settings.json');
    helpers.write(configFile, SETTINGS);
    const layout = createLayout({ root, runId: RUN });
    const common = [
      '--skills',
      helpers.SKILL,
      '--run',
      RUN,
      '--root',
      root,
      '--config',
      configFile,
      '--provider',
      'stub',
    ];

    const planIo = capture();
    const planArgs = common.filter(
      (arg, index) =>
        arg !== '--provider' && common[index - 1] !== '--provider',
    );
    assert.equal(
      bench.main(['plan', ...planArgs, '--max-usd', '4.8', '--json'], planIo),
      0,
      planIo.errors,
    );
    const plan = JSON.parse(planIo.text);
    assert.equal(plan.pending_usd, 2.78);
    assert.equal(plan.pending_usd_p90, 4.79);

    const steps = [];
    const loop = async (maxUsd) => {
      for (let round = 0; round < 10; round += 1) {
        const { code, result } = await next([...common, '--max-usd', maxUsd]);
        const step = {
          max_usd: maxUsd,
          next_exit: code,
          next: stepLine(result),
        };
        steps.push(step);
        if (result.next !== 'job') return result;
        const ran = await runJob(result);
        step.job_exit = ran.code;
        step.job_status = ran.last.status;
        step.job_stop = ran.last.stop && ran.last.stop.kind;
        // A shell loop stops on a job's non-zero exit; the next pass starts with `next` again.
        if (ran.code !== 0) return null;
      }
      throw new Error('the loop did not end within 10 rounds');
    };

    // Pass 1: the ledger refuses the sixth subject run, then `next` stops on the limit.
    assert.equal(await loop('4.8'), null);
    const stopped = await next([...common, '--max-usd', '4.8']);
    steps.push({
      max_usd: '4.8',
      next_exit: stopped.code,
      next: stepLine(stopped.result),
    });
    assert.equal(stopped.result.next, 'stop');
    assert.equal(stopped.result.kind, 'spend');
    const answersAfterStop = fs
      .readdirSync(path.join(layout.runDir, 'answers', helpers.SKILL, 'b1'))
      .filter((name) => name.endsWith('.json'));
    assert.equal(
      answersAfterStop.length,
      5,
      'the answers made before the STOP are kept',
    );

    // Pass 2: a higher limit resumes at the first unfinished job and runs to done.
    const done = await loop('25');
    assert.equal(done.next, 'done');
    assert.equal(done.status, 'done');

    // The finished work is reused: another `next` names no job and nothing new is spent.
    const stubLedgerFile = path.join(layout.runDir, 'ledger.jsonl');
    const ledgerBytes = fs.readFileSync(stubLedgerFile, 'utf8').length;
    const again = await next([...common, '--max-usd', '25']);
    assert.equal(again.result.next, 'done');
    assert.equal(fs.readFileSync(stubLedgerFile, 'utf8').length, ledgerBytes);
    assert.ok(readLedger(stubLedgerFile).calls > 0);
    // Every stub call reports its cost, so none is charged at the estimate. A stub judge call reports 0.001 USD, below
    // the mean of the GPT judge model whose CLI reports low, so those calls are charged that mean ("floor").
    const settled = fs
      .readFileSync(stubLedgerFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((row) => row.type === 'settle');
    assert.ok(settled.length > 0);
    const terra = helpers.exampleConfig().models.judges.openai;
    for (const row of settled)
      assert.equal(
        row.cost_source,
        row.model === terra ? 'floor' : 'reported',
        `${row.label} (${row.model})`,
      );
    assert.ok(settled.some((row) => row.cost_source === 'floor'));
    // The STOP came from the stub run's own ledger; the shared ledger of real runs never saw a stub dollar.
    assert.equal(
      fs.existsSync(layout.ledgerFile),
      false,
      'a stub run writes nothing to bench/out/ledger.jsonl',
    );

    const actual = portable({ steps, judgments: storedJudgments(layout) }, dir);
    const expected = helpers.readJson(EXPECTED_FILE);
    assert.deepEqual(
      actual,
      expected,
      `the stubbed run differs from ${EXPECTED_FILE}; actual:\n${JSON.stringify(actual, null, 2)}`,
    );
  }));
