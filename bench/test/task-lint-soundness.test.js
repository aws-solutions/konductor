// SPDX-License-Identifier: Apache-2.0
/**
 * Soundness tests for the task lint
 *
 * Each test encodes a concrete fault: a task or a start workspace that would mislead a run or
 * hide a wrong check. The tests build their snapshots inline so that each fault reads in one
 * place. Advice shows up as a warning with `ok: true`; a wrong task or a wrong reference is a gate.
 *
 * `min_matches` is not a check kind, so the check that adding words cannot satisfy is a
 * `file_absent` on a draft file that the start workspace holds and that the work must delete.
 * See task-lint-failclosed.test.js for the hangs and the validity rules.
 *
 * Run: node --test bench/test/task-lint-soundness.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CONDITIONS, WARNINGS, MIN_EARNED_SHARE, lintTask: strictLintTask } = require('../lib/task-lint');
const { withSkillText } = require('./helpers/skill-text');

// `lintTask` refuses to run without options.skillText. These tests are about other rules, so they
// call it through the helper that supplies a minimal skill text; see helpers/skill-text.js.
const lintTask = withSkillText(strictLintTask);
const { loadSnapshot } = require('../lib/snapshot-loader');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'tasks');

function loadTask(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, `${name}.task.json`), 'utf8'));
}

function loadSnap(role) {
  return loadSnapshot(path.join(FIXTURES_DIR, 'snapshots', role));
}

/** The one check kind that adding words cannot satisfy: delete the draft the start workspace holds. */
const DRAFT_GONE = { type: 'file_absent', path: 'DRAFT.md' };

function makeTask(overrides = {}) {
  return {
    id: 'release-notes-core-soundness',
    skill: 'release-notes',
    kind: 'core',
    task: 'Add an entry for the new flag to CHANGELOG.md under Unreleased.',
    rubric: ['The entry says what the flag does.', 'The entry says how to run without it.', 'The notes are left as they were.'],
    target_section: 'Recording a change',
    fixtures: ['NOTES.md', 'DRAFT.md'],
    checks: [
      { type: 'file_exists', path: 'CHANGELOG.md' },
      { type: 'contains', path: 'CHANGELOG.md', pattern: '--dry-run' },
      DRAFT_GONE,
    ],
    ...overrides,
  };
}

// Tests that assert the exact warning list supply the skill text, because leaving it out is
// itself a failure (skill_text_missing). The heading is the one makeTask() names as its target.
const SKILL_OPTIONS = { skillText: '## Recording a change\n\nHow to record a change in the changelog.\n' };

const START = { 'NOTES.md': 'Notes about the tool.\n', 'DRAFT.md': 'Draft entry, unfinished.\n' };
const REFERENCE = { 'NOTES.md': START['NOTES.md'], 'CHANGELOG.md': '# Changelog\n\n- Added --dry-run.\n- It writes nothing.\n' };

function conditionsOf(report) {
  return report.failures.map((f) => f.condition);
}

function failureOf(report, condition) {
  return report.failures.find((f) => f.condition === condition);
}

function warningOf(report, code) {
  return report.warnings.find((w) => w.code === code);
}

test('control: the base task used below is clean, so each result is caused by the fault', () => {
  const report = lintTask(makeTask(), { start: START, reference: REFERENCE }, SKILL_OPTIONS);
  assert.deepEqual(report.failures, []);
  assert.equal(report.ok, true);
  assert.deepEqual(report.warnings, []);
});

// --- A pattern nobody can satisfy ----------------------------------------------------------------

// A class of CJK ideographs: valid, two characters long, and outside the alphabet the witness builder draws from.
// The class alone has no literal text and is an invalid pattern, so the literal `note ` comes first;
// the class after it is still one no candidate text can fill.
const UNBUILDABLE = 'note [\\u4e00-\\u9fff]{2}';
// A negative must share a 3-character fragment with the pattern's words, so they start with `note`.
const UNBUILDABLE_NEGATIVES = ['note about plain ascii words', 'noted as another plain line'];

test('a contains pattern that nothing satisfies fails reference_passes, because the right answer fails it too', () => {
  const impossible = { type: 'contains', path: 'CHANGELOG.md', pattern: UNBUILDABLE, negatives: UNBUILDABLE_NEGATIVES };
  const report = lintTask(makeTask({ checks: [...makeTask().checks, impossible] }), { start: START, reference: REFERENCE });
  assert.equal(report.ok, false);
  assert.deepEqual(conditionsOf(report), [CONDITIONS.REFERENCE_PASSES]);
});

