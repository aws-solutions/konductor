// SPDX-License-Identifier: Apache-2.0
/**
 * Task Lint unit tests
 *
 * Uses Node's built-in `node:test` and `node:assert`, so no test framework dependency is needed.
 * Run: node --test bench/test/task-lint.test.js
 *
 * The fixtures under fixtures/tasks/ are small hand-written examples. `snapshots/start` and
 * `snapshots/reference` hold the two workspaces of one imaginary changelog task, and each
 * `*.task.json` is a task linted against them: `sound` is clean, and each of the other three
 * trips exactly one rule. Snapshots are read once with the loader; the lint itself reads nothing.
 * No test spawns a process or makes a network or model call.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CONDITIONS, WARNINGS, ROLES, REQUIRED_ROLES, MAX_LISTED_CHECKS, lintTask: strictLintTask } = require('../lib/task-lint');
const { withSkillText } = require('./helpers/skill-text');

// `lintTask` refuses to run without options.skillText. These tests are about other rules, so they
// call it through the helper that supplies a minimal skill text; see helpers/skill-text.js.
const lintTask = withSkillText(strictLintTask);
const { validateTask } = require('../lib/task-schema');
const { loadSnapshot } = require('../lib/snapshot-loader');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'tasks');

function loadTask(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, `${name}.task.json`), 'utf8'));
}

const SNAPSHOTS = Object.fromEntries(ROLES.map((role) => [role, loadSnapshot(path.join(FIXTURES_DIR, 'snapshots', role))]));

function conditionsOf(report) {
  return report.failures.map((f) => f.condition);
}

function warningCodes(report) {
  return report.warnings.map((w) => w.code);
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

// --- Fixtures ---------------------------------------------------------------------------------

test('every fixture task is a valid task, so a result below comes from the lint and not the shape', () => {
  for (const name of ['sound', 'start-passes', 'reference-fails', 'pasteable']) {
    assert.deepEqual(validateTask(loadTask(name)), [], name);
  }
});

test('the two snapshots are loaded as plain maps of path to text', () => {
  assert.deepEqual(Object.keys(SNAPSHOTS.start), ['NOTES.md', 'drafts/dry-run.md', 'src/flags.txt']);
  assert.deepEqual(Object.keys(SNAPSHOTS.reference), ['CHANGELOG.md', 'NOTES.md', 'src/flags.txt']);
});

test('the constants name the gates, the warnings and the roles', () => {
  assert.deepEqual([...ROLES], ['start', 'reference']);
  assert.deepEqual([...REQUIRED_ROLES], ['start']);
  assert.deepEqual(
    { ...CONDITIONS },
    {
      TASK_INVALID: 'task_invalid',
      SNAPSHOT_INVALID: 'snapshot_invalid',
      SKILL_TEXT_MISSING: 'skill_text_missing',
      FIXTURES_MISMATCH: 'fixtures_mismatch',
      START_PASSES: 'start_passes',
      REFERENCE_PASSES: 'reference_passes',
      WORK_BUDGET_EXHAUSTED: 'work_budget_exhausted',
    },
  );
  assert.deepEqual(
    { ...WARNINGS },
    {
      START_FAILS: 'start_fails',
      UNEARNED_CHECKS: 'unearned_checks',
      DUPLICATE_CHECKS: 'duplicate_checks',
      TRESPASS_FAILS: 'trespass_fails',
      NO_REFERENCE: 'no_reference',
      LITERAL_IN_REQUEST: 'literal_in_request',
      STAY_OUT_TASK: 'stay_out_task',
    },
  );
});

// --- A sound task -----------------------------------------------------------------------------

test('a sound task passes every gate and draws no warning', () => {
  const report = lintTask(loadTask('sound'), SNAPSHOTS);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.ok, true);
});

test('the report carries the per-check results for each workspace', () => {
  const { results } = lintTask(loadTask('sound'), SNAPSHOTS);
  assert.deepEqual(Object.keys(results), ['start', 'reference']);
  // The checks are file_exists, two contains, fixture_unchanged and a file_absent on the draft.
  assert.deepEqual(results.start.map((r) => r.passed), [false, false, false, true, false]);
  assert.deepEqual(results.reference.map((r) => r.passed), [true, true, true, true, true]);
});

test('the lint is repeatable and changes none of its inputs', () => {
  const task = deepFreeze(loadTask('sound'));
  const snapshots = deepFreeze({ start: { ...SNAPSHOTS.start }, reference: { ...SNAPSHOTS.reference } });
  const first = lintTask(task, snapshots);
  const second = lintTask(task, snapshots);
  assert.equal(first.ok, true);
  assert.deepEqual(first, second);
});

// --- Start workspace: advice, not a gate -------------------------------------------------------

test('a task whose checks already pass at the start is ok and draws start_fails', () => {
  const report = lintTask(loadTask('start-passes'), SNAPSHOTS);
  assert.equal(report.ok, true);
  assert.deepEqual(report.failures, []);
  // start_fails already says that nothing needs work, so unearned_checks is not repeated.
  assert.deepEqual(warningCodes(report), [WARNINGS.START_FAILS]);
  assert.equal(
    report.warnings[0].message,
    'the starting workspace passes all 3 checks, so none of them can separate an arm that did the work from one that did not',
  );
});

test('a task with no checks is judged by its rubric alone and draws no warning about checks', () => {
  const task = { ...loadTask('sound'), checks: [] };
  const report = lintTask(task, SNAPSHOTS);
  assert.equal(report.ok, true);
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(report.results.start, []);
  const bare = lintTask(task, { start: SNAPSHOTS.start });
  assert.deepEqual(bare.warnings, []);
});

// --- Reference solution: a gate when given -----------------------------------------------------

test('a check the reference solution fails is reported as reference_passes and nothing else', () => {
  const report = lintTask(loadTask('reference-fails'), SNAPSHOTS);
  assert.equal(report.ok, false);
  assert.deepEqual(conditionsOf(report), [CONDITIONS.REFERENCE_PASSES]);
  assert.equal(
    report.failures[0].message,
    'the reference solution fails 1 of 4 checks: checks[2] contains CHANGELOG.md (no match)',
  );
});

test('a reference that is the untouched start fails reference_passes for every failing check', () => {
  const report = lintTask(loadTask('sound'), { ...SNAPSHOTS, reference: SNAPSHOTS.start });
  assert.deepEqual(conditionsOf(report), [CONDITIONS.REFERENCE_PASSES]);
  assert.match(report.failures[0].message, /^the reference solution fails 4 of 5 checks: /);
});

test('without a reference the lint warns no_reference and runs no reference gate', () => {
  for (const snapshots of [{ start: SNAPSHOTS.start }, { start: SNAPSHOTS.start, reference: null }, { start: SNAPSHOTS.start, reference: undefined }]) {
    const report = lintTask(loadTask('sound'), snapshots);
    assert.equal(report.ok, true);
    assert.deepEqual(warningCodes(report), [WARNINGS.NO_REFERENCE]);
    assert.equal(report.results.reference, null);
  }
});

test('a failure message lists at most the cap of checks and counts the rest', () => {
  const many = Array.from({ length: MAX_LISTED_CHECKS + 3 }, (_, i) => ({ type: 'contains', path: 'CHANGELOG.md', pattern: `absent${i}` }));
  const report = lintTask({ ...loadTask('sound'), checks: many }, SNAPSHOTS);
  const reference = report.failures.find((f) => f.condition === CONDITIONS.REFERENCE_PASSES);
  assert.match(reference.message, new RegExp(`fails ${many.length} of ${many.length} checks: `));
  assert.match(reference.message, /; and 3 more$/);
  assert.equal(reference.message.split('; ').length, MAX_LISTED_CHECKS + 1);
});

// --- What the lint no longer claims --------------------------------------------------------------

test('a task whose checks can all be passed by pasting visible text is ok: the lint makes no claim about workspaces that did not do the work', () => {
  const report = lintTask(loadTask('pasteable'), SNAPSHOTS);
  assert.equal(report.ok, true, JSON.stringify(report.failures));
  assert.deepEqual(report.failures, []);
  assert.deepEqual(Object.keys(report.results), ['start', 'reference']);
});

test('a caller-supplied stuffed snapshot is not read and draws no warning', () => {
  const expected = lintTask(loadTask('sound'), { start: SNAPSHOTS.start, reference: SNAPSHOTS.reference });
  for (const stuffed of [SNAPSHOTS.reference, SNAPSHOTS.start, {}, null, 'text']) {
    const report = lintTask(loadTask('sound'), { ...SNAPSHOTS, stuffed });
    assert.deepEqual(report, expected);
  }
});

// --- Order and independence ---------------------------------------------------------------------

test('gates are judged independently and listed in a fixed order', () => {
  const task = { ...loadTask('sound'), fixtures: ['NOTES.md'], checks: [{ type: 'file_exists', path: 'NOTES.md' }, { type: 'file_exists', path: 'GONE.md' }] };
  const report = lintTask(task, { start: SNAPSHOTS.start, reference: {} });
  assert.deepEqual(conditionsOf(report), [CONDITIONS.FIXTURES_MISMATCH, CONDITIONS.REFERENCE_PASSES]);
});

// --- fixture_unchanged uses the starting workspace as the baseline -----------------------------

test('fixture_unchanged compares the other workspaces to the start snapshot', () => {
  const task = { ...loadTask('sound'), checks: [{ type: 'fixture_unchanged', path: 'src' }, { type: 'file_exists', path: 'CHANGELOG.md' }] };
  const edited = { ...SNAPSHOTS.reference, 'src/flags.txt': 'edited' };
  const report = lintTask(task, { ...SNAPSHOTS, reference: edited });
  const reference = report.failures.find((f) => f.condition === CONDITIONS.REFERENCE_PASSES);
  assert.equal(reference.message, 'the reference solution fails 1 of 2 checks: checks[0] fixture_unchanged src (changed 1 ("src/flags.txt"))');
});

// --- Preconditions -----------------------------------------------------------------------------

test('an invalid task is reported as task_invalid and its checks are not evaluated', () => {
  const task = { ...loadTask('sound') };
  delete task.rubric;
  const report = lintTask(task, SNAPSHOTS);
  assert.equal(report.ok, false);
  assert.deepEqual(conditionsOf(report), [CONDITIONS.TASK_INVALID]);
  assert.equal(report.failures[0].message, 'the task is invalid: rubric: missing');
  assert.deepEqual(report.results, { start: null, reference: null });
});

test('a malformed check makes the task invalid instead of counting as a failed check', () => {
  const task = { ...loadTask('sound'), checks: [{ type: 'contains', path: 'CHANGELOG.md', pattern: '(' }] };
  const report = lintTask(task, SNAPSHOTS);
  assert.deepEqual(conditionsOf(report), [CONDITIONS.TASK_INVALID]);
  assert.match(report.failures[0].message, /checks\[0\]: pattern: is not a valid regular expression/);
});

test('a long list of task problems is cut at the cap', () => {
  const report = lintTask({}, SNAPSHOTS);
  assert.deepEqual(conditionsOf(report), [CONDITIONS.TASK_INVALID]);
  assert.match(report.failures[0].message, /; and 3 more$/);
});

test('options.skillText reaches the task validator', () => {
  const task = loadTask('sound');
  const skillText = `${task.rubric[0]} and more text to read`;
  const report = lintTask(task, SNAPSHOTS, { skillText });
  assert.deepEqual(conditionsOf(report), [CONDITIONS.TASK_INVALID]);
  assert.match(report.failures[0].message, /rubric\[0\]: quotes 6 or more consecutive words/);
});

test('a missing or non-object start or reference snapshot is reported by role as snapshot_invalid', () => {
  const task = loadTask('sound');
  for (const [snapshots, roles] of [
    [undefined, 'start'],
    [null, 'start'],
    [[], 'start'],
    [{ reference: SNAPSHOTS.reference }, 'start'],
    [{ ...SNAPSHOTS, start: [] }, 'start'],
    [{ ...SNAPSHOTS, reference: 'text' }, 'reference'],
    [{ ...SNAPSHOTS, reference: [] }, 'reference'],
    [{ start: 'x', reference: 'y' }, 'start, reference'],
  ]) {
    const report = lintTask(task, snapshots);
    assert.equal(report.ok, false);
    assert.deepEqual(report.failures, [
      { condition: CONDITIONS.SNAPSHOT_INVALID, message: `these workspace snapshots are missing or not plain objects: ${roles}` },
    ]);
    assert.deepEqual(report.results, { start: null, reference: null });
  }
});

test('hostile input is a failed lint, not a throw', () => {
  const task = loadTask('sound');
  const hostileTask = { ...task };
  Object.defineProperty(hostileTask, 'checks', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });
  const hostileSnapshots = { ...SNAPSHOTS };
  Object.defineProperty(hostileSnapshots, 'reference', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });
  const hostileOptions = {};
  Object.defineProperty(hostileOptions, 'skillText', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });
  for (const args of [[undefined, undefined], [null, null], ['task', 'snapshots'], [hostileTask, SNAPSHOTS], [task, hostileSnapshots]]) {
    const report = lintTask(...args);
    assert.equal(report.ok, false);
    assert.equal(report.failures.length, 1);
    assert.deepEqual(report.results, { start: null, reference: null });
  }
  const options = strictLintTask(task, SNAPSHOTS, hostileOptions);
  assert.equal(options.ok, false);
  assert.equal(options.failures.length, 1);
  assert.equal(lintTask(task, SNAPSHOTS, null).ok, true);
  assert.equal(lintTask(task, SNAPSHOTS, 'options').ok, true);
});
