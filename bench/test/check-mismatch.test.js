// SPDX-License-Identifier: Apache-2.0
/**
 * The equal-length rule for word-check results. The two arms of a task must hold the same number
 * of results; a missing arm counts as none. When they differ, the pair is left out of the
 * word-check gap (`c_with`, `c_without` and `w` are null), stays in the judge gap, carries
 * `check_mismatch: { with, without }`, and the skill result counts such pairs in
 * `check_mismatch_pairs`, which the report prints. Nothing throws, so a stored run still replays.
 *
 * The rule leaves the pair out and says so. It does not fail the run and it does not turn the
 * verdict into a review. A result of `null` in a list already takes a pair out of the gate the same
 * way (word-check-pipeline.test.js), and a change to the verdict would be a change to the gate rule.
 *
 * The end-to-end tests write pairs through the store, fill `check_results` with `checkResultsFor`,
 * judge them with the scripted grader, replay the stored judgments into a second store, and render
 * the report.
 * Run: node --test bench/test/check-mismatch.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { aggregateSkill } = require('../lib/aggregate');
const { checkResultsFor } = require('../lib/checks');
const { renderReport } = require('../lib/report');
const { openStore } = require('../lib/store');
const { replayFromStore } = require('../plugins/replay');
const { runJudging } = require('../run/judge');
const { SKILL } = require('./support/records');
const { roster } = require('./support/roster');
const { CONTEXT, SCORES, START, taskSetOf, writePairs, scriptedPlugin } = require('./support/run-fixture');

const LINE = (n) => `- Word-check pairs left out: ${n}, the two arms ran different numbers of checks`;

// ---- aggregateSkill, directly ----------------------------------------------------------------

const CFG = { judges: [{ seat: 'seat-a' }, { seat: 'seat-b' }] };
const TASKS = [{ id: 't1', target_section: 'S' }, { id: 't2', target_section: 'S' }, { id: 't3', target_section: 'S' }];
const GAPS = Object.fromEntries(TASKS.map((t) => [t.id, { 'seat-a': { 'with-first': 2 }, 'seat-b': { 'with-first': 2 } }]));
const list = (length, passed) => Array.from({ length }, (_, i) => i < passed);

function aggregate(wordChecks) {
  return aggregateSkill({ skill: SKILL, taskSet: { tasks: TASKS }, deltas: GAPS, loaded: { t1: true, t2: true, t3: true }, wordChecks, cfg: CFG });
}

test('equal lists are compared; the pair carries no mismatch and the skill counts none', () => {
  const result = aggregate({ t1: { with: list(4, 3), without: list(4, 1) } });
  const [pair] = result.pairs;
  assert.deepEqual([pair.c_with, pair.c_without, pair.w], [0.75, 0.25, 0.5]);
  assert.equal(Object.hasOwn(pair, 'check_mismatch'), false);
  assert.equal(Object.hasOwn(result, 'check_mismatch_pairs'), false);
});

test('lists of different lengths leave the pair out of the word-check gap and say how long each was', () => {
  const result = aggregate({ t1: { with: list(4, 4), without: list(3, 0) } });
  const [pair] = result.pairs;
  assert.deepEqual([pair.c_with, pair.c_without, pair.w], [null, null, null]);
  assert.deepEqual(pair.check_mismatch, { with: 4, without: 3 });
  assert.equal(result.check_mismatch_pairs, 1);
});

test('the pair stays in the judge gap: it is counted and its score gap is used', () => {
  const result = aggregate({ t1: { with: list(4, 4), without: list(3, 0) } });
  const [pair] = result.pairs;
  assert.equal(pair.scored, true);
  assert.equal(pair.counted, true);
  assert.equal(pair.mean_delta, 2);
  assert.equal(result.graded.pairs, 3);
});

test('an arm with no results while the other has some is a mismatch of length 0', () => {
  for (const missing of [undefined, null, 'text', {}]) {
    const result = aggregate({ t1: { with: list(4, 2), without: missing } });
    assert.deepEqual(result.pairs[0].check_mismatch, { with: 4, without: 0 }, String(missing));
    const flipped = aggregate({ t1: { with: missing, without: list(2, 1) } });
    assert.deepEqual(flipped.pairs[0].check_mismatch, { with: 0, without: 2 }, String(missing));
  }
});

test('no results on either arm, or two empty lists, is no mismatch', () => {
  for (const words of [undefined, {}, { with: undefined, without: undefined }, { with: [], without: [] }, { with: [], without: undefined }]) {
    const result = aggregate({ t1: words });
    const [pair] = result.pairs;
    assert.equal(Object.hasOwn(pair, 'check_mismatch'), false, JSON.stringify(words));
    assert.equal(pair.w, null);
    assert.equal(Object.hasOwn(result, 'check_mismatch_pairs'), false);
  }
});

test('the skill counts every pair that mismatched, once each', () => {
  const result = aggregate({
    t1: { with: list(4, 4), without: list(3, 0) },
    t2: { with: list(4, 4), without: list(4, 0) },
    t3: { with: list(2, 2), without: undefined },
  });
  assert.equal(result.check_mismatch_pairs, 2);
  assert.deepEqual(result.pairs.map((p) => Object.hasOwn(p, 'check_mismatch')), [true, false, true]);
  assert.equal(result.pairs[1].w, 1);
});

test('a mismatch is not an error: aggregation does not throw and the verdict is still made', () => {
  const result = aggregate({ t1: { with: list(4, 4), without: list(3, 0) } });
  assert.equal(typeof result.verdict.verdict, 'string');
  assert.equal(result.verdict.word_check.k, 0);
});

// ---- the report line -------------------------------------------------------------------------

const reportOf = (aggregateResult) => renderReport({ status: 'PASS', controls: [], skills: { [SKILL]: aggregateResult } });

test('the report prints the count between the word-check line and the gate line', () => {
  const lines = reportOf(aggregate({ t1: { with: list(4, 4), without: list(3, 0) } })).split('\n');
  const at = lines.indexOf(LINE(1));
  assert.ok(at > 0, 'the line is there');
  assert.match(lines[at - 1], /^- Word-check gap/);
  assert.match(lines[at + 1], /^- Gate changed the verdict/);
});

test('the report counts more than one, and prints nothing when no pair mismatched', () => {
  const two = aggregate({ t1: { with: list(4, 4), without: list(3, 0) }, t2: { with: list(5, 5), without: undefined } });
  assert.ok(reportOf(two).split('\n').includes(LINE(2)));
  assert.doesNotMatch(reportOf(aggregate({ t1: { with: list(4, 3), without: list(4, 1) } })), /left out: \d+, the two arms/);
});

test('the report ignores a count that is not a positive whole number', () => {
  const base = aggregate({ t1: { with: list(4, 3), without: list(4, 1) } });
  for (const bad of [0, -1, 1.5, '2', null, NaN, {}, []]) {
    assert.doesNotMatch(reportOf({ ...base, check_mismatch_pairs: bad }), /Word-check pairs left out/, String(bad));
  }
});

// ---- through the store, the judge driver and the report --------------------------------------

const live = () => ({ judges: roster(3).map((s) => ({ ...s, plugin: 'scripted' })) });
const offline = () => ({ judges: roster(3).map((s) => ({ ...s, plugin: 'replay' })) });

const scratch = [];
test.after(() => scratch.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-mismatch-'));
  scratch.push(dir);
  return openStore(dir);
};

const base = (i) => SCORES[((i - 1) % 8) + 1];
const table = (count, make) => Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, make(i + 1)]));
/** The judges favour the with arm by about 2. */
const favourWith = (count) => table(count, base);