// --- fixtures ------------------------------------------------------------------------------------

test('task.fixtures that name a file the start snapshot lacks are a failure', () => {
  const report = lintTask(makeTask({ fixtures: ['NOTES.md', 'DRAFT.md', 'src/flags.txt'] }), { start: START, reference: REFERENCE });
  assert.deepEqual(conditionsOf(report), [CONDITIONS.FIXTURES_MISMATCH]);
  assert.equal(
    report.failures[0].message,
    'task.fixtures and the start snapshot disagree; declared but not in the start snapshot: src/flags.txt',
  );
});

test('a start snapshot that holds a file task.fixtures does not declare is a failure', () => {
  const start = { ...START, 'SECRET-ANSWER.md': 'the reference solution' };
  const report = lintTask(makeTask(), { start, reference: { ...REFERENCE, 'SECRET-ANSWER.md': 'the reference solution' } });
  assert.deepEqual(conditionsOf(report), [CONDITIONS.FIXTURES_MISMATCH]);
  assert.match(report.failures[0].message, /in the start snapshot but not declared: SECRET-ANSWER\.md$/);
});

test('both directions of the fixtures mismatch are reported together', () => {
  const start = { 'OTHER.md': 'x' };
  const report = lintTask(makeTask(), { start, reference: REFERENCE });
  assert.equal(
    failureOf(report, CONDITIONS.FIXTURES_MISMATCH).message,
    'task.fixtures and the start snapshot disagree; declared but not in the start snapshot: NOTES.md; DRAFT.md; in the start snapshot but not declared: OTHER.md',
  );
});

test('a fixtures entry may name a directory that covers the files under it', () => {
  const start = { 'src/a.txt': 'a', 'src/deep/b.txt': 'b', 'NOTES.md': 'n' };
  const report = lintTask(makeTask({ fixtures: ['src', 'NOTES.md'] }), { start, reference: { ...start, ...REFERENCE } });
  assert.equal(failureOf(report, CONDITIONS.FIXTURES_MISMATCH), undefined);
});

test('the sound fixture task still matches its start snapshot', () => {
  const report = lintTask(loadTask('sound'), { start: loadSnap('start'), reference: loadSnap('reference') });
  assert.equal(failureOf(report, CONDITIONS.FIXTURES_MISMATCH), undefined);
  assert.equal(report.ok, true);
});

// --- Wording already in the request --------------------------------------------------------------

// Wording that the request does not hold, to sit beside a quoted literal.
const HIDDEN = { type: 'contains', path: 'CHANGELOG.md', pattern: 'writes nothing' };

test('a contains literal that already appears in the request text is a warning', () => {
  const task = makeTask({ task: 'Add an entry for the --dry-run flag to CHANGELOG.md.', checks: [...makeTask().checks, HIDDEN] });
  const report = lintTask(task, { start: START, reference: REFERENCE }, SKILL_OPTIONS);
  assert.equal(report.ok, true, JSON.stringify(report.failures));
  assert.deepEqual(report.warnings, [
    {
      code: WARNINGS.LITERAL_IN_REQUEST,
      message:
        'these patterns match wording that is already in the task request, so a subject can pass them by quoting it: checks[1] contains CHANGELOG.md',
    },
  ]);
});

test('a task whose every literal is in the request is still ok: quoting the request is advice, not a gate', () => {
  const task = makeTask({ task: 'Add an entry for the --dry-run flag to CHANGELOG.md.' });
  const report = lintTask(task, { start: START, reference: REFERENCE }, SKILL_OPTIONS);
  assert.equal(report.ok, true);
  assert.deepEqual(report.warnings.map((w) => w.code), [WARNINGS.LITERAL_IN_REQUEST]);
});

