// SPDX-License-Identifier: Apache-2.0
// The report writer (scripts/bench/lib/report.js): seat agreement, item losses, spend, the report summary and its
// markdown, including the `controls: FAIL` banner that withholds the labels. Each answer is judged on its own, so the
// jobs here hold one judgment per seat and arm. Built from the committed fixtures tests/fixtures/bench/labels.json and
// tests/fixtures/bench/readings-report.json; nothing is written.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const report = require('../../../scripts/bench/lib/report');
const {
  labelSkill,
  LABELS,
  VERDICT_RULES_DATE,
} = require('../../../scripts/bench/lib/labels');
const {
  buildReadingsReport,
} = require('../../../scripts/bench/lib/readings-report');
const { readLedger } = require('../../../scripts/bench/lib/ledger');
const { jobsOf, summaryOf, guardEntriesOf, READ } = require('./labels-fixture');
const helpers = require('./helpers');

const EXPECTED_MD = path.join(helpers.FIXTURE_DIR, 'report.expected.txt');
const GENERATED_AT = '2026-11-12T09:30:00.000Z';
const BATCHES = ['b1', 'b2'];
const key = (batch, taskId) => `${batch}\u0000${taskId}`;

/** A done judge job of one seat and arm, with a valid record of that arm alone. */
const doneJob = ({
  batch = 'b1',
  taskId,
  seat,
  arm,
  score,
  labels = null,
  checklist = null,
  status = 'valid',
  scale = 'items',
}) => ({
  skill: 'demo',
  batch,
  task: { id: taskId },
  scale,
  seat,
  arm,
  state: 'done',
  checklist,
  record: { status, seat, arm, score, labels },
});
/** The two jobs of one seat: its with judgment and its without judgment. */
const seatJobs = (taskId, seat, withScore, withoutScore, extra = {}) => [
  doneJob({ taskId, seat, arm: 'with', score: withScore, ...extra }),
  doneJob({ taskId, seat, arm: 'without', score: withoutScore, ...extra }),
];

// ---- seat agreement -----------------------------------------------------------------------------------------------------

test("seatAgreement: a seat's vote compares its two judgments; unanimous tasks over the counted ones", () => {
  const jobs = [
    ...seatJobs('t1', 's1', 3, 2),
    ...seatJobs('t1', 's2', 2.5, 2),
    // A seat with one arm only does not count, whatever its score.
    doneJob({ taskId: 't1', seat: 's3', arm: 'with', score: 1 }),
    ...seatJobs('t2', 's1', 3, 2),
    ...seatJobs('t2', 's2', 2, 2.5),
    ...seatJobs('t3', 's1', 2, 2),
    ...seatJobs('t3', 's2', 4, 4),
    // A tie is a vote of its own: a tie beside a WITHOUT vote, or beside a WITH vote, is not unanimous.
    ...seatJobs('t4', 's1', 2, 2),
    ...seatJobs('t4', 's2', 2, 3),
    ...seatJobs('t5', 's1', 3, 3),
    ...seatJobs('t5', 's2', 4, 2),
    // Not counted, not valid or not done: never read.
    ...seatJobs('t9', 's1', 1, 5),
    {
      ...doneJob({ taskId: 't3', seat: 's3', arm: 'with', score: 5 }),
      state: 'pending',
    },
    doneJob({
      taskId: 't3',
      seat: 's3',
      arm: 'without',
      score: 1,
      status: 'ineligible',
    }),
  ];
  const counted = new Set(
    ['t1', 't2', 't3', 't4', 't5'].map((id) => key('b1', id)),
  );
  const agreement = report.seatAgreement(jobs, {
    readRecord: READ.readRecord,
    counted,
  });
  assert.deepEqual(agreement, { tasks: 5, unanimous: 2 });
  // A redo of seat s2's with judgment on t2 replaces the earlier one: now both seats vote WITH.
  jobs.push(doneJob({ taskId: 't2', seat: 's2', arm: 'with', score: 3 }));
  assert.deepEqual(
    report.seatAgreement(jobs, { readRecord: READ.readRecord, counted }),
    { tasks: 5, unanimous: 3 },
  );
  assert.deepEqual(
    report.seatAgreement(jobs, {
      readRecord: READ.readRecord,
      counted: new Set(),
    }),
    { tasks: 0, unanimous: 0 },
  );
});

