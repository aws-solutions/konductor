// SPDX-License-Identifier: Apache-2.0
/**
 * Word-check results through the whole offline pipeline. Stored pairs carry `check_results`, a
 * scripted grader judges them, and the result is built from stored files; the same run is then
 * replayed from the stored judgments into a second store and must give the same result. Every
 * row of the combination table (port plan section 3) is run this way, not only through the pure
 * functions:
 *
 *   judge keep, checks agree or flat               keep
 *   judge keep, with arm passes fewer, interval 0  keep, the negative gap is in the result
 *   judge keep, interval entirely below 0          review
 *   judge prune, clear with-arm gain               review
 *   task with no checks                            counted in the judge mean, left out of k
 *   fewer than 8 pairs with checks                 judge verdict, gate off and said so
 *   judge review                                   review
 *
 * Also pinned: a null check entry, the pair digest, and stale results after a check edit.
 * Run: node --test bench/test/word-check-pipeline.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runJudging, scoreSkill } = require('../run/judge');
const { openStore, pairCurrent, resultCurrent } = require('../lib/store');
const { replayFromStore } = require('../plugins/replay');
const { pairInputs, sha256 } = require('../lib/provenance');
const { SKILL, makePair } = require('./support/records');
const { roster } = require('./support/roster');
const { CONTEXT, SCORES, taskSetOf, writePairs, scriptedPlugin } = require('./support/run-fixture');

const live = () => ({ judges: roster(3).map((s) => ({ ...s, plugin: 'scripted' })) });
const offline = () => ({ judges: roster(3).map((s) => ({ ...s, plugin: 'replay' })) });
const near = (got, want, what) => assert.ok(Math.abs(got - want) < 1e-9, `${what}: ${got} vs ${want}`);

const scratch = [];
test.after(() => scratch.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-wordcheck-'));
  scratch.push(dir);
  return openStore(dir);
};

// ---- scores and checks ----------------------------------------------------------------------

const table = (count, make) => Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, make(i + 1)]));
const base = (i) => SCORES[((i - 1) % 8) + 1];
/** The judges favour the with arm by about 2. */
const favourWith = (count) => table(count, base);
/** The judges favour the without arm by about 2. */
const favourWithout = (count) => table(count, (i) => base(i).map(([a, b]) => [b, a]));
/** The judges see no difference: the gaps average zero. */
const EVEN = [
  [[4, 3], [3, 3], [3, 3]],
  [[3, 4], [3, 3], [3, 3]],
  [[3, 3], [4, 4], [3, 3]],
];
const noDifference = (count) => table(count, (i) => EVEN[(i - 1) % 3]);

const passes = (total, passed) => Array.from({ length: total }, (_, i) => i < passed);
/** `at(x, n)`: x for every task, or x[n - 1] when x is a list. */
const at = (x, n) => (Array.isArray(x) ? x[n - 1] : x);
/**
 * A `checks` option for writePairs: the with arm passes `withPass` of 10 checks and the without
 * arm `withoutPass`, each a number or a list by task. `only(n)` limits which tasks have checks.
 */
const checks = (withPass, withoutPass, only = () => true) => (task, arm, n) =>
  only(n) ? passes(10, at(arm === 'with' ? withPass : withoutPass, n)) : undefined;

// ---- the runner -----------------------------------------------------------------------------

/**
 * Judges a skill live with the scripted grader, then replays the stored judgments into a second
 * store that holds the same pairs. The replayed result must equal the live one and the stored
 * one. Returns the live run.
 */
async function runCase({ tasks = 8, scores, checks: checksFor }) {
  const taskSet = taskSetOf(tasks);
  const store = newStore();
  writePairs(store, taskSet.tasks, { checks: checksFor });
  const plugin = scriptedPlugin({ scores });
  const args = { skill: SKILL, taskSet, context: CONTEXT };
  const out = await runJudging({ ...args, store, config: live(), plugins: { scripted: plugin } });
  assert.equal(out.complete, true);
  const result = out.result.result;
  assert.deepEqual(store.readResult(SKILL).result, result, 'the stored result is the one returned');

  const copy = newStore();
  writePairs(copy, taskSet.tasks, { checks: checksFor });
  const replayed = await runJudging({
    ...args,
    store: copy,
    config: offline(),
    plugins: { replay: replayFromStore(store, SKILL) },
  });
  assert.equal(replayed.complete, true);
  assert.deepEqual(replayed.result.result, result, 'replaying the stored run gives the same result');
  return { store, taskSet, plugin, out, result, args };
}

