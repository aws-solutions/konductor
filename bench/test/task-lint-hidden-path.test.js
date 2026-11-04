// SPDX-License-Identifier: Apache-2.0
/**
 * Hidden-path tests for the task lint (finding I-A)
 *
 * The loader skips `.git` and `node_modules` at any depth, so no snapshot can ever hold a file
 * under either. The lint accepted a stay-out task that held `file_absent` on
 * `src/node_modules/x.js`: a check the loader can never fail, which makes it a check that measures
 * nothing. The path rule lives in checks.js `validateCheck`, which task-schema.js already calls, so
 * the lint reports `task_invalid` for it. This file pins that end to end through `lintTask`.
 *
 * Run: node --test bench/test/task-lint-hidden-path.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { CONDITIONS, lintTask } = require('../lib/task-lint');

const SKILL_OPTIONS = { skillText: '## Recording a change\n\nHow to record a change in the changelog.\n' };
const START = { 'NOTES.md': 'Notes about the tool.\n', 'src/a.js': 'module.exports = 1;\n' };

function stayOutTask(checks) {
  return {
    id: 'release-notes-near-miss-hidden',
    skill: 'release-notes',
    kind: 'near-miss',
    task: 'Tidy the project notes without starting a release.',
    rubric: ['The notes are left as they were.', 'No release file is created.', 'The source is not touched.'],
    target_section: 'Recording a change',
    fixtures: ['NOTES.md', 'src/a.js'],
    checks,
  };
}

const SOUND = [
  { type: 'file_absent', path: 'CHANGELOG.md' },
  { type: 'fixture_unchanged', path: 'NOTES.md' },
  { type: 'not_contains', path: 'NOTES.md', pattern: 'TODO' },
];

test('control: the stay-out task used below is clean, so each failure comes from the hidden path', () => {
  const report = lintTask(stayOutTask(SOUND), { start: START, reference: START }, SKILL_OPTIONS);
  assert.deepEqual(report.failures, []);
  assert.equal(report.ok, true);
});

test('I-A: a stay-out task with file_absent under node_modules is invalid, not lintable', () => {
  for (const hidden of ['src/node_modules/x.js', 'node_modules/x.js', 'src/.git/hook', '.git/config', 'src/Node_Modules/x.js', 'a/.GIT/b']) {
    const task = stayOutTask([...SOUND, { type: 'file_absent', path: hidden }]);
    const report = lintTask(task, { start: START, reference: START }, SKILL_OPTIONS);
    assert.equal(report.ok, false, hidden);
    const failure = report.failures.find((f) => f.condition === CONDITIONS.TASK_INVALID);
    assert.ok(failure, `${hidden}: ${JSON.stringify(report.failures)}`);
    assert.match(failure.message, /which the snapshot loader skips at any depth/, hidden);
    assert.match(failure.message, /checks\[3\]: path: /, hidden);
  }
});

test('I-A: a stay-out task made only of hidden-path checks is invalid too', () => {
  const task = stayOutTask([{ type: 'file_absent', path: 'src/node_modules/evil.js' }]);
  const report = lintTask(task, { start: START, reference: START }, SKILL_OPTIONS);
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => f.condition === CONDITIONS.TASK_INVALID), JSON.stringify(report.failures));
});

test('I-A: every check kind rejects a hidden path in a task, so none can be a check the loader cannot fail', () => {
  const checks = [
    { type: 'file_exists', path: 'src/node_modules/x.js' },
    { type: 'contains', path: 'src/.git/config', pattern: 'remote origin' },
    { type: 'not_contains', path: 'node_modules/x.js', pattern: 'TODO items' },
    { type: 'fixture_unchanged', path: 'src/node_modules' },
    { type: 'file_absent', path: 'src/.git' },
  ];
  for (const check of checks) {
    const report = lintTask(stayOutTask([...SOUND, check]), { start: START, reference: START }, SKILL_OPTIONS);
    assert.equal(report.ok, false, check.type);
    assert.ok(report.failures.some((f) => f.condition === CONDITIONS.TASK_INVALID), `${check.type}: ${JSON.stringify(report.failures)}`);
  }
});
