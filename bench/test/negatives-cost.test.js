// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for the negative corpus from the fourth review (findings I-D and C-4)
 *
 * I-D: `rolled forward` and `rolled forward\u034f` counted as two distinct negatives, because the
 * negatives' comparison dropped only format characters while the rubric's comparison folded much
 * more. Both now use the shared fold of text-fold.js. C-4: a negative the pattern is slow on costs a
 * full second, and a list of them, or the same one declared many times, cost that many.
 *
 * Run: node --test bench/test/negatives-cost.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { validateNegatives, evaluateNegatives } = require('../lib/negatives');
const { MAX_NEGATIVES_PER_CHECK, createBudget, withBudget } = require('../lib/checks');

const PATTERN = 'roll(?:s|ed)? back';

function check(negatives, pattern = PATTERN) {
  return { type: 'contains', path: 'CHANGELOG.md', pattern, negatives };
}

function timed(body) {
  const started = performance.now();
  const value = body();
  return { value, ms: performance.now() - started };
}

// --- I-D ---------------------------------------------------------------------------------------

test('I-D: a negative and a copy with a blank-looking letter appended count as one', () => {
  for (const filler of ['\u034f', '\u3164', '\u2800', '\ufe0f', '\u115f', '\u200b', '\u00ad', '\ud800']) {
    const problems = validateNegatives(check(['rolled forward', `rolled forward${filler}`]));
    assert.deepEqual(problems, ['negatives: a tolerant pattern needs at least 2 distinct declared negatives, got 1'], JSON.stringify(filler));
  }
});

test('I-D: a filler inside the negative does not make it a different negative', () => {
  const problems = validateNegatives(check(['rolled forward', 'rol\u2800led for\u3164ward', 'ROLLED   FORWARD']));
  assert.deepEqual(problems, ['negatives: a tolerant pattern needs at least 2 distinct declared negatives, got 1']);
});

test('I-D: two genuinely different negatives still satisfy the rule', () => {
  assert.deepEqual(validateNegatives(check(['rolled forward', 'rolling forward again'])), []);
});

test('I-D: a negative made of Hangul fillers and the Braille blank holds no letters', () => {
  // U+3164 and U+115F are letters by category and print nothing; counting them let a negative that
  // is only fillers pass the "three letters or digits" rule when it shared a fragment with the pattern.
  const onlyFillers = validateNegatives(check(['rolled forward', '\u3164\u3164\u3164\u3164']));
  assert.deepEqual(onlyFillers, ['negatives: the declared negative "\u3164\u3164\u3164\u3164" has fewer than 3 letters or digits, so it cannot stand for a wrong answer']);
  // Fillers around two real letters do not reach three either.
  const padded = validateNegatives(check(['rolled forward', '\u3164ro\u3164\u2800']));
  assert.deepEqual(padded, ['negatives: the declared negative "\u3164ro\u3164\u2800" has fewer than 3 letters or digits, so it cannot stand for a wrong answer']);
});

test('I-D: the negatives and the rubric use the same fold', () => {
  const { foldedForm } = require('../lib/text-fold');
  for (const text of ['rolled forward', 'ROLLED\u00a0FORWARD', 'rolled forward\u034f', 'r\u043elled forward', 'rolled forward\u2800\u3164']) {
    assert.equal(foldedForm(text), 'rolled forward', JSON.stringify(text));
  }
});

// --- C-4 ---------------------------------------------------------------------------------------

test('C-4: more than MAX_NEGATIVES_PER_CHECK negatives are one problem and none is run', () => {
  assert.equal(MAX_NEGATIVES_PER_CHECK, 8);
  const negatives = Array.from({ length: MAX_NEGATIVES_PER_CHECK + 1 }, (_, i) => `rolled forward ${i}`);
  const budget = createBudget({ ms: 10000, runs: 1000 });
  const problems = withBudget(budget, () => validateNegatives(check(negatives)));
  assert.deepEqual(problems, [`negatives: has ${MAX_NEGATIVES_PER_CHECK + 1} entries, the limit is ${MAX_NEGATIVES_PER_CHECK}`]);
  assert.equal(budget.runs, 1, 'only the pattern was compiled; no negative was run');
});

test('C-4: evaluateNegatives counts an over-long list as accepted and runs none of it', () => {
  assert.equal(MAX_NEGATIVES_PER_CHECK, 8);
  const negatives = Array.from({ length: MAX_NEGATIVES_PER_CHECK + 1 }, (_, i) => `rolled forward ${i}`);
  const result = evaluateNegatives(check(negatives));
  assert.deepEqual(result.accepted, negatives);
  assert.equal(result.tested, 0);
});

test('C-4: a negative declared eight times is run once', () => {
  assert.equal(MAX_NEGATIVES_PER_CHECK, 8);
  const budget = createBudget({ ms: 10000, runs: 1000 });
  const negatives = Array.from({ length: MAX_NEGATIVES_PER_CHECK }, () => 'rolled forward');
  const problems = withBudget(budget, () => validateNegatives(check(negatives)));
  assert.deepEqual(problems, ['negatives: a tolerant pattern needs at least 2 distinct declared negatives, got 1']);
  assert.equal(budget.runs, 2, 'one run to compile the pattern, one for the single distinct negative');
  const evaluated = createBudget({ ms: 10000, runs: 1000 });
  const result = withBudget(evaluated, () => evaluateNegatives(check(negatives)));
  assert.equal(result.tested, MAX_NEGATIVES_PER_CHECK);
  assert.deepEqual(result.accepted, []);
  assert.equal(evaluated.runs, 2);
});

test('C-4: eight slow negatives are charged to the budget in force and stop at its deadline', () => {
  assert.equal(MAX_NEGATIVES_PER_CHECK, 8);
  const slow = 'a{0,16}'.repeat(10) + 'bc';
  const negatives = Array.from({ length: MAX_NEGATIVES_PER_CHECK }, (_, i) => `${'a'.repeat(120 + i)}bd`);
  const budget = createBudget({ ms: 1200, runs: 1000 });
  const { value: problems, ms } = timed(() => withBudget(budget, () => validateNegatives(check(negatives, slow))));
  assert.ok(ms < 2500, `${ms} ms; eight negatives of one second each cost eight`);
  assert.ok(problems.some((problem) => /was not run because the work budget ran out/.test(problem)), problems.join(' | '));
  assert.match(budget.exhausted, /time limit/);
});

test('C-4: with no budget in force, validateNegatives makes its own, so a caller cannot reach the unbounded path', () => {
  assert.equal(MAX_NEGATIVES_PER_CHECK, 8);
  const slow = 'a{0,16}'.repeat(10) + 'bc';
  const negatives = Array.from({ length: MAX_NEGATIVES_PER_CHECK }, (_, i) => `${'a'.repeat(120 + i)}bd`);
  const { value: problems, ms } = timed(() => validateNegatives(check(negatives, slow)));
  assert.ok(ms < 3000 + 1500, `${ms} ms`);
  assert.ok(problems.some((problem) => /work budget ran out/.test(problem)), problems.join(' | '));
});