test('a task whose checks are all satisfied by the request text itself is ok with the warning', () => {
  const task = makeTask({
    task: 'Add the --dry-run flag to CHANGELOG.md. The --dry-run flag prints the planned changes.',
    checks: [
      { type: 'file_exists', path: 'CHANGELOG.md' },
      { type: 'contains', path: 'CHANGELOG.md', pattern: '--dry-run' },
      { type: 'contains', path: 'CHANGELOG.md', pattern: 'prints the planned changes' },
    ],
  });
  const reference = { ...REFERENCE, 'CHANGELOG.md': 'Added --dry-run. The --dry-run flag prints the planned changes.\n' };
  const report = lintTask(task, { start: START, reference });
  assert.equal(report.ok, true);
  assert.deepEqual(report.warnings.map((w) => w.code), [WARNINGS.LITERAL_IN_REQUEST]);
  assert.match(report.warnings[0].message, /checks\[1\] contains CHANGELOG\.md; checks\[2\] contains CHANGELOG\.md$/);
});

test('a pattern the request text does not match raises no warning', () => {
  const report = lintTask(makeTask(), { start: START, reference: REFERENCE }, SKILL_OPTIONS);
  assert.deepEqual(report.warnings, []);
});

test('the warning also catches a tolerant pattern that matches the request wording', () => {
  const task = makeTask({
    task: 'Say that the change was rolled back in CHANGELOG.md.',
    checks: [
      { type: 'contains', path: 'CHANGELOG.md', pattern: 'roll(s|ed)? back', negatives: ['we never roll forward', 'the roll of the dice'] },
      DRAFT_GONE,
    ],
  });
  const reference = { ...REFERENCE, 'CHANGELOG.md': '- The change was rolled back.\n- Nothing else.\n' };
  const report = lintTask(task, { start: START, reference });
  assert.equal(report.warnings[0].code, WARNINGS.LITERAL_IN_REQUEST);
});

// --- Idle and duplicate checks ---------------------------------------------------------------------

test('nine not_contains checks plus one file_exists draw unearned_checks, and the lint is still ok', () => {
  const dead = Array.from({ length: 9 }, (_, i) => ({ type: 'not_contains', path: 'NOTES.md', pattern: `forbidden${i}` }));
  const task = makeTask({ checks: [...dead, { type: 'file_exists', path: 'CHANGELOG.md' }] });
  const report = lintTask(task, { start: START, reference: REFERENCE });
  assert.equal(report.ok, true);
  const unearned = warningOf(report, WARNINGS.UNEARNED_CHECKS);
  assert.ok(unearned, JSON.stringify(report.warnings));
  assert.match(unearned.message, /^only 1 of 10 checks need work to pass \(10%\), and at least 50% should; an untouched workspace already satisfies: /);
  assert.equal(report.results.start.filter((r) => r.passed).length, 9);
});

test('not_contains checks on a missing output file fail at the start but are still not earned', () => {
  const dead = Array.from({ length: 9 }, (_, i) => ({ type: 'not_contains', path: 'CHANGELOG.md', pattern: `forbidden${i}` }));
  const task = makeTask({ checks: [...dead, { type: 'contains', path: 'CHANGELOG.md', pattern: '--dry-run' }] });
  const report = lintTask(task, { start: START, reference: { ...START, 'CHANGELOG.md': 'Added --dry-run.' } });
  assert.equal(report.results.start.every((r) => !r.passed), true);
  assert.match(warningOf(report, WARNINGS.UNEARNED_CHECKS).message, /^only 1 of 10 checks need work to pass \(10%\)/);
});

test('the earned share is a floor of one half, met exactly and missed by one check', () => {
  assert.equal(MIN_EARNED_SHARE, 0.5);
  const guards = [
    { type: 'not_contains', path: 'CHANGELOG.md', pattern: 'TODO' },
    { type: 'fixture_unchanged', path: 'NOTES.md' },
  ];
  const earned = [
    { type: 'contains', path: 'CHANGELOG.md', pattern: '--dry-run' },
    DRAFT_GONE,
  ];
  const half = lintTask(makeTask({ checks: [...earned, ...guards] }), { start: START, reference: REFERENCE });
  assert.equal(warningOf(half, WARNINGS.UNEARNED_CHECKS), undefined);
  const below = lintTask(makeTask({ checks: [earned[0], ...guards] }), { start: START, reference: REFERENCE });
  assert.match(warningOf(below, WARNINGS.UNEARNED_CHECKS).message, /^only 1 of 3 checks need work to pass \(33%\)/);
  assert.equal(below.ok, true);
});

