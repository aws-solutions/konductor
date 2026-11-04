// SPDX-License-Identifier: Apache-2.0
/**
 * Soundness tests for the check matcher (finding C-3)
 *
 * Each test encodes a concrete attack on the matcher: a pattern that matches arbitrary prose and
 * so lets a workspace pass a check without doing the work. Every one of them passed under the
 * matcher as first written.
 *
 * Run: node --test bench/test/checks-soundness.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MIN_PATTERN_CHARS,
  MATCH_TIMEOUT_MS,
  compilePattern,
  testBounded,
  isIndeterminate,
  validateCheck,
  evalCheck,
  evalChecks,
} = require('../lib/checks');

const PROSE = 'The planets orbit the sun. We plan the work, then explain the plan.\n- item one\n- item two\n';

// --- C-3: zero-width and single-character patterns --------------------------------------------

test('C-3: a zero-width pattern is rejected, because it matches arbitrary prose', () => {
  // Behavior change (C): the lookaround patterns that this test listed (`(?=a)`, `(?<=a)` ...) are
  // now rejected as lookarounds, before the zero-width rule is reached; see the C tests below.
  for (const pattern of ['\\b', '\\B', '\\b\\b', '^\\b', '(?:\\b)']) {
    const { error, regex } = compilePattern(pattern);
    assert.equal(regex, undefined, `${pattern} compiled`);
    // `\B` also matches the empty string, which is rejected first; both are rejections.
    assert.match(error, /zero-width|matches the empty string/, pattern);
  }
  for (const pattern of ['\\b', '^\\b', '(?:\\b)']) assert.match(compilePattern(pattern).error, /zero-width/, pattern);
});

test('C-3: a pattern that can match a single character is rejected, because it matches arbitrary prose', () => {
  for (const pattern of ['e', 'a', '.', '\\.', '[ab]', '[a-z]', '\\w', '\\d', 'x+', 'e+', 'a|b', 'a|bc', '\\ba', 'a{1}', '^#']) {
    const { error, regex } = compilePattern(pattern);
    assert.equal(regex, undefined, `${pattern} compiled`);
    assert.match(error, /single character/, pattern);
  }
});

test('C-3: the rejection reaches validateCheck, so a task carrying such a check is invalid', () => {
  for (const type of ['contains', 'not_contains']) {
    const problems = validateCheck({ type, path: 'a.md', pattern: '\\b' });
    assert.equal(problems.length, 1, type);
    assert.match(problems[0], /^pattern: is zero-width/);
  }
  const single = validateCheck({ type: 'contains', path: 'a.md', pattern: 'e' });
  assert.match(single[0], /^pattern: can match a single character/);
});

test('C-3: the rejection reaches evalCheck, so a bad pattern fails on every workspace instead of passing on prose', () => {
  for (const pattern of ['\\b', '(?=a)', '(?<=a)', 'e', '.', 't(?=h)', '(?<=r)o']) {
    const result = evalCheck({ 'a.md': PROSE }, { type: 'contains', path: 'a.md', pattern });
    assert.equal(result.passed, false, pattern);
    assert.match(result.detail, /^malformed check: pattern: /, pattern);
  }
});

test('C-3: a pattern that consumes at least two characters is still accepted', () => {
  // Behavior change (C): `(?<=price )\d+(?= USD)` left this list. It was admitted only through the
  // span rule that counted lookaround text, which is gone; see the lookaround tests below.
  assert.equal(MIN_PATTERN_CHARS, 2);
  // Behavior change (I-3 r4): `\d\d` and `[ab]{2}` left this list. Each is made of character classes
  // with no literal text, so they are rejected by the literal floor (MIN_LITERAL_CHARS);
  // `id\d\d` and `k[ab]{2}z` keep what these two showed, a short class pattern, with literal text added.
  for (const pattern of ['ab', '^# ', '^- ', 'xx+', 'ab|cd', '\\bword\\b', 'price \\d+ USD', 'id\\d\\d', '(ab)\\1', 'k[ab]{2}z']) {
    assert.ok(compilePattern(pattern).regex, pattern);
  }
});

// --- C: lookarounds are refused, and the strict consumed-length rule is back -------------------

test('C: every lookaround form is rejected by compilePattern with an error that says why', () => {
  for (const pattern of ['ab(?=c)', 'ab(?!c)', '(?<=a)bc', '(?<!a)bc', '(?:ab(?=c))+', 'x(?:(?=a)b|cd)', '(ab(?<=b))c']) {
    const { error, regex } = compilePattern(pattern);
    assert.equal(regex, undefined, `${pattern} compiled`);
    assert.match(error, /^uses a lookahead or lookbehind \(\(\?=, \(\?!, \(\?<=, \(\?<!\), which is not allowed: .*arbitrary prose/, pattern);
  }
});

test('C: the prose-matching patterns that the span rule admitted are rejected, and they matched prose', () => {
  // From the review (f1.js): each of these validated, and each matched this sentence.
  const prose = 'We rolled the release back after the checks failed on the staging cluster yesterday.';
  for (const pattern of ['t(?=h)', 'e(?=l)', '(?<=r)o', '(?=.)x', '.(?=.)', '\\w(?=\\w)', '(?<=\\w)\\w', '(?!zz)e', 'e(?!zz)']) {
    assert.match(compilePattern(pattern).error, /^uses a lookahead or lookbehind/, pattern);
    assert.match(validateCheck({ type: 'contains', path: 'out.md', pattern })[0], /^pattern: uses a lookahead or lookbehind/, pattern);
    assert.equal(evalCheck({ 'out.md': prose }, { type: 'contains', path: 'out.md', pattern }).passed, false, pattern);
  }
});

test('C: a lookaround is rejected wherever the pattern is used, including not_contains', () => {
  for (const type of ['contains', 'not_contains']) {
    assert.match(validateCheck({ type, path: 'a.md', pattern: 'ab(?=c)' })[0], /^pattern: uses a lookahead or lookbehind/, type);
  }
});

test('C: an escaped or bracketed "(?=" is text, not a lookaround', () => {
  for (const pattern of ['\\(\\?=ab', 'a[(?=]b', 'a\\(?=b']) {
    assert.equal(compilePattern(pattern).error, undefined, pattern);
  }
});

test('C: the consumed-length rule is strict again: a one-character match is rejected however much context surrounds it', () => {
  // The span rule counted lookaround text, so a one-character pattern with context validated. Without
  // lookarounds the only way to reach a short minimum is a short consumed length, which is refused.
  for (const pattern of ['x?y', 'a|b', '(?:ab)?c', 'x{0,3}y', '[ab]']) {
    assert.match(compilePattern(pattern).error, /single character/, pattern);
  }
});

test('C: the whole-word wrapper is the only lookaround in a compiled regex', () => {
  assert.match(compilePattern('plan').regex.source, /^\(\?<!\[.*\]\)\(\?:plan\)\(\?!\[.*\]\)$/);
  assert.equal(compilePattern('plan|design').regex.source, 'plan|design');
});

// --- C-3: strict literals match whole words ---------------------------------------------------

test('C-3: a literal does not match inside a longer word', () => {
  const snapshot = { 'a.md': 'The planets orbit. An explanation follows. Replanted.' };
  assert.equal(evalCheck(snapshot, { type: 'contains', path: 'a.md', pattern: 'plan' }).passed, false);
  assert.equal(evalCheck(snapshot, { type: 'contains', path: 'a.md', pattern: 'plan' }).detail, 'no match');
});

test('C-3: a literal still matches as a whole word, next to punctuation and at line edges', () => {
  for (const text of ['We plan the work', 'the plan.', '(plan)', 'plan', 'x\nplan\ny', 'PLAN', 'a plan, b', 'the-plan-b', 'plan_b is not it.\nplan']) {
    assert.equal(evalCheck({ 'a.md': text }, { type: 'contains', path: 'a.md', pattern: 'plan' }).passed, true, text);
  }
});

test('C-3: whole-word matching treats underscores, digits and accented letters as part of a word', () => {
  const check = { type: 'contains', path: 'a.md', pattern: 'plan' };
  for (const text of ['plan_b', 'plan2', 'plan\u00e9', '\u00e9plan', '_plan']) {
    assert.equal(evalCheck({ 'a.md': text }, check).passed, false, text);
  }
});

test('C-3: a literal that starts or ends with punctuation needs no boundary on that side', () => {
  const snapshot = { 'a.md': 'run it with --dry-run-mode on' };
  assert.equal(evalCheck(snapshot, { type: 'contains', path: 'a.md', pattern: '--dry-run' }).passed, true);
  assert.equal(evalCheck({ 'a.md': 'x--dry-run' }, { type: 'contains', path: 'a.md', pattern: '--dry-run' }).passed, true);
});

test('C-3: an anchored literal keeps its anchors and its word boundary', () => {
  const check = { type: 'contains', path: 'a.md', pattern: '^plan$' };
  assert.equal(evalCheck({ 'a.md': 'intro\nplan\nend' }, check).passed, true);
  assert.equal(evalCheck({ 'a.md': 'intro\nplans\nend' }, check).passed, false);
});

test('C-3: not_contains keeps substring matching, so a forbidden word inside a longer word is still caught', () => {
  const check = { type: 'not_contains', path: 'a.md', pattern: 'secret' };
  assert.equal(evalCheck({ 'a.md': 'the secrets are here' }, check).passed, false);
  assert.equal(evalCheck({ 'a.md': 'nothing to see' }, check).passed, true);
});

test('C-3: a tolerant pattern is left as the author wrote it', () => {
  const check = { type: 'contains', path: 'a.md', pattern: 'plan|design' };
  assert.equal(evalCheck({ 'a.md': 'planets' }, check).passed, true);
});

test('C-3: a prose file no longer satisfies a battery of cheap patterns', () => {
  const cheap = ['\\b', '(?=a)', '(?<=a)', 'e', '.', '[a-z]', 'plan', 't(?=h)', '\\w(?=\\w)'].map((pattern) => ({ type: 'contains', path: 'a.md', pattern }));
  const passed = evalChecks({ 'a.md': 'The planets and an explanation, nothing more.' }, cheap).filter((r) => r.passed);
  assert.deepEqual(passed, []);
});

// --- I-1: a hostile pattern cannot hang the harness -------------------------------------------

/** Seconds-scale work is a failure here; a rejection or a timed-out check must be well under it. */
function elapsedMs(run) {
  const start = process.hrtime.bigint();
  const result = run();
  return { result, ms: Number(process.hrtime.bigint() - start) / 1e6 };
}

