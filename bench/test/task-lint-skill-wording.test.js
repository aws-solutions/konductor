// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for the skill_only_wording gate of the task lint.
 *
 * Everything both arms can see cancels in the with-minus-without gap. The skill text is the one
 * text only the with-skill arm holds, so a `contains` check whose wording is in the skill and in
 * neither the request nor a start file would let that arm pass by copying. The gate fails such a
 * check, unless the caller marks the skill as one whose wording is the point.
 *
 * Run: node --test bench/test/task-lint-skill-wording.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CONDITIONS, SKILL_ONLY_WORDING_VERSION, MAX_LISTED_CHECKS, lintTask } = require('../lib/task-lint');
const { CONTROLS, isSkillSpecific } = require('../lib/controls');
const { RUBRIC_QUOTE_WORDS } = require('../lib/task-schema');

const SKILL_BODY = [
  '## Recording a change',
  '',
  'Write an entry for each user-facing change.',
  'End every entry with the line: Reviewed by the release desk.',
  'Name the owner of the change, then say how a reader can undo it.',
  '',
].join('\n');
const SKILL = `# Changelog skill\n\n${SKILL_BODY}`;

const START = { 'NOTES.md': 'Notes about the tool.\n', 'DRAFT.md': 'Draft entry, unfinished.\n' };
const DRAFT_GONE = { type: 'file_absent', path: 'DRAFT.md' };

function makeTask(checks, overrides = {}) {
  return {
    id: 'release-notes-core-wording',
    skill: 'release-notes',
    kind: 'core',
    task: 'Add an entry for the new flag to CHANGELOG.md under Unreleased.',
    rubric: ['The entry says what the flag does.', 'The entry says how to run without it.', 'The notes are left as they were.'],
    target_section: 'Recording a change',
    fixtures: ['NOTES.md', 'DRAFT.md'],
    checks: [DRAFT_GONE, ...checks],
    ...overrides,
  };
}

/** A reference solution that satisfies every check, so reference_passes stays quiet. */
function referenceWith(changelog) {
  return { 'NOTES.md': START['NOTES.md'], 'CHANGELOG.md': changelog };
}

const SKILL_LINE = { type: 'contains', path: 'CHANGELOG.md', pattern: 'Reviewed by the release desk' };
const REFERENCE = referenceWith('- Added --dry-run.\nReviewed by the release desk.\n');

function lint(task, snapshots, options = {}) {
  return lintTask(task, snapshots, { skillText: SKILL, ...options });
}

function gates(report) {
  return report.failures.map((f) => f.condition);
}

test('control: a task whose checks use no skill wording is clean', () => {
  const report = lint(makeTask([{ type: 'file_exists', path: 'CHANGELOG.md' }]), { start: START });
  assert.deepEqual(gates(report), []);
});

test('wording that only the skill text holds fails, names the check and suggests the fix', () => {
  const report = lint(makeTask([SKILL_LINE]), { start: START, reference: REFERENCE });
  assert.equal(report.ok, false);
  assert.deepEqual(gates(report), [CONDITIONS.SKILL_ONLY_WORDING]);
  const message = report.failures[0].message;
  assert.match(message, /checks\[1\] contains CHANGELOG\.md \("Reviewed by the release desk"\)/);
  assert.match(message, /so the with-skill arm can pass them by copying the skill/);
  assert.match(message, /check structure that the request names, or drop the check, since the judge still scores that point$/);
});

test('the same wording also in the request passes', () => {
  const task = makeTask([SKILL_LINE], { task: 'Add an entry for the new flag to CHANGELOG.md and end it with Reviewed by the release desk.' });
  const report = lint(task, { start: START, reference: REFERENCE });
  assert.deepEqual(gates(report), []);
});

test('the same wording also in a start file passes', () => {
  const start = { ...START, 'NOTES.md': 'Every note ends with: reviewed by the release desk\n' };
  const report = lint(makeTask([SKILL_LINE]), { start, reference: { ...REFERENCE, 'NOTES.md': start['NOTES.md'] } });
  assert.deepEqual(gates(report), []);
});