test('the largest task the check ceiling allows, made of identical checks, is one check, and the lint warns', () => {
  // 29 copies and one other check: the largest task the ceiling allows (MAX_CHECKS_PER_TASK is 30).
  const same = { type: 'contains', path: 'CHANGELOG.md', pattern: '--dry-run' };
  const task = makeTask({ checks: [...Array.from({ length: 29 }, () => ({ ...same })), DRAFT_GONE] });
  const report = lintTask(task, { start: START, reference: REFERENCE }, SKILL_OPTIONS);
  assert.equal(report.ok, true);
  const duplicate = warningOf(report, WARNINGS.DUPLICATE_CHECKS);
  assert.match(duplicate.message, /^the task repeats a check, which counts one measurement more than once in the word-check share: checks\[1\] contains CHANGELOG\.md repeats checks\[0\]; /);
  assert.match(duplicate.message, /; and 23 more$/);
});

test('a repeat is recognised whatever the key order or the negatives', () => {
  const task = makeTask({
    checks: [
      { type: 'file_absent', path: 'DRAFT.md' },
      { path: 'DRAFT.md', type: 'file_absent' },
      { type: 'contains', path: 'CHANGELOG.md', pattern: 'roll(s|ed)? back', negatives: ['we never roll forward', 'the roll of the dice'] },
      { type: 'contains', path: 'CHANGELOG.md', pattern: 'roll(s|ed)? back', negatives: ['rolling forward again', 'a roll call'] },
    ],
  });
  const report = lintTask(task, { start: START, reference: { ...REFERENCE, 'CHANGELOG.md': '- rolled back\n- and again\n- third\n' } });
  const message = warningOf(report, WARNINGS.DUPLICATE_CHECKS).message;
  assert.match(message, /checks\[1\] file_absent DRAFT\.md repeats checks\[0\]; checks\[3\] contains CHANGELOG\.md repeats checks\[2\]$/);
});

test('the same pattern on a different path, or a different kind, is not a repeat', () => {
  const task = makeTask({
    checks: [
      { type: 'contains', path: 'CHANGELOG.md', pattern: '--dry-run' },
      { type: 'contains', path: 'NOTES.md', pattern: '--dry-run' },
      { type: 'not_contains', path: 'CHANGELOG.md', pattern: '--dry-run' },
      DRAFT_GONE,
    ],
  });
  const report = lintTask(task, { start: START, reference: { 'NOTES.md': '--dry-run' } });
  assert.equal(warningOf(report, WARNINGS.DUPLICATE_CHECKS), undefined);
});

// --- file_exists and contains on one path are one measurement ----------------------------------

test('a file_exists beside a contains on the same path is counted once for the earned share', () => {
  const guards = [
    { type: 'not_contains', path: 'NOTES.md', pattern: 'forbidden one' },
    { type: 'not_contains', path: 'NOTES.md', pattern: 'forbidden two' },
  ];
  const checks = [...guards, { type: 'file_exists', path: 'CHANGELOG.md' }, { type: 'contains', path: 'CHANGELOG.md', pattern: '--dry-run' }];
  const report = lintTask(makeTask({ checks }), { start: START, reference: REFERENCE }, SKILL_OPTIONS);
  const unearned = warningOf(report, WARNINGS.UNEARNED_CHECKS);
  assert.ok(unearned, JSON.stringify(report.warnings));
  assert.match(unearned.message, /^only 1 of 3 checks need work to pass \(33%\), and at least 50% should; /);
  assert.match(unearned.message, /; 1 file_exists check on a path that a contains check also reads was counted once, with that check$/);
});

test('only a contains on the path subsumes the file_exists; a not_contains does not', () => {
  const checks = [
    { type: 'not_contains', path: 'NOTES.md', pattern: 'forbidden one' },
    { type: 'not_contains', path: 'NOTES.md', pattern: 'forbidden two' },
    { type: 'file_exists', path: 'CHANGELOG.md' },
    { type: 'not_contains', path: 'CHANGELOG.md', pattern: 'forbidden three' },
  ];
  const report = lintTask(makeTask({ checks }), { start: START, reference: { ...REFERENCE, 'CHANGELOG.md': 'clean entry' } }, SKILL_OPTIONS);
  const unearned = warningOf(report, WARNINGS.UNEARNED_CHECKS);
  assert.match(unearned.message, /^only 1 of 4 checks need work to pass \(25%\)/);
  assert.doesNotMatch(unearned.message, /counted once/);
});

