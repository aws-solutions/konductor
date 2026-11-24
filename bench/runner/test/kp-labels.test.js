// SPDX-License-Identifier: Apache-2.0
// Copied from Michael Lin's tests/scripts/bench/labels.test.js (pull request #263, commit 33b385f9), same repository and Apache-2.0 licence: the label and verdict rule tests that need no stored judge jobs (his fixture-based ones read his job layout, which cap does not copy; keepprune tests cover those causes).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const labels = require('../../cap/labels.js');

const { LABELS, labelFor, labelSkill } = labels;
const BATCHES = ['b1', 'b2'];
const reading = (lower, upper) => ({ t_interval_exact: [lower, upper] });
const labelOf = (readingA, readingB) => labelFor(readingA, readingB).label;
const { VERDICTS, VERDICT_RULES, VERDICT_RULES_DATE, verdictFor } = labels;
const gapReading = (meanGap, lower, upper) => ({
  mean_gap: meanGap,
  t_interval_exact: [lower, upper],
});
const meanOnly = (meanGap) => ({ mean_gap: meanGap });
const verdictOf = (readingA, readingB, label = LABELS.none) =>
  verdictFor(label, readingA, readingB);

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

// ---- pooled readings over two batches ---------------------------------------------------------------------------------

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

test('minCounted: 12 of every 16, rounded up for another size', () => {
  assert.deepEqual(
    [16, 15, 13, 8, 5, 1, 0].map(labels.minCounted),
    [12, 12, 10, 6, 4, 1, 0],
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

// Ours, not copied (K-2's sibling K-3, owner yes 2026-11-24): the per-batch coverage rule beside his rules.
test('batch coverage rule (2026-11-24): NO DATA when one batch counts under 12 of every 16 of its tasks', () => {
  const { readingOf } = require('../../cap/keepprune.js');
  const rows = (batch, n, counted) =>
    Array.from({ length: n }, (_, i) => ({ batch, counted: i < counted, gap: 0.5 + (i % 3) * 0.1, stale: 0 }));
  const all = [...rows('b1', 8, 8), ...rows('b2', 8, 5)];
  const summary = { skill: 's', tasks: 16, A: readingOf(all), B_all: readingOf(all), exclusions: [] };
  const entry = labelSkill({ summary, batches: BATCHES });
  assert.equal(entry.label, LABELS.noData);
  assert.ok(entry.no_data.includes('A counts 5 of batch b2\'s 8 tasks, below 6 (batch coverage rule, 12 of every 16 in each batch)'), entry.no_data.join('; '));
  const fine = { ...summary, A: readingOf([...rows('b1', 8, 8), ...rows('b2', 8, 6)]), B_all: readingOf([...rows('b1', 8, 8), ...rows('b2', 8, 6)]) };
  assert.ok(!labelSkill({ summary: fine, batches: BATCHES }).no_data.some((r) => /batch coverage rule/.test(r)));
  assert.equal(labels.BATCH_RULES_DATE, '2026-11-24');
  assert.match(labels.BATCH_RULES, /each batch/);
});