test('the same wording in the path of a start file passes: the path is visible to both arms', () => {
  const start = { ...START, 'reviewed-by-the-release-desk.txt': 'x\n' };
  const task = makeTask([SKILL_LINE], { fixtures: ['NOTES.md', 'DRAFT.md', 'reviewed-by-the-release-desk.txt'] });
  const report = lint(task, { start, reference: { ...REFERENCE, 'reviewed-by-the-release-desk.txt': 'x\n' } });
  assert.deepEqual(gates(report), []);
});

test('a skill marked skill_specific is exempt, and the flag comes from the control manifest', () => {
  const keep = CONTROLS.find((control) => control.id === 'keep');
  const prune = CONTROLS.find((control) => control.id === 'prune');
  assert.equal(isSkillSpecific(keep.skill), true);
  assert.equal(isSkillSpecific(prune.skill), false);
  const snapshots = { start: START, reference: REFERENCE };
  const task = makeTask([SKILL_LINE]);
  assert.deepEqual(gates(lint(task, snapshots, { skillSpecific: isSkillSpecific(keep.skill) })), []);
  assert.deepEqual(gates(lint(task, snapshots, { skillSpecific: isSkillSpecific(prune.skill) })), [CONDITIONS.SKILL_ONLY_WORDING]);
});

test('only an explicit true exempts a skill', () => {
  for (const skillSpecific of [false, undefined, null, 'true', 1, {}, []]) {
    const report = lint(makeTask([SKILL_LINE]), { start: START, reference: REFERENCE }, { skillSpecific });
    assert.deepEqual(gates(report), [CONDITIONS.SKILL_ONLY_WORDING], String(skillSpecific));
  }
});

test('a task cannot exempt itself: a skill_specific field on the task is an unknown field', () => {
  const report = lint({ ...makeTask([SKILL_LINE]), skill_specific: true }, { start: START, reference: REFERENCE });
  assert.deepEqual(gates(report), [CONDITIONS.TASK_INVALID]);
});

test('a paraphrase of the skill passes: pattern matching cannot decide that, and the judge covers it', () => {
  const paraphrase = { type: 'contains', path: 'CHANGELOG.md', pattern: 'signed off by the release team' };
  const report = lint(makeTask([paraphrase]), { start: START, reference: referenceWith('Signed off by the release team\n') });
  assert.deepEqual(gates(report), []);
});

test('case, spacing, accents and punctuation do not hide copied wording', () => {
  const variants = ['REVIEWED   BY THE RELEASE DESK', 'Réviewed by the release désk'];
  for (const pattern of variants) {
    const report = lint(makeTask([{ type: 'contains', path: 'CHANGELOG.md', pattern }]), { start: START, reference: referenceWith(`${pattern}\n`) });
    assert.deepEqual(gates(report), [CONDITIONS.SKILL_ONLY_WORDING], pattern);
  }
  const punctuated = { type: 'contains', path: 'CHANGELOG.md', pattern: 'line: Reviewed by the release desk\\.' };
  const report = lint(makeTask([punctuated]), { start: START, reference: referenceWith('line: Reviewed by the release desk.\n') });
  assert.deepEqual(gates(report), [CONDITIONS.SKILL_ONLY_WORDING]);
});

test('a short pattern is compared whole: one word of the skill that the request also holds is not skill-only', () => {
  assert.ok(RUBRIC_QUOTE_WORDS > 3);
  // "release" is in the skill and in the request; "release desk" together is only in the skill.
  const request = 'Add an entry for the next release to CHANGELOG.md.';
  const inRequest = makeTask([{ type: 'contains', path: 'CHANGELOG.md', pattern: 'release notes' }], { task: request });
  assert.deepEqual(gates(lint(inRequest, { start: START, reference: referenceWith('release notes\n') })), []);
  const wholeOnly = makeTask([{ type: 'contains', path: 'CHANGELOG.md', pattern: 'release desk' }], { task: request });
  assert.deepEqual(gates(lint(wholeOnly, { start: START, reference: referenceWith('release desk\n') })), [CONDITIONS.SKILL_ONLY_WORDING]);
});