test('a file_exists on a path no other check reads is still counted', () => {
  const checks = [
    { type: 'not_contains', path: 'NOTES.md', pattern: 'forbidden one' },
    { type: 'file_exists', path: 'CHANGELOG.md' },
    { type: 'contains', path: 'docs/OTHER.md', pattern: '--dry-run' },
  ];
  const reference = { ...REFERENCE, 'docs/OTHER.md': 'uses --dry-run' };
  const report = lintTask(makeTask({ checks, fixtures: ['NOTES.md'] }), { start: START, reference }, SKILL_OPTIONS);
  assert.equal(warningOf(report, WARNINGS.UNEARNED_CHECKS), undefined, JSON.stringify(report.warnings));
});

// --- Stay-out tasks ------------------------------------------------------------------------------

const STAY_OUT_CHECKS = [
  { type: 'file_absent', path: 'CHANGELOG.md' },
  { type: 'fixture_unchanged', path: 'NOTES.md' },
  { type: 'not_contains', path: 'NOTES.md', pattern: 'TODO' },
];

function stayOutTask(overrides = {}) {
  return makeTask({
    kind: 'near-miss',
    task: 'Tidy the project notes without starting a release.',
    checks: STAY_OUT_CHECKS,
    ...overrides,
  });
}

test('a near-miss task whose correct behavior is to touch nothing is ok', () => {
  const report = lintTask(stayOutTask(), { start: START, reference: START }, SKILL_OPTIONS);
  assert.deepEqual(report.failures, []);
  assert.equal(report.ok, true);
  assert.deepEqual(report.results.start.map((r) => r.passed), [true, true, true]);
  assert.deepEqual(report.results.trespass.map((r) => r.passed), [false, false, false]);
});

test('a stay-out task carries a warning that its score is not evidence of work', () => {
  const report = lintTask(stayOutTask(), { start: START, reference: START }, SKILL_OPTIONS);
  assert.deepEqual(report.warnings.map((w) => w.code), [WARNINGS.STAY_OUT_TASK]);
  assert.match(report.warnings[0].message, /untouched workspace passes every check by design/);
});

test('the trespass workspace breaks each rule: an extra file, an edited fixture, a forbidden line', () => {
  const report = lintTask(stayOutTask(), { start: START, reference: START }, SKILL_OPTIONS);
  assert.deepEqual(report.results.trespass.map((r) => r.detail), [
    'present ("CHANGELOG.md")',
    'changed 1 ("NOTES.md")',
    'matched',
  ]);
});

test('the same checks on a core task draw start_fails, not start_passes, and build no trespass workspace', () => {
  const report = lintTask(stayOutTask({ kind: 'core' }), { start: START, reference: START }, SKILL_OPTIONS);
  assert.equal(report.ok, true);
  assert.ok(warningOf(report, WARNINGS.START_FAILS), JSON.stringify(report.warnings));
  assert.equal(conditionsOf(report).includes(CONDITIONS.START_PASSES), false);
  assert.equal(report.results.trespass, undefined);
});

test('a near-miss label does not excuse nine idle checks and one file_exists', () => {
  const dead = Array.from({ length: 9 }, (_, i) => ({ type: 'not_contains', path: 'NOTES.md', pattern: `forbidden${i}` }));
  const task = makeTask({ kind: 'near-miss', checks: [...dead, { type: 'file_exists', path: 'CHANGELOG.md' }] });
  const report = lintTask(task, { start: START, reference: REFERENCE }, SKILL_OPTIONS);
  assert.match(warningOf(report, WARNINGS.UNEARNED_CHECKS).message, /^only 1 of 10 checks need work to pass \(10%\)/);
  assert.equal(warningOf(report, WARNINGS.STAY_OUT_TASK), undefined);
  assert.equal(report.results.trespass, undefined);
});

test('a stay-out check that the trespass cannot trip draws trespass_fails and does not fail the lint', () => {
  // A pattern that no text can satisfy forbids nothing, so the check would pass whatever the subject does.
  const checks = [...STAY_OUT_CHECKS.slice(0, 2), { type: 'not_contains', path: 'NOTES.md', pattern: UNBUILDABLE }];
  const report = lintTask(stayOutTask({ checks }), { start: START, reference: START }, SKILL_OPTIONS);
  assert.equal(report.ok, true, JSON.stringify(report.failures));
  assert.match(
    warningOf(report, WARNINGS.TRESPASS_FAILS).message,
    /^the rule could not be broken for checks\[2\] not_contains NOTES\.md, so they cannot be shown to guard anything \(no candidate text satisfies the pattern\); a workspace where the forbidden thing was done still passes 1 of 3 checks, so they cannot detect it: checks\[2\] not_contains NOTES\.md \(no match\)$/,
  );
});