const PROSE_78 = 'The planner reads each ticket before it writes a single word of the plan today';

test('I-1: (\\w+\\s?)+: is rejected at validation, so 78 characters of prose cannot hang evaluation', () => {
  assert.equal(PROSE_78.length, 78);
  const check = { type: 'contains', path: 'a.md', pattern: '(\\w+\\s?)+:' };
  const { result: problems, ms: validateMs } = elapsedMs(() => validateCheck(check));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^pattern: repeats a part of itself that can vary in length/);
  // Run against the prose, the unguarded expression took over 8 seconds. Rejection is instant.
  const { result, ms } = elapsedMs(() => evalCheck({ 'a.md': PROSE_78 }, check));
  assert.equal(result.passed, false);
  assert.match(result.detail, /^malformed check: pattern: repeats a part of itself/);
  assert.ok(validateMs < 500 && ms < 500, `took ${validateMs} ms to validate and ${ms} ms to evaluate`);
});

test('I-1: the exponential family is rejected by its syntax, not by running it', () => {
  const nested = ['(a+)+$', '(a*)*b', '(\\w+\\s?)+:', '(?:\\d+,?)+x', '(?:a?){30}a{30}', '(?:[ab]+c?)*d', '((ab+)+c)+d', '(a{1,9}){1,9}b'];
  for (const pattern of nested) {
    const { error, regex } = compilePattern(pattern);
    assert.equal(regex, undefined, pattern);
    assert.match(error, /repeats a part of itself that can vary in length/, pattern);
  }
  const alternations = ['(a|aa)+$', '(a|a)*b', '(?:ab|a)+c', '(?:x|)+yz', '(?:foo|f)+bar', '(?:AB|ab)+c', '(?:(?:ab)|a)+c'];
  for (const pattern of alternations) {
    const { error, regex } = compilePattern(pattern);
    assert.equal(regex, undefined, pattern);
    assert.match(error, /repeats an alternation whose branches can start with the same character/, pattern);
  }
  // Thirty optional parts in a row followed by thirty required ones multiply on text that almost matches.
  const sequential = `${'a?'.repeat(30)}${'a'.repeat(30)}`;
  assert.match(compilePattern(sequential).error, /30 optional or variable-length parts/);
});