// ---- section 3, row by row -------------------------------------------------------------------

test('judge keep, word checks agree: keep, with the gate on and the gap shown', async () => {
  const { result } = await runCase({ scores: favourWith(8), checks: checks(8, 4) });
  assert.equal(result.graded.verdict, 'keep');
  assert.equal(result.verdict.verdict, 'keep');
  assert.equal(result.verdict.judge_verdict, 'keep');
  const wc = result.verdict.word_check;
  assert.equal(wc.gate, 'on');
  assert.equal(wc.k, 8);
  assert.equal(wc.pairs, 8);
  assert.equal(wc.off_reason, null);
  assert.equal(wc.vetoed, false);
  near(wc.mean, 0.4, 'word-check gap');
  assert.ok(wc.ci[0] > 0);
  for (const pair of result.pairs) {
    assert.deepEqual([pair.c_with, pair.c_without], [0.8, 0.4]);
    near(pair.w, 0.4, `${pair.task_id} w`);
  }
});

test('judge keep, word checks flat: keep', async () => {
  const { result } = await runCase({ scores: favourWith(8), checks: checks(5, 5) });
  assert.equal(result.verdict.verdict, 'keep');
  assert.equal(result.verdict.word_check.gate, 'on');
  assert.equal(result.verdict.word_check.mean, 0);
  assert.deepEqual(result.verdict.word_check.ci, [0, 0]);
  assert.equal(result.verdict.word_check.vetoed, false);
});

test('judge keep, with arm passes fewer checks but the interval includes 0: keep, the negative gap is kept', async () => {
  const withPass = [4, 6, 3, 5, 4, 7, 5, 4];
  const withoutPass = [5, 5, 6, 5, 6, 5, 5, 5];
  const { result } = await runCase({ scores: favourWith(8), checks: checks(withPass, withoutPass) });
  assert.equal(result.graded.verdict, 'keep');
  assert.equal(result.verdict.verdict, 'keep');
  const wc = result.verdict.word_check;
  assert.equal(wc.gate, 'on');
  assert.equal(wc.vetoed, false);
  near(wc.mean, -0.05, 'word-check gap');
  assert.ok(wc.ci[0] < 0 && wc.ci[1] > 0, `the interval ${wc.ci} includes 0`);
  near(wc.ci[0], -0.05 - 2.365 * Math.sqrt(0.18 / 7 / 8), 'interval low');
  near(wc.ci[1], -0.05 + 2.365 * Math.sqrt(0.18 / 7 / 8), 'interval high');
  assert.deepEqual(result.pairs.map((p) => Math.round(p.w * 10)), [-1, 1, -3, 0, -2, 2, 0, -1]);
  assert.match(result.verdict.reason, /word-check gap \(with minus without\) -0\.05/);
});

test('judge keep, interval entirely below 0: review, and the reason says the checks say worse', async () => {
  const { result } = await runCase({
    scores: favourWith(8),
    checks: checks([2, 3, 2, 3, 2, 3, 2, 3], [7, 8, 7, 8, 7, 8, 7, 8]),
  });
  assert.equal(result.graded.verdict, 'keep');
  assert.equal(result.verdict.verdict, 'needs human review');
  assert.equal(result.verdict.judge_verdict, 'keep');
  assert.equal(result.verdict.word_check.vetoed, true);
  assert.ok(result.verdict.word_check.ci[1] < 0);
  assert.match(result.verdict.reason, /word checks say the skill is worse/);
  assert.match(result.verdict.reason, /judge verdict was keep/);
});

