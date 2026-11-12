// SPDX-License-Identifier: Apache-2.0
// The labels (scripts/bench/lib/labels.js): the four label rules at their interval edges, the NO DATA rules (12 of
// every 16 tasks, stale judgments, a batch not read), the pooled readings over two batches, the pooled guard result
// and a_batches_agree, and the suggested verdict at its cut points. Pinned to the committed fixture
// tests/fixtures/bench/labels.json; nothing is written.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const labels = require('../../../scripts/bench/lib/labels');
const { jobsOf, summaryOf, guardEntriesOf } = require('./labels-fixture');
const { sha256 } = require('../../../scripts/bench/lib/provenance');

const { LABELS, labelFor, labelSkill } = labels;
const BATCHES = ['b1', 'b2'];
const near = (actual, expected, epsilon, message = '') =>
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `${message} ${actual} is not within ${epsilon} of ${expected}`,
  );
const reading = (lower, upper) => ({ t_interval_exact: [lower, upper] });
const labelOf = (readingA, readingB) => labelFor(readingA, readingB).label;
const labelEntry = (skill, options = {}) =>
  labelSkill({
    summary: summaryOf(skill, options.summary),
    batches: BATCHES,
    guardEntries: guardEntriesOf(skill),
    ...options.label,
  });

// ---- the label rules ---------------------------------------------------------------------------------------------------

test('labelFor: the four labels, their edges at exactly 0, and their order', () => {
  assert.equal(
    labelOf(reading(0.1, 0.9), reading(-1, -0.5)),
    LABELS.helps,
    'A lower end above 0, whatever B says',
  );
  assert.equal(labelOf(reading(0.0001, 0.2), reading(-1, 1)), LABELS.helps);
  assert.equal(
    labelOf(reading(0, 0.9), reading(0.2, 0.9)),
    LABELS.conventions,
    'a lower end of exactly 0 is not above 0, and 0 is inside the interval',
  );
  assert.equal(
    labelOf(reading(-0.4, 0.4), reading(0.3, 1.2)),
    LABELS.conventions,
  );
  assert.equal(
    labelOf(reading(-0.4, 0.4), reading(0, 1.2)),
    LABELS.none,
    'a B lower end of exactly 0 is not above 0',
  );
  assert.equal(labelOf(reading(-0.4, 0.4), reading(-0.3, 0.3)), LABELS.none);
  assert.equal(
    labelOf(reading(-0.9, -0.1), reading(0.3, 1.2)),
    LABELS.harm,
    'harm is checked before conventions, so a B gain does not hide it',
  );
  assert.equal(
    labelOf(reading(-0.9, -0.0001), reading(-1, 0)),
    LABELS.harm,
    'harm is checked before no change',
  );
  assert.equal(
    labelOf(reading(-0.9, 0), reading(-1, 0)),
    LABELS.none,
    'an upper end of exactly 0 is not below 0',
  );
  assert.equal(labelOf(reading(0.1, 0.9), null), LABELS.helps);
  assert.equal(
    labelOf(reading(-0.9, -0.1), { t_interval_exact: null }),
    LABELS.harm,
    'B is not needed when A decides',
  );
  assert.deepEqual(Object.values(LABELS).sort(), [
    'NO DATA',
    'harm',
    'helps quality',
    'no change',
    'teaches conventions (human call)',
  ]);
});

test('labelFor: NO DATA when A has no interval, or A contains 0 and B has none', () => {
  for (const readingA of [null, { t_interval_exact: null, t_interval: null }]) {
    const result = labelFor(readingA, reading(0.3, 1.2));
    assert.equal(result.label, LABELS.noData);
    assert.match(result.why, /A has fewer than 2 counted tasks/);
  }
  const result = labelFor(reading(-0.4, 0.4), { t_interval_exact: null });
  assert.equal(result.label, LABELS.noData);
  assert.match(result.why, /contains 0 and B has fewer than 2 counted tasks/);
});

test('labelFor reads the unrounded interval ends, not the printed ones', () => {
  const tiny = { t_interval: [0, 0.5], t_interval_exact: [0.00004, 0.5] };
  assert.equal(labelOf(tiny, null), LABELS.helps, 'prints +0.00, is above 0');
  const tinyBelow = {
    t_interval: [-0.5, 0],
    t_interval_exact: [-0.5, -0.00004],
  };
  assert.equal(labelOf(tinyBelow, null), LABELS.harm);
  const printedOnly = { t_interval: [0.1, 0.5] };
  assert.equal(
    labelOf(printedOnly, null),
    LABELS.helps,
    'a reading with only the printed interval is still read',
  );
});

test('the why text prints an end that would round to 0 with 4 decimals, so the figure that decided the label shows', () => {
  assert.equal(
    labelFor(reading(0.003, 1.0), null).why,
    'A lower end +0.0030 is above 0',
  );
  assert.equal(
    labelFor(reading(-1.0, -0.002), null).why,
    'A upper end -0.0020 is below 0',
  );
  assert.equal(
    labelFor(reading(-0.003, 0.4), reading(0.004, 0.9)).why,
    'A [-0.0030, +0.40] contains 0 and B lower end +0.0040 is above 0',
  );
  // An end of exactly 0 and an end that rounds to a non-zero figure keep 2 decimals.
  assert.equal(
    labelFor(reading(-0.4, 0), reading(-0.3, 0.3)).why,
    'A [-0.40, +0.00] and B [-0.30, +0.30]: neither lower end is above 0',
  );
  assert.equal(
    labelFor(reading(0.012, 1.0), null).why,
    'A lower end +0.01 is above 0',
  );
  assert.equal(
    labelFor(reading(0.00004, 1.0), null).why,
    'A lower end +0.000040 is above 0',
  );
});

