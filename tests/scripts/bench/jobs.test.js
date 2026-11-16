// SPDX-License-Identifier: Apache-2.0
// Tests for job planning (scripts/bench/lib/jobs.js): the subject and judge jobs of assembled tasks, one judge job per
// arm, and agreement with the call counts of `plan`. No model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  planJobs,
  trackEstimatedCalls,
  estimatedCallsLine,
} = require('../../../scripts/bench/lib/jobs');
const { seatsOf } = require('../../../scripts/bench/lib/config');
const {
  createLedger,
  reservationFor,
  settledCost,
} = require('../../../scripts/bench/lib/ledger');
const { buildPlan } = require('../../../scripts/bench/lib/plan');
const { loadExclusions } = require('../../../scripts/bench/lib/baseline');
const { loadTaskSet } = require('../../../scripts/bench/lib/tasks');
const { createLayout, ARMS } = require('../../../scripts/bench/lib/layout');
const helpers = require('./helpers');

const CONFIG = helpers.exampleConfig();
const SEATS = seatsOf(CONFIG);

/** An assembled task set of `count` tasks in one batch, with only the fields planning reads. */
const taskSetOf = (
  count,
  { skill = 'demo', batch = 'b1', readB = true } = {},
) => ({
  skill,
  batches: [
    {
      batch,
      read_b: readB,
      tasks: Array.from({ length: count }, (_entry, index) => ({
        id: `${skill}-${index}`,
        prompt: 'p',
        rubric: ['r'],
      })),
    },
  ],
});
const keyOf = (job) =>
  `${job.skill}|${job.batch}|${job.task.id}|${job.scale}|${job.seat}|${job.arm}`;

test('planJobs: two subject runs per task, and per seat one judge call per reading and arm', () => {
  const { subject, judge } = planJobs([taskSetOf(5)], CONFIG);
  assert.equal(subject.length, 10);
  assert.deepEqual(
    subject.slice(0, 2).map((job) => job.arm),
    ['with', 'without'],
  );
  assert.ok(!subject.some((job) => job.arm === 'with2'), 'no same-arm sample');
  assert.equal(judge.length, 5 * 2 * SEATS.length * 2);
  for (const job of judge) {
    assert.ok(ARMS.includes(job.arm));
    assert.ok(!('order' in job) && !('slot' in job));
    assert.equal(job.model, CONFIG.models.judges[job.seat]);
  }
  assert.deepEqual([...new Set(judge.map((job) => job.scale))].sort(), [
    'items',
    'outcome',
  ]);
});

test('planJobs: one judge job per task, seat, reading and arm, the same on a resumed run', () => {
  const sets = [taskSetOf(6)];
  const judge = planJobs(sets, CONFIG).judge;
  const keys = judge.map(keyOf);
  assert.equal(new Set(keys).size, keys.length, 'no job twice');
  assert.deepEqual(
    keys,
    planJobs(sets, CONFIG).judge.map(keyOf),
    'a resumed run asks for the same jobs',
  );
  for (const scale of ['items', 'outcome'])
    for (const seat of SEATS)
      assert.deepEqual(
        judge
          .filter(
            (job) =>
              job.task.id === 'demo-0' &&
              job.scale === scale &&
              job.seat === seat,
          )
          .map((job) => job.arm),
        ['with', 'without'],
      );
});

test('planJobs: a batch not read by B has no items jobs; an excluded task has no outcome jobs', () => {
  const exclusions = {
    format_version: 1,
    batches: {
      b1: {
        scenarios: [
          {
            id: 'demo-1',
            reason: 'blocked by the provider',
            date: '2026-01-15',
            scales: ['outcome'],
          },
        ],
      },
    },
  };
  const { subject, judge } = planJobs(
    [taskSetOf(3, { readB: false })],
    CONFIG,
    { exclusions },
  );
  assert.equal(
    subject.length,
    6,
    'an excluded task is still answered: reading B may use it',
  );
  assert.ok(!judge.some((job) => job.scale === 'items'));
  assert.deepEqual([...new Set(judge.map((job) => job.task.id))].sort(), [
    'demo-0',
    'demo-2',
  ]);
  const readByB = planJobs([taskSetOf(3)], CONFIG, { exclusions }).judge;
  assert.equal(
    readByB.filter((job) => job.task.id === 'demo-1' && job.scale === 'items')
      .length,
    SEATS.length * 2,
  );
  assert.equal(
    readByB.filter((job) => job.task.id === 'demo-1' && job.scale === 'outcome')
      .length,
    0,
  );
});

test('planJobs agrees with the call counts of plan on the fixture baseline', () => {
  const layout = createLayout({ root: helpers.fixtureRoot() });
  const { taskSet } = loadTaskSet({
    layout,
    config: CONFIG,
    skill: helpers.SKILL,
  });
  const exclusions = loadExclusions(layout);
  assert.ok(
    Object.keys(exclusions.batches).length > 0,
    'the fixture excludes a task, so the outcome count is tested',
  );
  {
    const config = CONFIG;
    const { subject, judge } = planJobs([taskSet], config, { exclusions });
    const plan = buildPlan({ layout, config, skills: [helpers.SKILL] });
    const calls = Object.assign({}, ...plan.stages.map((stage) => stage.calls));
    assert.equal(subject.length, calls.subject.total);
    assert.equal(
      judge.filter((job) => job.scale === 'items').length,
      calls.judgeB.total,
    );
    assert.equal(
      judge.filter((job) => job.scale === 'outcome').length,
      calls.judgeA.total,
    );
    // Each judge job names a judgment file of its own.
    const files = judge.map((job) =>
      layout.judgmentFile(
        job.scale,
        job.skill,
        job.batch,
        job.task.id,
        job.seat,
        job.arm,
      ),
    );
    assert.equal(new Set(files).size, files.length);
  }
});

