// SPDX-License-Identifier: Apache-2.0
/**
 * `checkResultsFor` (checks.js): the word-check results of one arm, in the form a pair record
 * stores. One entry per check, in the task's order: true (passed), false (failed) or null (no
 * verdict). `fixture_unchanged` compares the final snapshot with the start snapshot it is given.
 * Run: node --test bench/test/check-results.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { MAX_CHECKS_PER_TASK, checkResultsFor, createBudget, evalChecks, withBudget } = require('../lib/checks');
const { pairInputs } = require('../lib/provenance');
const { openStore } = require('../lib/store');
const { makePair, tempDir } = require('./support/records');

const START = Object.freeze({ 'NOTES.md': 'Notes about the tool.\n', 'DRAFT.md': 'Draft entry, unfinished.\n' });

const CHECKS = Object.freeze([
  { type: 'file_exists', path: 'CHANGELOG.md' },
  { type: 'contains', path: 'CHANGELOG.md', pattern: 'dry-run flag' },
  { type: 'not_contains', path: 'CHANGELOG.md', pattern: 'TODO' },
  { type: 'fixture_unchanged', path: 'NOTES.md' },
  { type: 'file_absent', path: 'DRAFT.md' },
]);
const taskOf = (checks = CHECKS) => ({ id: 'toy-skill-core-1', checks });

const DONE = Object.freeze({ 'NOTES.md': START['NOTES.md'], 'CHANGELOG.md': '- Added the dry-run flag.\n' });
const NOTHING_DONE = START;

test('a workspace that did the work passes every check, in the order of the task', () => {
  assert.deepEqual(checkResultsFor(taskOf(), START, DONE), [true, true, true, true, true]);
});

test('a workspace that did nothing fails the checks that need work and passes the ones that do not', () => {
  // file_exists, contains and file_absent need work; not_contains on a missing file fails too,
  // because the check wants a file that exists; fixture_unchanged holds.
  assert.deepEqual(checkResultsFor(taskOf(), START, NOTHING_DONE), [false, false, false, true, false]);
});

test('each entry is a boolean or null, one per check, and equals what evalChecks says', () => {
  const finals = [DONE, NOTHING_DONE, { ...DONE, 'NOTES.md': 'changed\n' }, { ...DONE, 'CHANGELOG.md': 'TODO dry-run flag\n' }, {}];
  for (const final of finals) {
    const results = checkResultsFor(taskOf(), START, final);
    const direct = evalChecks(final, CHECKS, { pristine: START });
    assert.equal(results.length, CHECKS.length);
    assert.deepEqual(results, direct.map((r) => r.passed));
  }
});

test('fixture_unchanged reads the start side: the same final passes against one start and fails against another', () => {
  const task = taskOf([{ type: 'fixture_unchanged', path: 'NOTES.md' }]);
  const final = { 'NOTES.md': 'Notes about the tool.\n' };
  assert.deepEqual(checkResultsFor(task, { 'NOTES.md': 'Notes about the tool.\n' }, final), [true]);
  assert.deepEqual(checkResultsFor(task, { 'NOTES.md': 'Other notes.\n' }, final), [false]);
  assert.deepEqual(checkResultsFor(task, {}, final), [false], 'a path the start side does not hold is a failure');
});

test('fixture_unchanged fails when the final edits, deletes or adds under the path', () => {
  const task = taskOf([{ type: 'fixture_unchanged', path: 'NOTES.md' }]);
  assert.deepEqual(checkResultsFor(task, START, { 'NOTES.md': 'edited\n' }), [false]);
  assert.deepEqual(checkResultsFor(task, START, {}), [false]);
  const dir = taskOf([{ type: 'fixture_unchanged', path: 'src' }]);
  const start = { 'src/a.txt': 'a\n' };
  assert.deepEqual(checkResultsFor(dir, start, { 'src/a.txt': 'a\n' }), [true]);
  assert.deepEqual(checkResultsFor(dir, start, { 'src/a.txt': 'a\n', 'src/b.txt': 'b\n' }), [false]);
});

test('a fixture_unchanged check with no start snapshot gives no verdict, and the other checks still run', () => {
  const results = checkResultsFor(taskOf(), undefined, DONE);
  assert.deepEqual(results, [true, true, true, null, true]);
  assert.deepEqual(checkResultsFor(taskOf(), null, DONE), [true, true, true, null, true]);
});

test('a final snapshot that is not a plain object gives no verdict for any check', () => {
  for (const final of [undefined, null, 'text', 7, []]) {
    assert.deepEqual(checkResultsFor(taskOf(), START, final), CHECKS.map(() => null), String(final));
  }
});

test('a check the work budget did not let run is null, never false', () => {
  const task = taskOf([
    { type: 'contains', path: 'a.md', pattern: 'alpha beta' },
    { type: 'contains', path: 'a.md', pattern: 'gamma delta' },
    { type: 'contains', path: 'a.md', pattern: 'alpha' },
    { type: 'file_exists', path: 'a.md' },
  ]);
  const final = { 'a.md': 'alpha beta here' };
  assert.deepEqual(checkResultsFor(task, {}, final), [true, false, true, true], 'with a budget to spare');
  const stingy = withBudget(createBudget({ ms: 60000, runs: 3 }), () => checkResultsFor(task, {}, final));
  assert.equal(stingy.length, 4);
  assert.equal(stingy[3], true, 'a check that runs no pattern is not charged to the budget');
  assert.ok(stingy.slice(0, 3).includes(null), 'a pattern the budget cut off has no verdict');
  assert.ok(stingy.every((r, i) => r === null || r === [true, false, true, true][i]), 'no cut-off check turns into a failure');
});

test('a check past the ceiling on checks per task is null', () => {
  const checks = Array.from({ length: MAX_CHECKS_PER_TASK + 2 }, () => ({ type: 'file_exists', path: 'a.md' }));
  const results = checkResultsFor(taskOf(checks), {}, { 'a.md': 'x' });
  assert.equal(results.length, checks.length);
  assert.ok(results.slice(0, MAX_CHECKS_PER_TASK).every((r) => r === true));
  assert.deepEqual(results.slice(MAX_CHECKS_PER_TASK), [null, null]);
});

test('a malformed check is a failure of that check only', () => {
  const task = taskOf([{ type: 'file_exists', path: 'a.md' }, { type: 'unknown_kind', path: 'a.md' }, { type: 'file_exists', path: 'b.md' }]);
  assert.deepEqual(checkResultsFor(task, {}, { 'a.md': 'x' }), [true, false, false]);
});

test('a task with no checks, or none that can be read, gives an empty list', () => {
  for (const task of [taskOf([]), { id: 'x' }, { checks: 'nope' }, null, undefined, 'task']) {
    assert.deepEqual(checkResultsFor(task, START, DONE), [], String(task));
  }
});

test('it never throws, even when reading the task throws', () => {
  const hostile = new Proxy({}, { get() { throw new Error('boom'); } });
  assert.deepEqual(checkResultsFor(hostile, START, DONE), []);
  const hostileFinal = new Proxy({}, { get() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); } });
  const results = checkResultsFor(taskOf(), START, hostileFinal);
  assert.equal(results.length, CHECKS.length);
  assert.ok(results.every((r) => r === null || r === false));
});

test('it does not change the task or the snapshots, and gives the same list on a second call', () => {
  const task = JSON.parse(JSON.stringify(taskOf()));
  const start = JSON.parse(JSON.stringify(START));
  const final = JSON.parse(JSON.stringify(DONE));
  const first = checkResultsFor(task, start, final);
  assert.deepEqual(task, taskOf());
  assert.deepEqual(start, START);
  assert.deepEqual(final, DONE);
  assert.deepEqual(checkResultsFor(task, start, final), first);
});

test('the list is what a pair record stores: the store keeps it and the pair digest covers it', (t) => {
  const results = checkResultsFor(taskOf(), START, { ...DONE, 'CHANGELOG.md': 'TODO\n' });
  assert.deepEqual(results, [true, false, false, true, true]);
  const store = openStore(tempDir(t));
  store.writePair(makePair({ taskId: 'task-1', arm: 'with', checkResults: results }));
  assert.deepEqual(store.readPair('toy-skill', 'task-1', 'with').check_results, results);
  const args = { taskId: 'task-1', arm: 'with', request: 'Add a flag.', runnerFingerprint: 'replay-runner@1', answer: 'Done.', start: {}, final: {}, loaded: true };
  assert.notEqual(pairInputs({ ...args, checkResults: results }).pair_input_sha256, pairInputs({ ...args, checkResults: [true, true, false, true, true] }).pair_input_sha256);
  const withNull = checkResultsFor(taskOf(), undefined, DONE);
  store.writePair(makePair({ taskId: 'task-2', arm: 'with', checkResults: withNull }));
  assert.deepEqual(store.readPair('toy-skill', 'task-2', 'with').check_results, withNull);
});