test('seatAgreement and itemLosses leave out a record that names another seat or arm than its job, as the task gap does', () => {
  const counted = new Set([key('b1', 't1')]);
  const jobs = [
    ...seatJobs('t1', 'anthropic', 5, 1),
    ...seatJobs('t1', 'openai', 5, 1),
    doneJob({ taskId: 't1', seat: 'xai', arm: 'without', score: 1 }),
  ];
  // The xai with job reads a record that names the openai seat and its without arm: it is not xai's judgment, and it
  // must not replace openai's own without judgment either.
  jobs.push({
    ...doneJob({ taskId: 't1', seat: 'xai', arm: 'with', score: 5 }),
    record: { status: 'valid', seat: 'openai', arm: 'without', score: 5 },
  });
  assert.deepEqual(
    report.seatAgreement(jobs, { readRecord: READ.readRecord, counted }),
    { tasks: 1, unanimous: 1 },
  );
  const withChecklist = jobs.map((job) => ({
    ...job,
    checklist: ['an item'],
    record: { ...job.record, labels: [job.arm === 'with' ? 'MET' : 'MISSING'] },
  }));
  const losses = report.itemLosses(withChecklist, {
    readRecord: READ.readRecord,
    counted,
  });
  assert.equal(losses.seat_pairs, 2, 'xai has no pair of its own');
});

test('seatAgreement and itemLosses read only done jobs with a valid record, whatever else a file holds', () => {
  const checklist = ['first item'];
  const pair = (taskId, seat, flaw = {}) =>
    ['with', 'without'].map((arm) =>
      doneJob({
        taskId,
        seat,
        arm,
        score: arm === 'with' ? 1 : 5,
        checklist,
        labels: [arm === 'with' ? 'MISSING' : 'MET'],
        ...flaw,
      }),
    );
  const good = [
    ...[
      ['s1', 5, 1, 'MET', 'MISSING'],
      ['s2', 4, 2, 'MET', 'PARTIAL'],
    ].flatMap(([seat, withScore, withoutScore, withLabel, withoutLabel]) => [
      doneJob({
        taskId: 't1',
        seat,
        arm: 'with',
        score: withScore,
        checklist,
        labels: [withLabel],
      }),
      doneJob({
        taskId: 't1',
        seat,
        arm: 'without',
        score: withoutScore,
        checklist,
        labels: [withoutLabel],
      }),
    ]),
  ];
  const counted = new Set([key('b1', 't1')]);
  const options = { readRecord: READ.readRecord, counted };
  assert.deepEqual(report.seatAgreement(good, options), {
    tasks: 1,
    unanimous: 1,
  });
  const base = report.itemLosses(good, options);
  assert.equal(base.seat_pairs, 2);
  // A seat that votes the other way, but whose jobs are stale or pending, or whose records are not valid (a file made
  // under another status can still carry a score), changes nothing.
  const stale = pair('t1', 's3').map((job) => ({ ...job, state: 'stale' }));
  const pending = pair('t1', 's4').map((job) => ({ ...job, state: 'pending' }));
  const invalid = pair('t1', 's5', { status: 'invalid' });
  const ineligible = pair('t1', 's6', { status: 'ineligible' });
  for (const [name, extra] of Object.entries({
    stale,
    pending,
    invalid,
    ineligible,
  })) {
    const jobs = [...good, ...extra];
    assert.deepEqual(
      report.seatAgreement(jobs, options),
      { tasks: 1, unanimous: 1 },
      name,
    );
    assert.deepEqual(report.itemLosses(jobs, options), base, name);
  }
  // The same seat as a done job with a valid record does count, so the figures above are not blind to it.
  assert.deepEqual(
    report.seatAgreement([...good, ...pair('t1', 's3')], options),
    { tasks: 1, unanimous: 0 },
    'WITHOUT beside two WITH votes',
  );
  assert.equal(
    report.itemLosses([...good, ...pair('t1', 's3')], options).seat_pairs,
    3,
  );
});

// ---- item losses --------------------------------------------------------------------------------------------------------

