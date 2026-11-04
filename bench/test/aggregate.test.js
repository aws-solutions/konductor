// SPDX-License-Identifier: Apache-2.0
/**
 * Aggregation unit tests: pair records, seat statuses, per-pair word-check fields and the skill
 * result. Pure functions only: no model call, no file access.
 * Run: node --test bench/test/aggregate.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const agg = require('../lib/aggregate');
const rule = require('../lib/decision-rule');

const cfg = { judges: [{ seat: 'seat-a' }, { seat: 'seat-b' }, { seat: 'seat-c' }] };
const [S1, S2, S3] = cfg.judges.map((j) => j.seat);
const both = (v) => ({ 'with-first': v, 'without-first': v });
const taskSet = (ids, extra = {}) => ({
  tasks: ids.map((id, i) => ({ id, target_section: `S${i}` })),
  ...extra,
});
const allLoaded = (ids) => Object.fromEntries(ids.map((id) => [id, true]));

// ---- gaps ------------------------------------------------------------------------------------

test('deltasFor: flattens every seat and order into one pair mean, and reports null when no judge scored', () => {
  assert.deepEqual(
    agg.deltasFor({ x: { 'with-first': 2, 'without-first': 1 }, y: { 'with-first': 0, 'without-first': 1 } }),
    { score_deltas: [2, 1, 0, 1], mean_delta: 1 },
  );
  assert.deepEqual(agg.deltasFor({ x: { 'with-first': null, 'without-first': undefined } }), {
    score_deltas: [],
    mean_delta: null,
  });
  assert.deepEqual(agg.deltasFor(undefined), { score_deltas: [], mean_delta: null });
  assert.equal(agg.deltasFor({ x: { 'with-first': -2, 'without-first': -1 } }).mean_delta, -1.5);
  assert.deepEqual(agg.deltasFor({ x: { 'with-first': NaN, 'without-first': Infinity, a: 2 } }), {
    score_deltas: [2],
    mean_delta: 2,
  });
});

test('seatsScored counts a seat once however many of its orders scored', () => {
  assert.equal(agg.seatsScored({ a: { x: 1, y: 2 }, b: { x: null }, c: {} }), 1);
  assert.equal(agg.seatsScored(undefined), 0);
});

test('seatStatuses: scored, invalid and unscored, and every planned seat is named', () => {
  const out = agg.seatStatuses(cfg, { [S2]: { 'with-first': true } }, { [S1]: both(2), [S3]: both(NaN) });
  assert.deepEqual(out, { [S1]: 'scored', [S2]: 'invalid', [S3]: 'invalid' });
  assert.deepEqual(agg.seatStatuses(cfg, {}, {}), { [S1]: 'unscored', [S2]: 'unscored', [S3]: 'unscored' });
  assert.equal(agg.seatStatuses(cfg, {}, { extra: both(1) }).extra, 'scored', 'a seat outside the plan still shows');
  assert.equal(agg.seatStatuses(cfg, { [S1]: both(false) }, {})[S1], 'unscored', 'a false flag is no refusal');
  assert.equal(agg.seatStatuses(cfg, { [S1]: both(true) }, { [S1]: both(3) })[S1], 'scored', 'a score wins over a refusal');
});

// ---- word-check share ------------------------------------------------------------------------

test('checkShare: passed over counted, and null for no checks or any check without a verdict', () => {
  assert.equal(agg.checkShare([true, true, false, false]), 0.5);
  assert.equal(agg.checkShare([true]), 1);
  assert.equal(agg.checkShare([false, false]), 0);
  assert.equal(agg.checkShare([]), null, 'a task with no checks');
  assert.equal(agg.checkShare([true, null]), null, 'a check gave no verdict');
  assert.equal(agg.checkShare([true, 'yes']), null);
  assert.equal(agg.checkShare(undefined), null);
  assert.equal(agg.checkShare(null), null);
});

// ---- aggregateSkill --------------------------------------------------------------------------

test('aggregateSkill: a pair is scored only when at least two of the planned seats scored it', () => {
  const run = (deltas) =>
    agg.aggregateSkill({ skill: 's', taskSet: taskSet(['a']), deltas: { a: deltas }, loaded: { a: true }, cfg }).pairs[0];

  const three = run({ [S1]: both(2), [S2]: both(1), [S3]: both(3) });
  assert.deepEqual([three.judges_scored, three.judges_planned, three.scored, three.counted], [3, 3, true, true]);

  const two = run({ [S1]: both(2), [S2]: both(1), [S3]: both(null) });
  assert.deepEqual([two.judges_scored, two.scored], [2, true]);
  assert.equal(two.mean_delta, 1.5);

  const one = run({ [S1]: both(2), [S2]: both(null), [S3]: both(undefined) });
  assert.deepEqual([one.judges_scored, one.scored, one.counted], [1, false, true]);
  assert.equal(one.mean_delta, 2, 'the single score is still reported');

  const none = run(undefined);
  assert.deepEqual([none.judges_scored, none.scored, none.mean_delta], [0, false, null]);

  const twoOrdersOneSeat = run({ [S1]: { 'with-first': 2, 'without-first': 1 } });
  assert.equal(twoOrdersOneSeat.judges_scored, 1, 'two orders of one seat are one seat');
});

test('aggregateSkill: with fewer planned seats than the minimum, all planned seats are needed', () => {
  const solo = { judges: [{ seat: 'only' }] };
  const res = agg.aggregateSkill({
    skill: 's',
    taskSet: taskSet(['a']),
    deltas: { a: { only: both(1) } },
    loaded: { a: true },
    cfg: solo,
  });
  assert.equal(res.pairs[0].scored, true);
});

test('aggregateSkill: unscored pairs are counted in the result and named in the verdict reason', () => {
  const ids = Array.from({ length: 9 }, (_, i) => `p${i}`);
  const deltas = {};
  ids.forEach((id, i) => {
    deltas[id] =
      i === 8
        ? { [S1]: both(2.5) } // only one seat scored the last pair
        : { [S1]: both(2.5 + i * 0.02), [S2]: both(2.6), [S3]: both(2.7) };
  });
  const res = agg.aggregateSkill({ skill: 's', taskSet: taskSet(ids), deltas, loaded: allLoaded(ids), cfg });
  assert.equal(res.unscored, 1);
  assert.equal(res.verdict.unscored, 1);
  assert.equal(res.verdict.pairs, 8);
  assert.equal(res.verdict.verdict, 'keep');
  assert.match(res.verdict.reason, /1\/9 pairs unscored/);
  assert.equal(res.pairs[8].counted, true);
  assert.equal(res.pairs[8].scored, false);
});

test('aggregateSkill: a treatment record decides counted, and a missing loaded flag never counts', () => {
  const ids = ['a', 'b', 'c'];
  const res = agg.aggregateSkill({
    skill: 's',
    taskSet: taskSet(ids),
    loaded: { a: true, b: true },
    treatment: { a: { required: true, adhered: false }, b: { required: false, adhered: false } },
    cfg,
  });
  assert.deepEqual(
    res.pairs.map((p) => [p.counted, p.loaded, p.adhered]),
    [
      [false, true, false],
      [true, true, true],
      [false, false, true],
    ],
  );
  assert.deepEqual(res.pairs[0].treatment, { required: true, adhered: false });
  assert.ok(!('treatment' in res.pairs[1]), 'a check that is not required is not recorded on the pair');
});

test('aggregateSkill: each pair and each judge seat is scored, unscored or invalid, and the counts add up', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const all = (v) => ({ [S1]: both(v), [S2]: both(v), [S3]: both(v) });
  const res = agg.aggregateSkill({
    skill: 's',
    taskSet: taskSet(ids),
    deltas: {
      a: { [S1]: both(2), [S2]: both(1), [S3]: both(3) },
      b: { [S1]: both(2) },
      d: { [S1]: both(2), [S2]: both(1), [S3]: both(NaN) },
    },
    refused: { b: { [S2]: both(true) }, c: {}, a: {}, d: all(false) },
    loaded: allLoaded(ids),
    cfg,
  });
  const by = Object.fromEntries(res.pairs.map((p) => [p.task_id, p]));
  assert.deepEqual(by.a.judge_status, { [S1]: 'scored', [S2]: 'scored', [S3]: 'scored' });
  assert.equal(by.a.status, 'scored');
  assert.deepEqual(by.b.judge_status, { [S1]: 'scored', [S2]: 'invalid', [S3]: 'unscored' });
  assert.equal(by.b.status, 'invalid', 'too few seats scored it and one reply was refused');
  assert.deepEqual([by.b.judges_scored, by.b.judges_invalid, by.b.judges_unscored], [1, 1, 1]);
  assert.equal(by.c.status, 'unscored');
  assert.deepEqual(by.d.judge_status, { [S1]: 'scored', [S2]: 'scored', [S3]: 'invalid' });
  assert.equal(by.d.status, 'scored', 'two valid seats are enough');
  assert.deepEqual(res.pair_status, { scored: 2, unscored: 1, invalid: 1 });
  assert.deepEqual(res.judge_participation, { scored: 6, unscored: 4, invalid: 2 });
  assert.equal(Object.values(res.pair_status).reduce((a, b) => a + b, 0), ids.length);
  assert.equal(
    Object.values(res.judge_participation).reduce((a, b) => a + b, 0),
    ids.length * cfg.judges.length,
    'every seat of every pair appears exactly once',
  );
  assert.equal(res.unscored, 2);
  assert.equal(res.verdict.verdict, 'needs human review');
  assert.match(res.verdict.reason, /2\/4 pairs unscored/);
});

test('aggregateSkill: rejects a task set without a task array, a task without an id and a duplicate id', () => {
  assert.throws(() => agg.aggregateSkill({ skill: 's', taskSet: {}, cfg }), /taskSet\.tasks must be an array/);
  assert.throws(() => agg.aggregateSkill({ skill: 's', taskSet: undefined, cfg }), /must be an array/);
  assert.throws(() => agg.aggregateSkill({ skill: 's', taskSet: { tasks: [{}] }, cfg }), /no id/);
  assert.throws(
    () => agg.aggregateSkill({ skill: 's', taskSet: taskSet(['a', 'a']), cfg }),
    /duplicate task id a/,
  );
});

test('aggregateSkill: a set prune block turns a prune into review', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const neg = [-0.8, -0.5, -0.6, -0.7, -0.9, -0.6, -0.7, -0.8];
  const deltas = Object.fromEntries(ids.map((id, i) => [id, { [S1]: both(neg[i]), [S2]: both(neg[i]) }]));
  const run = (extra) =>
    agg.aggregateSkill({ skill: 's', taskSet: taskSet(ids, extra), deltas, loaded: allLoaded(ids), cfg });
  assert.equal(run({}).verdict.verdict, 'prune');
  const blocked = run({ prune_blocked_reason: 'outputs are not observed' });
  assert.equal(blocked.verdict.verdict, 'needs human review');
  assert.equal(blocked.prune_safety.blocked_reason, 'outputs are not observed');
});

test('aggregateSkill: the result names the rule and its digest and has no vote or noise output', () => {
  const res = agg.aggregateSkill({ skill: 's', taskSet: taskSet(['a']), loaded: { a: true }, cfg });
  assert.equal(res.decision_rule, 'paired-t/v1');
  assert.equal(res.rule_sha256, rule.decisionRuleSha256());
  assert.deepEqual(Object.keys(res).sort(), [
    'decision_rule',
    'graded',
    'judge_participation',
    'pair_status',
    'pairs',
    'prune_safety',
    'rule_sha256',
    'skill',
    'unscored',
    'verdict',
  ]);
});

// ---- word-check fields on a pair -------------------------------------------------------------

const results = (passed, total) => Array.from({ length: total }, (_, i) => i < passed);

test('aggregateSkill: a pair carries c_with, c_without and w, null where checks are absent', () => {
  const ids = ['both', 'none', 'only-with', 'unknown', 'unlisted'];
  const res = agg.aggregateSkill({
    skill: 's',
    taskSet: taskSet(ids),
    loaded: allLoaded(ids),
    wordChecks: {
      both: { with: results(3, 4), without: results(1, 4) },
      none: { with: [], without: [] },
      'only-with': { with: results(1, 2) },
      unknown: { with: [true, null], without: results(1, 2) },
    },
    cfg,
  });
  const by = Object.fromEntries(res.pairs.map((p) => [p.task_id, p]));
  assert.deepEqual([by.both.c_with, by.both.c_without, by.both.w], [0.75, 0.25, 0.5]);
  assert.deepEqual([by.none.c_with, by.none.c_without, by.none.w], [null, null, null]);
  assert.deepEqual([by['only-with'].c_with, by['only-with'].c_without, by['only-with'].w], [0.5, null, null]);
  assert.deepEqual([by.unknown.c_with, by.unknown.c_without, by.unknown.w], [null, 0.5, null]);
  assert.deepEqual([by.unlisted.c_with, by.unlisted.c_without, by.unlisted.w], [null, null, null]);
});

test('aggregateSkill: w is with minus without, so a loss is negative', () => {
  const res = agg.aggregateSkill({
    skill: 's',
    taskSet: taskSet(['a']),
    loaded: { a: true },
    wordChecks: { a: { with: results(1, 4), without: results(4, 4) } },
    cfg,
  });
  assert.equal(res.pairs[0].w, -0.75);
});

// ---- the gate inside aggregateSkill ----------------------------------------------------------

const eightIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const KEEP_GAPS = [2.5, 2.7, 2.6, 2.4, 2.8, 2.5, 2.6, 2.7];
const judgeDeltas = (ids, gaps) =>
  Object.fromEntries(ids.map((id, i) => [id, { [S1]: both(gaps[i]), [S2]: both(gaps[i]) }]));
/** Checks where the with arm passes `wp` of 10 and the without arm `wo` of 10, same on every task. */
const checks = (ids, wp, wo) =>
  Object.fromEntries(ids.map((id) => [id, { with: results(wp, 10), without: results(wo, 10) }]));