test('a stay-out task whose start workspace already breaks a rule fails start_passes', () => {
  const start = { ...START, 'CHANGELOG.md': 'already here' };
  const report = lintTask(stayOutTask({ fixtures: ['NOTES.md', 'DRAFT.md', 'CHANGELOG.md'] }), { start, reference: START }, SKILL_OPTIONS);
  assert.ok(conditionsOf(report).includes(CONDITIONS.START_PASSES), JSON.stringify(report.failures));
  assert.match(failureOf(report, CONDITIONS.START_PASSES).message, /^the starting workspace fails 1 of 3 checks; in a stay-out task doing nothing is the correct answer.*checks\[0\] file_absent CHANGELOG\.md \(present/);
});

test('a stay-out reference that trespasses fails reference_passes', () => {
  const reference = { ...START, 'CHANGELOG.md': 'started a release anyway' };
  const report = lintTask(stayOutTask(), { start: START, reference }, SKILL_OPTIONS);
  assert.deepEqual(conditionsOf(report), [CONDITIONS.REFERENCE_PASSES]);
});

test('a stay-out task is not an escape from the duplicate rule', () => {
  const checks = [...STAY_OUT_CHECKS, { type: 'file_absent', path: 'CHANGELOG.md' }];
  const report = lintTask(stayOutTask({ checks }), { start: START, reference: START }, SKILL_OPTIONS);
  assert.equal(report.ok, true);
  assert.ok(warningOf(report, WARNINGS.DUPLICATE_CHECKS), JSON.stringify(report.warnings));
});

test('a mixed near-miss task, one that must also write something, takes the ordinary path', () => {
  const checks = [...STAY_OUT_CHECKS, { type: 'contains', path: 'NOTES.md', pattern: 'Tidied' }, DRAFT_GONE];
  const reference = { 'NOTES.md': 'Notes about the tool.\n- Tidied\n- again\n' };
  const report = lintTask(stayOutTask({ checks }), { start: START, reference }, SKILL_OPTIONS);
  assert.equal(report.results.trespass, undefined);
  assert.equal(conditionsOf(report).includes(CONDITIONS.START_PASSES), false);
  assert.equal(warningOf(report, WARNINGS.STAY_OUT_TASK), undefined);
});

test('file_absent counts as earned work only when the start workspace fails it', () => {
  // The file is present at the start, so removing it is work and the check is earned.
  const start = { ...START, 'OLD.md': 'stale' };
  const checks = [{ type: 'file_absent', path: 'OLD.md' }, { type: 'contains', path: 'NOTES.md', pattern: 'Tidied' }, DRAFT_GONE];
  const reference = { 'NOTES.md': 'Notes about the tool.\n- Tidied\n- again\n' };
  const report = lintTask(makeTask({ fixtures: ['NOTES.md', 'DRAFT.md', 'OLD.md'], checks }), { start, reference }, SKILL_OPTIONS);
  assert.equal(warningOf(report, WARNINGS.UNEARNED_CHECKS), undefined, JSON.stringify(report.warnings));
  assert.equal(report.results.start[0].passed, false);
});

// --- The skill text is required ------------------------------------------------------------------

test('a lint run without options.skillText is refused, not passed with a warning', () => {
  for (const options of [undefined, null, {}, { skillText: undefined }, { skillText: '' }, { skillText: '\u200b \u3164' }, 'text']) {
    const report = strictLintTask(makeTask(), { start: START, reference: REFERENCE }, options);
    assert.equal(report.ok, false, String(options));
    assert.deepEqual(report.failures.map((f) => f.condition), [CONDITIONS.SKILL_TEXT_MISSING], String(options));
    assert.match(report.failures[0].message, /^options\.skillText was not supplied \(or has no visible text\), so the rubric quoting rule and the target_section check cannot run/);
    assert.equal(report.results.start, null);
  }
});

test('supplying the skill text lints the task with no warning', () => {
  const report = strictLintTask(makeTask(), { start: START, reference: REFERENCE }, SKILL_OPTIONS);
  assert.equal(report.ok, true, JSON.stringify(report.failures));
  assert.deepEqual(report.warnings, []);
});