test('trackEstimatedCalls: counts per model the settles the ledger charges at the mean', async () => {
  const settled = [];
  // A ledger that decides as the real one does (settledCost) and answers each settle with its decision.
  const fakeLedger = {
    file: 'ledger.jsonl',
    reserve: async (callUsd, label) => ({
      id: label,
      usd: callUsd,
      settle: (settlement) => {
        settled.push([label, settlement]);
        return settledCost({ ...settlement, reservedUsd: callUsd });
      },
      cancel: () => {},
    }),
  };
  const tracker = trackEstimatedCalls(fakeLedger);
  assert.equal(tracker.estimated(), null);
  assert.equal(tracker.ledger.file, 'ledger.jsonl');
  const tokens = { input_tokens: 10, output_tokens: 5 };
  // [label, settle argument]: reported, missing, zero with tokens, negative, then a second model.
  for (const [label, settlement] of [
    ['reported', { model: 'm1', usage: tokens, reportedUsd: 0.2 }],
    ['missing', { model: 'm1', usage: tokens }],
    ['zero', { model: 'm1', usage: tokens, reportedUsd: 0 }],
    ['negative', { model: 'm2', reportedUsd: -1 }],
    ['zero without tokens', { model: 'm2', reportedUsd: 0 }],
    // Ended before a model step: charged 0, not the mean, so not counted.
    ['not started', { model: 'm2', modelStarted: false }],
  ]) {
    const reservation = await tracker.ledger.reserve(0.5, label);
    assert.equal(reservation.id, label, 'the reservation keeps its own fields');
    assert.equal(reservation.usd, 0.5);
    assert.equal(typeof reservation.cancel, 'function');
    const charged = reservation.settle(settlement);
    assert.deepEqual(
      charged,
      settledCost({ ...settlement, reservedUsd: 0.5 }),
      `${label}: the caller gets the ledger's own answer`,
    );
  }
  assert.deepEqual(
    settled.map(([label]) => label),
    [
      'reported',
      'missing',
      'zero',
      'negative',
      'zero without tokens',
      'not started',
    ],
    'every settle reaches the ledger',
  );
  assert.deepEqual(tracker.estimated(), {
    calls: 3,
    models: { m1: 2, m2: 1 },
  });
  // The count is a copy: changing what estimated() returned does not change the next answer.
  tracker.estimated().models.m1 = 99;
  assert.deepEqual(tracker.estimated().models, { m1: 2, m2: 1 });
  assert.equal(
    estimatedCallsLine(tracker.estimated()),
    '3 call(s) charged at the estimate because the CLI reported no usable cost: m1 2, m2 1',
  );
});

test('trackEstimatedCalls: over the real ledger, the reservation keeps its kind, model, mean and expiry and an unreported call is charged its mean', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const file = path.join(dir, 'ledger.jsonl');
    const start = Date.parse('2026-02-01T00:00:00Z');
    const ttlMs = 6 * 60000;
    const tracker = trackEstimatedCalls(
      createLedger({
        file,
        limits: { max_usd: 5, total_cap_usd: 50 },
        runId: 'run-1',
        now: () => start,
      }),
    );
    const model = CONFIG.models.subject;
    const { usd, options } = reservationFor(CONFIG, 'subject', model);
    assert.ok(
      options.meanUsd < usd,
      'the mean is below the p90, so a call charged the p90 is seen',
    );
    const tokens = { input_tokens: 10, output_tokens: 5 };
    const reported = await tracker.ledger.reserve(usd, 'reported', {
      ...options,
      ttlMs,
    });
    reported.settle({ model, usage: tokens, reportedUsd: 0.01 });
    const unreported = await tracker.ledger.reserve(usd, 'unreported', {
      ...options,
      ttlMs,
    });
    // No model in the settle: the reservation's own is used, by the ledger and in the count.
    const charged = unreported.settle({ usage: tokens });
    assert.deepEqual(
      { usd: charged.usd, cost_source: charged.cost_source },
      { usd: options.meanUsd, cost_source: 'estimate' },
    );
    assert.deepEqual(tracker.estimated(), { calls: 1, models: { [model]: 1 } });

    const rows = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const reserveRow = rows.find(
      (row) => row.type === 'reserve' && row.label === 'unreported',
    );
    assert.equal(reserveRow.kind, 'subject');
    assert.equal(reserveRow.model, model);
    assert.equal(reserveRow.usd, usd);
    assert.equal(
      Date.parse(reserveRow.expires) - start,
      ttlMs,
      'the ttl reaches the ledger',
    );
    const settleRow = rows.find(
      (row) => row.type === 'settle' && row.label === 'unreported',
    );
    assert.equal(settleRow.kind, 'subject');
    assert.equal(settleRow.model, model);
    assert.equal(settleRow.usd, options.meanUsd);
    assert.equal(settleRow.cost_source, 'estimate');
  });
});
