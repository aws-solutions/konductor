// SPDX-License-Identifier: Apache-2.0
/**
 * Fail-closed tests for the task lint
 *
 * A check that gives no verdict (a pattern that did not finish, a check that could not be
 * evaluated) is never read as a pass, and a pattern that is slow on some text never hangs the
 * lint. Each test below encodes one input that used to be dangerous, or one rule that closes the
 * class.
 *
 * Tests that exercise an input which used to never return run it in a child process with a kill
 * timer. A call that does not return blocks this process's event loop, so the test runner's own
 * timeout cannot fire; the child turns "never returns" into a failing assertion.
 *
 * Run: node --test bench/test/task-lint-failclosed.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { CONDITIONS, WARNINGS, STAY_OUT_KINDS, lintTask: strictLintTask } = require('../lib/task-lint');
const { withSkillText } = require('./helpers/skill-text');

// `lintTask` refuses to run without options.skillText. Where a test here calls it without options,
// the helper supplies a minimal skill text (helpers/skill-text.js).
const lintTask = withSkillText(strictLintTask);
const { CHECK_KINDS, evalChecks, validateCheck } = require('../lib/checks');
const { loadSnapshot } = require('../lib/snapshot-loader');

const LIB_DIR = path.join(__dirname, '..', 'lib');
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'tasks');

const SKILL_TEXT = '# Plan\n\n## Overview\n\nthe skill body';
const OPTIONS = { skillText: SKILL_TEXT };

// A billing-service note, with one fixture the start workspace holds.
function makeTask(checks, overrides = {}) {
  return {
    id: 'plan-core-x',
    skill: 'plan',
    kind: 'core',
    task: 'Write a short migration note for the billing service.',
    rubric: ['The note names the billing service explicitly', 'The note lists a rollback step', 'The note gives an owner for each step'],
    target_section: 'Overview',
    fixtures: ['README.md'],
    checks,
    ...overrides,
  };
}

const START = { 'README.md': 'hello' };

function conditionsOf(report) {
  return report.failures.map((f) => f.condition);
}

function failureOf(report, condition) {
  return report.failures.find((f) => f.condition === condition);
}

function warningOf(report, code) {
  return report.warnings.find((w) => w.code === code);
}

/**
 * Runs `lintTask(task, snapshots, options)` in a child process and kills it after `limitMs`.
 * Returns `{ timedOut, ms, ok, conditions, messages, warnings, warningMessages }`.
 */