const run = (wordChecks, ids = eightIds, gaps = KEEP_GAPS) =>
  agg.aggregateSkill({
    skill: 's',
    taskSet: taskSet(ids),
    deltas: judgeDeltas(ids, gaps),
    loaded: allLoaded(ids),
    wordChecks,
    cfg,
  });

test('aggregateSkill: judge keep stays keep when the word checks are flat or agree', () => {
  assert.equal(run(checks(eightIds, 5, 5)).verdict.verdict, 'keep');
  assert.equal(run(checks(eightIds, 8, 4)).verdict.verdict, 'keep');
});

test('aggregateSkill: judge keep becomes review when the with arm clearly passes fewer checks', () => {
  const res = run(checks(eightIds, 3, 8));
  assert.equal(res.graded.verdict, 'keep');
  assert.equal(res.verdict.verdict, 'needs human review');
  assert.match(res.verdict.reason, /word checks say the skill is worse/);
});

test('aggregateSkill: word checks never enter the judge gap', () => {
  const plain = run({});
  const worse = run(checks(eightIds, 0, 10));
  assert.deepEqual(
    worse.pairs.map((p) => [p.mean_delta, p.score_deltas]),
    plain.pairs.map((p) => [p.mean_delta, p.score_deltas]),
  );
  assert.deepEqual(worse.graded, plain.graded, 'the judge verdict is the same with and without checks');
});

test('aggregateSkill: with no word checks at all the gate is off and says so', () => {
  const res = run({});
  assert.equal(res.verdict.verdict, 'keep');
  assert.equal(res.verdict.word_check.gate, 'off');
  assert.match(res.verdict.reason, /0 pairs with checks, need 8/);
});

test('aggregateSkill: a task without checks is in the judge mean and out of the check set', () => {
  const ids = [...eightIds, 'i'];
  const gaps = [...KEEP_GAPS, 2.6];
  const wc = checks(eightIds, 3, 8); // the ninth task has no entry
  const res = run(wc, ids, gaps);
  assert.equal(res.graded.pairs, 9);
  assert.equal(res.verdict.word_check.pairs, 8);
  assert.equal(res.verdict.verdict, 'needs human review');
  // Seven pairs with checks are not enough for the gate.
  const seven = run(checks(eightIds.slice(0, 7), 3, 8), ids, gaps);
  assert.equal(seven.verdict.verdict, 'keep');
  assert.equal(seven.verdict.word_check.gate, 'off');
  assert.match(seven.verdict.reason, /7 pairs with checks, need 8/);
});