test('itemLosses: per item, seats whose with judgment is worse or better than their without judgment; the items lost more often listed worst first', () => {
  const checklist = ['first item', 'second item', 'third item'];
  const judged = (taskId, seat, withLabels, withoutLabels) => [
    doneJob({
      taskId,
      seat,
      arm: 'with',
      score: 3,
      checklist,
      labels: withLabels,
    }),
    doneJob({
      taskId,
      seat,
      arm: 'without',
      score: 3,
      checklist,
      labels: withoutLabels,
    }),
  ];
  const jobs = [
    ...judged('t1', 's1', ['MET', 'MISSING', 'MET'], ['MET', 'MET', 'PARTIAL']),
    ...judged(
      't1',
      's2',
      ['MET', 'PARTIAL', 'MISSING'],
      ['MISSING', 'MET', 'MET'],
    ),
    ...judged('t2', 's1', ['PARTIAL', 'MET', 'MET'], ['MET', 'MET', 'MET']),
    // Labels that do not fit the checklist: not read.
    ...judged('t2', 's2', ['MET', 'MET'], ['MISSING', 'MISSING']),
    // A seat with only its with judgment: not read.
    doneJob({
      taskId: 't2',
      seat: 's3',
      arm: 'with',
      score: 1,
      checklist,
      labels: ['MISSING', 'MISSING', 'MISSING'],
    }),
    // A task the reading does not count: not read.
    ...judged(
      't9',
      's1',
      ['MISSING', 'MISSING', 'MISSING'],
      ['MET', 'MET', 'MET'],
    ),
  ];
  const losses = report.itemLosses(jobs, {
    readRecord: READ.readRecord,
    counted: new Set([key('b1', 't1'), key('b1', 't2')]),
  });
  assert.equal(losses.seat_pairs, 3);
  assert.equal(losses.with_worse, 4);
  assert.equal(losses.with_better, 2);
  assert.deepEqual(
    losses.worst.map((row) => [row.task_id, row.item, row.worse, row.better]),
    [
      ['t1', 2, 2, 0],
      ['t2', 1, 1, 0],
    ],
    't1 item 3 is lost once and won once, so it is not listed; t1 item 1 is won',
  );
  assert.equal(losses.worst[0].text, 'second item');
  assert.equal(losses.worst[0].seat_pairs, 2);
  const one = report.itemLosses(jobs, {
    readRecord: READ.readRecord,
    counted: new Set([key('b1', 't1'), key('b1', 't2')]),
    limit: 1,
  });
  assert.equal(one.worst.length, 1);
});

// ---- spend --------------------------------------------------------------------------------------------------------------

test('spendOf: this run and the whole ledger, from readLedger totals', () => {
  const totals = readLedger(
    path.join(helpers.FIXTURE_DIR, 'ledger.sample.jsonl'),
    {
      now: () => Date.parse('2026-01-15T09:30:00.000Z'),
    },
  );
  const spend = report.spendOf(totals, 'r1');
  assert.equal(spend.ledger_calls, totals.calls);
  assert.equal(spend.ledger_total_usd, Math.round(totals.total * 100) / 100);
  const run = totals.runs.get('r1');
  assert.equal(spend.run_spent_usd, Math.round(run.spent * 100) / 100);
  // The sample holds one call charged at its estimate, in run r2: it is counted for r2 and in the ledger total, not
  // for r1.
  assert.equal(totals.estimated.calls, 1);
  assert.equal(spend.estimated_calls, 0);
  assert.equal(spend.estimated_usd, 0);
  assert.equal(spend.ledger_estimated_calls, 1);
  assert.equal(spend.ledger_estimated_usd, 0.25);
  assert.equal(spend.unstarted_calls, 0);
  const other = report.spendOf(totals, 'r2');
  assert.equal(other.estimated_calls, 1);
  assert.equal(other.estimated_usd, 0.25);
  assert.deepEqual(report.spendOf(totals, 'no-such-run'), {
    ...spend,
    run_spent_usd: 0,
    run_reserved_usd: 0,
  });
  assert.equal(report.spendOf(null, 'r1').ledger_total_usd, 0);
});