test('judge prune, clear with-arm gain in the checks: review', async () => {
  const { result } = await runCase({
    scores: favourWithout(8),
    checks: checks([8, 9, 8, 9, 8, 9, 8, 9], [3, 4, 3, 4, 3, 4, 3, 4]),
  });
  assert.equal(result.graded.verdict, 'prune');
  assert.equal(result.verdict.verdict, 'needs human review');
  assert.equal(result.verdict.judge_verdict, 'prune');
  assert.equal(result.verdict.word_check.vetoed, true);
  assert.ok(result.verdict.word_check.ci[0] > 0);
  assert.match(result.verdict.reason, /word checks say the skill is better/);
});

test('judge prune, word checks agree or flat: prune', async () => {
  for (const [withPass, withoutPass] of [[3, 8], [5, 5]]) {
    const { result } = await runCase({ scores: favourWithout(8), checks: checks(withPass, withoutPass) });
    assert.equal(result.verdict.verdict, 'prune', `${withPass} vs ${withoutPass}`);
    assert.equal(result.verdict.word_check.vetoed, false);
  }
});

test('a task with no checks counts in the judge mean and is left out of k', async () => {
  const { result } = await runCase({
    tasks: 9,
    scores: favourWith(9),
    checks: checks(8, 4, (n) => n <= 8),
  });
  assert.equal(result.graded.pairs, 9, 'nine pairs feed the judge mean');
  near(result.graded.mean, 19 / 9, 'the ninth gap is in the judge mean');
  assert.equal(result.verdict.word_check.k, 8);
  assert.equal(result.verdict.word_check.gate, 'on');
  const ninth = result.pairs[8];
  assert.deepEqual([ninth.c_with, ninth.c_without, ninth.w], [null, null, null]);
  assert.equal(ninth.counted, true);
  assert.equal(result.verdict.verdict, 'keep');
});

test('a task with no checks leaves the gate on at eight pairs with checks, and it can still veto', async () => {
  const { result } = await runCase({ tasks: 9, scores: favourWith(9), checks: checks(2, 8, (n) => n <= 8) });
  assert.equal(result.verdict.word_check.k, 8);
  assert.equal(result.verdict.verdict, 'needs human review');
  assert.equal(result.graded.pairs, 9);
});

test('fewer than 8 pairs with checks: the judge verdict stands and the gate is off, with the count', async () => {
  const { result } = await runCase({
    tasks: 9,
    scores: favourWith(9),
    checks: checks(0, 10, (n) => n <= 7),
  });
  assert.equal(result.verdict.verdict, 'keep', 'a clear loss on seven pairs cannot veto');
  const wc = result.verdict.word_check;
  assert.equal(wc.gate, 'off');
  assert.equal(wc.k, 7);
  assert.equal(wc.need, 8);
  assert.equal(wc.mean, null);
  assert.equal(wc.ci, null);
  assert.equal(wc.off_reason, '7 pairs with checks, need 8');
  assert.match(result.verdict.reason, /word checks off: 7 pairs with checks, need 8/);
});

test('no task has any check: the gate is off with k = 0', async () => {
  const { result } = await runCase({ scores: favourWith(8), checks: () => undefined });
  assert.equal(result.verdict.verdict, 'keep');
  assert.equal(result.verdict.word_check.gate, 'off');
  assert.equal(result.verdict.word_check.k, 0);
  assert.equal(result.verdict.word_check.off_reason, '0 pairs with checks, need 8');
  assert.ok(result.pairs.every((p) => p.w === null && p.c_with === null));
});

test('an empty list of results is the same as no checks', async () => {
  const { result } = await runCase({ scores: favourWith(8), checks: () => [] });
  assert.equal(result.verdict.word_check.k, 0);
  assert.equal(result.verdict.verdict, 'keep');
});

test('judge review stays review, whatever the word checks say, and the numbers are shown', async () => {
  for (const [withPass, withoutPass] of [[9, 2], [2, 9]]) {
    const { result } = await runCase({ scores: noDifference(8), checks: checks(withPass, withoutPass) });
    assert.equal(result.graded.verdict, 'needs human review');
    assert.equal(result.verdict.verdict, 'needs human review', `${withPass} vs ${withoutPass}`);
    assert.equal(result.verdict.judge_verdict, 'needs human review');
    assert.equal(result.verdict.word_check.gate, 'on');
    assert.equal(result.verdict.word_check.vetoed, false);
    near(result.verdict.word_check.mean, (withPass - withoutPass) / 10, 'word-check gap shown as context');
  }
});