test('I-1: more than two open-ended quantifiers is rejected, because three took 63 seconds on 1,000 characters', () => {
  for (const pattern of ['a*a*a*b', 'a.*b.*c.*d', 'roll\\s+back\\s+the\\s+change']) {
    assert.match(compilePattern(pattern).error, /3 open-ended quantifiers/, pattern);
  }
  assert.ok(compilePattern('roll\\s{1,16}back\\s{1,16}the\\s{1,16}change').regex);
});

test('I-1: the same shapes reach every check kind that carries a pattern', () => {
  for (const type of ['contains', 'not_contains']) {
    assert.match(validateCheck({ type, path: 'a.md', pattern: '(a+)+$' })[0], /^pattern: repeats a part of itself/);
  }
  assert.match(validateCheck({ type: 'contains', path: 'a.md', pattern: '(a|aa)+$' })[0], /^pattern: repeats an alternation/);
});

test('I-1: ordinary patterns with repeats, optional parts and distinct alternatives are still accepted', () => {
  const fine = [
    '(?:foo|bar)+', 'roll(s|ed)? back (the )?(change|deploy(ment)?)', '(?:\\d{1,3}\\.){3}\\d+', '\\d+ items', '(?:ab)+', '^#+ \\w+',
    '(?:one|six|nine){2}', 'a.*b', 'colou?r', '(?:ab){3}c', '\\bplan(?:s|ned|ning)?\\b', '(?:[a-z]{2}-){2}[a-z]{2}',
  ];
  for (const pattern of fine) assert.ok(compilePattern(pattern).regex, `${pattern}: ${compilePattern(pattern).error}`);
});