test('spendOf: the unstarted calls are those of this run, not of the ledger', () => {
  const totals = {
    total: 3,
    calls: 9,
    runs: new Map([['r1', { spent: 1, reserved: 0 }]]),
    estimated: { calls: 0, usd: 0 },
    byRun: new Map([
      ['r1', { estimated: { calls: 0, usd: 0 }, unstarted: { calls: 3 } }],
      ['r2', { estimated: { calls: 0, usd: 0 }, unstarted: { calls: 5 } }],
    ]),
  };
  assert.equal(report.spendOf(totals, 'r1').unstarted_calls, 3);
  assert.equal(report.spendOf(totals, 'r2').unstarted_calls, 5);
  assert.equal(report.spendOf(totals, 'r3').unstarted_calls, 0);
});

test("spend lines: this run's estimated and unstarted calls, and the shared ledger only when it holds more", () => {
  const base = {
    run_spent_usd: 1,
    run_reserved_usd: 0,
    ledger_total_usd: 9,
    ledger_calls: 50,
    estimated_calls: 2,
    estimated_usd: 0.05,
    unstarted_calls: 3,
    ledger_estimated_calls: 63,
    ledger_estimated_usd: 2.82,
  };
  const markdown = (spend) =>
    report.renderReportMarkdown({ ...sampleReport(), spend });
  const text = markdown(base);
  assert.match(
    text,
    /2 call\(s\) of this run reported no usable cost and are charged at their mean \(\$0\.05\)\./,
  );
  assert.match(
    text,
    /3 call\(s\) of this run ended before a model step started and are charged \$0\.00\./,
  );
  assert.match(
    text,
    /The whole ledger, shared with other runs, holds 63 call\(s\) charged at their mean \(\$2\.82\)\./,
  );
  assert.doesNotMatch(text, /in the ledger reported no usable cost/);
  const quiet = markdown({
    ...base,
    estimated_calls: 0,
    estimated_usd: 0,
    unstarted_calls: 0,
    ledger_estimated_calls: 0,
    ledger_estimated_usd: 0,
  });
  assert.doesNotMatch(quiet, /charged at their mean|before a model step/);
});

// ---- the report ---------------------------------------------------------------------------------------------------------

test('skillDetails: the jobs of two skills, a task that does not count and a task left out of A reach the figures of each reading', () => {
  const rules = ['first item', 'second item'];
  const labelled = (skill, withLabels, withoutLabels) => {
    const jobs = jobsOf(skill);
    jobs.itemsJobs = jobs.itemsJobs.map((job) => ({
      ...job,
      checklist: rules,
      record: {
        ...job.record,
        labels: job.arm === 'with' ? withLabels : withoutLabels,
      },
    }));
    return jobs;
  };
  // helps-skill: every seat gives the with answer a MISSING first item; the second item ties.
  const helps = labelled('helps-skill', ['MISSING', 'MET'], ['MET', 'MET']);
  // Task 1 of b1 is left out of A. Task 8 of b2 has one valid seat on reading B only, so reading B does not count it.
  helps.outcomeJobs = helps.outcomeJobs.filter(
    (job) => !(job.batch === 'b1' && job.task.id === 'helps-skill-1'),
  );
  helps.itemsJobs = helps.itemsJobs.map((job) =>
    job.batch === 'b2' && job.task.id === 'helps-skill-8' && job.seat !== 'xai'
      ? { ...job, state: 'pending', record: null }
      : job,
  );
  const excluded = [
    {
      skill: 'helps-skill',
      batch: 'b1',
      id: 'helps-skill-1',
      reason: 'blocked',
      date: '2026-11-01',
    },
  ];
  const summary = summaryOf('helps-skill', { jobs: helps, excluded });
  // Another skill's jobs sit in the same lists, with opposite labels: they must not be read for helps-skill.
  // They use the same batch and task ids, so only the skill name tells them apart.
  const other = labelled('harm-skill', ['MET', 'MET'], ['MISSING', 'MISSING']);
  for (const list of [other.itemsJobs, other.outcomeJobs])
    list.forEach((job, index) => {
      list[index] = {
        ...job,
        task: { id: job.task.id.replace('harm-skill', 'helps-skill') },
      };
    });
  const details = report.skillDetails({
    summary,
    itemsJobs: [...helps.itemsJobs, ...other.itemsJobs],
    outcomeJobs: [...helps.outcomeJobs, ...other.outcomeJobs],
    ...READ,
  });
  // Reading B counts the 15 tasks A reads minus the task with one seat: 14 tasks of 3 seats each.
  assert.equal(summary.B.tasks_counted, 14);
  assert.equal(details.item_losses.seat_pairs, 14 * 3);
  assert.equal(details.item_losses.with_worse, 14 * 3);
  assert.equal(details.item_losses.with_better, 0);
  assert.ok(
    details.item_losses.worst.every((row) => row.item === 1 && row.worse === 3),
  );
  // Reading A counts its 15 tasks, and every seat votes WITH in each.
  assert.deepEqual(details.seats_agree.A, { tasks: 15, unanimous: 15 });
  assert.deepEqual(details.seats_agree.B, { tasks: 14, unanimous: 14 });
  assert.deepEqual(report.skillDetails({ summary: { error: 'gone' } }), {
    seats_agree: null,
    item_losses: null,
  });
});