test('the gate never makes a keep or a prune out of a review', async () => {
  for (const scores of [noDifference(8), favourWith(7), favourWithout(7)]) {
    const tasks = Object.keys(scores).length;
    for (const [withPass, withoutPass] of [[10, 0], [0, 10], [5, 5]]) {
      const { result } = await runCase({ tasks, scores, checks: checks(withPass, withoutPass) });
      if (result.graded.verdict === 'needs human review') {
        assert.equal(result.verdict.verdict, 'needs human review');
      }
    }
  }
});

// ---- null entries ---------------------------------------------------------------------------

/** Checks where the with arm of the task numbered `badTask` has one entry with no verdict. */
const nullIn = (badTask, withPass = 8, withoutPass = 4) => (task, arm, n) => {
  const results = passes(10, arm === 'with' ? withPass : withoutPass);
  if (arm === 'with' && n === badTask) results[3] = null;
  return results;
};

test('a null check entry makes that pair c null and leaves it out of k', async () => {
  const { result } = await runCase({ tasks: 9, scores: favourWith(9), checks: nullIn(3) });
  const pair = result.pairs[2];
  assert.equal(pair.c_with, null, 'one check with no verdict gives no share, not a share of nine');
  assert.equal(pair.c_without, 0.4);
  assert.equal(pair.w, null);
  assert.equal(result.verdict.word_check.k, 8);
  assert.equal(result.verdict.word_check.gate, 'on');
  assert.equal(result.graded.pairs, 9, 'the pair still counts in the judge mean');
  assert.equal(result.verdict.verdict, 'keep');
});

test('a null check entry can take the gate below eight pairs', async () => {
  const { result } = await runCase({ scores: favourWith(8), checks: nullIn(3, 1, 9) });
  assert.equal(result.verdict.word_check.k, 7);
  assert.equal(result.verdict.word_check.gate, 'off');
  assert.equal(result.verdict.verdict, 'keep', 'the gate is off, so a clear loss on seven pairs cannot veto');
});

test('a null entry in the without arm does the same', async () => {
  const { result } = await runCase({
    scores: favourWith(8),
    checks: (task, arm, n) => {
      const results = passes(10, arm === 'with' ? 8 : 4);
      if (arm === 'without' && n === 5) results[0] = null;
      return results;
    },
  });
  assert.equal(result.pairs[4].c_without, null);
  assert.equal(result.pairs[4].w, null);
  assert.equal(result.verdict.word_check.k, 7);
});

// ---- the result record ----------------------------------------------------------------------

test('the stored result carries the judge verdict, the final verdict, the gap or why it is off, and k', async () => {
  const gate = await runCase({ scores: favourWith(8), checks: checks(2, 8) });
  const off = await runCase({ scores: favourWith(8), checks: () => undefined });
  for (const { result } of [gate, off]) {
    assert.deepEqual(
      Object.keys(result.verdict.word_check).sort(),
      ['ci', 'gate', 'k', 'mean', 'need', 'off_reason', 'pairs', 'vetoed'],
    );
    assert.equal(result.verdict.word_check.k, result.verdict.word_check.pairs);
  }
  assert.equal(gate.result.graded.verdict, 'keep');
  assert.equal(gate.result.verdict.judge_verdict, 'keep');
  assert.equal(gate.result.verdict.verdict, 'needs human review');
  assert.equal(typeof gate.result.verdict.word_check.mean, 'number');
  assert.equal(gate.result.verdict.word_check.ci.length, 2);
  assert.equal(off.result.verdict.word_check.mean, null);
  assert.equal(typeof off.result.verdict.word_check.off_reason, 'string');
});

