// SPDX-License-Identifier: Apache-2.0
/**
 * Negative corpus unit tests
 *
 * Uses Node's built-in `node:test` and `node:assert`, so no test framework dependency is needed.
 * Run: node --test bench/test/negatives.test.js
 *
 * The fixtures under fixtures/tasks/negatives/ are three small tasks whose only check is a
 * tolerant `contains` pattern: `tolerant-rejects` declares negatives the pattern rejects,
 * `tolerant-accepts` declares one that the pattern wrongly accepts, and `tolerant-missing`
 * declares none. The tests read nothing but those fixtures, spawn no processes and make no
 * network or model calls.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MIN_NEGATIVES, isTolerantPattern, evaluateNegatives, validateNegatives } = require('../lib/negatives');
const { validateTask } = require('../lib/task-schema');
const { evalCheck } = require('../lib/checks');
const { lintTask: strictLintTask, CONDITIONS } = require('../lib/task-lint');
const { withSkillText } = require('./helpers/skill-text');

// lintTask refuses to run without options.skillText; this file is about negatives, so it calls
// it through the helper that supplies a minimal skill text (helpers/skill-text.js).
const lintTask = withSkillText(strictLintTask);
const { loadSnapshot } = require('../lib/snapshot-loader');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'tasks');

function loadTask(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'negatives', `${name}.task.json`), 'utf8'));
}

function contains(pattern, negatives) {
  const check = { type: 'contains', path: 'a.md', pattern };
  if (negatives !== undefined) check.negatives = negatives;
  return check;
}

// --- What counts as tolerant ------------------------------------------------------------------

test('the minimum number of negatives is two', () => {
  assert.equal(MIN_NEGATIVES, 2);
});

test('patterns that can match more than one text of the same shape are tolerant', () => {
  const tolerant = [
    'a|b', 'colou?r', 'a*', 'a+', 'a.b', '[abc]', '[^x]', '\\s', '\\S', '\\w+', '\\W', '\\d', '\\D',
    'a{1,3}', 'a{2,}', '(?:abc)?', '(abc)?', '\\(?x', 'roll(s|ed)? back', 'roll(s|ed)?.*back',
  ];
  for (const pattern of tolerant) assert.equal(isTolerantPattern(pattern), true, pattern);
});

test('literal patterns are not tolerant', () => {
  const strict = [
    'plain text', '--dry-run', 'off by default', '^# Title$', '\\bword\\b', '\\.', '\\(x\\)', 'a{2}',
    '(?:abc)', '(?=abc)', '(?!abc)', '(?<=x)y', '(?<!x)y', '(?<name>abc)', '(abc)', 'a\\|b', '\\[x\\]',
    '\\*', '\\+', '\\?', '\\\\', 'a{', 'a{x,y}',
  ];
  for (const pattern of strict) assert.equal(isTolerantPattern(pattern), false, pattern);
});

test('a value that is not a pattern string is not tolerant', () => {
  for (const value of [undefined, null, 5, {}, [], '\\', '']) assert.equal(isTolerantPattern(value), false, String(value));
});

// --- Running negatives through a pattern ------------------------------------------------------

test('a pattern that rejects its negatives reports none accepted', () => {
  const check = loadTask('tolerant-rejects').checks[0];
  assert.deepEqual(evaluateNegatives(check), { accepted: [], tested: 2 });
});

test('a pattern that wrongly accepts a negative reports it', () => {
  const check = loadTask('tolerant-accepts').checks[0];
  assert.deepEqual(evaluateNegatives(check), { accepted: ['the roll of the dice came back'], tested: 2 });
});

test('the pattern in the rejecting fixture still accepts the wordings it is meant to', () => {
  const { pattern } = loadTask('tolerant-rejects').checks[0];
  for (const text of ['We roll back the change.', 'It rolled back the deployment', 'Rolls back deploy']) {
    assert.equal(evalCheck({ 'a.md': text }, contains(pattern)).passed, true, text);
  }
});

test('negatives are matched the way contains matches a file: ignoring case, with line anchors', () => {
  assert.deepEqual(evaluateNegatives(contains('foo', ['FOO bar', 'baz'])).accepted, ['FOO bar']);
  assert.deepEqual(evaluateNegatives(contains('^## risks$', ['intro\n## Risks\nbody', 'a ## risks'])).accepted, ['intro\n## Risks\nbody']);
});

test('a check with nothing to evaluate gives an empty result', () => {
  const empty = { accepted: [], tested: 0 };
  assert.deepEqual(evaluateNegatives(contains('xx')), empty);
  assert.deepEqual(evaluateNegatives(contains('xx', [])), empty);
  assert.deepEqual(evaluateNegatives(contains('xx', 'not a list')), empty);
  assert.deepEqual(evaluateNegatives({ type: 'not_contains', path: 'a.md', pattern: 'x', negatives: ['x'] }), empty);
  assert.deepEqual(evaluateNegatives(contains('(', ['x'])), empty);
  assert.deepEqual(evaluateNegatives(contains('x*', ['x'])), empty);
  for (const bad of [undefined, null, 'check', 3, []]) assert.deepEqual(evaluateNegatives(bad), empty, String(bad));
});

test('entries that are not usable strings are skipped, not counted as tested', () => {
  assert.deepEqual(evaluateNegatives(contains('xx', ['xx', '', 4, null, 'y'])), { accepted: ['xx'], tested: 2 });
});

test('a hostile check is a result, not a throw', () => {
  const check = contains('xx');
  Object.defineProperty(check, 'negatives', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });
  assert.deepEqual(evaluateNegatives(check), { accepted: [], tested: 0 });
});

// --- The rule as the validator applies it -----------------------------------------------------

test('a tolerant pattern that declares enough negatives it rejects has no problems', () => {
  assert.deepEqual(validateNegatives(loadTask('tolerant-rejects').checks[0]), []);
  assert.deepEqual(validateTask(loadTask('tolerant-rejects')), []);
});

test('a tolerant pattern without declared negatives is a problem', () => {
  const task = loadTask('tolerant-missing');
  const expected = 'negatives: a tolerant pattern needs at least 2 distinct declared negatives, got 0';
  assert.deepEqual(validateNegatives(task.checks[0]), [expected]);
  assert.deepEqual(validateTask(task), [`checks[0]: ${expected}`]);
});

test('a tolerant pattern needs the minimum count of distinct negatives', () => {
  assert.deepEqual(validateNegatives(contains('ab|cd', ['zzz', 'yyy'])), []);
  assert.deepEqual(validateNegatives(contains('ab|cd', [])), ['negatives: a tolerant pattern needs at least 2 distinct declared negatives, got 0']);
  assert.deepEqual(validateNegatives(contains('ab|cd', ['zzz'])), ['negatives: a tolerant pattern needs at least 2 distinct declared negatives, got 1']);
  assert.deepEqual(validateNegatives(contains('ab|cd', ['zzz', 'zzz'])), ['negatives: a tolerant pattern needs at least 2 distinct declared negatives, got 1']);
});

test('a declared negative that the pattern accepts is a problem', () => {
  const task = loadTask('tolerant-accepts');
  const expected = 'negatives: the pattern accepts the declared negative "the roll of the dice came back"';
  assert.deepEqual(validateNegatives(task.checks[0]), [expected]);
  assert.deepEqual(validateTask(task), [`checks[0]: ${expected}`]);
});

test('every accepted negative is reported', () => {
  const problems = validateNegatives(contains('ab|cd', ['xab', 'ycd', 'zzz']));
  assert.deepEqual(problems, [
    'negatives: the pattern accepts the declared negative "xab"',
    'negatives: the pattern accepts the declared negative "ycd"',
  ]);
});

test('a long accepted negative is truncated in the problem', () => {
  const problems = validateNegatives(contains('ab|cd', ['cd'.repeat(250), 'zzz']));
  assert.equal(problems.length, 1);
  assert.ok(problems[0].length < 200, problems[0]);
});

test('a literal pattern needs no negatives, but any it declares are still checked', () => {
  assert.deepEqual(validateNegatives(contains('--dry-run')), []);
  assert.deepEqual(validateNegatives(contains('--dry-run', ['dry run'])), []);
  assert.deepEqual(validateNegatives(contains('--dry-run', ['uses --dry-run'])), [
    'negatives: the pattern accepts the declared negative "uses --dry-run"',
  ]);
});

test('only the check that asserts a pattern is held to the rule: contains', () => {
  for (const type of ['not_contains', 'file_exists', 'fixture_unchanged']) {
    assert.deepEqual(validateNegatives({ type, path: 'a.md', pattern: 'ab|cd' }), [], type);
  }
  // Behavior change (C): this test also asserted that a tolerant min_matches pattern was held to the
  // rule (I-2). The kind was removed, so validateNegatives gives it no problems; validateCheck reports it.
  assert.deepEqual(validateNegatives({ type: 'min_matches', path: 'a.md', pattern: '^[-*] ', min: 2 }), []);
  // Behavior change (I-3 r4): the pattern was `^[-*] `, one literal character, below the literal floor.
  assert.deepEqual(validateNegatives({ type: 'contains', path: 'a.md', pattern: '^[-*] ok' }), [
    'negatives: a tolerant pattern needs at least 2 distinct declared negatives, got 0',
  ]);
});

test('a malformed check gets no negative problems on top of its own', () => {
  assert.deepEqual(validateNegatives(contains('(')), []);
  assert.deepEqual(validateNegatives(null), []);
  const problems = validateTask({ ...loadTask('tolerant-missing'), checks: [contains('ab|cd', 'not a list')] });
  assert.deepEqual(problems, ['checks[0]: negatives: must be an array of non-empty strings, each at most 1000 characters']);
});

test('a hostile check is a problem, not a throw', () => {
  const check = contains('ab|cd');
  Object.defineProperty(check, 'negatives', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });
  assert.deepEqual(validateNegatives(check), ['negatives: could not be inspected because reading a property threw']);
});

// --- Through the lint -------------------------------------------------------------------------

test('a task whose pattern accepts a declared negative is invalid before any lint check runs', () => {
  const dir = path.join(FIXTURES_DIR, 'snapshots');
  const snapshots = {
    start: loadSnapshot(path.join(dir, 'start')),
    reference: loadSnapshot(path.join(dir, 'reference')),
  };
  const report = lintTask(loadTask('tolerant-accepts'), snapshots);
  assert.deepEqual(report.failures.map((f) => f.condition), [CONDITIONS.TASK_INVALID]);
  assert.match(report.failures[0].message, /the pattern accepts the declared negative/);
});