function lintInChild(task, snapshots, options, limitMs) {
  const script = `
    const { lintTask } = require(${JSON.stringify(path.join(LIB_DIR, 'task-lint.js'))});
    const { task, snapshots, options } = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
    const report = lintTask(task, snapshots, options);
    process.stdout.write(JSON.stringify({
      ok: report.ok,
      conditions: report.failures.map((f) => f.condition),
      messages: report.failures.map((f) => f.message),
      warnings: report.warnings.map((w) => w.code),
      warningMessages: report.warnings.map((w) => w.message),
    }));
  `;
  const started = process.hrtime.bigint();
  const run = spawnSync(process.execPath, ['-e', script], {
    input: JSON.stringify({ task, snapshots, options }),
    timeout: limitMs,
    killSignal: 'SIGKILL',
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const timedOut = run.error !== undefined && run.error.code === 'ETIMEDOUT';
  const parsed = run.status === 0 && run.stdout ? JSON.parse(run.stdout) : null;
  return { timedOut, ms, stderr: run.stderr, ...(parsed || {}) };
}

// --- Every check kind is handled -----------------------------------------------------------------

test('every stay-out kind is a check kind, and each one gets a trespass that breaks its rule', () => {
  for (const kind of STAY_OUT_KINDS) assert.ok(CHECK_KINDS.includes(kind), kind);
  const checks = [
    { type: 'file_absent', path: 'CHANGELOG.md' },
    { type: 'not_contains', path: 'README.md', pattern: 'TODO items' },
    { type: 'fixture_unchanged', path: 'README.md' },
  ];
  const report = lintTask(makeTask(checks, { kind: 'near-miss' }), { start: START, reference: START }, OPTIONS);
  assert.equal(report.ok, true, JSON.stringify(report.failures));
  assert.deepEqual(report.results.trespass.map((r) => r.passed), [false, false, false]);
  assert.equal(warningOf(report, WARNINGS.TRESPASS_FAILS), undefined);
});

// --- A check that gave no verdict is not a pass --------------------------------------------------

const SLOW_NEGATIVES = ['wrong answer one', 'wrong answer two'];

test('a check that gave no verdict on the reference fails reference_passes and names why', () => {
  // `a.*b` passes every syntax rule and takes about 30 s on 200,000 `a`. The file is
  // MAX_SNAPSHOT_FILE_CHARS (100,000) `a`, the largest the lint accepts; the pattern is still
  // quadratic on it, so it times out on every workspace that holds the file.
  const big = 'a'.repeat(100000);
  const start = { 'README.md': 'hello', 'big.md': big, 'draft.md': 'unfinished' };
  const checks = [{ type: 'contains', path: 'big.md', pattern: 'a.*b', negatives: SLOW_NEGATIVES }, { type: 'file_absent', path: 'draft.md' }];
  const task = makeTask(checks, { fixtures: ['README.md', 'big.md', 'draft.md'] });
  const report = lintTask(task, { start, reference: { 'README.md': 'hello', 'big.md': big } }, OPTIONS);
  assert.equal(report.ok, false);
  const failure = failureOf(report, CONDITIONS.REFERENCE_PASSES);
  assert.ok(failure, JSON.stringify(report.failures));
  assert.match(failure.message, /checks\[0\] contains big\.md \(pattern did not finish within 1000 ms/);
});

test('the earned count does not credit a check that only timed out at the start', () => {
  const big = 'a'.repeat(100000); // The largest file the lint accepts; see the test above.
  const start = { 'README.md': 'hello', 'big.md': big };
  const task = makeTask([{ type: 'contains', path: 'big.md', pattern: 'a.*b', negatives: SLOW_NEGATIVES }, { type: 'fixture_unchanged', path: 'README.md' }], {
    fixtures: ['README.md', 'big.md'],
  });
  const report = lintTask(task, { start, reference: { 'README.md': 'hello', 'big.md': 'ab' } }, OPTIONS);
  const unearned = warningOf(report, WARNINGS.UNEARNED_CHECKS);
  assert.ok(unearned, JSON.stringify(report.warnings));
  assert.match(unearned.message, /^only 0 of 2 checks need work to pass \(0%\)/);
});

// --- min_matches is removed ----------------------------------------------------------------------

const MIN_MATCHES_REASON = /^the task is invalid: checks\[\d\]: type: min_matches was removed .*; use contains with a pattern that spans the structure you need/;

test('min_matches tasks are invalid, not lintable', () => {
  const a1 = makeTask([
    { type: 'contains', path: 'out.md', pattern: 'rollback plan' },
    { type: 'min_matches', path: 'notes.md', pattern: 'step one', min: 3 },
  ]);
  const g1 = makeTask([
    { type: 'min_matches', path: 'plan.md', pattern: 'rollback plan', min: 1 },
    { type: 'min_matches', path: 'owners.md', pattern: 'named owner', min: 1 },
    { type: 'min_matches', path: 'risks.md', pattern: 'risk register', min: 1 },
  ]);
  const reference = { 'README.md': 'hello', 'out.md': 'rollback plan', 'notes.md': 'step one\nstep one\nstep one', 'plan.md': 'rollback plan', 'owners.md': 'named owner', 'risks.md': 'risk register' };
  for (const task of [a1, g1]) {
    const report = lintTask(task, { start: START, reference }, OPTIONS);
    assert.equal(report.ok, false);
    assert.deepEqual(conditionsOf(report), [CONDITIONS.TASK_INVALID]);
    assert.match(report.failures[0].message, MIN_MATCHES_REASON);
    assert.deepEqual(report.results, { start: null, reference: null });
  }
});

test('min_matches is rejected by validateCheck however it is spelled, with or without its own fields', () => {
  for (const check of [
    { type: 'min_matches', path: 'a.md', pattern: 'xx', min: 1 },
    { type: 'min_matches' },
    { type: 'min_matches', path: 'a.md', pattern: 'xx', min: 1, negatives: ['y'] },
  ]) {
    const problems = validateCheck(check);
    assert.equal(problems.length, 1, JSON.stringify(check));
    assert.match(problems[0], /^type: min_matches was removed .*use contains/);
  }
  assert.equal(CHECK_KINDS.includes('min_matches'), false);
});

test('a lookaround pattern is an invalid task, so the prose-matching admissions cannot reach the lint', () => {
  for (const pattern of ['t(?=h)', 'e(?=l)', '(?<=r)o', '(?=.)x', '.(?=.)', '\\w(?=\\w)', '(?<=price )\\d+(?= USD)']) {
    const report = lintTask(makeTask([{ type: 'contains', path: 'out.md', pattern }]), { start: START, reference: START }, OPTIONS);
    assert.deepEqual(conditionsOf(report), [CONDITIONS.TASK_INVALID], pattern);
    assert.match(report.failures[0].message, /checks\[0\]: pattern: uses a lookahead or lookbehind/, pattern);
  }
});

// --- The sound fixture ---------------------------------------------------------------------------

test('the three-line workspace that used to pass the whole sound fixture does not pass it now', () => {
  const task = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'sound.task.json'), 'utf8'));
  const start = loadSnapshot(path.join(FIXTURES_DIR, 'snapshots', 'start'));
  const reference = loadSnapshot(path.join(FIXTURES_DIR, 'snapshots', 'reference'));
  // It sets only CHANGELOG.md, with each literal once and two bullets.
  const stuffer = { ...start, 'CHANGELOG.md': '## Unreleased\n- --dry-run\n- off by default\n' };
  const results = evalChecks(stuffer, task.checks, { pristine: start });
  assert.equal(results.every((r) => r.passed), false, JSON.stringify(results));
  // The second content check asks for a phrase that says to leave the flag out, which this
  // workspace does not write, and the draft is still there.
  assert.deepEqual(results.map((r) => [r.type, r.passed]), [
    ['file_exists', true],
    ['contains', true],
    ['contains', false],
    ['fixture_unchanged', true],
    ['file_absent', false],
  ]);
  // The fixture lints clean, and the reference, which does the work, passes every check.
  const report = lintTask(task, { start, reference });
  assert.equal(report.ok, true, JSON.stringify(report.failures));
  assert.equal(evalChecks(reference, task.checks, { pristine: start }).every((r) => r.passed), true);
});