/**
 * The checks of task `n`, as authored: the file exists, the with arm's marker is in it, the
 * without arm's marker is not, and a draft file is gone. The with arm passes all four; the
 * without arm passes the first and the last.
 */
const checksOf = (n) => [
  { type: 'file_exists', path: 'CHANGELOG.md' },
  { type: 'contains', path: 'CHANGELOG.md', pattern: `ZQHI${n} entry` },
  { type: 'not_contains', path: 'CHANGELOG.md', pattern: `ZQLO${n} entry` },
  { type: 'file_absent', path: 'DRAFT.md' },
];

/** The final snapshot that `writePairs` stores for an arm of task `n`. */
const finalOf = (arm, n) => ({ 'CHANGELOG.md': `# Changelog\n- ${arm === 'with' ? 'ZQHI' : 'ZQLO'}${n} entry\n` });

/**
 * `check_results` for one arm, run by `checkResultsFor`. `shorter` lists the tasks whose without
 * arm was run after the last check was dropped from the task, so its list is one entry shorter.
 */
const resultsFor = (shorter) => (task, arm, n) => {
  const checks = checksOf(n);
  const used = arm === 'without' && shorter.includes(n) ? checks.slice(0, -1) : checks;
  return checkResultsFor({ checks: used }, START, finalOf(arm, n));
};

async function runCase({ tasks, scores, shorter = [] }) {
  const taskSet = taskSetOf(tasks);
  const store = newStore();
  writePairs(store, taskSet.tasks, { checks: resultsFor(shorter) });
  const args = { skill: SKILL, taskSet, context: CONTEXT };
  const out = await runJudging({ ...args, store, config: live(), plugins: { scripted: scriptedPlugin({ scores }) } });
  assert.equal(out.complete, true);
  assert.equal(out.result_written, true);
  const result = out.result.result;
  assert.deepEqual(store.readResult(SKILL).result, result, 'the stored result is the one returned');

  const copy = newStore();
  writePairs(copy, taskSet.tasks, { checks: resultsFor(shorter) });
  const replayed = await runJudging({ ...args, store: copy, config: offline(), plugins: { replay: replayFromStore(store, SKILL) } });
  assert.equal(replayed.complete, true);
  assert.deepEqual(replayed.result.result, result, 'replaying the stored run gives the same result');
  return { store, out, result };
}