test('the label entry carries the unrounded intervals the rules read, beside the printed ones', () => {
  const entry = labelEntry('helps-skill');
  const summary = summaryOf('helps-skill');
  assert.deepEqual(entry.A.t_interval_exact, summary.A.t_interval_exact);
  assert.deepEqual(entry.B.t_interval_exact, summary.B.t_interval_exact);
  assert.deepEqual(
    entry.B_all.t_interval_exact,
    summary.B_all.t_interval_exact,
  );
  assert.equal(entry.A.t_interval_exact.length, 2);
  assert.ok(entry.A.t_interval_exact.every((end) => typeof end === 'number'));
});

test('the label rules text names the four labels in the order they are checked, with a date', () => {
  const order = [
    LABELS.helps,
    LABELS.harm,
    LABELS.conventions,
    LABELS.none,
  ].map((label) => labels.LABEL_RULES.indexOf(`\`${label}\``));
  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual(
    [...order].sort((left, right) => left - right),
    order,
  );
  assert.match(labels.LABEL_RULES, /12 of every 16/);
  assert.match(labels.LABEL_RULES, /not a keep or prune verdict/);
  assert.match(labels.LABEL_RULES_DATE, /^\d{4}-\d{2}-\d{2}$/);
});

test('the label and verdict rules texts are pinned to their dates: a changed rule needs a new date and a new pin', () => {
  assert.equal(labels.LABEL_RULES_DATE, '2026-11-10');
  assert.equal(
    sha256(labels.LABEL_RULES),
    '57e62d2ade715d5fd59033115e859ae903de40f2f68090aa1cdce06f8676cfce',
  );
  assert.equal(labels.VERDICT_RULES_DATE, '2026-11-16');
  assert.equal(
    sha256(labels.VERDICT_RULES),
    '8928955b2af5e9343828cc6b2716c8f175bee05b6e214a223e14e09da2c422a6',
  );
});

// ---- pooled readings over two batches ---------------------------------------------------------------------------------

test('A and B are pooled over the 16 tasks of the two batches, with each batch kept beside them', () => {
  const entry = labelEntry('helps-skill');
  const summary = summaryOf('helps-skill');
  assert.equal(
    summary.tasks,
    16,
    'task ids repeat across batches and still count as 16 tasks',
  );
  // By hand: 16 gaps with sum 14.0, so mean 0.875; sd 0.2769; half-width t(15) 2.131 * sd / 4 = 0.1475.
  assert.equal(entry.A.tasks_counted, 16);
  near(entry.A.mean_gap, 0.875, 1e-9);
  near(entry.A.t_interval[0], 0.7275, 2e-3);
  near(entry.A.t_interval[1], 1.0225, 2e-3);
  near(entry.B.mean_gap, 1.28125, 1e-4);
  near(entry.B.t_interval[0], 1.1137, 2e-3);
  near(entry.B.t_interval[1], 1.4488, 2e-3);
  near(summary.A.by_batch.b1.mean_gap, 1.0, 1e-9);
  near(summary.A.by_batch.b2.mean_gap, 0.75, 1e-9);
  // The pooled interval is the interval of the 16 values, not the mean of the two batch intervals (df 15, not 7).
  const meanLower =
    (summary.A.by_batch.b1.t_interval[0] +
      summary.A.by_batch.b2.t_interval[0]) /
    2;
  assert.ok(Math.abs(meanLower - entry.A.t_interval[0]) > 0.02);
});

test('each fixture skill gets the label the table gives it', () => {
  const got = Object.fromEntries(
    ['helps-skill', 'conventions-skill', 'harm-skill', 'none-skill'].map(
      (skill) => [skill, labelEntry(skill).label],
    ),
  );
  assert.deepEqual(got, {
    'helps-skill': LABELS.helps,
    'conventions-skill': LABELS.conventions,
    'harm-skill': LABELS.harm,
    'none-skill': LABELS.none,
  });
  const conventions = labelEntry('conventions-skill');
  near(conventions.A.mean_gap, 0, 1e-9);
  assert.ok(conventions.A.t_interval[0] < 0 && conventions.A.t_interval[1] > 0);
  assert.ok(conventions.B.t_interval[0] > 1.0);
  assert.deepEqual(conventions.no_data, []);
  assert.match(
    conventions.why,
    /contains 0 and B lower end \+1\.\d\d is above 0/,
  );
});

// ---- the suggested verdict ---------------------------------------------------------------------------------------------