test('no fixture task carries a removed kind or a lookaround', () => {
  for (const name of fs.readdirSync(FIXTURES_DIR).filter((file) => file.endsWith('.task.json'))) {
    const text = fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
    assert.doesNotMatch(text, /min_matches/, name);
    assert.doesNotMatch(text, /\(\?[=!<]/, name);
  }
});

// --- The hangs -------------------------------------------------------------------------------------

test('an empty-body quantifier nest validates and no longer hangs the lint', () => {
  let inner = '';
  for (let i = 0; i < 4; i += 1) inner = `(?:${inner}){200}`;
  const task = makeTask([{ type: 'contains', path: 'out.md', pattern: `ab${inner}` }]);
  const outcome = lintInChild(task, { start: START, reference: { 'README.md': 'hello', 'out.md': 'ab' } }, OPTIONS, 60000);
  assert.equal(outcome.timedOut, false, 'lintTask did not return within 60 s');
  assert.equal(outcome.ok, true, JSON.stringify(outcome.conditions));
  assert.ok(outcome.ms < 30000, `took ${outcome.ms} ms`);
});

test('the same nest reached through not_contains no longer hangs the trespass build', () => {
  let inner = '';
  for (let i = 0; i < 4; i += 1) inner = `(?:${inner}){200}`;
  const task = makeTask([{ type: 'not_contains', path: 'README.md', pattern: `ab${inner}` }], { kind: 'near-miss' });
  const outcome = lintInChild(task, { start: START, reference: START }, OPTIONS, 60000);
  assert.equal(outcome.timedOut, false, 'lintTask did not return within 60 s');
  assert.equal(outcome.ok, true, JSON.stringify(outcome.conditions));
  assert.ok(outcome.warnings.includes(WARNINGS.TRESPASS_FAILS), JSON.stringify(outcome.warnings));
});

// Ten `x{0,16}` and a `(?:x{200}){24}` make the candidate 'x' * 4800 + 'bc' cost 17^10 backtracking
// steps under the real expression. The trespass build runs the candidate under the time limit.
const SLOW_CANDIDATE_PATTERN = `${'x{0,16}'.repeat(10)}(?:x{200}){24}bc`;

test('a lookaround-free pattern that is slow on its own candidate text validates and no longer hangs the trespass build', () => {
  const check = { type: 'not_contains', path: 'README.md', pattern: SLOW_CANDIDATE_PATTERN };
  assert.deepEqual(validateCheck(check), [], 'the input must validate clean for this to be the hang');
  const outcome = lintInChild(makeTask([check], { kind: 'near-miss' }), { start: START, reference: START }, OPTIONS, 60000);
  assert.equal(outcome.timedOut, false, 'lintTask did not return within 60 s');
  assert.ok(outcome.ms < 30000, `took ${outcome.ms} ms`);
  const at = outcome.warnings.indexOf(WARNINGS.TRESPASS_FAILS);
  assert.ok(at >= 0, JSON.stringify(outcome.warnings));
  assert.match(outcome.warningMessages[at], /the pattern did not finish within 1000 ms on a candidate text/);
});

test('the task request is matched under the time limit too', () => {
  // A pattern that is slow on the request text. The run that does not finish is reported with the
  // quoting patterns, because it cannot be shown not to match.
  const check = { type: 'contains', path: 'out.md', pattern: `${'x{0,16}'.repeat(10)}yy`, negatives: ['wrong answer one', 'wrong answer two'] };
  const task = makeTask([check], { task: 'x'.repeat(3900) });
  assert.deepEqual(validateCheck(check), []);
  const outcome = lintInChild(task, { start: START, reference: { 'README.md': 'hello', 'out.md': 'yy' } }, OPTIONS, 60000);
  assert.equal(outcome.timedOut, false, 'lintTask did not return within 60 s');
  assert.ok(outcome.warnings.includes(WARNINGS.LITERAL_IN_REQUEST), JSON.stringify(outcome.warnings));
});

// --- The header claims are true --------------------------------------------------------------------

function codeOf(name) {
  return fs.readFileSync(path.join(LIB_DIR, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('task-lint.js executes no pattern except through testBounded or evalChecks', () => {
  // checks.js says that every execution of a pattern against text runs under a time limit.
  const code = codeOf('task-lint.js');
  assert.doesNotMatch(code, /\.(test|exec|match|matchAll|search)\(/);
  assert.match(code, /testBounded\(/);
});

test('checks.js no longer claims a figure it does not deliver', () => {
  const header = fs.readFileSync(path.join(LIB_DIR, 'checks.js'), 'utf8').split('*/')[0];
  assert.doesNotMatch(header, /measured at most about 0\.2/);
  assert.match(header, /Every execution of an author's pattern against text runs through `testBounded`/);
});