test('word checks never reach the judge: judgments and judge gaps are the same with and without them', async () => {
  const plain = await runCase({ scores: favourWith(8), checks: () => undefined });
  const worse = await runCase({ scores: favourWith(8), checks: checks(0, 10) });
  const digests = (store) => store.listJudgments(SKILL).map((j) => j.inputs.judge_input_sha256).sort();
  assert.deepEqual(digests(worse.store), digests(plain.store), 'the judge inputs are the same');
  assert.deepEqual(
    worse.result.pairs.map((p) => [p.mean_delta, p.score_deltas]),
    plain.result.pairs.map((p) => [p.mean_delta, p.score_deltas]),
  );
  assert.deepEqual(worse.result.graded, plain.result.graded);
  for (const call of worse.plugin.calls) assert.doesNotMatch(call.prompt, /check_results|word check/i);
});

// ---- the pair record and its digest --------------------------------------------------------

const PAIR_ARGS = {
  taskId: 'task-1',
  arm: 'with',
  request: 'Add a flag.',
  runnerFingerprint: 'replay@1',
  answer: 'Done.',
  start: {},
  final: {},
  loaded: true,
};

test('pair digest: check_results is covered, and a pair without them keeps its earlier digest', () => {
  const none = pairInputs(PAIR_ARGS);
  assert.ok(!('check_results_sha256' in none), 'no field when the pair has no checks');
  const withChecks = pairInputs({ ...PAIR_ARGS, checkResults: [true, false, null] });
  assert.equal(withChecks.check_results_sha256, sha256([true, false, null]));
  const seen = new Set([none.pair_input_sha256, withChecks.pair_input_sha256]);
  for (const change of [[], [true, false], [true, true, null], [true, false, false], [false, true, null]]) {
    seen.add(pairInputs({ ...PAIR_ARGS, checkResults: change }).pair_input_sha256);
  }
  assert.equal(seen.size, 7, 'absent, empty and every edit give a different digest');
  const { pair_input_sha256: _drop, ...bare } = none;
  assert.equal(none.pair_input_sha256, sha256(bare), 'the digest of a pair without checks is built as before');
});

test('pair digest: check_results must be an array of true, false or null', () => {
  for (const bad of [null, 'true', [1], ['yes'], [undefined], [[true]], { 0: true }]) {
    assert.throws(() => pairInputs({ ...PAIR_ARGS, checkResults: bad }), /check_results/, JSON.stringify(bad));
  }
});

test('store: a pair with check_results round-trips, and a malformed list is refused', () => {
  const store = newStore();
  const pair = makePair({ taskId: 'task-1', arm: 'with', checkResults: [true, false, null] });
  store.writePair(pair);
  assert.deepEqual(store.readPair(SKILL, 'task-1', 'with').check_results, [true, false, null]);
  for (const bad of [null, 'true', [1], ['yes'], [[]], new Array(501).fill(true)]) {
    assert.throws(() => store.writePair({ ...pair, check_results: bad }), /check_results|malformed/, JSON.stringify(bad).slice(0, 30));
  }
  assert.equal(store.readPair(SKILL, 'task-1', 'with').check_results.length, 3, 'the old record is kept');
});

const EXPECT = { skill: SKILL, taskId: 'task-1', arm: 'with', request: 'Add a flag.' };

test('pairCurrent: edited, added or removed check_results without a new digest make the pair stale', () => {
  const pair = makePair({ checkResults: [true, false] });
  assert.equal(pairCurrent(pair, EXPECT), true);
  assert.equal(pairCurrent({ ...pair, check_results: [true, true] }, EXPECT), false, 'edited');
  assert.equal(pairCurrent({ ...pair, check_results: [] }, EXPECT), false, 'emptied');
  const { check_results: _drop, ...removed } = pair;
  assert.equal(pairCurrent(removed, EXPECT), false, 'removed');
  assert.equal(pairCurrent({ ...makePair(), check_results: [true] }, EXPECT), false, 'added to a pair without');
  assert.equal(pairCurrent({ ...pair, check_results: [true, 'false'] }, EXPECT), false, 'malformed');
  assert.equal(pairCurrent(makePair(), EXPECT), true, 'a pair without checks is still current');
});

// ---- editing check_results ------------------------------------------------------------------

/** Copies a stored run's judgments, and optionally its result, into a store with edited pairs. */
function withPairs(source, taskSet, checksFor, { copyResult = true } = {}) {
  const target = newStore();
  writePairs(target, taskSet.tasks, { checks: checksFor });
  source.listJudgments(SKILL).forEach((rec) => target.writeJudgment(rec));
  if (copyResult) target.writeResult(source.readResult(SKILL));
  return target;
}

