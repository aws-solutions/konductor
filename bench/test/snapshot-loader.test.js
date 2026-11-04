// SPDX-License-Identifier: Apache-2.0
/**
 * Snapshot Loader unit tests
 *
 * Run: node --test bench/test/snapshot-loader.test.js
 *
 * Each test builds a small tree in a fresh directory under the operating system's temporary
 * directory and removes it afterwards. No test spawns a process or makes a network call.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DEFAULT_LIMITS, SKIPPED_DIRECTORIES, loadSnapshot } = require('../lib/snapshot-loader');
const { evalCheck } = require('../lib/checks');

/** Creates a temporary tree from `files` (relative path to content) and removes it after the test. */
function makeTree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-loader-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

test('the defaults and skipped directories are the documented ones', () => {
  assert.deepEqual({ ...DEFAULT_LIMITS }, { maxFiles: 2000, maxFileBytes: 1048576, maxTotalBytes: 16777216 });
  assert.deepEqual([...SKIPPED_DIRECTORIES], ['.git', 'node_modules']);
});

test('loads nested files as relative forward-slash paths with string content', (t) => {
  const root = makeTree(t, { 'a.md': 'alpha', 'src/b.js': 'beta', 'src/deep/c.txt': 'gamma', 'empty.txt': '' });
  assert.deepEqual(loadSnapshot(root), {
    'a.md': 'alpha',
    'empty.txt': '',
    'src/b.js': 'beta',
    'src/deep/c.txt': 'gamma',
  });
});

test('keys come back in sorted order whatever the creation order', (t) => {
  const root = makeTree(t, { 'z.txt': '1', 'a.txt': '2', 'm/x.txt': '3', 'b.txt': '4' });
  assert.deepEqual(Object.keys(loadSnapshot(root)), ['a.txt', 'b.txt', 'm/x.txt', 'z.txt']);
});

test('reads UTF-8 content', (t) => {
  const root = makeTree(t, { 'a.md': 'caf\u00e9 \u2713' });
  assert.equal(loadSnapshot(root)['a.md'], 'caf\u00e9 \u2713');
});

test('an empty directory gives an empty snapshot', (t) => {
  assert.deepEqual(loadSnapshot(makeTree(t, {})), {});
});

test('skips .git and node_modules at any depth, leaving an empty marker for each', (t) => {
  // Behavior change (I-A): this asserted that the skipped entries left no trace in the snapshot. They
  // are still not read, but each now appears as a key whose value is '', so a check can tell that
  // something is there. The content of `.git/config` and `node_modules/pkg/index.js` is not in it.
  const root = makeTree(t, {
    'keep.txt': 'k',
    '.git/config': 'g',
    'node_modules/pkg/index.js': 'n',
    'sub/node_modules/x.js': 'n',
    'sub/.git/HEAD': 'g',
    'sub/keep.txt': 'k',
  });
  assert.deepEqual(loadSnapshot(root), {
    '.git': '',
    'keep.txt': 'k',
    node_modules: '',
    'sub/.git': '',
    'sub/keep.txt': 'k',
    'sub/node_modules': '',
  });
});

test('does not follow symbolic links', (t) => {
  const outside = makeTree(t, { 'secret.txt': 'outside' });
  const root = makeTree(t, { 'real.txt': 'inside' });
  try {
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
    fs.symlinkSync(outside, path.join(root, 'linked-dir'));
  } catch (error) {
    t.skip(`symbolic links are not available here: ${error.code}`);
    return;
  }
  assert.deepEqual(loadSnapshot(root), { 'real.txt': 'inside' });
});

test('a file named __proto__ is an ordinary key and does not change the prototype', (t) => {
  const root = makeTree(t, Object.fromEntries([['__proto__', 'payload'], ['a.txt', 'x']]));
  const snapshot = loadSnapshot(root);
  assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
  assert.deepEqual(Object.keys(snapshot), ['__proto__', 'a.txt']);
  assert.equal(evalCheck(snapshot, { type: 'contains', path: '__proto__', pattern: 'payload' }).passed, true);
});

test('the snapshot it returns can be evaluated by the matcher', (t) => {
  const root = makeTree(t, { 'PLAN.md': '- first\n- second' });
  const snapshot = loadSnapshot(root);
  // Behavior change (C): this asserted a min_matches check (`^- ` at least twice); contains is the replacement.
  assert.equal(evalCheck(snapshot, { type: 'contains', path: 'PLAN.md', pattern: '^- second' }).passed, true);
});

test('a file over the per-file limit is an error that names it', (t) => {
  const root = makeTree(t, { 'big.txt': 'x'.repeat(11), 'small.txt': 'x' });
  // Behavior change (I-8): the limit is enforced on the bytes read, which stop one past the limit, so
  // the message no longer states the file's full size.
  assert.throws(() => loadSnapshot(root, { maxFileBytes: 10 }), /big\.txt is over the 10 byte limit/);
  assert.deepEqual(Object.keys(loadSnapshot(root, { maxFileBytes: 11 })), ['big.txt', 'small.txt']);
});

test('more files than the file limit is an error', (t) => {
  const root = makeTree(t, { 'a.txt': '1', 'b.txt': '2', 'c.txt': '3' });
  assert.throws(() => loadSnapshot(root, { maxFiles: 2 }), /more than 2 files/);
  assert.equal(Object.keys(loadSnapshot(root, { maxFiles: 3 })).length, 3);
});

test('content over the total limit is an error', (t) => {
  const root = makeTree(t, { 'a.txt': 'xxxxxx', 'b.txt': 'xxxxxx' });
  assert.throws(() => loadSnapshot(root, { maxTotalBytes: 11 }), /exceeds 11 bytes in total/);
  assert.equal(Object.keys(loadSnapshot(root, { maxTotalBytes: 12 })).length, 2);
});

test('a limit that is not a non-negative integer is an error and not a default', (t) => {
  // Behavior change (I-8): this test used to assert that a bad limit fell back to the default.
  const root = makeTree(t, { 'a.txt': 'x' });
  for (const name of ['maxFiles', 'maxFileBytes', 'maxTotalBytes']) {
    for (const bad of [-1, 1.5, NaN, Infinity, '3', null, true, {}]) {
      assert.throws(() => loadSnapshot(root, { [name]: bad }), new RegExp(`${name} must be a non-negative integer`), `${name}: ${String(bad)}`);
    }
  }
  assert.deepEqual(Object.keys(loadSnapshot(root, { maxFiles: undefined })), ['a.txt']);
});

test('a bad root is an error', () => {
  for (const bad of [undefined, null, '', 5, {}]) {
    assert.throws(() => loadSnapshot(bad), /rootDir must be a non-empty string/, String(bad));
  }
  const missing = path.join(os.tmpdir(), 'snapshot-loader-test-does-not-exist');
  assert.throws(() => loadSnapshot(missing), { code: 'ENOENT' });
});
