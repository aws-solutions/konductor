// SPDX-License-Identifier: Apache-2.0
// The stubbed end-to-end run: on a copy of the fixture repo, `plan`, then `next` and the job it names, until `next`
// says done, down to the stored judgments of both readings, then `report`, down to a labeled report. The first pass is
// cut by a spend STOP from the ledger and resumed with a higher max_usd. The stub provider
// (scripts/bench/lib/stub-provider.js) stands in for the claude and opencode processes: no model, AWS or network call
// is made. The expected steps and judgments are committed in tests/fixtures/bench/stub-run.expected.json and the
// expected report in tests/fixtures/bench/stub-run.report.expected.txt.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const bench = require('../../../scripts/bench/bench');
const job = require('../../../scripts/bench/job');
const { createLayout } = require('../../../scripts/bench/lib/layout');
const { readLedger } = require('../../../scripts/bench/lib/ledger');
const helpers = require('./helpers');

const EXPECTED_FILE = path.join(helpers.FIXTURE_DIR, 'stub-run.expected.json');
const EXPECTED_REPORT_FILE = path.join(
  helpers.FIXTURE_DIR,
  'stub-run.report.expected.txt',
);
const REPORT_TIME = '2026-11-12T12:00:00.000Z';
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

/** Every file of the run folder: path -> sha256 of its bytes. */
function runFiles(layout) {
  return Object.fromEntries(
    fs
      .readdirSync(layout.runDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [
          path.relative(layout.runDir, file).split(path.sep).join('/'),
          crypto
            .createHash('sha256')
            .update(fs.readFileSync(file))
            .digest('hex'),
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

    // Stage 4: `report` reads the stored judgments, labels the skill and writes report.json and report.md. Nothing
    // else in the run folder changes, and the report spends nothing.
    const before = runFiles(layout);
    const reportIo = capture();
    const reportCode = bench.main(
      ['report', ...common],
      reportIo,
      {},
      {
        now: () => Date.parse(REPORT_TIME),
      },
    );
    assert.equal(reportCode, 0, reportIo.errors);
    assert.equal(reportIo.errors, '');
    const line = portable(JSON.parse(reportIo.text), dir);
    assert.deepEqual(line, {
      report: 'written',
      run_id: RUN,
      report_json: `<dir>/repo/bench/out/${RUN}/report.json`,
      report_md: `<dir>/repo/bench/out/${RUN}/report.md`,
      controls_status: 'NONE',
      labels_published: true,
      labels: { [helpers.SKILL]: 'helps quality' },
    });
    const after = runFiles(layout);
    assert.deepEqual(
      Object.keys(after).filter((name) => !Object.hasOwn(before, name)),
      ['report.json', 'report.md'],
    );
    for (const [name, digest] of Object.entries(before))
      assert.equal(after[name], digest, `report changed ${name}`);
    assert.equal(fs.readFileSync(stubLedgerFile, 'utf8').length, ledgerBytes);
    const markdown = fs.readFileSync(layout.reportMd, 'utf8');
    assert.equal(
      markdown,
      fs.readFileSync(EXPECTED_REPORT_FILE, 'utf8'),
      `the stub report differs from ${EXPECTED_REPORT_FILE}; actual:\n${markdown}`,
    );
    const summary = helpers.readJson(layout.reportJson);
    assert.equal(summary.provider, 'stub');
    assert.match(markdown, /^\*\*STUB DATA: not a measurement\.\*\*/m);
    assert.deepEqual(
      summary.warnings.filter((warning) =>
        warning.startsWith(`${helpers.SKILL}:`),
      ),
      [],
      'a skill that is ready has no plan status warning',
    );
    assert.equal(summary.skills[0].label, 'helps quality');
    assert.equal(summary.skills[0].coverage.A.tasks_counted, 4);
    assert.equal(summary.skills[0].coverage.B.tasks_counted, 5);
    // `plan` now shows stage 4 as done.
    const planAfter = capture();
    bench.main(['plan', ...planArgs, '--json'], planAfter);
    assert.equal(JSON.parse(planAfter.text).stages[3].state, 'done');

    // Stage 5: SKILL.md changes after the baseline, so reading B waits for a refreshed baseline. The
    // with answers and reading A are made again; an A interval above 0 still labels the skill.
    fs.appendFileSync(
      path.join(root, 'skills', helpers.SKILL, 'SKILL.md'),
      '\nOne more line written after the baseline.\n',
    );
    assert.equal((await loop('25')).next, 'done');
    const staleIo = capture();
    assert.equal(
      bench.main(
        ['report', ...common],
        staleIo,
        {},
        {
          now: () => Date.parse(REPORT_TIME),
        },
      ),
      0,
      staleIo.errors,
    );
    const staleReport = helpers.readJson(layout.reportJson);
    const stale = staleReport.skills[0];
    assert.ok(
      staleReport.warnings.includes(`${helpers.SKILL}: rules stale`),
      'the plan status of a skill that is not ready is a warning',
    );
    assert.deepEqual(stale.no_data, []);
    assert.deepEqual(JSON.parse(staleIo.text).labels, {
      [helpers.SKILL]: 'helps quality',
    });
    assert.equal(stale.coverage.A.tasks_counted, 4);
  }));
