// SPDX-License-Identifier: Apache-2.0
/**
 * Cost and word-boundary tests for the check matcher (findings C-4 and I-F)
 *
 * C-4: each pattern run was bounded at MATCH_TIMEOUT_MS, but the number of runs was chosen by the
 * author, so nothing bounded the total. These tests rebuild the inputs that were confirmed and show
 * the two layers that bound it now: ceilings on the counts, and a work budget (a deadline and a
 * run count) that every run is charged to. The budgets used here are small, so the tests are quick;
 * the default figures are exercised end to end in task-schema-cost.test.js and task-lint-cost.test.js.
 *
 * I-F: whole-word matching of a plain literal listed the Latin letters, so `план` matched inside
 * `планета` while `plan` did not match inside `planets`.
 *
 * Run: node --test bench/test/checks-cost.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MATCH_TIMEOUT_MS,
  MAX_NEGATIVES_PER_CHECK,
  MAX_CHECKS_PER_TASK,
  MAX_PATH_CHARS,
  BUDGET_LIMITS,
  createBudget,
  isBudget,
  withBudget,
  exhaustionReason,
  compilePattern,
  testBounded,
  isIndeterminate,
  validateCheck,
  evalCheck,
  evalChecks,
} = require('../lib/checks');

// C-4: confirmed inputs. Neither pattern is rejected by `backtrackingRisk`, and each takes the whole
// MATCH_TIMEOUT_MS on its text.
const SLOW_PATTERN = 'a{0,16}'.repeat(10) + 'bc';
const SLOW_TEXT = `${'a'.repeat(120)}bd`;
const SLOW_ALTERNATION = '(?:a|a)'.repeat(34) + 'bbb';
const SLOW_ALTERNATION_TEXT = `${'a'.repeat(34)}bbd`;

function timed(body) {
  const started = performance.now();
  const value = body();
  return { value, ms: performance.now() - started };
}

// --- C-4: the inputs are real ------------------------------------------------------------------

test('C-4: the confirmed slow patterns pass every syntax rule and reach the per-run limit', () => {
  for (const [pattern, text] of [
    [SLOW_PATTERN, SLOW_TEXT],
    [SLOW_ALTERNATION, SLOW_ALTERNATION_TEXT],
  ]) {
    const { regex, error } = compilePattern(pattern);
    assert.equal(error, undefined, `${pattern.slice(0, 20)} was rejected by a syntax rule`);
    const { value, ms } = timed(() => testBounded(regex, text));
    assert.equal(value, null);
    assert.ok(ms >= MATCH_TIMEOUT_MS * 0.9, `${ms} ms`);
  }
});

// --- C-4: ceilings on counts -------------------------------------------------------------------

test('C-4: a check may declare at most MAX_NEGATIVES_PER_CHECK negatives, reported before any is run', () => {
  assert.equal(MAX_NEGATIVES_PER_CHECK, 8);
  const negatives = Array.from({ length: MAX_NEGATIVES_PER_CHECK + 1 }, (_, i) => `rolled forward ${i}`);
  const { value, ms } = timed(() => validateCheck({ type: 'contains', path: 'a.md', pattern: 'roll(?:s|ed)? back', negatives }));
  assert.deepEqual(value, [`negatives: has ${MAX_NEGATIVES_PER_CHECK + 1} entries, the limit is ${MAX_NEGATIVES_PER_CHECK}`]);
  assert.ok(ms < 200, `${ms} ms`);
  const atLimit = negatives.slice(0, MAX_NEGATIVES_PER_CHECK);
  assert.deepEqual(validateCheck({ type: 'contains', path: 'a.md', pattern: 'roll(?:s|ed)? back', negatives: atLimit }), []);
});

test('C-4: a path longer than MAX_PATH_CHARS is a validation error on every kind that takes one', () => {
  assert.equal(MAX_PATH_CHARS, 256);
  const long = `${'d/'.repeat(MAX_PATH_CHARS / 2)}f.md`;
  assert.ok(long.length > MAX_PATH_CHARS);
  for (const check of [
    { type: 'file_exists', path: long },
    { type: 'file_absent', path: long },
    { type: 'fixture_unchanged', path: long },
    { type: 'contains', path: long, pattern: 'rollback plan' },
  ]) {
    assert.deepEqual(validateCheck(check), [`path: has ${long.length} characters, the limit is ${MAX_PATH_CHARS}`], check.type);
  }
  const fits = 'x'.repeat(MAX_PATH_CHARS);
  assert.deepEqual(validateCheck({ type: 'file_exists', path: fits }), []);
});

test('C-4: evalChecks does not run a check past MAX_CHECKS_PER_TASK, and says it gave no verdict', () => {
  assert.equal(MAX_CHECKS_PER_TASK, 30);
  const checks = Array.from({ length: MAX_CHECKS_PER_TASK + 3 }, () => ({ type: 'file_exists', path: 'a.md' }));
  const results = evalChecks({ 'a.md': 'x' }, checks);
  assert.equal(results.length, checks.length);
  assert.ok(results.slice(0, MAX_CHECKS_PER_TASK).every((result) => result.passed));
  for (const result of results.slice(MAX_CHECKS_PER_TASK)) {
    assert.equal(result.passed, false);
    assert.match(result.detail, /holds more than 30 checks/);
    assert.equal(isIndeterminate(result), true);
  }
});

// --- C-4: the work budget ----------------------------------------------------------------------

test('C-4: createBudget takes positive integer limits and nothing else', () => {
  for (const bad of [undefined, null, {}, { ms: 0, runs: 5 }, { ms: 5, runs: 0 }, { ms: 1.5, runs: 5 }, { ms: '5', runs: 5 }, { ms: -1, runs: 5 }, 'x']) {
    assert.throws(() => createBudget(bad), TypeError, JSON.stringify(bad));
  }
  assert.equal(isBudget(createBudget({ ms: 10, runs: 10 })), true);
  assert.equal(isBudget({ ms: 10, runs: 10 }), false);
  assert.equal(isBudget(Object.create(createBudget({ ms: 10, runs: 10 }))), false);
  assert.equal(isBudget(null), false);
});

test('C-4: BUDGET_LIMITS is frozen and names the four entry points', () => {
  assert.deepEqual(Object.keys(BUDGET_LIMITS).sort(), ['evaluation', 'lint', 'taskSet', 'validation']);
  assert.ok(Object.isFrozen(BUDGET_LIMITS));
  for (const limits of Object.values(BUDGET_LIMITS)) {
    assert.ok(Object.isFrozen(limits));
    assert.ok(Number.isSafeInteger(limits.ms) && limits.ms > 0 && Number.isSafeInteger(limits.runs) && limits.runs > 0);
  }
  // Nested work is charged to the outer budget, so a larger entry point must not be smaller than what it contains.
  assert.ok(BUDGET_LIMITS.lint.ms >= BUDGET_LIMITS.validation.ms && BUDGET_LIMITS.lint.runs >= BUDGET_LIMITS.validation.runs);
  assert.ok(BUDGET_LIMITS.taskSet.ms >= BUDGET_LIMITS.lint.ms && BUDGET_LIMITS.taskSet.runs >= BUDGET_LIMITS.lint.runs);
  // The time limits bound wall-clock time; the run counts are a backstop that does not depend on the machine.
  assert.deepEqual({ ...BUDGET_LIMITS.lint }, { ms: 8000, runs: 3000 });
  assert.deepEqual({ ...BUDGET_LIMITS.taskSet }, { ms: 30000, runs: 100000 });
  assert.deepEqual({ ...BUDGET_LIMITS.evaluation }, { ms: 5000, runs: 200 });
  assert.deepEqual({ ...BUDGET_LIMITS.validation }, { ms: 3000, runs: 700 });
});

test('C-4: a budget admits exactly its run count, then refuses every later run without running it', () => {
  const budget = createBudget({ ms: 60000, runs: 3 });
  const regex = compilePattern('rollback plan').regex;
  const verdicts = withBudget(budget, () => [1, 2, 3, 4, 5].map(() => testBounded(regex, 'a rollback plan')));
  assert.deepEqual(verdicts, [true, true, true, null, null]);
  assert.match(budget.exhausted, /^more than 3 pattern runs$/);
  // Outside withBudget no budget is in force.
  assert.equal(exhaustionReason(), null);
  assert.equal(testBounded(regex, 'a rollback plan'), true);
});

test('C-4: a budget cuts the run in flight at its deadline and stays exhausted', () => {
  const budget = createBudget({ ms: 300, runs: 1000 });
  const regex = compilePattern(SLOW_PATTERN).regex;
  const { value, ms } = timed(() => withBudget(budget, () => testBounded(regex, SLOW_TEXT)));
  assert.equal(value, null);
  assert.ok(ms < MATCH_TIMEOUT_MS * 0.8, `the run was cut at the deadline, not the per-run limit: ${ms} ms`);
  assert.match(budget.exhausted, /^the 300 ms time limit was reached$/);
  const later = timed(() => withBudget(budget, () => testBounded(compilePattern('rollback plan').regex, 'a rollback plan')));
  assert.equal(later.value, null, 'an exhausted budget does not start a run, even a trivial one');
});

test('C-4: the exploit with many slow checks costs the budget and not the sum of the limits', () => {
  // Four checks, each of which costs a full second against this file: four seconds without a budget.
  const checks = Array.from({ length: 4 }, (_, i) => ({ type: 'contains', path: `f${i}.md`, pattern: SLOW_PATTERN }));
  const snapshot = Object.fromEntries(checks.map((check) => [check.path, SLOW_TEXT]));
  const budget = createBudget({ ms: 1200, runs: 1000 });
  const { value: results, ms } = timed(() => evalChecks(snapshot, checks, { budget }));
  assert.ok(ms < 2500, `${ms} ms`);
  assert.equal(results.length, 4);
  for (const result of results) {
    assert.equal(result.passed, false);
    assert.equal(isIndeterminate(result), true, result.detail);
  }
  assert.ok(results.slice(1).some((result) => /work budget ran out/.test(result.detail)), JSON.stringify(results.map((r) => r.detail)));
  assert.match(budget.exhausted, /time limit/);
});

test('C-4: a check the budget did not run is no verdict, for not_contains as much as for contains', () => {
  const budget = createBudget({ ms: 60000, runs: 1 });
  const snapshot = { 'a.md': 'a rollback plan' };
  const results = evalChecks(snapshot, [
    { type: 'not_contains', path: 'a.md', pattern: 'rollback plan' },
    { type: 'not_contains', path: 'a.md', pattern: 'something else' },
  ], { budget });
  for (const result of results) {
    assert.equal(result.passed, false);
    assert.match(result.detail, /^the work budget ran out before this check was run/);
    assert.equal(isIndeterminate(result), true);
  }
});

test('C-4: checks that run no pattern still give their verdict after the budget is spent', () => {
  const budget = createBudget({ ms: 60000, runs: 1 });
  const snapshot = { 'a.md': 'x' };
  const results = evalChecks(snapshot, [
    { type: 'contains', path: 'a.md', pattern: 'rollback plan' },
    { type: 'file_exists', path: 'a.md' },
    { type: 'file_absent', path: 'b.md' },
  ], { budget });
  assert.equal(isIndeterminate(results[0]), true);
  assert.deepEqual(results.slice(1).map((r) => r.passed), [true, true]);
});

test('C-4: options.budget must come from createBudget, and a look-alike evaluates nothing', () => {
  const fake = { ms: 100000, runs: 100000, admit: () => 1000 };
  const results = evalChecks({ 'a.md': 'x' }, [{ type: 'file_exists', path: 'a.md' }, { type: 'file_exists', path: 'a.md' }], { budget: fake });
  assert.equal(results.length, 2);
  for (const result of results) {
    assert.equal(result.passed, false);
    assert.equal(isIndeterminate(result), true);
  }
});

test('C-4: a budget in force is inherited by nested calls and restored afterwards', () => {
  const outer = createBudget({ ms: 60000, runs: 3 });
  withBudget(outer, () => {
    evalChecks({ 'a.md': 'a rollback plan' }, [
      { type: 'contains', path: 'a.md', pattern: 'rollback plan' },
    ]);
    assert.ok(outer.runs >= 2, 'the nested evaluation was charged to the outer budget');
    assert.equal(exhaustionReason(), outer.exhausted);
  });
  assert.equal(exhaustionReason(), null);
  // An exception inside leaves no budget behind.
  assert.throws(() => withBudget(createBudget({ ms: 10, runs: 10 }), () => { throw new Error('boom'); }), /boom/);
  assert.equal(exhaustionReason(), null);
});

test('C-4: a pattern the budget would not compile is not reported as a malformed check', () => {
  const budget = createBudget({ ms: 60000, runs: 1 });
  const [first, second] = evalChecks({ 'a.md': 'rollback plan' }, [
    { type: 'contains', path: 'a.md', pattern: 'rollback plan' },
    { type: 'contains', path: 'a.md', pattern: 'rollback plan' },
  ], { budget });
  assert.equal(isIndeterminate(first), true);
  assert.equal(isIndeterminate(second), true);
  assert.doesNotMatch(second.detail, /malformed/);
});

// --- I-F: whole words in any script ------------------------------------------------------------

function matches(pattern, text) {
  const { regex, error } = compilePattern(pattern);
  assert.equal(error, undefined, pattern);
  return regex.test(text);
}

test('I-F: a plain literal in Cyrillic matches whole words, as the Latin one does', () => {
  assert.equal(matches('план', 'Наш план готов.'), true);
  assert.equal(matches('план', 'планета'), false);
  assert.equal(matches('план', 'сплан'), false);
  assert.equal(matches('plan', 'planets'), false);
  assert.equal(matches('plan', 'a plan.'), true);
});

test('I-F: Greek, Arabic, Devanagari and Hangul literals are held to word boundaries too', () => {
  const cases = [
    ['σχέδιο', 'το σχέδιο τελείωσε', 'σχέδιοn', 'σχέδιο'],
    ['خطة', 'هذه خطة جيدة', 'خطةً', 'خطة'],
    ['योजना', 'यह योजना है', 'योजनाएं', 'योजना'],
    ['계획서', '이 계획서 를 본다', '계획서류', '계획서'],
  ];
  for (const [pattern, whole, longer] of cases) {
    assert.equal(matches(pattern, whole), true, `${pattern} in ${whole}`);
    assert.equal(matches(pattern, longer), false, `${pattern} inside ${longer}`);
  }
});

test('I-F: a combining mark or a digit next to the literal makes it part of a longer word', () => {
  assert.equal(matches('plan', 'plan\u0301'), false);
  assert.equal(matches('plan', 'plan2'), false);
  assert.equal(matches('plan', 'plan_b'), false);
  assert.equal(matches('plan', 'plan-b'), true);
  assert.equal(matches('план', 'план\u0301'), false);
});

test('I-F: not_contains keeps substring matching in every script, so a forbidden word hidden in a longer one is caught', () => {
  const check = { type: 'not_contains', path: 'a.md', pattern: 'план' };
  assert.equal(evalCheck({ 'a.md': 'планета' }, check).passed, false);
  assert.equal(evalCheck({ 'a.md': 'ничего' }, check).passed, true);
});

test('I-F: only an edge that is a word character needs a boundary, in any script', () => {
  // The leading `#` is not a word character, so nothing is demanded before it; the trailing letter is.
  assert.equal(matches('#план', 'x#план.'), true);
  assert.equal(matches('#план', 'x#планета'), false);
  assert.equal(matches('--dry-run', 'use xx--dry-run'), true);
  assert.equal(matches('--dry-run', 'use --dry-runner'), false);
});