const { VERDICTS, VERDICT_RULES, VERDICT_RULES_DATE, verdictFor } = labels;
const gapReading = (meanGap, lower, upper) => ({
  mean_gap: meanGap,
  t_interval_exact: [lower, upper],
});
const meanOnly = (meanGap) => ({ mean_gap: meanGap });
const VERDICT_ACTIONS_TEXT = {
  leanPrune: 'Prune unless the team needs these rules.',
  fix: 'Fix the rules that cost task quality (see the item losses), or prune.',
  prune: 'Prune: it makes the task result worse.',
  closeCall: 'Read the item losses before deciding.',
};
const verdictOf = (readingA, readingB, label = LABELS.none) =>
  verdictFor(label, readingA, readingB);

test('verdictFor: keep and prune follow A interval ends, whatever B says', () => {
  assert.equal(
    verdictOf(gapReading(0.3, 0.05, 0.55), meanOnly(-1)).verdict,
    VERDICTS.keep,
  );
  assert.equal(
    verdictOf(gapReading(-0.3, -0.55, -0.05), meanOnly(1.2)).verdict,
    VERDICTS.prune,
  );
  assert.notEqual(
    verdictOf(gapReading(0.2, 0, 0.4), meanOnly(0)).verdict,
    VERDICTS.keep,
    'a lower end of exactly 0 is not above 0',
  );
  assert.notEqual(
    verdictOf(gapReading(-0.2, -0.4, 0), meanOnly(1)).verdict,
    VERDICTS.prune,
    'an upper end of exactly 0 is not below 0',
  );
});

test('verdictFor: lean keep, lean prune and close call at the cut points -0.10, +0.30 and +0.50', () => {
  const open = (meanGap) => gapReading(meanGap, -0.5, 0.5);
  assert.equal(
    verdictOf(open(-0.1), meanOnly(0.5)).verdict,
    VERDICTS.leanKeep,
    'A exactly -0.10 and B exactly +0.50 lean keep: rule 3 is checked first',
  );
  assert.equal(
    verdictOf(open(-0.1001), meanOnly(0.9)).verdict,
    VERDICTS.leanPrune,
  );
  assert.equal(
    verdictOf(open(-0.1), meanOnly(0.4999)).verdict,
    VERDICTS.leanPrune,
    'A exactly -0.10 with B under +0.50 is rule 4',
  );
  assert.equal(
    verdictOf(open(0.2), meanOnly(0.2999)).verdict,
    VERDICTS.leanPrune,
  );
  assert.equal(
    verdictOf(open(0.2), meanOnly(0.3)).verdict,
    VERDICTS.closeCall,
    'B exactly +0.30 is not under +0.30',
  );
  assert.equal(
    verdictOf(open(-0.05), meanOnly(0.4999)).verdict,
    VERDICTS.closeCall,
  );
});

test('verdictFor: with no B mean, A at -0.10 or less leans prune and anything else is a close call', () => {
  const open = (meanGap) => gapReading(meanGap, -0.5, 0.5);
  assert.equal(verdictOf(open(-0.1), null).verdict, VERDICTS.leanPrune);
  assert.equal(
    verdictOf(open(-0.1), null).action,
    VERDICT_ACTIONS_TEXT.leanPrune,
    'the action follows the verdict at exactly -0.10',
  );
  assert.equal(
    verdictOf(open(-0.09), null).action,
    VERDICT_ACTIONS_TEXT.closeCall,
  );
  assert.equal(verdictOf(open(-0.09), null).verdict, VERDICTS.closeCall);
  assert.equal(verdictOf(open(0.2), {}).verdict, VERDICTS.closeCall);
  assert.match(verdictOf(open(0.2), null).why, /B has no mean/);
});

test('verdictFor: NO DATA gives no data, with the label reason as the action', () => {
  const noData = verdictFor(LABELS.noData, gapReading(0.4, 0.1, 0.7), null, {
    noDataWhy: 'batch b2 was not read',
  });
  assert.deepEqual(noData, {
    verdict: VERDICTS.noData,
    why: 'the skill is NO DATA',
    action: 'batch b2 was not read',
  });
  assert.equal(
    verdictFor(LABELS.none, null, meanOnly(1)).verdict,
    VERDICTS.noData,
    'no A interval is no data',
  );
});

test('verdictFor: a prune or lean prune with B at +0.50 or more says fix, otherwise prune', () => {
  const fix = /^Fix the rules that cost task quality/;
  assert.match(
    verdictOf(gapReading(-0.3, -0.5, -0.1), meanOnly(0.5)).action,
    fix,
  );
  assert.equal(
    verdictOf(gapReading(-0.3, -0.5, -0.1), meanOnly(0.4999)).action,
    'Prune: it makes the task result worse.',
  );
  assert.match(
    verdictOf(gapReading(-0.2, -0.5, 0.1), meanOnly(0.8)).action,
    fix,
  );
  assert.equal(
    verdictOf(gapReading(0.1, -0.2, 0.4), meanOnly(0.1)).action,
    'Prune unless the team needs these rules.',
  );
  assert.equal(
    verdictOf(gapReading(0.2, 0.1, 0.3), meanOnly(0)).action,
    'Keep.',
  );
  assert.match(
    verdictOf(gapReading(0, -0.2, 0.2), meanOnly(0.9)).action,
    /^Keep if the team wants these rules/,
  );
  assert.match(
    verdictOf(gapReading(0, -0.2, 0.2), meanOnly(0.4)).action,
    /^Read the item losses/,
  );
});