test('I-1: a pattern that passes the syntax rules but is slow on the text fails its check within the limit', () => {
  // `a.*b` is fine to write, yet takes about 30 seconds on 200,000 `a`: syntax cannot bound it.
  const snapshot = { 'a.md': 'a'.repeat(200000) };
  assert.deepEqual(validateCheck({ type: 'contains', path: 'a.md', pattern: 'a.*b' }), []);
  for (const [check, wantDetail] of [[{ type: 'contains', path: 'a.md', pattern: 'a.*b' }, /did not finish within 1000 ms/]]) {
    const { result, ms } = elapsedMs(() => evalCheck(snapshot, check));
    assert.equal(result.passed, false, check.type);
    assert.match(result.detail, wantDetail, check.type);
    assert.ok(ms < 10 * MATCH_TIMEOUT_MS, `${check.type} took ${ms} ms`);
  }
});

test('A: isIndeterminate separates a failure that says nothing about the workspace from a real failure', () => {
  const slow = evalCheck({ 'a.md': 'a'.repeat(200000) }, { type: 'contains', path: 'a.md', pattern: 'a.*b' });
  const unevaluable = evalCheck({ 'a.md': 'x' }, { get type() { throw new Error('boom'); } });
  assert.equal(isIndeterminate(slow), true);
  assert.equal(isIndeterminate(unevaluable), true);
  // An ordinary miss, a missing file and a pass are verdicts about the workspace.
  assert.equal(isIndeterminate(evalCheck({ 'a.md': 'text' }, { type: 'contains', path: 'a.md', pattern: 'absent' })), false);
  assert.equal(isIndeterminate(evalCheck({}, { type: 'contains', path: 'a.md', pattern: 'absent' })), false);
  assert.equal(isIndeterminate(evalCheck({ 'a.md': 'text' }, { type: 'contains', path: 'a.md', pattern: 'text' })), false);
  for (const value of [undefined, null, {}, { passed: true, detail: 'check could not be evaluated' }]) assert.equal(isIndeterminate(value), false);
});

test('I-1: a timed-out not_contains fails instead of passing, because it proved nothing', () => {
  const snapshot = { 'a.md': 'a'.repeat(200000) };
  const { result, ms } = elapsedMs(() => evalCheck(snapshot, { type: 'not_contains', path: 'a.md', pattern: 'a.*b' }));
  assert.equal(result.passed, false);
  assert.match(result.detail, /did not finish within 1000 ms/);
  assert.ok(ms < 10 * MATCH_TIMEOUT_MS, `took ${ms} ms`);
});