test('editing check_results makes the stored result stale, and it re-aggregates with no plugin call', async () => {
  const source = await runCase({ scores: favourWith(8), checks: checks(8, 4) });
  assert.equal(source.result.verdict.verdict, 'keep');

  // Same pairs, same judgments, same stored result: nothing to do.
  const same = withPairs(source.store, source.taskSet, checks(8, 4));
  const unchanged = scoreSkill({ ...source.args, store: same, config: live() });
  assert.equal(unchanged.complete, true);
  assert.equal(unchanged.result_written, false, 'the copied result is current');

  // The with arm now passes far fewer checks. The pair digests change, the judgments do not.
  const edited = withPairs(source.store, source.taskSet, checks(2, 8));
  const stored = edited.readResult(SKILL);
  const plugin = scriptedPlugin({ scores: favourWith(8) });
  const out = await runJudging({ ...source.args, store: edited, config: live(), plugins: { scripted: plugin } });
  assert.equal(out.calls, 0, 'no judge call');
  assert.equal(plugin.calls.length, 0);
  assert.equal(out.result_written, true, 'the stale result was rebuilt');
  assert.equal(out.result.result.verdict.verdict, 'needs human review');
  assert.equal(out.result.result.verdict.judge_verdict, 'keep');
  assert.notEqual(out.result.inputs.result_input_sha256, stored.inputs.result_input_sha256);
  assert.deepEqual(out.result.result.graded, source.result.graded, 'the judge verdict is unchanged');
  assert.equal(edited.readResult(SKILL).result.verdict.verdict, 'needs human review');
  assert.equal(resultCurrent(edited.readResult(SKILL), out.result.inputs), true);
});

test('editing one check entry of one pair also makes the result stale', async () => {
  const source = await runCase({ scores: favourWith(8), checks: checks(8, 4) });
  const one = (task, arm, n) => {
    const results = passes(10, arm === 'with' ? 8 : 4);
    if (arm === 'with' && n === 2) results[0] = false;
    return results;
  };
  const edited = withPairs(source.store, source.taskSet, one);
  const plugin = scriptedPlugin({ scores: favourWith(8) });
  const out = await runJudging({ ...source.args, store: edited, config: live(), plugins: { scripted: plugin } });
  assert.equal(out.calls, 0);
  assert.equal(out.result_written, true);
  assert.equal(out.result.result.pairs[1].c_with, 0.7);
  assert.equal(out.result.result.pairs[0].c_with, 0.8, 'the other pairs are as before');
});

test('removing the checks of a stored run also re-aggregates: the gate turns off', async () => {
  const source = await runCase({ scores: favourWith(8), checks: checks(2, 8) });
  assert.equal(source.result.verdict.verdict, 'needs human review');
  const edited = withPairs(source.store, source.taskSet, () => undefined);
  const out = scoreSkill({ ...source.args, store: edited, config: live() });
  assert.equal(out.result_written, true);
  assert.equal(out.result.result.verdict.verdict, 'keep');
  assert.equal(out.result.result.verdict.word_check.gate, 'off');
});

test('a hand-edited check_results with no new digest makes the pair stale and nothing is judged from it', async () => {
  const source = await runCase({ scores: favourWith(8), checks: checks(8, 4) });
  const target = withPairs(source.store, source.taskSet, checks(8, 4));
  const pair = target.readPair(SKILL, 'task-1', 'with');
  target.writePair({ ...pair, check_results: passes(10, 0) });
  const out = scoreSkill({ ...source.args, store: target, config: live() });
  assert.equal(out.complete, false);
  assert.deepEqual(out.missing_pairs, ['task-1']);
  assert.equal(out.result, null);
});

test('a result made before check results existed is rebuilt only when its inputs change', async () => {
  const source = await runCase({ scores: favourWith(8), checks: () => undefined });
  const same = withPairs(source.store, source.taskSet, () => undefined);
  assert.equal(scoreSkill({ ...source.args, store: same, config: live() }).result_written, false);
});