test('verdictFor reads the unrounded A ends, as the labels do', () => {
  assert.equal(
    verdictFor(LABELS.helps, {
      mean_gap: 0.2,
      t_interval: [0, 0.4],
      t_interval_exact: [0.00001, 0.4],
    }).verdict,
    VERDICTS.keep,
  );
});

test('each fixture skill carries its suggested verdict beside its label', () => {
  const got = Object.fromEntries(
    ['helps-skill', 'conventions-skill', 'harm-skill', 'none-skill'].map(
      (skill) => {
        const entry = labelEntry(skill);
        return [skill, [entry.label, entry.verdict]];
      },
    ),
  );
  assert.equal(got['helps-skill'][1], VERDICTS.keep);
  assert.equal(got['harm-skill'][1], VERDICTS.prune);
  assert.equal(
    got['conventions-skill'][1],
    VERDICTS.leanKeep,
    'A mean 0 and a big B gain',
  );
  const entry = labelEntry('helps-skill');
  assert.match(entry.verdict_why, /^A lower end \+\d\.\d\d is above 0$/);
  assert.equal(entry.verdict_action, 'Keep.');
  assert.equal(entry.A.tasks, 16, 'the brief of a reading carries its tasks');
});

test('a skill whose reading B waits gets a verdict from A alone, and a NO DATA skill carries its reason as the action', () => {
  // B has a +1.00 gain in the jobs. Read, it turns the prune action into "fix"; the plan says B waits, so it is not read.
  const gain = [
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
  ];
  const jobs = jobsOf('harm-skill', { override: { items: gain } });
  const read = labelEntry('harm-skill', { summary: { jobs } });
  assert.equal(read.verdict_action, VERDICT_ACTIONS_TEXT.fix);
  const waiting = labelEntry('harm-skill', {
    summary: { jobs },
    label: { bWaiting: BATCHES },
  });
  assert.equal(waiting.verdict, VERDICTS.prune);
  assert.equal(waiting.verdict_action, VERDICT_ACTIONS_TEXT.prune);
  const stale = labelEntry('helps-skill', {
    summary: {
      jobs: jobsOf('helps-skill'),
      isStale: (job) => job.scale === 'outcome',
    },
  });
  assert.equal(stale.label, LABELS.noData);
  assert.equal(stale.verdict_action, stale.no_data[0]);
});