/** One skill entry of the report from the labels fixture. */
function entryOf(skill, { label = {} } = {}) {
  const jobs = jobsOf(skill);
  const summary = summaryOf(skill, { jobs });
  return {
    label: labelSkill({
      summary,
      batches: BATCHES,
      guardEntries: guardEntriesOf(skill),
      ...label,
    }),
    summary,
    details: report.skillDetails({ summary, ...jobs, ...READ }),
  };
}

/** A readings report whose convention-control is the given fixture skill's readings (PASS or FAIL by its gaps). */
const readingsWith = (conventionSkill) =>
  buildReadingsReport({
    skills: [],
    convention: conventionSkill
      ? { ...summaryOf(conventionSkill), skill: 'convention-control' }
      : null,
    generatedAt: GENERATED_AT,
  });

function sampleReport(conventionSkill = 'conventions-skill') {
  return report.buildReport({
    runId: 'r1',
    generatedAt: GENERATED_AT,
    skills: [entryOf('helps-skill'), entryOf('harm-skill')],
    readings: readingsWith(conventionSkill),
    spend: report.spendOf(
      {
        total: 12.5,
        calls: 40,
        runs: new Map([['r1', { spent: 8.75, reserved: 0.25 }]]),
        estimated: { calls: 2, usd: 0.125, models: {} },
        byRun: new Map([
          [
            'r1',
            { estimated: { calls: 2, usd: 0.125 }, unstarted: { calls: 0 } },
          ],
        ]),
      },
      'r1',
    ),
    warnings: ['plan: a warning | with a pipe\nand a newline'],
  });
}

test('buildReport: the labels, readings and controls in one summary', () => {
  const summary = sampleReport();
  assert.equal(summary.version, report.REPORT_VERSION);
  assert.equal(summary.controls_status, 'PASS');
  assert.equal(summary.trusted, true);
  assert.equal(summary.labels_published, true);
  assert.deepEqual(
    summary.skills.map((skill) => [skill.skill, skill.label]),
    [
      ['helps-skill', LABELS.helps],
      ['harm-skill', LABELS.harm],
    ],
  );
  const helps = summary.skills[0];
  assert.equal(helps.tasks, 16);
  assert.equal(helps.coverage.A.tasks_counted, 16);
  assert.equal(
    helps.coverage.B.expected,
    96,
    '16 tasks x 3 seats x 2 arms: one judgment per answer',
  );
  assert.deepEqual(Object.keys(helps.by_batch.A), BATCHES);
  assert.deepEqual(helps.seats_agree.A, { tasks: 16, unanimous: 16 });
  assert.equal(helps.seats_agree.B.tasks, 16);
  assert.equal(summary.controls['convention-control'].status, 'PASS');
  assert.equal(summary.spend.run_spent_usd, 8.75);
  // Each answer is scored on its own: the summary has no presentation order.
  assert.equal(Object.hasOwn(summary, 'orders_per_pair'), false);
  assert.equal(Object.hasOwn(helps, 'order_split'), false);
  // The summary is plain JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), summary);
});

