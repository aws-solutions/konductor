// SPDX-License-Identifier: Apache-2.0
/**
 * Descent tests for the snapshot loader (finding I-H)
 *
 * `O_NOFOLLOW` guards only the last component of a path. A directory swapped for a symbolic link
 * between `readdir` and the recursive read was therefore followed, and the files read from outside
 * the root passed the name rule, which only ever saw the path inside the root. The review wrapped
 * `readdirSync` to do the swap and loaded `{"a/config": "[user]\n token = pretend-secret-outside-root\n"}`
 * from outside the root. Each test below does that swap, with `readdirSync` wrapped, on a real
 * directory tree.
 *
 * Run: node --test bench/test/snapshot-loader-descent.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadSnapshot } = require('../lib/snapshot-loader');

const SECRET = 'pretend-secret-outside-root';

function makeTree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-loader-descent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return fs.realpathSync(root);
}

/** Replaces `target[name]` for the rest of the test and returns the original. */
function patch(t, target, name, replacement) {
  const original = target[name];
  target[name] = replacement;
  t.after(() => {
    target[name] = original;
  });
  return original;
}

/** Moves `root/relative` aside and puts a symbolic link to `target` in its place. */
function swapForLink(root, relative, target) {
  fs.renameSync(path.join(root, relative), path.join(root, `${relative}.moved`));
  fs.symlinkSync(target, path.join(root, relative));
}

/**
 * Wraps `fs.readdirSync` so that `swap()` runs once, right after the first listing whose names
 * include `when`. Returns an object whose `swapped` says whether the swap really ran, so a test can
 * not pass because the race never happened.
 */
function swapAfterListing(t, when, swap) {
  const state = { swapped: false };
  const original = fs.readdirSync;
  patch(t, fs, 'readdirSync', (...args) => {
    const result = original(...args);
    if (!state.swapped && result.some((entry) => (typeof entry === 'string' ? entry : entry.name) === when)) {
      state.swapped = true;
      swap();
    }
    return result;
  });
  return state;
}

function outcomeOf(root) {
  try {
    return { result: loadSnapshot(root) };
  } catch (error) {
    return { error };
  }
}

function assertNothingFromOutside({ result, error }) {
  assert.equal(JSON.stringify(result || {}).includes(SECRET), false, 'content from outside the root reached the snapshot');
  assert.equal(String((error && error.message) || '').includes(SECRET), false);
}

// --- the review's swap -------------------------------------------------------------------------

test('I-H: a directory swapped for a symlink after it was listed is not followed', (t) => {
  const outside = makeTree(t, { config: `[user]\n token = ${SECRET}\n` });
  const root = makeTree(t, { 'a/keep.txt': 'k', 'z.txt': 'z' });
  const race = swapAfterListing(t, 'a', () => swapForLink(root, 'a', outside));
  const outcome = outcomeOf(root);
  assert.equal(race.swapped, true, 'the swap never ran, so this test proved nothing');
  assertNothingFromOutside(outcome);
  assert.ok(outcome.error, 'a workspace that changes while it is read must not load');
  assert.match(outcome.error.message, /snapshot-loader: a changed while it was being read/);
});

test('I-H: an ancestor swapped for a symlink while a deeper directory is read cannot expose the outside tree', (t) => {
  const outside = makeTree(t, { 'b/c.txt': `token = ${SECRET}\n` });
  const root = makeTree(t, { 'a/b/c.txt': 'inside' });
  // `b` is listed inside `a`; right then `a` itself becomes a link to the outside tree.
  const race = swapAfterListing(t, 'b', () => swapForLink(root, 'a', outside));
  const outcome = outcomeOf(root);
  assert.equal(race.swapped, true, 'the swap never ran, so this test proved nothing');
  assertNothingFromOutside(outcome);
  if (outcome.error) {
    assert.match(outcome.error.message, /changed while it was being read/);
  } else {
    // Where the kernel resolves against a held descriptor (Linux), the walk keeps reading the
    // directory it already holds, which is the original `a`: inside content, not the outside tree.
    assert.deepEqual(outcome.result, { 'a/b/c.txt': 'inside' });
  }
  if (os.platform() === 'darwin') assert.ok(outcome.error, 'macOS refuses a link in any component');
});