test('the verdict rules text names the verdicts in the order they are checked, with a date, and calls it a suggestion', () => {
  assert.match(VERDICT_RULES_DATE, /^\d{4}-\d{2}-\d{2}$/);
  const order = ['keep', 'prune', 'lean keep', 'lean prune', 'close call'].map(
    (verdict) => VERDICT_RULES.indexOf(`\`${verdict}\`:`),
  );
  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual(
    [...order].sort((left, right) => left - right),
    order,
  );
  assert.match(VERDICT_RULES, /final call is the maintainer's/);
  assert.match(VERDICT_RULES, /-0\.10/);
  assert.match(VERDICT_RULES, /\+0\.30/);
  assert.match(VERDICT_RULES, /\+0\.50/);
});

// ---- the guard result ---------------------------------------------------------------------------------------------------

test('the guard result: per batch rates and loss, and the pooled guard gap with its interval', () => {
  const helps = labelEntry('helps-skill').guard;
  assert.deepEqual(
    helps.batches.map((batch) => [
      batch.batch,
      batch.with_rate,
      batch.without_rate,
      batch.loss,
    ]),
    [
      ['b1', 0.75, 0.375, false],
      ['b2', 0.75, 0.375, false],
    ],
  );
  near(helps.gap.mean_gap, 0.375, 1e-9);
  near(helps.gap.t_interval[0], 0.3062, 2e-3);
  assert.equal(helps.gap.tasks_counted, 16);
  assert.equal(helps.loss, false);
  assert.deepEqual(helps.loss_batches, []);
  const harm = labelEntry('harm-skill').guard;
  assert.equal(harm.loss, true);
  assert.deepEqual(harm.loss_batches, ['b1', 'b2']);
  near(harm.gap.mean_gap, -0.375, 1e-9);
});

test('the guard result keeps each batch data flag and note, and rounds the pooled gap to 4 places', () => {
  const guardEntries = guardEntriesOf('helps-skill');
  guardEntries.b2 = {
    ...guardEntries.b2,
    guard: { ...guardEntries.b2.guard, data: false, note: 'no guard item' },
  };
  guardEntries.b1.guard.gap.per_task = [0.123456, 0.2345678, 0.3456789].map(
    (gap, index) => ({ task_id: `helps-skill-${index + 1}`, gap }),
  );
  const entry = labelEntry('helps-skill', { label: { guardEntries } });
  assert.deepEqual(
    entry.guard.batches.map((batch) => [batch.batch, batch.data, batch.note]),
    [
      ['b1', true, null],
      ['b2', false, 'no guard item'],
    ],
  );
  const pooled = entry.guard.gap;
  assert.equal(pooled.mean_gap, Math.round(pooled.mean_gap * 1e4) / 1e4);
  for (const end of pooled.t_interval)
    assert.equal(end, Math.round(end * 1e4) / 1e4);
});

test('the pooled guard result has a loss when any batch has one, not only when every batch has one', () => {
  const entries = guardEntriesOf('helps-skill');
  const lossInOne = {
    ...entries,
    b1: { ...entries.b1, guard: { ...entries.b1.guard, loss: true } },
  };
  const pooled = labels.poolGuard(lossInOne);
  assert.equal(pooled.loss, true);
  assert.deepEqual(pooled.loss_batches, ['b1']);
  assert.deepEqual(
    pooled.batches.map((batch) => [batch.batch, batch.loss]),
    [
      ['b1', true],
      ['b2', false],
    ],
  );
  const noLoss = labels.poolGuard(entries);
  assert.equal(noLoss.loss, false);
  assert.deepEqual(noLoss.loss_batches, []);
});

test('the guard result changes no label, and a skill with no guard item says "no guard data"', () => {
  const noGuard = Object.fromEntries(
    Object.entries(guardEntriesOf('harm-skill')).map(([batch, entry]) => [
      batch,
      {
        ...entry,
        guard: {
          data: false,
          note: labels.NO_GUARD_DATA,
          items: 0,
          with_rate: null,
          without_rate: null,
          loss: null,
          gap: null,
        },
      },
    ]),
  );
  const entry = labelEntry('harm-skill', {
    label: { guardEntries: noGuard },
  });
  assert.equal(entry.label, LABELS.harm);
  assert.equal(entry.guard.data, false);
  assert.equal(entry.guard.note, 'no guard data');
  assert.equal(entry.guard.gap, null);
  assert.equal(
    labelEntry('helps-skill', { label: { guardEntries: null } }).guard,
    null,
  );
  // Only the batches with guard data are pooled.
  const mixed = { ...guardEntriesOf('helps-skill'), b2: noGuard.b2 };
  const pooled = labels.poolGuard(mixed);
  assert.equal(pooled.gap.tasks_counted, 8);
  assert.equal(pooled.batches.length, 2);
});

// ---- NO DATA ------------------------------------------------------------------------------------------------------------

/** The jobs of `skill` with the outcome records of the first `count` tasks of b1 left with one valid seat. */
function withUncountedA(skill, count) {
  const jobs = jobsOf(skill);
  const outcomeJobs = jobs.outcomeJobs.map((job) => {
    const index = Number(job.task.id.split('-').pop());
    if (job.batch === 'b1' && index <= count && job.seat !== 'anthropic')
      return { ...job, state: 'pending', record: null };
    return job;
  });
  return { ...jobs, outcomeJobs };
}

test('NO DATA at fewer than 12 of 16 counted tasks; exactly 12 is enough', () => {
  const twelve = labelEntry('helps-skill', {
    summary: { jobs: withUncountedA('helps-skill', 4) },
  });
  assert.equal(twelve.A.tasks_counted, 12);
  assert.equal(twelve.label, LABELS.helps);
  assert.deepEqual(twelve.no_data, []);
  const eleven = labelEntry('helps-skill', {
    summary: { jobs: withUncountedA('helps-skill', 5) },
  });
  assert.equal(eleven.A.tasks_counted, 11);
  assert.equal(eleven.label, LABELS.noData);
  assert.deepEqual(eleven.no_data, [
    "A counts 11 of the skill's 16 tasks, below 12 (12 of every 16)",
  ]);
  assert.equal(eleven.why, eleven.no_data[0]);
});

test('minCounted: 12 of every 16, rounded up for another size', () => {
  assert.deepEqual(
    [16, 15, 13, 8, 5, 1, 0].map(labels.minCounted),
    [12, 12, 10, 6, 4, 1, 0],
  );
});

test('NO DATA when B counts too few tasks, read over every task (B_all)', () => {
  const jobs = jobsOf('conventions-skill');
  jobs.itemsJobs = jobs.itemsJobs.map((job) =>
    job.batch === 'b2' && job.seat !== 'xai'
      ? { ...job, state: 'pending', record: null }
      : job,
  );
  const entry = labelEntry('conventions-skill', { summary: { jobs } });
  assert.equal(entry.label, LABELS.noData);
  assert.deepEqual(entry.no_data, [
    "B counts 8 of the skill's 16 tasks, below 12 (12 of every 16)",
  ]);
});

test('NO DATA when B counts too few of the tasks A reads, though it counts enough of all tasks', () => {
  const jobs = jobsOf('conventions-skill');
  const left = new Set([
    'conventions-skill-1',
    'conventions-skill-2',
    'conventions-skill-3',
  ]);
  const noB = new Set([
    'conventions-skill-1',
    'conventions-skill-2',
    'conventions-skill-3',
    'conventions-skill-4',
  ]);
  jobs.outcomeJobs = jobs.outcomeJobs.filter(
    (job) => !(job.batch === 'b1' && left.has(job.task.id)),
  );
  // Four tasks of b2 have no valid B judgment: B_all counts 12 of 16, B counts 9 of the 13 tasks A reads.
  jobs.itemsJobs = jobs.itemsJobs.map((job) =>
    job.batch === 'b2' && noB.has(job.task.id)
      ? { ...job, state: 'pending', record: null }
      : job,
  );
  const excluded = [...left].map((id) => ({
    skill: 'conventions-skill',
    batch: 'b1',
    id,
    reason: 'blocked',
    date: '2026-11-01',
  }));
  const entry = labelEntry('conventions-skill', {
    summary: { jobs, excluded },
  });
  assert.equal(entry.A.tasks_counted, 13);
  assert.equal(entry.B_all.tasks_counted, 12);
  assert.equal(entry.B.tasks_counted, 9);
  assert.equal(entry.label, LABELS.noData);
  assert.deepEqual(entry.no_data, [
    'B counts 9 of the 13 tasks A reads, below 10 (12 of every 16)',
  ]);
  // One exclusion is enough when B_all is at exactly 12 of 16: B counts 11 of the 15 tasks A reads.
  const oneJobs = jobsOf('conventions-skill');
  oneJobs.outcomeJobs = oneJobs.outcomeJobs.filter(
    (job) => !(job.batch === 'b1' && job.task.id === 'conventions-skill-1'),
  );
  oneJobs.itemsJobs = oneJobs.itemsJobs.map((job) =>
    job.batch === 'b2' && noB.has(job.task.id)
      ? { ...job, state: 'pending', record: null }
      : job,
  );
  const one = labelEntry('conventions-skill', {
    summary: { jobs: oneJobs, excluded: excluded.slice(0, 1) },
  });
  assert.equal(one.B_all.tasks_counted, 12);
  assert.equal(one.B.tasks_counted, 11);
  assert.equal(one.label, LABELS.noData);
  assert.deepEqual(one.no_data, [
    'B counts 11 of the 15 tasks A reads, below 12 (12 of every 16)',
  ]);
});

test('NO DATA when a judgment of either reading is stale, even with full coverage', () => {
  const jobs = jobsOf('helps-skill');
  const stale = jobs.itemsJobs[0];
  // A pending job whose file is on disk: the judgment was made from other inputs and is never read.
  jobs.itemsJobs = [
    { ...stale, seat: 'extra', state: 'pending', record: null },
    ...jobs.itemsJobs,
  ];
  const entry = labelEntry('helps-skill', {
    summary: { jobs, isStale: (job) => job.seat === 'extra' },
  });
  assert.equal(entry.B_all.tasks_counted, 16, 'the coverage is complete');
  assert.equal(entry.label, LABELS.noData);
  assert.deepEqual(entry.no_data, [
    'B has 1 stale judgment(s): made from other inputs and not read until the judge job makes them again',
  ]);
});

test('NO DATA when a batch was not read: no judge job in it, or listing it failed; the reason names the batch', () => {
  const jobs = jobsOf('helps-skill');
  const onlyB1 = {
    itemsJobs: jobs.itemsJobs.filter((job) => job.batch === 'b1'),
    outcomeJobs: jobs.outcomeJobs.filter((job) => job.batch === 'b1'),
  };
  const missing = labelEntry('helps-skill', { summary: { jobs: onlyB1 } });
  assert.equal(missing.label, LABELS.noData);
  assert.equal(
    missing.no_data[0],
    'batch b2 was not read: B has no judge job in it',
  );
  const noA = labelEntry('helps-skill', {
    summary: {
      jobs: { ...jobs, outcomeJobs: onlyB1.outcomeJobs },
    },
  });
  assert.equal(
    noA.no_data[0],
    'batch b2 was not read: A has no judge job in it',
  );
  const failed = labelEntry('helps-skill', {
    summary: { jobs: onlyB1 },
    label: { batchErrors: [{ batch: 'b2', error: 'bad bucket sidecar' }] },
  });
  assert.equal(
    failed.no_data[0],
    'batch b2 could not be read: bad bucket sidecar',
  );
  assert.equal(
    failed.no_data.filter((line) => line.includes('b2 was not read')).length,
    0,
    'a batch that failed is named once',
  );
  // With the full batch list read, the same skill is labeled.
  assert.equal(labelEntry('helps-skill').label, LABELS.helps);
});

test('rules stale: with B waiting for a refreshed baseline, A alone gives helps or harm, and A containing 0 is NO DATA naming the batch', () => {
  // A batch whose reading B waits (plan row read_b false) has no items job, and A still reads it.
  const waitingEntry = (skill, bWaiting = BATCHES) =>
    labelEntry(skill, {
      summary: { jobs: { ...jobsOf(skill), itemsJobs: [] } },
      label: { bWaiting },
    });
  const helps = waitingEntry('helps-skill');
  assert.equal(helps.B_all.tasks_counted, 0, 'B reads nothing');
  assert.equal(helps.label, LABELS.helps);
  assert.deepEqual(helps.no_data, []);
  const harm = waitingEntry('harm-skill');
  assert.equal(harm.label, LABELS.harm);
  assert.deepEqual(harm.no_data, []);
  const none = waitingEntry('none-skill');
  assert.equal(none.label, LABELS.noData);
  assert.match(
    none.why,
    /contains 0 and reading B waits for a refreshed baseline in batch b1, b2$/,
  );
  assert.deepEqual(none.no_data, [none.why]);
  const conventions = waitingEntry('conventions-skill');
  assert.equal(
    conventions.label,
    LABELS.noData,
    'a B gain cannot be read while B waits',
  );
  // One batch waits and the other is read: B still has no interval, and only the waiting batch is spared.
  const jobs = jobsOf('helps-skill');
  const oneWaits = labelEntry('helps-skill', {
    summary: {
      jobs: {
        ...jobs,
        itemsJobs: jobs.itemsJobs.filter((job) => job.batch === 'b1'),
      },
    },
    label: { bWaiting: ['b2'] },
  });
  assert.equal(oneWaits.label, LABELS.helps);
  const noneOneWaits = labelEntry('none-skill', {
    summary: {
      jobs: {
        ...jobsOf('none-skill'),
        itemsJobs: jobsOf('none-skill').itemsJobs.filter(
          (job) => job.batch === 'b1',
        ),
      },
    },
    label: { bWaiting: ['b2'] },
  });
  assert.match(noneOneWaits.why, /waits for a refreshed baseline in batch b2$/);
  // A must still read a waiting batch. Its tasks are then unknown to the summary, so the batch line is the cause.
  const noA = labelEntry('helps-skill', {
    summary: {
      jobs: {
        itemsJobs: [],
        outcomeJobs: jobs.outcomeJobs.filter((job) => job.batch === 'b1'),
      },
    },
    label: { bWaiting: BATCHES },
  });
  assert.equal(noA.label, LABELS.noData);
  assert.deepEqual(noA.no_data, [
    'batch b2 was not read: A has no judge job in it',
  ]);
  // A's coverage still counts in a waiting batch.
  const thinA = labelEntry('helps-skill', {
    summary: { jobs: { ...withUncountedA('helps-skill', 5), itemsJobs: [] } },
    label: { bWaiting: BATCHES },
  });
  assert.equal(thinA.label, LABELS.noData);
  assert.deepEqual(thinA.no_data, [
    "A counts 11 of the skill's 16 tasks, below 12 (12 of every 16)",
  ]);
  // A B batch that is missing without waiting is still NO DATA.
  const notWaiting = labelEntry('helps-skill', {
    summary: { jobs: { ...jobs, itemsJobs: [] } },
    label: { bWaiting: ['b1'] },
  });
  assert.equal(notWaiting.label, LABELS.noData);
  assert.deepEqual(notWaiting.no_data, [
    'batch b2 was not read: B has no judge job in it',
  ]);
});

test('rules stale: a waiting batch whose every task is left out of A is not "not read"', () => {
  const jobs = jobsOf('helps-skill');
  const excluded = Array.from({ length: 8 }, (_, index) => ({
    skill: 'helps-skill',
    batch: 'b2',
    id: `helps-skill-${index + 1}`,
    reason: 'blocked',
    date: '2026-11-01',
  }));
  const entry = labelEntry('helps-skill', {
    summary: {
      jobs: {
        itemsJobs: [],
        outcomeJobs: jobs.outcomeJobs.filter((job) => job.batch === 'b1'),
      },
      excluded,
    },
    label: { bWaiting: BATCHES },
  });
  // Only the thin coverage of A is the cause: no line says the batch was not read.
  assert.deepEqual(entry.no_data, [
    "A counts 8 of the skill's 16 tasks, below 12 (12 of every 16)",
  ]);
  // One exclusion does not make the batch read: the other 7 tasks have no A job at all. With the plan's task
  // counts the batch is "not read" and the skill is NO DATA, not `helps quality` from 8 of its 16 tasks.
  const partly = (batchTasks) =>
    labelEntry('helps-skill', {
      summary: {
        jobs: {
          itemsJobs: [],
          outcomeJobs: jobs.outcomeJobs.filter((job) => job.batch === 'b1'),
        },
        excluded: excluded.slice(0, 1),
      },
      label: { bWaiting: BATCHES, batchTasks },
    });
  const one = partly({ b1: 8, b2: 8 });
  assert.equal(one.label, LABELS.noData);
  assert.ok(
    one.no_data.includes('batch b2 was not read: A has no judge job in it'),
    one.no_data.join('; '),
  );
  // A reads 4 tasks of b2 and 4 are excluded: all 8 are accounted for.
  const split = labelEntry('helps-skill', {
    summary: {
      jobs: {
        itemsJobs: [],
        outcomeJobs: jobs.outcomeJobs.filter(
          (job) =>
            job.batch === 'b1' ||
            [
              'helps-skill-5',
              'helps-skill-6',
              'helps-skill-7',
              'helps-skill-8',
            ].includes(job.task.id),
        ),
      },
      excluded: excluded.slice(0, 4),
    },
    label: { bWaiting: BATCHES, batchTasks: { b1: 8, b2: 8 } },
  });
  assert.equal(
    split.no_data.some((line) => /batch b2 was not read/.test(line)),
    false,
    split.no_data.join('; '),
  );
  // Every task of the batch is accounted for (read by A or excluded): nothing is unread.
  const all = labelEntry('helps-skill', {
    summary: {
      jobs: {
        itemsJobs: [],
        outcomeJobs: jobs.outcomeJobs.filter((job) => job.batch === 'b1'),
      },
      excluded,
    },
    label: { bWaiting: BATCHES, batchTasks: { b1: 8, b2: 8 } },
  });
  assert.equal(
    all.no_data.some((line) => /batch b2 was not read/.test(line)),
    false,
  );
  // Without the plan's counts the rule falls back to "no A job and no exclusion in the batch".
  assert.equal(
    partly({}).no_data.some((line) => /batch b2 was not read/.test(line)),
    false,
  );
});

test('NO DATA when the skill could not be read at all', () => {
  const entry = labelSkill({
    summary: {
      skill: 'gone-skill',
      error: 'the run has no judge job for gone-skill',
    },
    batches: BATCHES,
  });
  assert.equal(entry.label, LABELS.noData);
  assert.deepEqual(entry.no_data, [
    'the skill could not be read: the run has no judge job for gone-skill',
  ]);
  assert.equal(entry.A, null);
  assert.equal(entry.a_batches_agree, null);
  assert.throws(() => labelSkill({ summary: null }), TypeError);
});

test('NO DATA from rule 5 is listed too: full coverage of a one-task skill still has no interval', () => {
  const jobs = jobsOf('helps-skill');
  const firstTask = (job) =>
    job.batch === 'b1' && job.task.id === 'helps-skill-1';
  const oneTask = {
    itemsJobs: jobs.itemsJobs.filter(firstTask),
    outcomeJobs: jobs.outcomeJobs.filter(firstTask),
  };
  const entry = labelSkill({
    summary: summaryOf('helps-skill', { jobs: oneTask }),
    batches: ['b1'],
  });
  assert.equal(entry.A.tasks_counted, 1, '1 of 1 task is full coverage');
  assert.equal(entry.label, LABELS.noData);
  assert.deepEqual(entry.no_data, [
    'A has fewer than 2 counted tasks, so it has no interval',
  ]);
});

test('exclusions: a task left out of A is a task A does not count; 13 of 16 still gets a label', () => {
  const jobs = jobsOf('helps-skill');
  const left = new Set(['helps-skill-1', 'helps-skill-2', 'helps-skill-3']);
  jobs.outcomeJobs = jobs.outcomeJobs.filter(
    (job) => !(job.batch === 'b1' && left.has(job.task.id)),
  );
  const excluded = [...left].map((id) => ({
    skill: 'helps-skill',
    batch: 'b1',
    id,
    reason: 'the provider blocked the writer',
    date: '2026-11-01',
  }));
  const entry = labelEntry('helps-skill', { summary: { jobs, excluded } });
  assert.equal(entry.A.tasks_counted, 13);
  assert.equal(entry.B.tasks_counted, 13, 'B is read over the tasks A reads');
  assert.equal(entry.B_all.tasks_counted, 16);
  assert.equal(entry.label, LABELS.helps);
  // Four left out: 12 of 16 is still enough; five is not.
  const four = labelEntry('helps-skill', {
    summary: {
      jobs: {
        ...jobs,
        outcomeJobs: jobs.outcomeJobs.filter(
          (job) => !(job.batch === 'b1' && job.task.id === 'helps-skill-4'),
        ),
      },
      excluded: [...excluded, { ...excluded[0], id: 'helps-skill-4' }],
    },
  });
  assert.equal(four.A.tasks_counted, 12);
  assert.equal(four.label, LABELS.helps);
});

test('exclusions: a batch whose every task is left out of A is not "not read"', () => {
  const jobs = jobsOf('helps-skill');
  jobs.outcomeJobs = jobs.outcomeJobs.filter((job) => job.batch !== 'b2');
  const excluded = Array.from({ length: 8 }, (_, index) => ({
    skill: 'helps-skill',
    batch: 'b2',
    id: `helps-skill-${index + 1}`,
    reason: 'blocked',
    date: '2026-11-01',
  }));
  const entry = labelEntry('helps-skill', { summary: { jobs, excluded } });
  assert.deepEqual(entry.no_data, [
    "A counts 8 of the skill's 16 tasks, below 12 (12 of every 16)",
  ]);
});

// ---- a_batches_agree ----------------------------------------------------------------------------------------------------

test('a_batches_agree: true when A has the same sign in both batches, false when not, null with one batch', () => {
  assert.equal(labelEntry('harm-skill').a_batches_agree, true);
  assert.equal(labelEntry('helps-skill').a_batches_agree, true);
  const split = labelEntry('none-skill', {
    summary: {
      jobs: jobsOf('none-skill', {
        override: {
          outcome: [
            [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.1],
            [-0.2, -0.2, -0.2, -0.2, -0.2, -0.2, -0.2, -0.1],
          ],
        },
      }),
    },
  });
  assert.equal(split.a_batches_agree, false);
  assert.equal(split.label, LABELS.none, 'it changes nothing');
  const byBatch = (means) => ({
    by_batch: Object.fromEntries(
      means.map((mean, index) => [`b${index + 1}`, { mean_gap: mean }]),
    ),
  });
  assert.equal(labels.aBatchesAgree(byBatch([0.3])), null);
  assert.equal(labels.aBatchesAgree(byBatch([0.3, null])), null);
  assert.equal(labels.aBatchesAgree(byBatch([0, 0.4])), false, '0 has no sign');
  assert.equal(labels.aBatchesAgree(byBatch([0, 0])), false);
  assert.equal(labels.aBatchesAgree(byBatch([-0.1, -0.4, -0.2])), true);
  assert.equal(labels.aBatchesAgree(null), null);
});