test('a long pattern is compared by runs of the rubric quoting length', () => {
  const longPattern = 'Name the owner of the change, then say how a reader can undo it';
  const words = longPattern.split(' ').length;
  assert.ok(words > RUBRIC_QUOTE_WORDS);
  const check = { type: 'contains', path: 'CHANGELOG.md', pattern: longPattern };
  const reference = referenceWith(`${longPattern}\n`);
  // Only the skill holds it: fails.
  assert.deepEqual(gates(lint(makeTask([check]), { start: START, reference })), [CONDITIONS.SKILL_ONLY_WORDING]);
  // The request holds every run of it: passes.
  const task = makeTask([check], { task: `Add an entry to CHANGELOG.md. ${longPattern}.` });
  assert.deepEqual(gates(lint(task, { start: START, reference })), []);
  // The request holds its first half only: a later run is still skill-only, so it fails.
  const half = makeTask([check], { task: 'Add an entry to CHANGELOG.md. Name the owner of the change.' });
  assert.deepEqual(gates(lint(half, { start: START, reference })), [CONDITIONS.SKILL_ONLY_WORDING]);
});

test('a pattern with a skill-only branch fails even when another branch is in the request', () => {
  const task = makeTask([{ type: 'contains', path: 'CHANGELOG.md', pattern: 'new flag|Reviewed by the release desk', negatives: ['a newer flagship', 'review of the desk'] }]);
  const report = lint(task, { start: START, reference: referenceWith('new flag\n') });
  assert.deepEqual(gates(report), [CONDITIONS.SKILL_ONLY_WORDING]);
});

test('a structure pattern with no words is not wording', () => {
  const heading = { type: 'contains', path: 'CHANGELOG.md', pattern: '^## \\[\\]$' };
  const task = makeTask([heading]);
  const report = lint(task, { start: START, reference: referenceWith('## []\n') });
  assert.deepEqual(gates(report), []);
});

test('only contains checks are read: not_contains, file_exists, file_absent and fixture_unchanged are not', () => {
  const checks = [
    { type: 'not_contains', path: 'NOTES.md', pattern: 'Reviewed by the release desk' },
    { type: 'file_exists', path: 'reviewed-by-the-release-desk.md' },
    { type: 'fixture_unchanged', path: 'NOTES.md' },
  ];
  const reference = { ...referenceWith('x\n'), 'reviewed-by-the-release-desk.md': 'x\n' };
  const report = lint(makeTask(checks), { start: START, reference });
  assert.deepEqual(gates(report), []);
});

test('a task with no checks passes the gate', () => {
  assert.deepEqual(gates(lint({ ...makeTask([]), checks: [] }, { start: START })), []);
});

test('the message lists at most the cap of checks and counts the rest', () => {
  const words = ['Reviewed by the release desk', 'Name the owner of the change', 'say how a reader can undo it', 'Write an entry for each', 'End every entry with the line', 'user-facing change entry', 'owner of the change then', 'how a reader can undo'];
  const checks = words.map((pattern) => ({ type: 'contains', path: 'CHANGELOG.md', pattern }));
  assert.ok(checks.length > MAX_LISTED_CHECKS);
  const report = lint(makeTask(checks), { start: START });
  const failure = report.failures.find((f) => f.condition === CONDITIONS.SKILL_ONLY_WORDING);
  assert.ok(failure, JSON.stringify(report.failures));
  assert.match(failure.message, /; and \d+ more; check structure/);
});

test('the gate runs after the reference gate and before the budget gate, and exposes its rule version', () => {
  const task = makeTask([SKILL_LINE]);
  const report = lint(task, { start: START, reference: START });
  assert.deepEqual(gates(report), [CONDITIONS.REFERENCE_PASSES, CONDITIONS.SKILL_ONLY_WORDING]);
  assert.equal(SKILL_ONLY_WORDING_VERSION, 1);
});

test('the sound fixture task, with a skill that does not contain its check wording, stays clean', () => {
  const dir = path.join(__dirname, 'fixtures', 'tasks');
  const task = JSON.parse(fs.readFileSync(path.join(dir, 'sound.task.json'), 'utf8'));
  const text = `## ${task.target_section}\n\nWrite an entry for each user-facing change.\n`;
  const report = lintTask(task, { start: require('../lib/snapshot-loader').loadSnapshot(path.join(dir, 'snapshots', 'start')) }, { skillText: text });
  assert.deepEqual(gates(report), []);
});