test('control: with equal lists on every task the gate sees all nine pairs and no line is printed', async () => {
  const { out, result } = await runCase({ tasks: 9, scores: favourWith(9) });
  assert.equal(result.verdict.word_check.k, 9);
  assert.equal(Object.hasOwn(result, 'check_mismatch_pairs'), false);
  assert.ok(result.pairs.every((p) => p.c_with === 1 && p.c_without === 0.5 && p.w === 0.5));
  assert.doesNotMatch(renderReport({ status: 'PASS', controls: [], skills: { [SKILL]: out.result } }), /Word-check pairs left out/);
});

test('one task whose arms ran different numbers of checks is left out of k, and the others decide', async () => {
  const { out, result } = await runCase({ tasks: 9, scores: favourWith(9), shorter: [3] });
  const mismatched = result.pairs[2];
  assert.deepEqual(mismatched.check_mismatch, { with: 4, without: 3 });
  assert.deepEqual([mismatched.c_with, mismatched.c_without, mismatched.w], [null, null, null]);
  assert.equal(mismatched.counted, true, 'the pair is still in the judge gap');
  assert.equal(result.graded.pairs, 9);
  assert.equal(result.check_mismatch_pairs, 1);
  assert.equal(result.verdict.word_check.gate, 'on');
  assert.equal(result.verdict.word_check.k, 8);
  assert.equal(result.verdict.verdict, 'keep');
  assert.ok(result.pairs.filter((p) => p !== mismatched).every((p) => p.w === 0.5));
  const lines = renderReport({ status: 'PASS', controls: [], skills: { [SKILL]: out.result } }).split('\n');
  assert.ok(lines.includes(LINE(1)), lines.join('\n'));
});

test('the pair is left out of the gap and not counted as a loss: the judge gaps do not change', async () => {
  const clean = await runCase({ tasks: 9, scores: favourWith(9) });
  const edited = await runCase({ tasks: 9, scores: favourWith(9), shorter: [3] });
  assert.deepEqual(edited.result.graded, clean.result.graded);
  assert.deepEqual(
    edited.result.pairs.map((p) => [p.mean_delta, p.score_deltas]),
    clean.result.pairs.map((p) => [p.mean_delta, p.score_deltas]),
  );
});

test('a mismatch can take the gate below eight pairs, and then the judge verdict stands and the report says why', async () => {
  const { out, result } = await runCase({ tasks: 8, scores: favourWith(8), shorter: [5] });
  assert.equal(result.verdict.word_check.k, 7);
  assert.equal(result.verdict.word_check.gate, 'off');
  assert.equal(result.verdict.word_check.off_reason, '7 pairs with checks, need 8');
  assert.equal(result.verdict.verdict, 'keep');
  const report = renderReport({ status: 'PASS', controls: [], skills: { [SKILL]: out.result } });
  assert.match(report, /- Word-check gap: gate off: 7 pairs with checks, need 8/);
  assert.ok(report.split('\n').includes(LINE(1)), 'the report names the pair that was left out');
});

test('every task mismatched: no word-check gap at all, the judge verdict is made, and the report counts them all', async () => {
  const { out, result } = await runCase({ tasks: 8, scores: favourWith(8), shorter: [1, 2, 3, 4, 5, 6, 7, 8] });
  assert.equal(result.check_mismatch_pairs, 8);
  assert.equal(result.verdict.word_check.k, 0);
  assert.equal(result.verdict.word_check.gate, 'off');
  assert.equal(result.verdict.verdict, 'keep');
  assert.ok(renderReport({ status: 'PASS', controls: [], skills: { [SKILL]: out.result } }).split('\n').includes(LINE(8)));
});

test('an arm with no results while the other has them is a mismatch too', async () => {
  const taskSet = taskSetOf(9);
  const store = newStore();
  writePairs(store, taskSet.tasks, {
    checks: (task, arm, n) => (arm === 'without' && n === 4 ? undefined : checkResultsFor({ checks: checksOf(n) }, START, finalOf(arm, n))),
  });
  const out = await runJudging({
    skill: SKILL,
    taskSet,
    context: CONTEXT,
    store,
    config: live(),
    plugins: { scripted: scriptedPlugin({ scores: favourWith(9) }) },
  });
  const result = out.result.result;
  assert.deepEqual(result.pairs[3].check_mismatch, { with: 4, without: 0 });
  assert.equal(result.check_mismatch_pairs, 1);
  assert.equal(result.verdict.word_check.k, 8);
});