test('I-1: testBounded gives true or false when the match finishes and null when it does not', () => {
  assert.equal(MATCH_TIMEOUT_MS, 1000);
  assert.equal(testBounded(/plan/i, 'a plan'), true);
  assert.equal(testBounded(/plan/i, 'nothing'), false);
  assert.equal(testBounded(new RegExp('a.*b', 'imu'), 'a'.repeat(200000)), null);
  // The shared context is left usable after a timeout, and keeps no reference to the last input.
  assert.equal(testBounded(/plan/i, 'a plan'), true);
});

// --- I-9: patterns compile in unicode mode ----------------------------------------------------

test('I-9: \\p{L} is a letter class, not the letter p followed by literal braces', () => {
  // Behavior change (I-3 r4): the patterns were `\p{L}{3,}` and `\p{Lu}\p{Ll}+`, which are classes
  // with no literal text and are now rejected. They carry the literal `id ` and `Mr ` in front.
  const check = { type: 'contains', path: 'a.md', pattern: 'id \\p{L}{3,}' };
  assert.equal(evalCheck({ 'a.md': 'id h\u00e9llo' }, check).passed, true);
  assert.equal(evalCheck({ 'a.md': 'id 123 456' }, check).passed, false);
  // Compiled without `u`, this pattern was `p{L}` plus a quantifier on `}`, so only this text passed it.
  assert.equal(evalCheck({ 'a.md': 'id p{L}}}' }, check).passed, false);
  assert.equal(evalCheck({ 'a.md': 'Mr Caf\u00c9' }, { type: 'contains', path: 'a.md', pattern: 'Mr \\p{Lu}\\p{Ll}+' }).passed, true);
});

test('I-9: a lone \\p{L} is rejected as a single-character pattern; it used to pass as the four literal characters p{L}', () => {
  const { error, regex } = compilePattern('\\p{L}');
  assert.equal(regex, undefined);
  assert.match(error, /single character/);
});

test('I-9: \\u{...} and surrogate-pair escapes name one character', () => {
  const accented = { type: 'contains', path: 'a.md', pattern: 'caf\\u{e9}' };
  assert.equal(evalCheck({ 'a.md': 'a caf\u00e9 here' }, accented).passed, true);
  assert.equal(evalCheck({ 'a.md': 'cafu{e9}' }, accented).passed, false);
  const emoji = { type: 'contains', path: 'a.md', pattern: 'ok \\uD83D\\uDE00' };
  assert.equal(evalCheck({ 'a.md': 'ok \ud83d\ude00' }, emoji).passed, true);
  assert.equal(compilePattern('x\\u{1F600}').regex.test('x\ud83d\ude00'), true);
});

test('I-9: a pattern that compiled before but throws under u is a validation error that says so', () => {
  for (const pattern of ['a\\-b', '{{name}}', 'x]', 'a\\_b', 'path\\/to\\ file']) {
    const { error, regex } = compilePattern(pattern);
    assert.equal(regex, undefined, pattern);
    assert.match(error, /^is not valid in unicode mode, which every check pattern uses/, pattern);
    const problems = validateCheck({ type: 'contains', path: 'a.md', pattern });
    assert.equal(problems.length, 1, pattern);
    assert.match(problems[0], /^pattern: is not valid in unicode mode/, pattern);
    const result = evalCheck({ 'a.md': 'a-b {{name}} x] a_b path/to file' }, { type: 'contains', path: 'a.md', pattern });
    assert.equal(result.passed, false, pattern);
    assert.match(result.detail, /^malformed check: pattern: is not valid in unicode mode/, pattern);
  }
});

test('I-9: an expression that is broken either way keeps the plain invalid-expression message', () => {
  for (const pattern of ['(', 'a(?<n>b', '[b-a]', '*x']) {
    assert.match(compilePattern(pattern).error, /^is not a valid regular expression/, pattern);
  }
});

test('I-9: valid escapes of syntax characters still compile', () => {
  // Behavior change (I-3 r4): `\(x\)` is three literal characters but `[\-a]b` is one literal and a
  // class, so the second is written `[\-a]bc`.
  for (const pattern of ['a\\.b', '\\(x\\)', '\\$5 total', 'a\\/b', '\\{x\\}', '[\\-a]bc', 'x\\|yz']) {
    assert.ok(compilePattern(pattern).regex, `${pattern}: ${compilePattern(pattern).error}`);
  }
});