test('I-H: the name rule is not the defence: a swapped-in file with an innocent name is not read', (t) => {
  // The name rule only ever sees the path inside the root (`a/notes.txt`), so it cannot tell that
  // the bytes came from outside. Only the descent can keep them out.
  const outside = makeTree(t, { 'notes.txt': `plain note ${SECRET}\n` });
  const root = makeTree(t, { 'a/notes.txt': 'inside' });
  const race = swapAfterListing(t, 'a', () => swapForLink(root, 'a', outside));
  const outcome = outcomeOf(root);
  assert.equal(race.swapped, true);
  assertNothingFromOutside(outcome);
});

test('I-H: a file swapped for a symlink after it was listed is an error, not a quiet skip', (t) => {
  const outside = makeTree(t, { 'target.txt': `token = ${SECRET}\n` });
  const root = makeTree(t, { 'x.txt': 'inside' });
  const race = swapAfterListing(t, 'x.txt', () => {
    fs.rmSync(path.join(root, 'x.txt'));
    fs.symlinkSync(path.join(outside, 'target.txt'), path.join(root, 'x.txt'));
  });
  const outcome = outcomeOf(root);
  assert.equal(race.swapped, true);
  assertNothingFromOutside(outcome);
  assert.match(outcome.error.message, /x\.txt changed while it was being read/);
});

test('I-H: a directory replaced by a file after it was listed is an error', (t) => {
  const root = makeTree(t, { 'a/keep.txt': 'k' });
  const race = swapAfterListing(t, 'a', () => {
    fs.rmSync(path.join(root, 'a'), { recursive: true });
    fs.writeFileSync(path.join(root, 'a'), 'now a file');
  });
  const outcome = outcomeOf(root);
  assert.equal(race.swapped, true);
  assert.match(outcome.error.message, /a changed while it was being read/);
});

test('I-H: a directory removed after it was listed is an error, not a partial snapshot', (t) => {
  const root = makeTree(t, { 'a/keep.txt': 'k', 'b.txt': 'b' });
  const race = swapAfterListing(t, 'a', () => fs.rmSync(path.join(root, 'a'), { recursive: true }));
  const outcome = outcomeOf(root);
  assert.equal(race.swapped, true);
  assert.match(outcome.error.message, /a changed while it was being read/);
});

// --- nothing else changed ----------------------------------------------------------------------

test('I-H: a quiet tree loads as before, and a root given as a symlink is resolved once and read', (t) => {
  const real = makeTree(t, { 'a/b/c.txt': 'c', 'a/d.txt': 'd', 'e.txt': 'e' });
  const holder = makeTree(t, {});
  const link = path.join(holder, 'link');
  fs.symlinkSync(real, link);
  const expected = { 'a/b/c.txt': 'c', 'a/d.txt': 'd', 'e.txt': 'e' };
  assert.deepEqual(loadSnapshot(real), expected);
  assert.deepEqual(loadSnapshot(link), expected);
});

test('I-H: a symlink inside the tree is still skipped and never followed', (t) => {
  const outside = makeTree(t, { 'secret.txt': SECRET });
  const root = makeTree(t, { 'real.txt': 'inside' });
  fs.symlinkSync(outside, path.join(root, 'dir-link'));
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'file-link'));
  assert.deepEqual(loadSnapshot(root), { 'real.txt': 'inside' });
});

test('I-H: every descriptor the walk opens is closed, on success and when it throws', (t) => {
  const open = new Set();
  const openSync = fs.openSync;
  const closeSync = fs.closeSync;
  patch(t, fs, 'openSync', (...args) => {
    const fd = openSync(...args);
    open.add(fd);
    return fd;
  });
  patch(t, fs, 'closeSync', (fd) => {
    open.delete(fd);
    return closeSync(fd);
  });
  const fine = makeTree(t, { 'a/b/c.txt': 'c', 'd.txt': 'd' });
  loadSnapshot(fine);
  assert.deepEqual([...open], []);
  const sensitive = makeTree(t, { 'a/b/ok.txt': 'ok', 'a/b/c/.env': 'x' });
  assert.throws(() => loadSnapshot(sensitive), /refusing to load a\/b\/c\/\.env/);
  assert.deepEqual([...open], [], 'a throw deep in the tree leaked a descriptor');
  const over = makeTree(t, { 'a/b/big.txt': 'x'.repeat(50) });
  assert.throws(() => loadSnapshot(over, { maxFileBytes: 10 }), /over the 10 byte limit/);
  assert.deepEqual([...open], []);
});

// --- platforms ---------------------------------------------------------------------------------

