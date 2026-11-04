// SPDX-License-Identifier: Apache-2.0
/**
 * Cost tests for the task lint
 *
 * Nothing bounded the total cost of validating and linting a task, so the lint runs under one
 * work budget. Idle `file_exists` checks must not lift the earned share of a do-nothing workspace,
 * `duplicate_checks` compares what a check measures and not how it is spelled, and a lint without
 * the skill text runs nothing. Each test rebuilds the input and asserts the lint's answer.
 *
 * Run: node --test bench/test/task-lint-cost.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONDITIONS,
  WARNINGS,
  MAX_SNAPSHOT_FILES,
  MAX_SNAPSHOT_FILE_CHARS,
  MAX_SNAPSHOT_CHARS,
  lintTask,
} = require('../lib/task-lint');
const { BUDGET_LIMITS, MAX_CHECKS_PER_TASK, MAX_NEGATIVES_PER_CHECK, createBudget } = require('../lib/checks');

const SKILL_OPTIONS = { skillText: '## Recording a change\n\nHow to record a change in the changelog.\n' };

function makeTask(overrides = {}) {
  return {
    id: 'release-notes-core-cost',
    skill: 'release-notes',
    kind: 'core',
    task: 'Write the release notes into the output files and remove the old drafts.',
    rubric: ['The notes name each change.', 'The old drafts are gone.', 'The source files are left as they were.'],
    target_section: 'Recording a change',
    fixtures: ['NOTES.md', 'DRAFT.md', 'OLD.md'],
    checks: [],
    ...overrides,
  };
}

function failureOf(report, condition) {
  return report.failures.find((f) => f.condition === condition);
}

function warningOf(report, code) {
  return report.warnings.find((w) => w.code === code);
}

function timed(body) {
  const started = performance.now();
  const value = body();
  return { value, ms: performance.now() - started };
}

// --- No skill text, no lint ----------------------------------------------------------------------

test('a lint without the skill text is a failure and runs nothing, so ok:true cannot be had by omission', () => {
  const task = makeTask({ checks: [{ type: 'file_absent', path: 'DRAFT.md' }] });
  const snapshots = { start: { 'NOTES.md': 'n', 'DRAFT.md': 'd', 'OLD.md': 'o' }, reference: { 'NOTES.md': 'n', 'OLD.md': 'o' } };
  for (const options of [undefined, null, {}, { skillText: undefined }, { skillText: 42 }, { skillText: '' }, { skillText: ' \u200b\u3164\u2800 ' }, { budget: createBudget({ ms: 1000, runs: 10 }) }]) {
    const report = lintTask(task, snapshots, options);
    assert.equal(report.ok, false, JSON.stringify(options));
    assert.deepEqual(report.failures.map((f) => f.condition), [CONDITIONS.SKILL_TEXT_MISSING]);
    assert.deepEqual(report.warnings, []);
    assert.deepEqual(report.results, { start: null, reference: null });
  }
});

test('skill_text_missing is a condition and not a warning', () => {
  assert.equal(CONDITIONS.SKILL_TEXT_MISSING, 'skill_text_missing');
  assert.equal(Object.hasOwn(WARNINGS, 'SKILL_TEXT_MISSING'), false);
});

// --- Subsumption cannot raise the do-nothing share -----------------------------------------------

const IDLE_START = {
  'a.md': 'X present text\n',
  'b.md': 'X present text\n',
  'c.md': 'X present text\n',
  'old1.md': 'old\n',
  'old2.md': 'old\n',
};
const IDLE_CHECKS = [
  { type: 'file_exists', path: 'a.md' },
  { type: 'file_exists', path: 'b.md' },
  { type: 'file_exists', path: 'c.md' },
  { type: 'contains', path: 'a.md', pattern: 'X present' },
  { type: 'contains', path: 'b.md', pattern: 'X present' },
  { type: 'contains', path: 'c.md', pattern: 'X present' },
  { type: 'contains', path: 'out1.md', pattern: 'results are ready' },
  { type: 'contains', path: 'out2.md', pattern: 'results are ready' },
  { type: 'contains', path: 'out3.md', pattern: 'results are ready' },
  { type: 'file_absent', path: 'old1.md' },
  { type: 'file_absent', path: 'old2.md' },
];

function idleTask(checks) {
  return makeTask({ fixtures: Object.keys(IDLE_START), checks });
}

const IDLE_REFERENCE = {
  'a.md': IDLE_START['a.md'],
  'b.md': IDLE_START['b.md'],
  'c.md': IDLE_START['c.md'],
  'out1.md': 'The results are ready.\n',
  'out2.md': 'The results are ready.\n',
  'out3.md': 'The results are ready.\n',
};

test('three idle file_exists beside three idle contains do not lift the earned share of a do-nothing workspace', () => {
  const report = lintTask(idleTask(IDLE_CHECKS), { start: IDLE_START, reference: IDLE_REFERENCE }, SKILL_OPTIONS);
  // The untouched workspace passes 6 of the 11 checks (55%), above the 50% an untouched workspace may score.
  assert.equal(report.results.start.filter((r) => r.passed).length, 6);
  assert.equal(report.ok, true);
  const unearned = warningOf(report, WARNINGS.UNEARNED_CHECKS);
  assert.ok(unearned, JSON.stringify(report.warnings));
  assert.match(unearned.message, /^only 5 of 11 checks need work to pass \(45%\), and at least 50% should; /);
  assert.doesNotMatch(unearned.message, /counted once/, 'no idle check was merged');
});

test('the same task without the three idle file_exists checks is the control, and it draws no warning', () => {
  const withoutFileExists = IDLE_CHECKS.filter((check) => check.type !== 'file_exists');
  const report = lintTask(idleTask(withoutFileExists), { start: IDLE_START, reference: IDLE_REFERENCE }, SKILL_OPTIONS);
  assert.equal(warningOf(report, WARNINGS.UNEARNED_CHECKS), undefined, JSON.stringify(report.warnings));
});

test('a file_exists beside a contains that both fail at the start still count once', () => {
  const checks = [
    { type: 'file_exists', path: 'out1.md' },
    { type: 'contains', path: 'out1.md', pattern: 'results are ready' },
    { type: 'file_absent', path: 'old1.md' },
    { type: 'file_absent', path: 'old2.md' },
    { type: 'fixture_unchanged', path: 'a.md' },
    { type: 'not_contains', path: 'b.md', pattern: 'forbidden words' },
  ];
  const report = lintTask(idleTask(checks), { start: IDLE_START, reference: IDLE_REFERENCE }, SKILL_OPTIONS);
  // 3 earned (contains, two file_absent) of 5 counted: the failing file_exists is merged with the contains.
  assert.equal(warningOf(report, WARNINGS.UNEARNED_CHECKS), undefined, JSON.stringify(report.warnings));
});

// --- Duplicates are what a check measures --------------------------------------------------------

const DUP_START = { 'NOTES.md': 'Notes about the tool.\n', 'DRAFT.md': 'draft\n', 'OLD.md': 'old\n' };
const DUP_REFERENCE = { 'NOTES.md': DUP_START['NOTES.md'], 'CHANGELOG.md': '# Changelog\n\n- Added a rollback plan for the flag.\n' };

function dupTask(patterns, extra = []) {
  return makeTask({
    checks: [
      { type: 'file_absent', path: 'DRAFT.md' },
      { type: 'file_absent', path: 'OLD.md' },
      { type: 'fixture_unchanged', path: 'NOTES.md' },
      ...patterns.map((pattern) => ({ type: 'contains', path: 'CHANGELOG.md', pattern })),
      ...extra,
    ],
  });
}

test('one pattern is the control, and the task draws no warning', () => {
  const report = lintTask(dupTask(['rollback plan']), { start: DUP_START, reference: DUP_REFERENCE }, SKILL_OPTIONS);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.warnings, []);
});

test('rollback plan, ROLLBACK PLAN and (?:rollback plan) on one file are one measurement', () => {
  const task = dupTask(['rollback plan', 'ROLLBACK PLAN', '(?:rollback plan)']);
  const report = lintTask(task, { start: DUP_START, reference: DUP_REFERENCE }, SKILL_OPTIONS);
  assert.equal(report.ok, true);
  const duplicate = warningOf(report, WARNINGS.DUPLICATE_CHECKS);
  assert.ok(duplicate, JSON.stringify(report.warnings));
  assert.match(duplicate.message, /checks\[4\] contains CHANGELOG\.md repeats checks\[3\]; checks\[5\] contains CHANGELOG\.md repeats checks\[3\]$/);
});

test('other spellings of the same measurement are caught as well', () => {
  const negatives = ['rollback pla', 'roll back plan'];
  const spellings = [
    'rollback pla[n]',
    'rollback plan|rollback plan',
    'rollback plan{1}',
    '(rollback plan)',
    'rollback   plan',
    'ROLLBACK\u200b PLAN',
    'rollback plan(?:)',
    // A tail or head that a search for the phrase ignores:
    'rollback plan.*',
    '.*rollback plan',
    'rollback plans?',
    'rollback plan[a-z]*',
    'rollback\\splan',
  ];
  for (const spelling of spellings) {
    const task = dupTask(['rollback plan']);
    task.checks.push({ type: 'contains', path: 'CHANGELOG.md', pattern: spelling, negatives });
    const report = lintTask(task, { start: DUP_START, reference: DUP_REFERENCE }, SKILL_OPTIONS);
    const duplicate = warningOf(report, WARNINGS.DUPLICATE_CHECKS);
    assert.ok(duplicate, `${spelling}: ${JSON.stringify(report.warnings)}`);
    assert.match(duplicate.message, /checks\[4\] contains CHANGELOG\.md repeats checks\[3\]/, spelling);
  }
});

test('patterns that measure different things are not merged', () => {
  for (const other of ['rollback steps', 'rollback (?:plan|steps)', 'rollback plan.*owner', 'roll(?:s|ed)? back']) {
    const snapshots = { start: DUP_START, reference: { ...DUP_REFERENCE, 'CHANGELOG.md': 'rollback plan owner\nrollback steps\nrolled back\n' } };
    const checks = [{ type: 'contains', path: 'CHANGELOG.md', pattern: 'rollback plan' }, { type: 'contains', path: 'CHANGELOG.md', pattern: other, negatives: ['rolling forward', 'we roll the dice', 'the rollout plan'] }];
    const report = lintTask(
      makeTask({ checks: [{ type: 'file_absent', path: 'DRAFT.md' }, { type: 'file_absent', path: 'OLD.md' }, { type: 'fixture_unchanged', path: 'NOTES.md' }, ...checks] }),
      snapshots,
      SKILL_OPTIONS,
    );
    assert.equal(warningOf(report, WARNINGS.DUPLICATE_CHECKS), undefined, `${other}: ${JSON.stringify(report.warnings)}`);
  }
});

test('the same pattern on another path or of another kind is not a repeat', () => {
  const checks = [
    { type: 'file_absent', path: 'DRAFT.md' },
    { type: 'file_absent', path: 'OLD.md' },
    { type: 'fixture_unchanged', path: 'NOTES.md' },
    { type: 'contains', path: 'CHANGELOG.md', pattern: 'rollback plan' },
    { type: 'contains', path: 'RELEASE.md', pattern: 'rollback plan' },
    { type: 'not_contains', path: 'NOTES.md', pattern: 'rollback plan' },
  ];
  const reference = { ...DUP_REFERENCE, 'RELEASE.md': 'the rollback plan\n' };
  const report = lintTask(makeTask({ checks }), { start: DUP_START, reference }, SKILL_OPTIONS);
  assert.equal(warningOf(report, WARNINGS.DUPLICATE_CHECKS), undefined, JSON.stringify(report.warnings));
});

test('not_contains patterns and file_absent paths are compared by measurement too', () => {
  const checks = [
    { type: 'file_absent', path: 'DRAFT.md' },
    { type: 'file_absent', path: 'draft.md' },
    { type: 'file_absent', path: 'OLD.md' },
    { type: 'not_contains', path: 'NOTES.md', pattern: 'secret key' },
    { type: 'not_contains', path: 'NOTES.md', pattern: 'SECRET KEY' },
    { type: 'contains', path: 'CHANGELOG.md', pattern: 'rollback plan' },
  ];
  const report = lintTask(makeTask({ checks }), { start: DUP_START, reference: DUP_REFERENCE }, SKILL_OPTIONS);
  const duplicate = warningOf(report, WARNINGS.DUPLICATE_CHECKS);
  assert.ok(duplicate, JSON.stringify(report.warnings));
  assert.match(duplicate.message, /checks\[1\] file_absent draft\.md repeats checks\[0\]; checks\[4\] not_contains NOTES\.md repeats checks\[3\]$/);
});

// --- The lint is bounded in total ------------------------------------------------------------------

test('a task over the check ceiling is invalid before anything runs', () => {
  const checks = Array.from({ length: 100 }, (_, i) => ({ type: 'file_exists', path: `f${i}.md` }));
  const { value: report, ms } = timed(() => lintTask(makeTask({ checks }), { start: {}, reference: {} }, SKILL_OPTIONS));
  assert.equal(report.ok, false);
  assert.match(failureOf(report, CONDITIONS.TASK_INVALID).message, /checks: has 100 checks, the limit is 30/);
  assert.ok(ms < 500, `${ms} ms`);
  assert.equal(MAX_CHECKS_PER_TASK, 30);
});

test('ten declared negatives are invalid at once; before, ten slow ones cost ten seconds', () => {
  const slow = 'a{0,16}'.repeat(10) + 'bc';
  const negatives = Array.from({ length: MAX_NEGATIVES_PER_CHECK + 2 }, (_, i) => `${'a'.repeat(120)}bd${i}`);
  const checks = [{ type: 'contains', path: 'out.md', pattern: slow, negatives }];
  const { value: report, ms } = timed(() => lintTask(makeTask({ checks }), { start: {}, reference: {} }, SKILL_OPTIONS));
  assert.match(failureOf(report, CONDITIONS.TASK_INVALID).message, /negatives: has 10 entries, the limit is 8/);
  assert.ok(ms < 1500, `${ms} ms`);
});

test('eight slow negatives are charged to the budget, and the lint fails closed inside it', () => {
  const slow = 'a{0,16}'.repeat(10) + 'bc';
  const negatives = Array.from({ length: MAX_NEGATIVES_PER_CHECK }, (_, i) => `${'a'.repeat(120 + i)}bd`);
  const checks = [{ type: 'contains', path: 'out.md', pattern: slow, negatives }];
  const budget = createBudget({ ms: 1500, runs: 1000 });
  const { value: report, ms } = timed(() => lintTask(makeTask({ checks }), { start: {}, reference: {} }, { ...SKILL_OPTIONS, budget }));
  assert.equal(report.ok, false);
  assert.ok(ms < 3000, `${ms} ms; eight negatives of one second each would cost eight`);
  assert.ok(failureOf(report, CONDITIONS.WORK_BUDGET_EXHAUSTED), JSON.stringify(report.failures));
  assert.match(failureOf(report, CONDITIONS.WORK_BUDGET_EXHAUSTED).message, /^the lint ran out of its work budget \(the 1500 ms time limit was reached\)/);
});

test('five not_contains checks of aaa.*a.*bb on a large fixture end at the lint budget', () => {
  // Five checks, two workspaces, one second each: ten seconds before the budget. The fixture is
  // the largest the lint accepts; `aaa.*a.*bb` takes the whole per-run limit on it.
  const big = 'a'.repeat(MAX_SNAPSHOT_FILE_CHARS);
  const start = { 'NOTES.md': 'n', 'big.md': big, 'DRAFT.md': 'd' };
  const checks = [
    { type: 'not_contains', path: 'big.md', pattern: 'aaa.*a.*bb' },
    { type: 'not_contains', path: 'big.md', pattern: 'aaaa.*a.*bb' },
    { type: 'not_contains', path: 'big.md', pattern: 'aaaaa.*a.*bb' },
    { type: 'not_contains', path: 'big.md', pattern: 'aaaaaa.*a.*bb' },
    { type: 'not_contains', path: 'big.md', pattern: 'aaaaaaa.*a.*bb' },
    { type: 'file_absent', path: 'DRAFT.md' },
  ];
  const task = makeTask({ fixtures: ['NOTES.md', 'big.md', 'DRAFT.md'], checks });
  const { value: report, ms } = timed(() => lintTask(task, { start, reference: { 'NOTES.md': 'n', 'big.md': big } }, SKILL_OPTIONS));
  assert.equal(report.ok, false);
  assert.ok(failureOf(report, CONDITIONS.WORK_BUDGET_EXHAUSTED), JSON.stringify(report.failures));
  // The default lint budget plus the run in flight and the work between runs.
  assert.ok(ms < BUDGET_LIMITS.lint.ms + 2000, `${ms} ms`);
});

test('validating the task inside a lint is charged to the lint budget', () => {
  const checks = Array.from({ length: 6 }, (_, i) => ({ type: 'contains', path: `o${i}.md`, pattern: `rollback${i}(?:s|ed)? plan`, negatives: [`rollback${i}ing plan`, `rollback${i}er plan`] }));
  const budget = createBudget({ ms: 60000, runs: 5 });
  const report = lintTask(makeTask({ checks }), { start: {}, reference: {} }, { ...SKILL_OPTIONS, budget });
  assert.equal(report.ok, false);
  assert.deepEqual(report.failures.map((f) => f.condition), [CONDITIONS.TASK_INVALID, CONDITIONS.WORK_BUDGET_EXHAUSTED]);
  assert.match(report.failures[0].message, /validation ran out of its work budget \(more than 5 pattern runs\)/);
  assert.equal(budget.runs, 5);
});

test('an exhausted budget fails a lint that every other rule would pass', () => {
  // The task passes with a generous budget and fails with a stingy one, and only for that reason.
  const task = makeTask({
    checks: [
      { type: 'file_absent', path: 'DRAFT.md' },
      { type: 'file_absent', path: 'OLD.md' },
      { type: 'fixture_unchanged', path: 'NOTES.md' },
      { type: 'contains', path: 'CHANGELOG.md', pattern: 'rollback plan' },
    ],
  });
  const snapshots = { start: DUP_START, reference: DUP_REFERENCE };
  const generousBudget = createBudget({ ms: 60000, runs: 100000 });
  const generous = lintTask(task, snapshots, { ...SKILL_OPTIONS, budget: generousBudget });
  assert.equal(generous.ok, true, JSON.stringify(generous.failures));
  assert.ok(generousBudget.runs > 3, `${generousBudget.runs} runs`);
  for (const runs of [1, 3, generousBudget.runs - 1]) {
    const stingy = lintTask(task, snapshots, { ...SKILL_OPTIONS, budget: createBudget({ ms: 60000, runs }) });
    assert.equal(stingy.ok, false, `runs ${runs}`);
    assert.ok(failureOf(stingy, CONDITIONS.WORK_BUDGET_EXHAUSTED), `runs ${runs}: ${JSON.stringify(stingy.failures)}`);
  }
});

test('a stay-out lint is bounded the same way', () => {
  const task = makeTask({
    kind: 'near-miss',
    checks: [
      { type: 'not_contains', path: 'NOTES.md', pattern: 'secret key' },
      { type: 'fixture_unchanged', path: 'NOTES.md' },
      { type: 'file_absent', path: 'CHANGELOG.md' },
    ],
  });
  const snapshots = { start: DUP_START, reference: DUP_START };
  assert.equal(lintTask(task, snapshots, { ...SKILL_OPTIONS, budget: createBudget({ ms: 60000, runs: 100000 }) }).ok, true);
  const stingy = lintTask(task, snapshots, { ...SKILL_OPTIONS, budget: createBudget({ ms: 60000, runs: 4 }) });
  assert.equal(stingy.ok, false);
  assert.ok(failureOf(stingy, CONDITIONS.WORK_BUDGET_EXHAUSTED), JSON.stringify(stingy.failures));
});

test('options.budget must be a budget made by createBudget', () => {
  const task = makeTask({ checks: [{ type: 'file_absent', path: 'DRAFT.md' }] });
  for (const budget of [{ ms: 100000, runs: 100000 }, 'budget', 7, null]) {
    const report = lintTask(task, { start: DUP_START, reference: DUP_REFERENCE }, { ...SKILL_OPTIONS, budget });
    assert.equal(report.ok, false, String(budget));
    assert.ok(failureOf(report, CONDITIONS.TASK_INVALID), JSON.stringify(report.failures));
  }
});

test('a snapshot over the size ceilings is refused before any pattern reads it', () => {
  const task = makeTask({ fixtures: ['NOTES.md'], checks: [{ type: 'contains', path: 'out.md', pattern: 'results ready' }] });
  const ok = { 'NOTES.md': 'n' };
  const tooMany = Object.fromEntries(Array.from({ length: MAX_SNAPSHOT_FILES + 1 }, (_, i) => [`f${i}.md`, 'x']));
  const cases = [
    [{ ...ok, 'NOTES.md': 'x'.repeat(MAX_SNAPSHOT_FILE_CHARS + 1) }, 'holds a file of 100001 characters \\("NOTES\\.md"\\), the limit is 100000'],
    [tooMany, 'holds 201 files, the limit is 200'],
    [Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`f${i}.md`, 'x'.repeat(MAX_SNAPSHOT_FILE_CHARS)])), 'holds 1100000 characters in all, the limit is 1000000'],
  ];
  for (const [big, rest] of cases) {
    for (const role of ['start', 'reference']) {
      const snapshots = role === 'start' ? { start: big, reference: ok } : { start: ok, reference: big };
      const { value: report, ms } = timed(() => lintTask(task, snapshots, SKILL_OPTIONS));
      assert.deepEqual(report.failures.map((f) => f.condition), [CONDITIONS.SNAPSHOT_INVALID]);
      assert.match(report.failures[0].message, new RegExp(`too large to lint against: ${role} ${rest}`));
      assert.ok(ms < 500, `${ms} ms`);
    }
  }
  assert.equal(MAX_SNAPSHOT_CHARS, 1000000);
});

test('a snapshot at the size ceilings is accepted', () => {
  const task = makeTask({ fixtures: ['big.md'], checks: [{ type: 'file_absent', path: 'big.md' }] });
  const start = { 'big.md': 'x'.repeat(MAX_SNAPSHOT_FILE_CHARS) };
  const report = lintTask(task, { start, reference: {} }, SKILL_OPTIONS);
  assert.equal(failureOf(report, CONDITIONS.SNAPSHOT_INVALID), undefined);
});

// --- The figures are real --------------------------------------------------------------------------

function largestTask(oneFile) {
  const suffixes = ['ing', 'er', 'ers', 'ly', 'ish', 'ful', 'less', 'ness'];
  assert.equal(suffixes.length, MAX_NEGATIVES_PER_CHECK);
  const checks = Array.from({ length: MAX_CHECKS_PER_TASK }, (_, i) => ({
    type: 'contains',
    path: oneFile ? 'out.md' : `out${i}.md`,
    pattern: `rollback${i}(?:s|ed)? plan`,
    negatives: suffixes.map((suffix) => `rollback${i}${suffix} plan`),
  }));
  return makeTask({ fixtures: [], checks });
}

test('the largest task the ceilings allow uses at most half of each run limit, so an ordinary task never meets it', () => {
  for (const oneFile of [false, true]) {
    const budget = createBudget({ ms: 120000, runs: 1000000 });
    const report = lintTask(largestTask(oneFile), { start: {}, reference: {} }, { ...SKILL_OPTIONS, budget });
    // The task is valid: the lint got past validation (it fails later rules, which is fine here).
    assert.equal(failureOf(report, CONDITIONS.TASK_INVALID), undefined, JSON.stringify(report.failures));
    assert.ok(budget.runs * 2 <= BUDGET_LIMITS.lint.runs, `lint: ${budget.runs} runs against a limit of ${BUDGET_LIMITS.lint.runs} (oneFile ${oneFile})`);
  }
});