// --- I-7: file_absent and byte-exact fixture_unchanged ------------------------------------------

test('I-7: file_absent passes when nothing is at the path and fails when a file is', () => {
  const check = { type: 'file_absent', path: 'CHANGELOG.md' };
  assert.deepEqual(evalCheck({ 'NOTES.md': 'x' }, check), { passed: true, detail: 'absent' });
  assert.deepEqual(evalCheck({}, check), { passed: true, detail: 'absent' });
  assert.deepEqual(evalCheck({ 'CHANGELOG.md': 'x' }, check), { passed: false, detail: 'present ("CHANGELOG.md")' });
});

test('I-7: file_absent counts an empty file, and a value that is not a string, as present', () => {
  const check = { type: 'file_absent', path: 'CHANGELOG.md' };
  // The detail is asserted too: a check kind the matcher does not know also reports passed: false.
  for (const value of ['', 5, null]) {
    assert.deepEqual(evalCheck({ 'CHANGELOG.md': value }, check), { passed: false, detail: 'present ("CHANGELOG.md")' });
  }
});

test('I-7: file_absent on a directory fails while any file is still under it', () => {
  const check = { type: 'file_absent', path: 'docs' };
  assert.equal(evalCheck({ 'docs/a.md': 'x' }, check).passed, false);
  assert.equal(evalCheck({ 'docs/deep/b.md': '' }, check).passed, false);
  // A sibling that merely starts with the same letters is a different path.
  assert.equal(evalCheck({ 'docs-old/a.md': 'x', 'docsx': 'y' }, check).passed, true);
});

test('I-7: file_absent is not satisfied by changing the case or the Unicode form of the name', () => {
  const check = { type: 'file_absent', path: 'CHANGELOG.md' };
  for (const name of ['changelog.md', 'Changelog.md', 'ChangeLog.MD', '\uff23HANGELOG.md']) {
    const result = evalCheck({ [name]: 'x' }, check);
    assert.deepEqual(result, { passed: false, detail: `present (${JSON.stringify(name)})` }, name);
  }
  const accented = { type: 'file_absent', path: 'caf\u00e9.md' };
  assert.deepEqual(evalCheck({ 'cafe\u0301.md': 'x' }, accented), { passed: false, detail: 'present ("cafe\u0301.md")' });
});

test('I-7: file_absent is a well-formed check only with a safe path and no other field', () => {
  assert.deepEqual(validateCheck({ type: 'file_absent', path: 'a.md' }), []);
  assert.deepEqual(validateCheck({ type: 'file_absent' }), ['path: missing']);
  assert.deepEqual(validateCheck({ type: 'file_absent', path: '../a' }), ['path: must be a relative path inside the workspace']);
  assert.deepEqual(validateCheck({ type: 'file_absent', path: 'a', pattern: 'xx' }), ['unknown field "pattern" for a file_absent check']);
  assert.equal(evalCheck({}, { type: 'file_absent', path: '/etc/passwd' }).passed, false);
});

test('I-7: fixture_unchanged fails when a value is not a string, even if both sides are equal', () => {
  const pristine = { 'src/a.txt': 5 };
  const check = { type: 'fixture_unchanged', path: 'src' };
  assert.equal(evalCheck({ 'src/a.txt': 5 }, check, { pristine }).passed, false);
  assert.equal(evalCheck({ 'src/a.txt': '5' }, check, { pristine: { 'src/a.txt': '5' } }).passed, true);
});

test('I-7: fixture_unchanged tells two different lone surrogates apart, which is how invalid bytes are stored', () => {
  const check = { type: 'fixture_unchanged', path: 'blob.dat' };
  const pristine = { 'blob.dat': 'a\udcffb' };
  assert.equal(evalCheck({ 'blob.dat': 'a\udcffb' }, check, { pristine }).passed, true);
  assert.equal(evalCheck({ 'blob.dat': 'a\udcfeb' }, check, { pristine }).passed, false);
  assert.equal(evalCheck({ 'blob.dat': 'a\ufffdb' }, check, { pristine }).passed, false);
});