test('I-H: a platform with no safe descent refuses to run and reads nothing', (t) => {
  const root = makeTree(t, { 'a.txt': 'x' });
  const opened = [];
  const openSync = fs.openSync;
  patch(t, fs, 'openSync', (...args) => {
    opened.push(String(args[0]));
    return openSync(...args);
  });
  patch(t, os, 'platform', () => 'win32');
  assert.throws(() => loadSnapshot(root), /snapshot-loader: refusing to run on win32/);
  patch(t, os, 'platform', () => 'freebsd');
  assert.throws(() => loadSnapshot(root), /refusing to run on freebsd/);
  assert.deepEqual(opened, []);
});

test('I-H: Linux without /proc refuses to run instead of falling back to reading by path', (t) => {
  const root = makeTree(t, { 'a.txt': 'x' });
  patch(t, os, 'platform', () => 'linux');
  const existsSync = fs.existsSync;
  patch(t, fs, 'existsSync', (p) => (p === '/proc/self/fd' ? false : existsSync(p)));
  assert.throws(() => loadSnapshot(root), /refusing to run on linux without \/proc/);
});

test('I-H: on Linux every child is opened through its parent descriptor, never by a path from the root', (t) => {
  // This machine may not be Linux, so /proc is simulated: a `/proc/self/fd/<n>/<name>` path is
  // translated to the directory that descriptor was opened as. What the test pins is the shape of
  // the paths the loader asks for: the root once by absolute path, everything else as one name
  // under a descriptor. The kernel's own pinning is exercised by the race tests above on Linux.
  const root = makeTree(t, { 'a/b/c.txt': 'c', 'a/d.txt': 'd', 'e.txt': 'e' });
  patch(t, os, 'platform', () => 'linux');
  const existsSync = fs.existsSync;
  patch(t, fs, 'existsSync', (p) => (p === '/proc/self/fd' ? true : existsSync(p)));
  const fdPaths = new Map();
  const translate = (given) => {
    const match = /^\/proc\/self\/fd\/(\d+)(\/.*)?$/.exec(given);
    if (match === null) return given;
    const base = fdPaths.get(Number(match[1]));
    assert.notEqual(base, undefined, `${given} names a descriptor the loader never opened`);
    return match[2] === undefined ? base : path.join(base, match[2]);
  };
  const requested = [];
  const openSync = fs.openSync;
  const readdirSync = fs.readdirSync;
  patch(t, fs, 'openSync', (given, ...rest) => {
    requested.push(String(given));
    const real = translate(String(given));
    const fd = openSync(real, ...rest);
    fdPaths.set(fd, real);
    return fd;
  });
  patch(t, fs, 'readdirSync', (given, ...rest) => readdirSync(translate(String(given)), ...rest));

  assert.deepEqual(loadSnapshot(root), { 'a/b/c.txt': 'c', 'a/d.txt': 'd', 'e.txt': 'e' });
  assert.equal(requested[0], root, 'the root is opened once, by its resolved path');
  assert.equal(requested.length, 1 + 2 + 3, `unexpected opens: ${requested.join(', ')}`);
  for (const given of requested.slice(1)) {
    assert.match(given, /^\/proc\/self\/fd\/\d+\/[^/]+$/, 'a child must be one name under a held descriptor');
  }
});

test('I-H: the same simulation shows a directory swapped after listing is refused on the Linux path too', (t) => {
  const outside = makeTree(t, { config: `[user]\n token = ${SECRET}\n` });
  const root = makeTree(t, { 'a/keep.txt': 'k' });
  patch(t, os, 'platform', () => 'linux');
  const existsSync = fs.existsSync;
  patch(t, fs, 'existsSync', (p) => (p === '/proc/self/fd' ? true : existsSync(p)));
  const fdPaths = new Map();
  const translate = (given) => {
    const match = /^\/proc\/self\/fd\/(\d+)(\/.*)?$/.exec(given);
    if (match === null) return given;
    const base = fdPaths.get(Number(match[1]));
    return match[2] === undefined ? base : path.join(base, match[2]);
  };
  const openSync = fs.openSync;
  const readdirSync = fs.readdirSync;
  patch(t, fs, 'openSync', (given, ...rest) => {
    const real = translate(String(given));
    const fd = openSync(real, ...rest);
    fdPaths.set(fd, real);
    return fd;
  });
  let swapped = false;
  patch(t, fs, 'readdirSync', (given, ...rest) => {
    const result = readdirSync(translate(String(given)), ...rest);
    if (!swapped && result.some((entry) => entry.name === 'a')) {
      swapped = true;
      swapForLink(root, 'a', outside);
    }
    return result;
  });
  const outcome = outcomeOf(root);
  assert.equal(swapped, true);
  assertNothingFromOutside(outcome);
  assert.match(outcome.error.message, /a changed while it was being read/);
});
