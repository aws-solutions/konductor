// SPDX-License-Identifier: Apache-2.0
/**
 * workspaceChanges: which files a run added, edited or deleted, sorted, bounded by limits, and
 * deterministic. Pure functions only: no file access.
 * Run: node --test bench/test/workspace-changes.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { workspaceChanges, resolveLimits, DEFAULT_LIMITS } = require('../lib/workspace-changes');

const entry = (path, change, content, extra = {}) => ({
  path,
  change,
  content,
  truncated: false,
  omitted: false,
  ...extra,
});

test('added, edited and deleted paths are listed and untouched files are left out', () => {
  const start = { 'a.txt': 'same', 'b.txt': 'old', 'c.txt': 'gone' };
  const final = { 'a.txt': 'same', 'b.txt': 'new', 'd.txt': 'fresh' };
  assert.deepEqual(workspaceChanges(start, final), [
    entry('b.txt', 'edited', 'new'),
    entry('c.txt', 'deleted', null),
    entry('d.txt', 'added', 'fresh'),
  ]);
});

test('no change gives an empty list, including two empty snapshots', () => {
  assert.deepEqual(workspaceChanges({}, {}), []);
  assert.deepEqual(workspaceChanges({ 'a.txt': 'x' }, { 'a.txt': 'x' }), []);
});

test('an added or kept empty file is not confused with a missing one', () => {
  assert.deepEqual(workspaceChanges({}, { 'e.txt': '' }), [entry('e.txt', 'added', '')]);
  assert.deepEqual(workspaceChanges({ 'e.txt': '' }, {}), [entry('e.txt', 'deleted', null)]);
  assert.deepEqual(workspaceChanges({ 'e.txt': '' }, { 'e.txt': '' }), []);
  assert.deepEqual(workspaceChanges({ 'e.txt': '' }, { 'e.txt': 'x' }), [
    entry('e.txt', 'edited', 'x'),
  ]);
});

test('a difference in case or line ending is an edit', () => {
  assert.equal(workspaceChanges({ 'a.txt': 'Ab' }, { 'a.txt': 'ab' })[0].change, 'edited');
  assert.equal(workspaceChanges({ 'a.txt': 'a\n' }, { 'a.txt': 'a\r\n' })[0].change, 'edited');
});

test('entries are sorted by path in code-unit order, whatever order the keys come in', () => {
  const final = { 'z.md': '1', 'B.md': '2', 'a/b.md': '3', 'a.md': '4', 'é.md': '5' };
  const reversed = Object.fromEntries(Object.entries(final).reverse());
  const paths = workspaceChanges({}, final).map((e) => e.path);
  assert.deepEqual(paths, ['B.md', 'a.md', 'a/b.md', 'z.md', 'é.md']);
  assert.deepEqual(workspaceChanges({}, reversed), workspaceChanges({}, final));
});

test('the same inputs always give the same output and the inputs are not changed', () => {
  const start = Object.freeze({ 'a.txt': 'old', 'b.txt': 'x' });
  const final = Object.freeze({ 'a.txt': 'new', 'c.txt': 'y' });
  const limits = Object.freeze({ maxFileChars: 2 });
  const first = workspaceChanges(start, final, limits);
  assert.deepEqual(workspaceChanges(start, final, limits), first);
  assert.deepEqual(start, { 'a.txt': 'old', 'b.txt': 'x' });
  assert.deepEqual(final, { 'a.txt': 'new', 'c.txt': 'y' });
});

test('a path named like an object property is handled as a plain path', () => {
  const final = JSON.parse('{"__proto__":"payload","constructor":"c"}');
  const out = workspaceChanges({}, final);
  assert.deepEqual(
    out.map((e) => [e.path, e.content]),
    [
      ['__proto__', 'payload'],
      ['constructor', 'c'],
    ],
  );
  assert.equal(Object.getPrototypeOf(out[0]), Object.prototype);
});

// ---- limits ----------------------------------------------------------------------------------

test('defaults are documented values and are frozen', () => {
  assert.deepEqual(DEFAULT_LIMITS, { maxFileChars: 6000, maxTotalChars: 24000, maxFiles: 20 });
  assert.ok(Object.isFrozen(DEFAULT_LIMITS));
  assert.deepEqual(resolveLimits(), DEFAULT_LIMITS);
  assert.deepEqual(resolveLimits(null), DEFAULT_LIMITS);
  assert.deepEqual(resolveLimits({}), DEFAULT_LIMITS);
  assert.deepEqual(resolveLimits({ maxFiles: 3 }), { ...DEFAULT_LIMITS, maxFiles: 3 });
  assert.deepEqual(resolveLimits({ maxFiles: undefined }), DEFAULT_LIMITS);
});

test('a file over the per-file cap is cut and marked truncated', () => {
  const out = workspaceChanges({}, { 'a.txt': 'abcdef', 'b.txt': 'abc' }, { maxFileChars: 4 });
  assert.deepEqual(out, [
    entry('a.txt', 'added', 'abcd', { truncated: true }),
    entry('b.txt', 'added', 'abc'),
  ]);
  const exact = workspaceChanges({}, { 'a.txt': 'abcd' }, { maxFileChars: 4 });
  assert.equal(exact[0].truncated, false, 'a file exactly at the cap is whole');
});

test('a cut never splits a surrogate pair', () => {
  const text = 'ab\u{1F600}cd';
  const out = workspaceChanges({}, { 'a.txt': text }, { maxFileChars: 3 });
  assert.equal(out[0].content, 'ab');
  assert.equal(out[0].truncated, true);
  const whole = workspaceChanges({}, { 'a.txt': text }, { maxFileChars: 4 });
  assert.equal(whole[0].content, 'ab\u{1F600}');
});

test('past the total cap a file is cut to what is left and later entries are omitted', () => {
  const final = { 'a.txt': 'aaaa', 'b.txt': 'bbbb', 'c.txt': 'cccc', 'd.txt': 'dddd' };
  const out = workspaceChanges({}, final, { maxFileChars: 4, maxTotalChars: 6 });
  assert.deepEqual(out, [
    entry('a.txt', 'added', 'aaaa'),
    entry('b.txt', 'added', 'bb', { truncated: true }),
    entry('c.txt', 'added', null, { omitted: true }),
    entry('d.txt', 'added', null, { omitted: true }),
  ]);
});

test('past the file count the rest are listed by path and change only', () => {
  const final = { 'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c' };
  const start = { 'z.txt': 'gone' };
  const out = workspaceChanges(start, final, { maxFiles: 2 });
  assert.deepEqual(out, [
    entry('a.txt', 'added', 'a'),
    entry('b.txt', 'added', 'b'),
    entry('c.txt', 'added', null, { omitted: true }),
    entry('z.txt', 'deleted', null, { omitted: true }),
  ]);
});

test('a deleted file costs no content budget but counts as a listed file', () => {
  const out = workspaceChanges(
    { 'a.txt': 'x', 'b.txt': 'y' },
    { 'c.txt': 'zzzz' },
    { maxTotalChars: 4, maxFiles: 3 },
  );
  assert.deepEqual(out, [
    entry('a.txt', 'deleted', null),
    entry('b.txt', 'deleted', null),
    entry('c.txt', 'added', 'zzzz'),
  ]);
});

test('both arms of a pair get the same treatment from the same limits', () => {
  const start = { 'notes.md': 'draft' };
  const limits = { maxFileChars: 5, maxTotalChars: 8, maxFiles: 2 };
  const armA = workspaceChanges(start, { 'notes.md': 'draft plus a long line' }, limits);
  const armB = workspaceChanges(start, { 'notes.md': 'other plus a long line' }, limits);
  assert.deepEqual(
    armA.map(({ content, ...rest }) => [rest, content.length]),
    armB.map(({ content, ...rest }) => [rest, content.length]),
  );
});

test('an unknown option, a non-integer or a non-positive limit throws', () => {
  const bad = [
    { maxFileChar: 10 },
    { maxFiles: 1.5 },
    { maxFiles: 0 },
    { maxFiles: -1 },
    { maxTotalChars: '100' },
    { maxFileChars: NaN },
    { maxFileChars: Infinity },
    { maxFileChars: null },
    { maxTotalChars: 2 ** 60 },
  ];
  for (const limits of bad) {
    assert.throws(() => workspaceChanges({}, {}, limits), /limit/, JSON.stringify(limits));
  }
  assert.throws(() => workspaceChanges({}, {}, 5), /limits must be a plain object/);
  assert.throws(() => workspaceChanges({}, {}, []), /limits must be a plain object/);
  assert.throws(() => workspaceChanges({}, {}, { maxFiles: 1, extra: 1 }), /unknown limit "extra"/);
});

// ---- input checks ----------------------------------------------------------------------------

test('an absolute path is rejected in either snapshot, touched or not', () => {
  for (const bad of ['/etc/passwd', '\\share\\x', 'C:\\x', 'c:/x']) {
    assert.throws(() => workspaceChanges({ [bad]: 'x' }, {}), /absolute/, bad);
    assert.throws(() => workspaceChanges({}, { [bad]: 'x' }), /absolute/, bad);
    assert.throws(() => workspaceChanges({ [bad]: 'x' }, { [bad]: 'x' }), /absolute/, bad);
  }
});

test('a path containing ".." is rejected in either snapshot, touched or not', () => {
  for (const bad of ['../x', 'a/../x', 'a/..', '..\\x', 'a..b']) {
    assert.throws(() => workspaceChanges({ [bad]: 'x' }, {}), /"\.\."/, bad);
    assert.throws(() => workspaceChanges({}, { [bad]: 'x' }), /"\.\."/, bad);
    assert.throws(() => workspaceChanges({ [bad]: 'x' }, { [bad]: 'x' }), /"\.\."/, bad);
  }
});

test('an empty path or a path with a control character is rejected', () => {
  for (const bad of ['', 'a\nb', 'a\u0000b', 'a\u001bb', 'a\u2028b', 'a\u0085b']) {
    assert.throws(() => workspaceChanges({}, { [bad]: 'x' }), /file path/, JSON.stringify(bad));
  }
});

test('a snapshot that is not a plain object of strings is rejected', () => {
  for (const bad of [null, undefined, 'x', 3, [], [['a', 'b']], new Map(), new Date()]) {
    assert.throws(() => workspaceChanges(bad, {}), /start must be a plain object/);
    assert.throws(() => workspaceChanges({}, bad), /final must be a plain object/);
  }
  for (const value of [1, null, undefined, {}, ['x'], Buffer.from('x')]) {
    assert.throws(() => workspaceChanges({}, { 'a.txt': value }), /must be a string/);
    assert.throws(() => workspaceChanges({ 'a.txt': value }, {}), /must be a string/);
  }
  assert.doesNotThrow(() => workspaceChanges(Object.create(null), {}));
});

test('ordinary relative paths are accepted', () => {
  const final = {
    'a.md': '1',
    'docs/guide.md': '2',
    './x.md': '3',
    'dir/.hidden': '4',
    'a b.md': '5',
  };
  assert.equal(workspaceChanges({}, final).length, 5);
});
