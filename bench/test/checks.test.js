// SPDX-License-Identifier: Apache-2.0
/**
 * Deterministic Task Checks unit tests
 *
 * Uses Node's built-in `node:test` and `node:assert`, so no test framework dependency is needed.
 * Run: node --test bench/test/checks.test.js
 *
 * Every snapshot is a plain object built inline. The tests read no files, spawn no processes and
 * make no network or model calls.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CHECK_KINDS,
  PATTERN_FLAGS,
  MAX_PATTERN_LENGTH,
  MAX_NEGATIVE_LENGTH,
  compilePattern,
  validateCheck,
  evalCheck,
  evalChecks,
} = require('../lib/checks');

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

// --- Definitions ------------------------------------------------------------------------------

test('the constants describe the supported kinds and limits', () => {
  // Behavior change (C): min_matches was removed from the kinds; see checks-soundness.test.js.
  assert.deepEqual([...CHECK_KINDS], ['file_exists', 'contains', 'not_contains', 'fixture_unchanged', 'file_absent']);
  assert.equal(PATTERN_FLAGS, 'imu'); // I-9: the unicode flag is part of the contract
  assert.equal(MAX_PATTERN_LENGTH, 500);
  assert.equal(MAX_NEGATIVE_LENGTH, 1000);
});

test('well-formed checks of every kind have no problems', () => {
  const checks = [
    { type: 'file_exists', path: 'a.md' },
    { type: 'contains', path: 'docs/a.md', pattern: 'hello' },
    { type: 'not_contains', path: 'a.md', pattern: 'TODO' },
    { type: 'fixture_unchanged', path: 'src' },
    { type: 'fixture_unchanged', path: 'src', allowAdditions: true },
    { type: 'fixture_unchanged', path: 'src', allowAdditions: false },
  ];
  for (const check of checks) assert.deepEqual(validateCheck(check), [], JSON.stringify(check));
});

test('a check that is not a plain object is one problem', () => {
  for (const bad of [undefined, null, 0, 'contains', true, [], [{ type: 'file_exists', path: 'a' }], () => 1]) {
    assert.deepEqual(validateCheck(bad), ['check: must be an object'], String(bad));
  }
});

test('the type must be one of the supported kinds', () => {
  const expected = ['type: must be one of file_exists, contains, not_contains, fixture_unchanged, file_absent'];
  for (const type of [undefined, null, 3, '', 'cmd', 'tests', 'Contains', 'toString', 'constructor', '__proto__', ['contains']]) {
    assert.deepEqual(validateCheck({ type, path: 'a.md', pattern: 'xx' }), expected, JSON.stringify(type));
  }
  assert.deepEqual(validateCheck({ path: 'a.md' }), expected);
});

test('required fields are reported when missing', () => {
  assert.deepEqual(validateCheck({ type: 'file_exists' }), ['path: missing']);
  assert.deepEqual(validateCheck({ type: 'contains' }), ['path: missing', 'pattern: missing']);
  assert.deepEqual(validateCheck({ type: 'not_contains', path: 'a' }), ['pattern: missing']);
  assert.deepEqual(validateCheck({ type: 'fixture_unchanged' }), ['path: missing']);
});

test('a field that belongs to another kind is an unknown field', () => {
  assert.deepEqual(validateCheck({ type: 'file_exists', path: 'a', pattern: 'xx' }), ['unknown field "pattern" for a file_exists check']);
  assert.deepEqual(validateCheck({ type: 'contains', path: 'a', pattern: 'xx', min: 2 }), ['unknown field "min" for a contains check']);
  assert.deepEqual(validateCheck({ type: 'contains', path: 'a', pattern: 'xx', cmd: 'ls' }), ['unknown field "cmd" for a contains check']);
  assert.deepEqual(validateCheck({ type: 'fixture_unchanged', path: 'a', pattern: 'xx' }), ['unknown field "pattern" for a fixture_unchanged check']);
});

test('path must be a relative path inside the workspace', () => {
  for (const path of ['', '/abs', '../up', 'a/../b', 'a//b', 'a\\b', './a', 'dir/', 3, null, ['a']]) {
    assert.deepEqual(
      validateCheck({ type: 'file_exists', path }),
      ['path: must be a relative path inside the workspace'],
      JSON.stringify(path),
    );
  }
});

test('allowAdditions must be a boolean when present', () => {
  for (const allowAdditions of ['true', 1, 0, null, {}]) {
    assert.deepEqual(
      validateCheck({ type: 'fixture_unchanged', path: 'a', allowAdditions }),
      ['allowAdditions: must be true or false'],
      JSON.stringify(allowAdditions),
    );
  }
});

test('a check with a throwing getter is reported, not thrown', () => {
  const check = { type: 'file_exists' };
  Object.defineProperty(check, 'path', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });
  assert.deepEqual(validateCheck(check), ['check: could not be inspected because reading a property threw']);
});

// --- Patterns ---------------------------------------------------------------------------------

test('compilePattern returns a case-insensitive multiline unicode expression', () => {
  const { regex, error } = compilePattern('^hello$');
  assert.equal(error, undefined);
  assert.equal(regex.flags, 'imu');
  assert.equal(regex.test('first\nHELLO\nlast'), true);
  assert.equal(compilePattern('xx', 'g').regex.flags, 'gimu');
});

test('a pattern at the length limit is accepted and one over it is not', () => {
  assert.ok(compilePattern('a'.repeat(MAX_PATTERN_LENGTH)).regex);
  assert.match(compilePattern('a'.repeat(MAX_PATTERN_LENGTH + 1)).error, /longer than 500 characters/);
});

test('patterns that are not strings, are empty or do not compile are problems', () => {
  for (const pattern of [undefined, null, 5, {}, ['a'], '']) {
    assert.equal(compilePattern(pattern).error, 'must be a non-empty string', String(pattern));
  }
  for (const pattern of ['(', '[a-', '*a', 'a{2,1}', '(?<n>a)(?<n>b)', '\\', '(?i)a']) {
    assert.match(compilePattern(pattern).error, /^is not a valid regular expression/, pattern);
  }
});

test('a pattern that matches the empty string is rejected', () => {
  for (const pattern of ['x*', 'a?', '(?:)', '^', '$', '^$', 'a|', '(a|)', '\\s*']) {
    assert.match(compilePattern(pattern).error, /matches the empty string/, pattern);
  }
  // 'x+' and 'a|b' used to be listed here as valid; C-3 now rejects them as single-character
  // patterns (see checks-soundness.test.js), so the valid examples are their two-character forms.
  for (const pattern of ['^# ', 'xx+', 'ab|cd', '\\bword\\b']) {
    assert.ok(compilePattern(pattern).regex, pattern);
  }
});

test('an invalid pattern in a check is reported by validateCheck', () => {
  const problems = validateCheck({ type: 'contains', path: 'a', pattern: '(' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^pattern: is not a valid regular expression/);
});

// --- file_exists ------------------------------------------------------------------------------

test('file_exists passes for a present file, including an empty one, and fails otherwise', () => {
  const snapshot = { 'a.md': 'x', 'empty.md': '' };
  assert.deepEqual(evalCheck(snapshot, { type: 'file_exists', path: 'a.md' }), { passed: true, detail: 'present' });
  assert.deepEqual(evalCheck(snapshot, { type: 'file_exists', path: 'empty.md' }), { passed: true, detail: 'present' });
  assert.deepEqual(evalCheck(snapshot, { type: 'file_exists', path: 'b.md' }), { passed: false, detail: 'missing' });
});

test('file_exists does not treat a directory prefix as a file', () => {
  assert.equal(evalCheck({ 'src/a.js': '1' }, { type: 'file_exists', path: 'src' }).passed, false);
});

test('file_exists does not see inherited object members', () => {
  for (const path of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
    assert.equal(evalCheck({}, { type: 'file_exists', path }).passed, false, path);
  }
});

test('a snapshot key named __proto__ is an ordinary path', () => {
  const snapshot = Object.fromEntries([['__proto__', 'payload']]);
  assert.equal(evalCheck(snapshot, { type: 'file_exists', path: '__proto__' }).passed, true);
  assert.equal(evalCheck(snapshot, { type: 'contains', path: '__proto__', pattern: 'payload' }).passed, true);
});

test('a path whose value is not a string does not exist', () => {
  assert.equal(evalCheck({ 'a.md': 5 }, { type: 'file_exists', path: 'a.md' }).passed, false);
  assert.equal(evalCheck({ 'a.md': null }, { type: 'file_exists', path: 'a.md' }).passed, false);
});

// --- contains ---------------------------------------------------------------------------------

test('contains passes on a match and fails on no match', () => {
  const snapshot = { 'a.md': 'Alpha beta gamma' };
  assert.deepEqual(evalCheck(snapshot, { type: 'contains', path: 'a.md', pattern: 'beta' }), { passed: true, detail: 'matched' });
  assert.deepEqual(evalCheck(snapshot, { type: 'contains', path: 'a.md', pattern: 'delta' }), { passed: false, detail: 'no match' });
});

test('contains ignores case and anchors at line boundaries', () => {
  const snapshot = { 'a.md': 'intro\n## Risks\nbody' };
  assert.equal(evalCheck(snapshot, { type: 'contains', path: 'a.md', pattern: 'ALPHA|intro' }).passed, true);
  assert.equal(evalCheck(snapshot, { type: 'contains', path: 'a.md', pattern: '^## risks$' }).passed, true);
  assert.equal(evalCheck(snapshot, { type: 'contains', path: 'a.md', pattern: '^risks' }).passed, false);
});

test('contains fails on a missing file or a non-string value with a reason', () => {
  assert.deepEqual(evalCheck({}, { type: 'contains', path: 'a.md', pattern: 'xx' }), { passed: false, detail: 'file missing' });
  assert.deepEqual(evalCheck({ 'a.md': 7 }, { type: 'contains', path: 'a.md', pattern: 'xx' }), {
    passed: false,
    detail: 'file content is not a string',
  });
});

test('contains treats pattern characters as expression syntax and escapes as literals', () => {
  const snapshot = { 'a.md': 'version 1.2 and v1x2' };
  assert.equal(evalCheck(snapshot, { type: 'contains', path: 'a.md', pattern: 'v1.2' }).passed, true, 'dot is a wildcard');
  assert.equal(evalCheck(snapshot, { type: 'contains', path: 'a.md', pattern: 'version 1\\.2' }).passed, true);
  assert.equal(evalCheck({ 'a.md': 'v1x2' }, { type: 'contains', path: 'a.md', pattern: 'v1\\.2' }).passed, false);
  assert.equal(evalCheck({ 'a.md': 'cost: $5 (est.)' }, { type: 'contains', path: 'a.md', pattern: '\\$5 \\(est\\.\\)' }).passed, true);
});

test('contains works on multi-line, CRLF and non-ASCII text', () => {
  assert.equal(evalCheck({ 'a.md': 'one\r\ntwo\r\nthree' }, { type: 'contains', path: 'a.md', pattern: '^two$' }).passed, true);
  assert.equal(evalCheck({ 'a.md': 'caf\u00e9 menu' }, { type: 'contains', path: 'a.md', pattern: 'caf\u00e9' }).passed, true);
  assert.equal(evalCheck({ 'a.md': 'line one\nline two' }, { type: 'contains', path: 'a.md', pattern: 'one.line' }).passed, false, 'dot stops at a newline');
});

test('contains supports alternation and backreferences, and a lookaround is refused', () => {
  // Behavior change (C): this test used to assert that `(?<=price )\d+(?= USD)` matches. Lookarounds
  // are no longer valid patterns; the matching `price \d+ USD` is the replacement.
  const snapshot = { 'a.md': 'roll back the change; abab; price 10 USD' };
  assert.equal(evalCheck(snapshot, { type: 'contains', path: 'a.md', pattern: 'roll(s|ed)? back|revert' }).passed, true);
  assert.equal(evalCheck(snapshot, { type: 'contains', path: 'a.md', pattern: '(ab)\\1' }).passed, true);
  assert.equal(evalCheck(snapshot, { type: 'contains', path: 'a.md', pattern: 'price \\d+ USD' }).passed, true);
  const lookaround = evalCheck(snapshot, { type: 'contains', path: 'a.md', pattern: '(?<=price )\\d+(?= USD)' });
  assert.equal(lookaround.passed, false);
  assert.match(lookaround.detail, /^malformed check: pattern: uses a lookahead or lookbehind/);
});

// --- not_contains -----------------------------------------------------------------------------

test('not_contains passes only when the file exists and the pattern is absent', () => {
  const snapshot = { 'a.md': 'clean text' };
  assert.deepEqual(evalCheck(snapshot, { type: 'not_contains', path: 'a.md', pattern: 'TODO' }), { passed: true, detail: 'no match' });
  assert.deepEqual(evalCheck({ 'a.md': 'a TODO here' }, { type: 'not_contains', path: 'a.md', pattern: 'todo' }), {
    passed: false,
    detail: 'matched',
  });
});

test('not_contains fails when the file is missing, so doing nothing cannot pass', () => {
  assert.deepEqual(evalCheck({}, { type: 'not_contains', path: 'a.md', pattern: 'TODO' }), { passed: false, detail: 'file missing' });
});

// --- min_matches (removed, finding C) ---------------------------------------------------------

test('min_matches is not a check kind any more: it is a validation error that names contains', () => {
  // Behavior change (C): this section tested min_matches counting ("3 matches, need 3") and its
  // missing-file result. The kind is gone; the same input now fails validation.
  const check = { type: 'min_matches', path: 'a.md', pattern: '^- ', min: 3 };
  const [problem, ...rest] = validateCheck(check);
  assert.deepEqual(rest, []);
  assert.match(problem, /^type: min_matches was removed .*; use contains with a pattern that spans the structure you need$/);
  assert.deepEqual(evalCheck({ 'a.md': '- one\n- two\n- three' }, check), { passed: false, detail: `malformed check: ${problem}` });
});

test('repeated evaluation of the same check gives the same answer', () => {
  const snapshot = { 'a.md': 'ab ab ab' };
  const contains = { type: 'contains', path: 'a.md', pattern: 'ab' };
  for (let i = 0; i < 4; i += 1) {
    assert.equal(evalCheck(snapshot, contains).passed, true);
  }
});

// --- fixture_unchanged ------------------------------------------------------------------------

const PRISTINE = { 'src/a.js': 'one', 'src/b.js': 'two', 'src2/c.js': 'other', 'README.md': 'readme' };

test('fixture_unchanged passes for an identical file and an identical directory', () => {
  const options = { pristine: PRISTINE };
  assert.deepEqual(evalCheck({ ...PRISTINE }, { type: 'fixture_unchanged', path: 'README.md' }, options), { passed: true, detail: 'identical' });
  assert.deepEqual(evalCheck({ ...PRISTINE }, { type: 'fixture_unchanged', path: 'src' }, options), { passed: true, detail: 'identical' });
});

test('fixture_unchanged fails when a file changed, and names it', () => {
  const result = evalCheck({ ...PRISTINE, 'src/a.js': 'edited' }, { type: 'fixture_unchanged', path: 'src' }, { pristine: PRISTINE });
  assert.deepEqual(result, { passed: false, detail: 'changed 1 ("src/a.js")' });
});

test('fixture_unchanged fails when a file is deleted', () => {
  const workspace = { ...PRISTINE };
  delete workspace['src/b.js'];
  const result = evalCheck(workspace, { type: 'fixture_unchanged', path: 'src' }, { pristine: PRISTINE });
  assert.deepEqual(result, { passed: false, detail: 'missing 1 ("src/b.js")' });
});

test('fixture_unchanged fails on an added file unless allowAdditions is true', () => {
  const workspace = { ...PRISTINE, 'src/new.js': 'added' };
  const options = { pristine: PRISTINE };
  assert.deepEqual(evalCheck(workspace, { type: 'fixture_unchanged', path: 'src' }, options), {
    passed: false,
    detail: 'extra 1 ("src/new.js")',
  });
  assert.equal(evalCheck(workspace, { type: 'fixture_unchanged', path: 'src', allowAdditions: false }, options).passed, false);
  assert.equal(evalCheck(workspace, { type: 'fixture_unchanged', path: 'src', allowAdditions: true }, options).passed, true);
});

test('allowAdditions still fails on a changed or removed file', () => {
  const options = { pristine: PRISTINE };
  const check = { type: 'fixture_unchanged', path: 'src', allowAdditions: true };
  assert.equal(evalCheck({ ...PRISTINE, 'src/a.js': 'edited', 'src/new.js': 'x' }, check, options).passed, false);
  const removed = { ...PRISTINE, 'src/new.js': 'x' };
  delete removed['src/a.js'];
  assert.equal(evalCheck(removed, check, options).passed, false);
});

test('fixture_unchanged reports every kind of difference together', () => {
  const workspace = { 'src/a.js': 'edited', 'src/new.js': 'x', 'src2/c.js': 'other', 'README.md': 'readme' };
  const result = evalCheck(workspace, { type: 'fixture_unchanged', path: 'src' }, { pristine: PRISTINE });
  assert.deepEqual(result, { passed: false, detail: 'missing 1 ("src/b.js"), changed 1 ("src/a.js"), extra 1 ("src/new.js")' });
});

test('fixture_unchanged on a directory does not capture a sibling with the same prefix', () => {
  const workspace = { ...PRISTINE, 'src2/c.js': 'changed' };
  assert.equal(evalCheck(workspace, { type: 'fixture_unchanged', path: 'src' }, { pristine: PRISTINE }).passed, true);
  assert.equal(evalCheck(workspace, { type: 'fixture_unchanged', path: 'src2' }, { pristine: PRISTINE }).passed, false);
});

test('fixture_unchanged needs a pristine snapshot that holds the path', () => {
  const check = { type: 'fixture_unchanged', path: 'src' };
  for (const options of [undefined, null, {}, { pristine: null }, { pristine: 'text' }, { pristine: [] }]) {
    assert.deepEqual(evalCheck({ ...PRISTINE }, check, options), { passed: false, detail: 'no pristine snapshot supplied' });
  }
  assert.deepEqual(evalCheck({ ...PRISTINE }, { type: 'fixture_unchanged', path: 'docs' }, { pristine: PRISTINE }), {
    passed: false,
    detail: 'path not in the pristine snapshot',
  });
});

test('fixture_unchanged treats a non-string workspace value as a change', () => {
  const result = evalCheck({ ...PRISTINE, 'README.md': 5 }, { type: 'fixture_unchanged', path: 'README.md' }, { pristine: PRISTINE });
  assert.equal(result.passed, false);
});

// --- Malformed input at evaluation time -------------------------------------------------------

test('a malformed check fails with the first problem and never throws', () => {
  const snapshot = { 'a.md': 'x' };
  const cases = [
    [{ type: 'contains', path: 'a.md' }, 'malformed check: pattern: missing'],
    [{ type: 'contains', path: 'a.md', pattern: '(' }, /^malformed check: pattern: is not a valid regular expression/],
    [{ type: 'contains', path: 'a.md', pattern: 'x*' }, /^malformed check: pattern: matches the empty string/],
    [{ type: 'file_exists', path: '../a.md' }, 'malformed check: path: must be a relative path inside the workspace'],
    [{ type: 'contains', path: 'a.md', pattern: 'xx', min: 0 }, 'malformed check: unknown field "min" for a contains check'],
    [{ type: 'cmd', path: 'a.md' }, /^malformed check: type: must be one of/],
    [null, 'malformed check: check: must be an object'],
  ];
  for (const [check, expected] of cases) {
    const result = evalCheck(snapshot, check);
    assert.equal(result.passed, false);
    if (typeof expected === 'string') assert.equal(result.detail, expected);
    else assert.match(result.detail, expected);
  }
});

test('a snapshot that is not a plain object fails every kind', () => {
  const checks = [
    { type: 'file_exists', path: 'a' },
    { type: 'contains', path: 'a', pattern: 'xx' },
    { type: 'not_contains', path: 'a', pattern: 'xx' },
    { type: 'file_absent', path: 'a' },
    { type: 'fixture_unchanged', path: 'a' },
  ];
  for (const snapshot of [undefined, null, 'text', 5, [], [['a', 'x']]]) {
    for (const check of checks) {
      assert.deepEqual(
        evalCheck(snapshot, check, { pristine: { a: 'x' } }),
        { passed: false, detail: 'workspace snapshot must be a plain object' },
        `${String(snapshot)} ${check.type}`,
      );
    }
  }
});

test('a hostile snapshot with a throwing getter is a failed check, not a throw', () => {
  const snapshot = {};
  Object.defineProperty(snapshot, 'a.md', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });
  assert.deepEqual(evalCheck(snapshot, { type: 'contains', path: 'a.md', pattern: 'xx' }), {
    passed: false,
    detail: 'check could not be evaluated',
  });
});

test('evaluation does not modify a frozen snapshot or check', () => {
  const snapshot = deepFreeze({ 'src/a.js': 'one', 'doc.md': '- a\n- b' });
  const pristine = deepFreeze({ 'src/a.js': 'one' });
  const checks = deepFreeze([
    { type: 'file_exists', path: 'doc.md' },
    { type: 'contains', path: 'doc.md', pattern: '- a' },
    { type: 'not_contains', path: 'doc.md', pattern: 'zzz' },
    { type: 'contains', path: 'doc.md', pattern: '^- ' },
    { type: 'fixture_unchanged', path: 'src' },
  ]);
  const results = evalChecks(snapshot, checks, { pristine });
  assert.equal(results.length, 5);
  assert.ok(results.every((r) => r.passed), JSON.stringify(results));
});

// --- evalChecks -------------------------------------------------------------------------------

test('evalChecks returns one result per check in order, with index, type and path', () => {
  const snapshot = { 'a.md': 'alpha' };
  const results = evalChecks(snapshot, [
    { type: 'file_exists', path: 'a.md' },
    { type: 'contains', path: 'a.md', pattern: 'beta' },
    { type: 'file_exists', path: 'b.md' },
  ]);
  assert.deepEqual(results, [
    { index: 0, type: 'file_exists', path: 'a.md', passed: true, detail: 'present' },
    { index: 1, type: 'contains', path: 'a.md', passed: false, detail: 'no match' },
    { index: 2, type: 'file_exists', path: 'b.md', passed: false, detail: 'missing' },
  ]);
});

test('evalChecks reports a malformed entry in place and carries on', () => {
  const results = evalChecks({ 'a.md': 'x' }, [null, { type: 'banana' }, { type: 'file_exists', path: 'a.md' }]);
  assert.deepEqual(
    results.map((r) => [r.index, r.type, r.path, r.passed]),
    [
      [0, null, null, false],
      [1, 'banana', null, false],
      [2, 'file_exists', 'a.md', true],
    ],
  );
});

test('evalChecks returns an empty list for anything that is not an array', () => {
  for (const checks of [undefined, null, {}, 'checks', 3]) assert.deepEqual(evalChecks({}, checks), []);
  assert.deepEqual(evalChecks({}, []), []);
});

test('evalChecks passes the pristine snapshot through to fixture_unchanged', () => {
  const results = evalChecks({ ...PRISTINE }, [{ type: 'fixture_unchanged', path: 'src' }], { pristine: PRISTINE });
  assert.equal(results[0].passed, true);
});

test('evalChecks survives an array-like that throws while read', () => {
  const hostile = new Proxy([{ type: 'file_exists', path: 'a' }], {
    get(target, key) {
      if (key === 'length') return 2;
      if (key === '1') throw new Error('boom');
      return Reflect.get(target, key);
    },
  });
  const results = evalChecks({ a: 'x' }, hostile);
  assert.equal(results.length, 1);
  assert.equal(results[0].passed, true);
});

// --- negatives on a contains check ------------------------------------------------------------

test('a contains check may declare negatives as a list of non-empty strings', () => {
  const base = { type: 'contains', path: 'a.md', pattern: 'ab|cd' };
  assert.deepEqual(validateCheck({ ...base, negatives: ['xyz', 'zzz'] }), []);
  assert.deepEqual(validateCheck({ ...base, negatives: [] }), []);
  assert.deepEqual(validateCheck({ ...base, negatives: ['z'.repeat(MAX_NEGATIVE_LENGTH)] }), []);
});

test('negatives must be an array of non-empty strings within the length limit', () => {
  const base = { type: 'contains', path: 'a.md', pattern: 'ab|cd' };
  const expected = [`negatives: must be an array of non-empty strings, each at most ${MAX_NEGATIVE_LENGTH} characters`];
  for (const negatives of ['text', null, 5, {}, [''], [3], ['ok', null], [['nested']], ['z'.repeat(MAX_NEGATIVE_LENGTH + 1)]]) {
    assert.deepEqual(validateCheck({ ...base, negatives }), expected, JSON.stringify(negatives));
  }
});

test('negatives belong to the check that asserts a pattern: contains', () => {
  // Behavior change (C): this test also asserted that min_matches takes negatives (I-2). The kind is gone.
  assert.deepEqual(validateCheck({ type: 'not_contains', path: 'a.md', pattern: 'xx', negatives: ['y'] }), [
    'unknown field "negatives" for a not_contains check',
  ]);
  assert.deepEqual(validateCheck({ type: 'contains', path: 'a.md', pattern: 'xx', negatives: ['y'] }), []);
  assert.deepEqual(validateCheck({ type: 'contains', path: 'a.md', pattern: 'xx', negatives: 'y' }), [
    `negatives: must be an array of non-empty strings, each at most ${MAX_NEGATIVE_LENGTH} characters`,
  ]);
  assert.deepEqual(validateCheck({ type: 'file_exists', path: 'a.md', negatives: ['y'] }), [
    'unknown field "negatives" for a file_exists check',
  ]);
});

test('evaluating a workspace ignores the declared negatives', () => {
  const check = { type: 'contains', path: 'a.md', pattern: 'alpha|beta', negatives: ['alpha'] };
  assert.equal(evalCheck({ 'a.md': 'alpha' }, check).passed, true);
  assert.equal(evalCheck({ 'a.md': 'gamma' }, check).passed, false);
});
