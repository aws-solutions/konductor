// SPDX-License-Identifier: Apache-2.0
/**
 * One test per row of the task lint's table of conditions: whether it is a gate (it fails the
 * lint), a warning (advice, `ok` stays true) or gone (no code path can report it).
 *
 *   gate:     task_invalid, snapshot_invalid, skill_text_missing, fixtures_mismatch, start_passes,
 *             reference_passes (when a reference is given), skill_only_wording, work_budget_exhausted
 *   warning:  start_fails, unearned_checks, duplicate_checks, trespass_fails, no_reference
 *             (reference_passes when none is given), stay_out_task, literal_in_request
 *   gone:     cheater_fails, cheater_search_incomplete, unattackable_checks, stuffed_ignored
 *
 * Run: node --test bench/test/task-lint-table.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lint = require('../lib/task-lint');
const { CONDITIONS, WARNINGS, lintTask } = lint;
const { createBudget } = require('../lib/checks');
const { HIDDEN_FROM_SUBJECT } = require('../lib/hidden-fields');

const SKILL_TEXT = '## Recording a change\n\nHow to record a change in the changelog.\n';
const OPTIONS = { skillText: SKILL_TEXT };
const START = { 'NOTES.md': 'Notes about the tool.\n', 'DRAFT.md': 'Draft entry, unfinished.\n' };
const REFERENCE = { 'NOTES.md': START['NOTES.md'], 'CHANGELOG.md': '# Changelog\n\n- Added --dry-run.\n- It writes nothing.\n' };
const DRAFT_GONE = { type: 'file_absent', path: 'DRAFT.md' };

function makeTask(overrides = {}) {
  return {
    id: 'release-notes-core-table',
    skill: 'release-notes',
    kind: 'core',
    task: 'Add an entry for the new flag to CHANGELOG.md under Unreleased.',
    rubric: ['The entry says what the flag does.', 'The entry says how to run without it.', 'The notes are left as they were.'],
    target_section: 'Recording a change',
    fixtures: ['NOTES.md', 'DRAFT.md'],
    checks: [{ type: 'file_exists', path: 'CHANGELOG.md' }, { type: 'contains', path: 'CHANGELOG.md', pattern: '--dry-run' }, DRAFT_GONE],
    ...overrides,
  };
}

const STAY_OUT = [
  { type: 'file_absent', path: 'CHANGELOG.md' },
  { type: 'fixture_unchanged', path: 'NOTES.md' },
  { type: 'not_contains', path: 'NOTES.md', pattern: 'TODO' },
];

const gates = (report) => report.failures.map((f) => f.condition);
const warns = (report) => report.warnings.map((w) => w.code);

test('control: the base task is clean', () => {
  const report = lintTask(makeTask(), { start: START, reference: REFERENCE }, OPTIONS);
  assert.deepEqual(gates(report), []);
  assert.deepEqual(warns(report), []);
});

// --- gates ---------------------------------------------------------------------------------------

test('task_invalid is a gate', () => {
  const report = lintTask(makeTask({ rubric: [] }), { start: START, reference: REFERENCE }, OPTIONS);
  assert.equal(report.ok, false);
  assert.deepEqual(gates(report), [CONDITIONS.TASK_INVALID]);
});

test('snapshot_invalid is a gate', () => {
  const report = lintTask(makeTask(), { start: 'not a snapshot', reference: REFERENCE }, OPTIONS);
  assert.equal(report.ok, false);
  assert.deepEqual(gates(report), [CONDITIONS.SNAPSHOT_INVALID]);
});

test('skill_text_missing is a gate', () => {
  const report = lintTask(makeTask(), { start: START, reference: REFERENCE }, {});
  assert.equal(report.ok, false);
  assert.deepEqual(gates(report), [CONDITIONS.SKILL_TEXT_MISSING]);
});

test('fixtures_mismatch is a gate', () => {
  const report = lintTask(makeTask({ fixtures: ['NOTES.md'] }), { start: START, reference: REFERENCE }, OPTIONS);
  assert.equal(report.ok, false);
  assert.deepEqual(gates(report), [CONDITIONS.FIXTURES_MISMATCH]);
});

test('start_passes is a gate for a stay-out task', () => {
  const task = makeTask({ kind: 'near-miss', task: 'Tidy the notes without starting a release.', checks: STAY_OUT });
  const start = { ...START, 'CHANGELOG.md': 'already here' };
  const report = lintTask({ ...task, fixtures: ['NOTES.md', 'DRAFT.md', 'CHANGELOG.md'] }, { start, reference: START }, OPTIONS);
  assert.equal(report.ok, false);
  assert.ok(gates(report).includes(CONDITIONS.START_PASSES));
});

test('reference_passes is a gate when a reference is given', () => {
  const report = lintTask(makeTask(), { start: START, reference: START }, OPTIONS);
  assert.equal(report.ok, false);
  assert.deepEqual(gates(report), [CONDITIONS.REFERENCE_PASSES]);
});

test('skill_only_wording is a gate', () => {
  const skillText = `${SKILL_TEXT}\nEnd every entry with the line: Reviewed by the release desk.\n`;
  const checks = [...makeTask().checks, { type: 'contains', path: 'CHANGELOG.md', pattern: 'Reviewed by the release desk' }];
  const report = lintTask(makeTask({ checks }), { start: START, reference: { ...REFERENCE, 'CHANGELOG.md': 'Reviewed by the release desk\n--dry-run\n' } }, { skillText });
  assert.equal(report.ok, false);
  assert.deepEqual(gates(report), [CONDITIONS.SKILL_ONLY_WORDING]);
});

test('work_budget_exhausted is a gate', () => {
  const stingy = createBudget({ ms: 60000, runs: 3 });
  const report = lintTask(makeTask(), { start: START, reference: REFERENCE }, { ...OPTIONS, budget: stingy });
  assert.equal(report.ok, false);
  assert.ok(gates(report).includes(CONDITIONS.WORK_BUDGET_EXHAUSTED), JSON.stringify(report.failures));
});

// --- warnings ------------------------------------------------------------------------------------

test('start_fails is a warning', () => {
  const task = makeTask({ checks: [{ type: 'file_exists', path: 'NOTES.md' }, { type: 'fixture_unchanged', path: 'NOTES.md' }] });
  const report = lintTask(task, { start: START, reference: START }, OPTIONS);
  assert.equal(report.ok, true);
  assert.deepEqual(warns(report), [WARNINGS.START_FAILS]);
});

test('unearned_checks is a warning', () => {
  const dead = Array.from({ length: 3 }, (_, i) => ({ type: 'not_contains', path: 'NOTES.md', pattern: `forbidden${i}` }));
  const task = makeTask({ checks: [...dead, { type: 'file_exists', path: 'CHANGELOG.md' }] });
  const report = lintTask(task, { start: START, reference: REFERENCE }, OPTIONS);
  assert.equal(report.ok, true);
  assert.deepEqual(warns(report), [WARNINGS.UNEARNED_CHECKS]);
});

test('duplicate_checks is a warning', () => {
  const task = makeTask({ checks: [...makeTask().checks, { type: 'contains', path: 'CHANGELOG.md', pattern: '--DRY-RUN' }] });
  const report = lintTask(task, { start: START, reference: REFERENCE }, OPTIONS);
  assert.equal(report.ok, true);
  assert.deepEqual(warns(report), [WARNINGS.DUPLICATE_CHECKS]);
});

test('trespass_fails is a warning', () => {
  const checks = [...STAY_OUT.slice(0, 2), { type: 'not_contains', path: 'NOTES.md', pattern: 'note [\\u4e00-\\u9fff]{2}' }];
  const task = makeTask({ kind: 'near-miss', task: 'Tidy the notes without starting a release.', checks });
  const report = lintTask(task, { start: START, reference: START }, OPTIONS);
  assert.equal(report.ok, true, JSON.stringify(report.failures));
  assert.ok(warns(report).includes(WARNINGS.TRESPASS_FAILS), JSON.stringify(report.warnings));
});

test('reference_passes is only a warning, no_reference, when no reference is given', () => {
  const report = lintTask(makeTask(), { start: START }, OPTIONS);
  assert.equal(report.ok, true);
  assert.deepEqual(warns(report), [WARNINGS.NO_REFERENCE]);
  assert.equal(report.results.reference, null);
});

test('stay_out_task is a warning', () => {
  const task = makeTask({ kind: 'near-miss', task: 'Tidy the notes without starting a release.', checks: STAY_OUT });
  const report = lintTask(task, { start: START, reference: START }, OPTIONS);
  assert.equal(report.ok, true);
  assert.deepEqual(warns(report), [WARNINGS.STAY_OUT_TASK]);
});

test('literal_in_request is a warning', () => {
  const task = makeTask({ task: 'Add an entry for the --dry-run flag to CHANGELOG.md.' });
  const report = lintTask(task, { start: START, reference: REFERENCE }, OPTIONS);
  assert.equal(report.ok, true);
  assert.deepEqual(warns(report), [WARNINGS.LITERAL_IN_REQUEST]);
});

// --- gone ----------------------------------------------------------------------------------------

test('cheater_fails, cheater_search_incomplete and unattackable_checks are gone', () => {
  for (const name of ['CHEATER_FAILS', 'CHEATER_SEARCH_INCOMPLETE', 'UNATTACKABLE_CHECKS']) {
    assert.equal(Object.hasOwn(CONDITIONS, name), false, name);
  }
  const codes = [...Object.values(CONDITIONS), ...Object.values(WARNINGS)];
  for (const code of ['cheater_fails', 'cheater_search_incomplete', 'unattackable_checks', 'stuffed_ignored']) {
    assert.equal(codes.includes(code), false, code);
  }
  // A task whose every check is satisfied by text the request or the start files already hold: nothing rejects it.
  const task = makeTask({
    task: 'Add an entry for the --dry-run flag to CHANGELOG.md. It writes nothing.',
    checks: [{ type: 'contains', path: 'CHANGELOG.md', pattern: '--dry-run' }, { type: 'contains', path: 'CHANGELOG.md', pattern: 'writes nothing' }],
  });
  const report = lintTask(task, { start: START, reference: REFERENCE }, OPTIONS);
  assert.equal(report.ok, true);
  assert.deepEqual(Object.keys(report.results), ['start', 'reference']);
});

test('the attacker registry and the cheater builders are gone from the module', () => {
  assert.deepEqual(
    Object.keys(lint).sort(),
    ['CONDITIONS', 'EARNED_KINDS', 'MAX_LISTED_CHECKS', 'MAX_SNAPSHOT_CHARS', 'MAX_SNAPSHOT_FILES', 'MAX_SNAPSHOT_FILE_CHARS', 'MIN_EARNED_SHARE', 'REQUIRED_ROLES', 'ROLES', 'SKILL_ONLY_WORDING_VERSION', 'STAY_OUT_KINDS', 'WARNINGS', 'lintTask'],
  );
  assert.equal(Object.hasOwn(lint, 'MIN_RESISTED_SHARE'), false);
});

test('stuffed_ignored is gone: a stuffed snapshot is not read and draws no warning', () => {
  const task = makeTask();
  const plain = lintTask(task, { start: START, reference: REFERENCE }, OPTIONS);
  const withStuffed = lintTask(task, { start: START, reference: REFERENCE, stuffed: START }, OPTIONS);
  assert.deepEqual(withStuffed, plain);
});

// --- HIDDEN_FROM_SUBJECT -------------------------------------------------------------------------

test('HIDDEN_FROM_SUBJECT lists the fields a runner must never show the subject, and is frozen', () => {
  assert.deepEqual([...HIDDEN_FROM_SUBJECT], ['checks', 'rubric', 'reference']);
  assert.ok(Object.isFrozen(HIDDEN_FROM_SUBJECT));
  assert.throws(() => {
    'use strict';
    HIDDEN_FROM_SUBJECT.push('task');
  }, TypeError);
});

// --- Nothing of the dropped search is left under bench/ --------------------------------------------

const BENCH_DIR = path.join(__dirname, '..');
// Built from fragments so that this file does not contain the names it looks for.
const DROPPED = [['cheater', 'search'].join('-'), ['visible', 'moves'].join('-')];

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

test('no file under bench/ requires or mentions the dropped search modules, and neither module exists', () => {
  const files = filesUnder(BENCH_DIR);
  for (const name of DROPPED) {
    assert.equal(files.some((file) => path.basename(file).startsWith(name)), false, `a file named ${name} exists`);
  }
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const name of DROPPED) assert.equal(text.includes(name), false, `${path.relative(BENCH_DIR, file)} mentions ${name}`);
  }
});

test('no library module claims anything about a cheater', () => {
  const lib = path.join(BENCH_DIR, 'lib');
  for (const file of fs.readdirSync(lib).filter((name) => name.endsWith('.js'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(lib, file), 'utf8'), /cheat/i, file);
  }
});
