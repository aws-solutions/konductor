// SPDX-License-Identifier: Apache-2.0
/**
 * Soundness tests for the negative corpus (finding C-3)
 *
 * Each test encodes a concrete attack: a negative corpus that satisfies the rule without testing
 * the pattern at all. Every one of them was accepted by the rule as first written.
 *
 * Run: node --test bench/test/negatives-soundness.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { MIN_NEGATIVE_WORD_CHARS, validateNegatives, evaluateNegatives } = require('../lib/negatives');
const { validateTask } = require('../lib/task-schema');

function contains(pattern, negatives) {
  const check = { type: 'contains', path: 'a.md', pattern };
  if (negatives !== undefined) check.negatives = negatives;
  return check;
}

function makeTask(checks) {
  return {
    id: 'release-notes-core-negatives',
    skill: 'release-notes',
    kind: 'core',
    task: 'Write the entry.',
    rubric: ['The entry says what changed.', 'The entry says how to opt out.', 'The notes are left as they were.'],
    target_section: 'Recording a change',
    fixtures: ['NOTES.md'],
    checks,
  };
}

const ROLLBACK = 'roll(s|ed)? back (the )?(change|deploy(ment)?)';

// --- The reported attack ----------------------------------------------------------------------

test('C-3: pattern "." with negatives ["\\n", "\\r"] is an invalid task, not a satisfied negative corpus', () => {
  const problems = validateTask(makeTask([contains('.', ['\n', '\r'])]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^checks\[0\]: pattern: can match a single character/);
});

test('C-3: whitespace-only negatives prove nothing, even beside a real pattern', () => {
  const problems = validateNegatives(contains(ROLLBACK, ['\n', '\r']));
  assert.deepEqual(problems, [
    // Both normalize to empty text, so they are also one negative and not two.
    'negatives: a tolerant pattern needs at least 2 distinct declared negatives, got 1',
    `negatives: the declared negative "\\n" has fewer than ${MIN_NEGATIVE_WORD_CHARS} letters or digits, so it cannot stand for a wrong answer`,
    `negatives: the declared negative "\\r" has fewer than ${MIN_NEGATIVE_WORD_CHARS} letters or digits, so it cannot stand for a wrong answer`,
  ]);
  assert.equal(MIN_NEGATIVE_WORD_CHARS, 3);
});

test('C-3: single letters and punctuation are not negatives', () => {
  for (const negative of ['x', 'y', '!!', '--', 'a b']) {
    const problems = validateNegatives(contains(ROLLBACK, [negative, 'we never roll forward the change']));
    assert.equal(problems.length, 1, negative);
    assert.match(problems[0], /fewer than 3 letters or digits/, negative);
  }
});

// --- A negative must be a near miss -----------------------------------------------------------

test('C-3: unrelated filler text is not a near miss, so it cannot satisfy the negatives requirement', () => {
  const problems = validateNegatives(contains(ROLLBACK, ['the sky is blue', 'lorem ipsum dolor']));
  assert.equal(problems.length, 2);
  for (const problem of problems) assert.match(problem, /shares no 3-character fragment with the pattern's words, so it is not a near miss/);
});

test('C-3: the near-miss rule applies to a strict pattern that declares negatives', () => {
  assert.equal(validateNegatives(contains('--dry-run', ['no flag here'])).length, 1);
  assert.deepEqual(validateNegatives(contains('--dry-run', ['dry run'])), []);
});

test('C-3: a pattern that is a word list is satisfied by a resembling negative, not by an unrelated one', () => {
  assert.deepEqual(validateNegatives(contains('risks?|hazards?', ['a risen tide', 'hazy weather'])), []);
  assert.equal(validateNegatives(contains('risks?|hazards?', ['nothing to flag', 'no problem here'])).length, 2);
});

test('C-3: a pattern built only from structure has no vocabulary, so the near-miss rule is skipped', () => {
  assert.deepEqual(validateNegatives(contains('\\d{4}-\\d{2}-\\d{2}', ['2024-1-5', '24-05-06'])), []);
});

test('C-3: genuine near misses on the reference pattern are accepted', () => {
  assert.deepEqual(validateNegatives(contains(ROLLBACK, ['we never roll forward the change', 'back the change up before the deploy'])), []);
});

// --- Distinctness follows the matcher's case-insensitivity ------------------------------------

test('C-3: negatives that differ only by case or spacing count once', () => {
  const problems = validateNegatives(contains(ROLLBACK, ['We never roll forward the change', 'we never  roll forward the CHANGE ']));
  assert.deepEqual(problems, ['negatives: a tolerant pattern needs at least 2 distinct declared negatives, got 1']);
});

// --- A negative must fail the pattern it is paired with ---------------------------------------

test('C-3: a negative is run through the pattern and a negative the pattern accepts is reported', () => {
  assert.deepEqual(validateNegatives(contains('plan|design', ['replan the work', 'an unrelated line'])), [
    'negatives: the pattern accepts the declared negative "replan the work"',
    `negatives: the declared negative "an unrelated line" shares no 3-character fragment with the pattern's words, so it is not a near miss; write a wrong answer in the pattern's own vocabulary`,
  ]);
});

test('C-3: a word-boundary-aware literal rejects the inside-a-word negative that used to be accepted', () => {
  assert.deepEqual(evaluateNegatives(contains('plan', ['planets orbit', 'explanation follows'])), { accepted: [], tested: 2 });
  assert.deepEqual(validateNegatives(contains('plan', ['planets orbit'])), []);
});

// --- I-2: the negatives requirement follows the pattern, not the check kind -------------------

function minMatches(pattern, negatives, min = 1) {
  const check = { type: 'min_matches', path: 'a.md', pattern, min };
  if (negatives !== undefined) check.negatives = negatives;
  return check;
}

test('I-2: a min_matches check is no longer a way around the negatives rule: the kind is invalid', () => {
  // Behavior change (C): these tests (five of them) asserted that min_matches carried the same
  // negatives requirement as contains. The kind was removed, so the escape they closed cannot be
  // reopened; what remains is that a task still using it is invalid and is never judged on negatives.
  const asContains = validateTask(makeTask([contains(ROLLBACK)]));
  const asMinMatches = validateTask(makeTask([minMatches(ROLLBACK)]));
  assert.deepEqual(asContains, ['checks[0]: negatives: a tolerant pattern needs at least 2 distinct declared negatives, got 0']);
  assert.equal(asMinMatches.length, 1);
  assert.match(asMinMatches[0], /^checks\[0\]: type: min_matches was removed .*use contains/);
  assert.deepEqual(validateNegatives(minMatches(ROLLBACK, ['the roll of the dice came back', 'we never roll forward the change'])), []);
  assert.deepEqual(evaluateNegatives(minMatches(ROLLBACK, ['we rolled back the change twice'])), { accepted: [], tested: 0 });
});

test('I-2: a contains pattern that accepts a declared negative is a problem', () => {
  const check = contains(ROLLBACK, ['the roll of the dice came back', 'we never roll forward the change']);
  assert.deepEqual(validateNegatives(check), []);
  const bad = contains(ROLLBACK, ['we rolled back the change twice', 'we never roll forward the change']);
  assert.deepEqual(validateNegatives(bad), ['negatives: the pattern accepts the declared negative "we rolled back the change twice"']);
  assert.deepEqual(evaluateNegatives(bad), { accepted: ['we rolled back the change twice'], tested: 2 });
});

test('I-2: a tolerant contains pattern with enough rejected negatives is valid', () => {
  const check = contains(ROLLBACK, ['the roll of the dice came back', 'we never roll forward the change']);
  assert.deepEqual(validateTask(makeTask([check])), []);
});

test('I-2: not_contains stays outside the rule, because a broad forbidden pattern can only reject more', () => {
  assert.deepEqual(validateNegatives({ type: 'not_contains', path: 'a.md', pattern: ROLLBACK }), []);
  assert.deepEqual(validateTask(makeTask([{ type: 'not_contains', path: 'a.md', pattern: ROLLBACK }])), []);
});

test('I-2: the other negative rules apply to every contains check (near miss, word characters, distinctness)', () => {
  assert.match(validateNegatives(contains(ROLLBACK, ['zz', 'we never roll forward the change']))[0], /fewer than 3 letters or digits/);
  assert.match(validateNegatives(contains(ROLLBACK, ['unrelated filler text', 'we never roll forward the change']))[0], /shares no 3-character fragment/);
  assert.match(validateNegatives(contains(ROLLBACK, ['we never roll forward the change', 'We never roll  forward the change']))[0], /got 1/);
});

// --- I-9: property escapes are classes, so a pattern built from them is tolerant --------------

test('I-9: a pattern built from \\p{...} is tolerant and needs negatives; it used to read as a literal', () => {
  // Behavior change (I-3 r4): the first two were `\p{Lu}\p{Ll}` and `\P{L}x`, which have fewer than
  // two literal characters and are rejected by the literal floor; they carry literal text now.
  for (const pattern of ['ab\\p{Lu}\\p{Ll}', '\\P{L}xy', 'risk \\p{Lu}']) {
    assert.deepEqual(validateNegatives(contains(pattern)), [
      'negatives: a tolerant pattern needs at least 2 distinct declared negatives, got 0',
    ], pattern);
  }
  assert.deepEqual(validateNegatives(contains('risk \\p{Lu}', ['risen tide', 'risky bet'])), []);
});

// --- I-1: a negative cannot hang validation ---------------------------------------------------

test('I-1: a pattern that does not finish on a declared negative is a problem, within the time limit', () => {
  // Eight optional parts and two open-ended ones pass the syntax rules but multiply on 1,000 `a`.
  const pattern = `${'a?'.repeat(8)}a*a*bc`;
  const check = contains(pattern, ['a'.repeat(1000), 'a'.repeat(999)]);
  const start = process.hrtime.bigint();
  const problems = validateNegatives(check);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(problems.length, 2);
  for (const problem of problems) assert.match(problem, /^negatives: the pattern did not finish within 1000 ms on the declared negative/);
  assert.ok(ms < 10000, `took ${ms} ms`);
  // evaluateNegatives is fail closed too: a negative that never finished is not a rejected one.
  assert.equal(evaluateNegatives(check).accepted.length, 2);
});

// --- R-3: invisible characters do not make a negative distinct ---------------------------------

const ONE_DISTINCT = 'negatives: a tolerant pattern needs at least 2 distinct declared negatives, got 1';

test('R-3: one negative and a copy with a zero-width character inside count once', () => {
  // Before R-3 these were two distinct strings, and one real negative satisfied the "two distinct" rule.
  const real = 'we never roll forward the change';
  for (const invisible of ['\u200b', '\u200c', '\u200d', '\u2060', '\ufeff', '\u00ad']) {
    const copy = real.replace('never', `ne${invisible}ver`);
    assert.notEqual(copy, real);
    assert.deepEqual(validateNegatives(contains(ROLLBACK, [real, copy])), [ONE_DISTINCT], JSON.stringify(invisible));
  }
});

test('R-3: an invisible character at the edge or between words changes nothing either', () => {
  const real = 'we never roll forward the change';
  for (const copy of [`\u200b${real}`, `${real}\u200b`, real.replace(' ', '\u200b '), real.replace(' ', ' \u200b ')]) {
    assert.deepEqual(validateNegatives(contains(ROLLBACK, [real, copy])), [ONE_DISTINCT], JSON.stringify(copy));
  }
});

test('R-3: compatibility forms count as the same negative, as they do for rubric items', () => {
  const real = 'we never roll forward the change';
  const wide = 'ｗｅ ｎｅｖｅｒ ｒｏｌｌ ｆｏｒｗａｒｄ ｔｈｅ ｃｈａｎｇｅ';
  assert.ok(validateNegatives(contains(ROLLBACK, [real, wide])).includes(ONE_DISTINCT));
});

test('R-3: two genuinely different negatives still count as two', () => {
  assert.deepEqual(validateNegatives(contains(ROLLBACK, ['we never roll forward the change', 'back the change up before the deploy'])), []);
  // An invisible character inside one does not merge it with an unrelated negative.
  assert.deepEqual(validateNegatives(contains(ROLLBACK, ['we never ro\u200bll forward the change', 'back the change up before the deploy'])), []);
});