test('controls: FAIL prints the banner at the top and withholds every label from the markdown, not from report.json', () => {
  // helps-skill as convention-control: A is above 0, so its rule fails.
  const summary = sampleReport('helps-skill');
  assert.equal(summary.controls_status, 'FAIL');
  assert.equal(summary.labels_published, false);
  assert.equal(summary.skills[0].label, LABELS.helps, 'report.json keeps it');
  const md = report.renderReportMarkdown(summary);
  const banner = md.indexOf('**controls: FAIL**');
  assert.ok(banner > 0 && banner < md.indexOf('## Labels'), 'banner first');
  assert.match(md, /\| `helps-skill` \| withheld \(controls: FAIL\) \|/);
  assert.match(md, /Label: \*\*withheld\*\*\./);
  assert.doesNotMatch(md, /\*\*helps quality\*\*/);
  assert.doesNotMatch(md, /\*\*harm\*\*/);
  assert.match(md, /\| `convention-control` \| \*\*FAIL\*\* \|/);
});

test('controls: FAIL withholds the suggested verdicts with the labels; report.json keeps them', () => {
  const summary = sampleReport('helps-skill');
  assert.equal(summary.skills[0].verdict, 'keep', 'report.json keeps it');
  assert.equal(summary.verdict_rules_date, VERDICT_RULES_DATE);
  const md = report.renderReportMarkdown(summary);
  assert.match(md, /## Suggested verdicts\n\nWithheld with the labels/);
  assert.match(
    md,
    /\| `helps-skill` \| withheld \(controls: FAIL\) \| withheld \|/,
  );
  assert.doesNotMatch(md, /Suggested verdict: \*\*/);
});

test('the suggested verdicts: a summary table before the labels, a column, and a verdict and action per skill', () => {
  const md = report.renderReportMarkdown(sampleReport());
  const summaryAt = md.indexOf('## Suggested verdicts');
  assert.ok(summaryAt > 0 && summaryAt < md.indexOf('## Labels'));
  assert.match(md, /\| keep \(1\) \| `helps-skill` \|/);
  assert.match(md, /\| prune \(1\) \| `harm-skill` \|/);
  assert.doesNotMatch(
    md,
    /\| lean keep \(/,
    'a verdict with no skill has no row',
  );
  assert.match(md, /\| `helps-skill` \| \*\*helps quality\*\* \| keep \|/);
  assert.match(
    md,
    /Suggested verdict: \*\*prune\*\* \(A upper end -0\.78 is below 0\)\. Action: Prune: it makes the task result worse\./,
  );
  assert.ok(
    md.indexOf('## Suggested verdict rules') < md.indexOf('## Controls'),
  );
});

test('a run with no control is not trusted: the labels are shown with a NONE line', () => {
  const summary = sampleReport(null);
  assert.equal(summary.controls_status, 'NONE');
  assert.equal(summary.trusted, false);
  assert.equal(summary.labels_published, true);
  const md = report.renderReportMarkdown(summary);
  assert.match(
    md,
    /Controls: \*\*NONE\*\* \(the run includes no control, so the readings are not trusted\)/,
  );
  assert.match(md, /\| `helps-skill` \| \*\*helps quality\*\* \|/);
  assert.match(md, /No control is in this run\./);
  assert.doesNotMatch(md, /controls: FAIL/);
});

test('the markdown of a fixture report matches the committed expected file', () => {
  const md = report.renderReportMarkdown(sampleReport());
  assert.equal(md, fs.readFileSync(EXPECTED_MD, 'utf8'));
});

test('the markdown: rules before results, how to read a label at the top, NO DATA reasons listed', () => {
  const noData = entryOf('helps-skill', {
    label: { batches: ['b1', 'b2', 'b3'] },
  });
  const summary = report.buildReport({
    runId: 'r1',
    generatedAt: GENERATED_AT,
    skills: [noData],
    readings: readingsWith(null),
  });
  const md = report.renderReportMarkdown(summary);
  assert.ok(md.indexOf('How to read a label') < md.indexOf('## Labels'));
  assert.ok(
    md.indexOf('not a keep or prune verdict') < md.indexOf('## Labels'),
  );
  assert.match(md, /\| `helps-skill` \| \*\*NO DATA\*\* \|/);
  assert.match(
    md,
    /NO DATA because:\n\n- batch b3 was not read: B has no judge job in it\n/,
  );
  assert.match(md, /The spend ledger could not be read\./);
  assert.doesNotMatch(md, /## Warnings/);
});

test('the markdown names no presentation order: each answer is judged on its own', () => {
  const md = report.renderReportMarkdown(sampleReport());
  assert.match(md, /Each answer is judged on its own\./);
  for (const word of [
    /with-first/,
    /without-first/,
    /orders_per_pair/,
    /order split/i,
    /order consistency/i,
    /shown first/,
  ])
    assert.doesNotMatch(md, word);
  const empty = report.renderReportMarkdown({ ...sampleReport(), skills: [] });
  // A run of controls only says so instead of printing a table with one empty row.
  assert.ok(
    empty
      .split('\n')
      .includes('No skill was measured in this run (controls only).'),
  );
  assert.doesNotMatch(empty, /\(no skill\)/);
  assert.doesNotMatch(empty, /\| Skill \| Label \|/);
  assert.match(empty, /## Controls/);
});

test('the markdown: free text from records and settings is printed on one line with no table break', () => {
  const entry = entryOf('helps-skill');
  entry.summary.exclusions = [
    {
      batch: 'b1',
      id: 'helps-skill-1',
      reason: 'blocked | twice\nby the provider',
      date: '2026-11-01',
    },
  ];
  const summary = report.buildReport({
    runId: 'r1',
    generatedAt: GENERATED_AT,
    skills: [entry],
    readings: readingsWith(null),
    warnings: ['a `tick` | pipe\nnewline'],
  });
  const md = report.renderReportMarkdown(summary);
  assert.match(md, /Reason: blocked ' twice by the provider\n/);
  assert.match(md, /- a 'tick' ' pipe newline\n/);
});

/** The markdown of a report whose first skill lists one lost item with the given text. */
function markdownWithItem(text) {
  const summary = sampleReport();
  summary.skills[0].item_losses = {
    seat_pairs: 1,
    with_worse: 1,
    with_better: 0,
    worst: [
      {
        batch: 'b1',
        task_id: 't1',
        item: 1,
        text,
        worse: 1,
        better: 0,
        seat_pairs: 1,
      },
    ],
  };
  return report.renderReportMarkdown(summary);
}
const itemCell = (markdown) =>
  markdown.split('\n').find((line) => line.startsWith('| b1 | t1 | 1 | '));

test('a checklist item is redacted before it is cut to 110 characters, so no part of a secret that crosses the cut is printed', () => {
  // The cut keeps 107 characters. Each secret starts early enough that its rule matches only the whole value, and
  // ends after the cut, so a cut made before the redaction would leave a prefix that no rule matches.
  const cases = [
    [
      'aws_secret_access_key',
      `${'a'.repeat(50)} aws_secret_access_key=${'Q'.repeat(40)} tail`,
      /Q{4}/,
    ],
    [
      'canary',
      `${'a'.repeat(88)} bench-canary-${'f'.repeat(20)} tail`,
      /bench-canary-[0-9a-f]/,
    ],
    [
      'key id',
      `${'a'.repeat(95)} ${['AKIA', 'ABCDEFGHIJKLMNOP'].join('')} tail`,
      /AKIA/,
    ],
  ];
  for (const [name, text, leak] of cases) {
    assert.ok(
      text.indexOf(' tail') > 107,
      `${name}: the secret crosses the cut`,
    );
    const line = itemCell(markdownWithItem(text));
    assert.ok(line, name);
    assert.doesNotMatch(line, leak, name);
    assert.match(line, /REDACTED/, name);
  }
});

test('a checklist item longer than 110 characters is cut to 110 with three dots; a shorter one is kept whole', () => {
  const cut = itemCell(markdownWithItem('x'.repeat(200)));
  assert.ok(cut.includes(`| ${'x'.repeat(107)}... |`), cut);
  const exact = itemCell(markdownWithItem('y'.repeat(110)));
  assert.ok(exact.includes(`| ${'y'.repeat(110)} |`), exact);
});

test('the markdown prints a link, an image and HTML from a record as text, with nothing a viewer would load', () => {
  const reason =
    'see ![x](https://example.invalid/p.png?q=1) and <img src=x> [a](javascript:alert(1))';
  const entry = entryOf('helps-skill');
  entry.summary.exclusions = [
    { batch: 'b1', id: 'helps-skill-1', reason, date: '2026-11-01' },
  ];
  const md = report.renderReportMarkdown(
    report.buildReport({
      runId: 'r1',
      generatedAt: GENERATED_AT,
      skills: [entry],
      readings: readingsWith('conventions-skill'),
    }),
  );
  const line = md.split('\n').find((text) => text.includes('Reason: see'));
  assert.ok(line, 'the reason is printed');
  assert.doesNotMatch(line, /<img/, 'no `<` is left in the text');
  assert.doesNotMatch(line, /\]\(/, 'no link or image has its target');
  assert.ok(line.includes('&lt;img src=x>'), line);
  assert.ok(line.includes('![x]\\(https://example.invalid'), line);
  assert.ok(line.includes('[a]\\(javascript:alert(1))'), line);
  // The controls table keeps the `<br>` between its checks, which is the report's own markup.
  assert.match(md, /<br>/);
});

test('a backslash before `<` in a record does not bring the tag back in the markdown', () => {
  const item = 'x \\<img src=https://example.invalid/q.png> y \\\\<b>';
  const line = itemCell(markdownWithItem(item));
  assert.ok(line, 'the item row is printed');
  assert.doesNotMatch(line, /<img|<b>/);
  assert.ok(line.includes('&lt;img src='), line);
  const reason = report
    .renderReportMarkdown(
      report.buildReport({
        runId: 'r1',
        generatedAt: GENERATED_AT,
        skills: [
          (() => {
            const entry = entryOf('helps-skill');
            entry.summary.exclusions = [
              {
                batch: 'b1',
                id: 'helps-skill-1',
                reason: 'see \\<img src=x onerror=1>',
                date: '2026-11-01',
              },
            ];
            return entry;
          })(),
        ],
        readings: readingsWith('conventions-skill'),
      }),
    )
    .split('\n')
    .find((text) => text.includes('Reason: see'));
  assert.ok(reason && !reason.includes('<img'), reason);
});

test('the coverage line lists every judgment state of the reading, other arm unusable included, and the states add up to expected', () => {
  const summary = sampleReport();
  summary.skills[0].coverage.B = {
    tasks: 16,
    tasks_counted: 14,
    expected: 96,
    done: 80,
    pending: 6,
    stale: 2,
    waiting: 4,
    not_loaded: 2,
    ineligible: 1,
    other_arm_unusable: 3,
  };
  const line = report
    .renderReportMarkdown(summary)
    .split('\n')
    .find(
      (text) => text.startsWith('- Coverage B:') && text.includes(' 80 of '),
    );
  assert.equal(
    line,
    '- Coverage B: 14 of 16 tasks counted; judgments 80 of 96 done, 6 pending (2 stale), 4 waiting, 2 not loaded, 1 not eligible, 3 other arm unusable.',
  );
  // `stale` is part of `pending`; the other counts and `done` give `expected`.
  const [
    ,
    ,
    done,
    expected,
    pending,
    ,
    waiting,
    notLoaded,
    notEligible,
    other,
  ] = [...line.matchAll(/\d+/g)].map((match) => Number(match[0]));
  assert.equal(
    done + pending + waiting + notLoaded + notEligible + other,
    expected,
  );
});

test('a stub report says at the top that it is not a measurement, in the markdown and in report.json; a live report does not', () => {
  const live = sampleReport();
  assert.equal(live.provider, 'live');
  assert.doesNotMatch(report.renderReportMarkdown(live), /STUB DATA/);
  const stub = report.buildReport({
    runId: 'stub-e2e',
    generatedAt: GENERATED_AT,
    provider: 'stub',
    skills: [entryOf('helps-skill')],
    readings: readingsWith(null),
  });
  assert.equal(stub.provider, 'stub');
  const md = report.renderReportMarkdown(stub);
  const lines = md.split('\n');
  assert.equal(lines[0], '# Skill benchmark report');
  assert.match(
    lines[4],
    /^\*\*STUB DATA: not a measurement\.\*\* This run used the stub provider/,
  );
  assert.ok(md.indexOf('STUB DATA') < md.indexOf('Controls:'));
  assert.ok(md.indexOf('STUB DATA') < md.indexOf('## Labels'));
  assert.throws(
    () =>
      report.buildReport({
        runId: 'r1',
        skills: [],
        readings: readingsWith(null),
        provider: 'paid',
      }),
    /provider/,
  );
});

test('buildReport refuses a missing readings report', () => {
  assert.throws(
    () => report.buildReport({ runId: 'r1', skills: [] }),
    TypeError,
  );
});
