// SPDX-License-Identifier: Apache-2.0
'use strict';

// Checks read the agent's tree on the host. A symlink there could point at a file the agent cannot read
// (a masked reference solution), so every check that reads workspace files refuses links, and a link
// to another file inside the workspace is refused too.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runChecks } = require('../lib/checks.js');
const { mkScratch } = require('./scratch.js');

function setup() {
  const base = mkScratch('bench-symlink-');
  const root = path.join(base, 'ws');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'canary.txt'), 'SECRET-ANSWER\n- critical: one\n');
  fs.writeFileSync(path.join(root, 'real.txt'), 'SECRET-ANSWER\n- critical: two\n');
  fs.writeFileSync(path.join(root, 'sub', 'inner.txt'), 'SECRET-ANSWER\n');
  return { base, root, outside };
}

const READERS = [
  (p) => ({ type: 'file_exists', path: p }),
  (p) => ({ type: 'contains', path: p, pattern: 'SECRET-ANSWER' }),
  (p) => ({ type: 'not_contains', path: p, pattern: 'NOPE' }),
  (p) => ({ type: 'min_matches', path: p, pattern: 'SECRET', min: 1 }),
  (p) => ({ type: 'labelled_findings', path: p, labels: ['critical'], min: 1 }),
];

test('a symlink to a file outside the workspace fails every file-reading check', () => {
  const { root, outside } = setup();
  fs.symlinkSync(path.join(outside, 'canary.txt'), path.join(root, 'link.txt'));
  const out = runChecks(root, READERS.map((mk) => mk('link.txt')));
  for (const r of out) {
    assert.equal(r.passed, false, r.type);
    assert.equal(r.detail, 'path is a symlink: link.txt', r.type);
  }
});

test('a symlink to another file inside the workspace is refused', () => {
  const { root } = setup();
  fs.symlinkSync(path.join(root, 'real.txt'), path.join(root, 'alias.txt'));
  const out = runChecks(root, READERS.map((mk) => mk('alias.txt')));
  for (const r of out) {
    assert.equal(r.passed, false, r.type);
    assert.equal(r.detail, 'path is a symlink: alias.txt', r.type);
  }
});

test('a relative symlink is refused', () => {
  const { root } = setup();
  fs.symlinkSync('real.txt', path.join(root, 'rel.txt'));
  const [r] = runChecks(root, [{ type: 'contains', path: 'rel.txt', pattern: 'SECRET' }]);
  assert.equal(r.passed, false);
  assert.equal(r.detail, 'path is a symlink: rel.txt');
});

test('a symlinked parent directory is refused and names the link', () => {
  const { root, outside } = setup();
  fs.symlinkSync(outside, path.join(root, 'linked-dir'));
  const out = runChecks(root, READERS.map((mk) => mk('linked-dir/canary.txt')));
  for (const r of out) {
    assert.equal(r.passed, false, r.type);
    assert.equal(r.detail, 'path is a symlink: linked-dir', r.type);
  }
});

test('a normal file in a normal subdirectory passes', () => {
  const { root } = setup();
  const out = runChecks(root, [...READERS.map((mk) => mk('real.txt')), { type: 'contains', path: 'sub/inner.txt', pattern: 'SECRET' }]);
  assert.deepEqual(out.map((r) => r.passed), [true, true, true, true, true, true]);
});

test('a missing file keeps its existing result', () => {
  const { root } = setup();
  const [exists, contains] = runChecks(root, [{ type: 'file_exists', path: 'nope.txt' }, { type: 'contains', path: 'nope/deeper.txt', pattern: 'x' }]);
  assert.deepEqual([exists.passed, exists.detail], [false, 'missing']);
  assert.deepEqual([contains.passed, contains.detail], [false, 'file missing']);
});

test('a dangling symlink is refused, not reported as missing', () => {
  const { root, base } = setup();
  fs.symlinkSync(path.join(base, 'gone'), path.join(root, 'dangling.txt'));
  const [r] = runChecks(root, [{ type: 'file_exists', path: 'dangling.txt' }]);
  assert.equal(r.passed, false);
  assert.equal(r.detail, 'path is a symlink: dangling.txt');
});

test('fixture_unchanged refuses a symlinked file and a symlink inside a compared directory', () => {
  const { base, root, outside } = setup();
  const pristine = path.join(base, 'pristine');
  fs.mkdirSync(path.join(pristine, 'dir'), { recursive: true });
  fs.writeFileSync(path.join(pristine, 'dir', 'a.txt'), 'SECRET-ANSWER\n- critical: one\n');
  fs.writeFileSync(path.join(pristine, 'f.txt'), 'SECRET-ANSWER\n- critical: one\n');
  fs.mkdirSync(path.join(root, 'dir'));
  fs.symlinkSync(path.join(outside, 'canary.txt'), path.join(root, 'dir', 'a.txt'));
  fs.symlinkSync(path.join(outside, 'canary.txt'), path.join(root, 'f.txt'));
  const out = runChecks(root, [{ type: 'fixture_unchanged', path: 'f.txt' }, { type: 'fixture_unchanged', path: 'dir' }], { pristineDir: pristine });
  assert.deepEqual(out.map((r) => r.passed), [false, false]);
  assert.equal(out[0].detail, 'path is a symlink: f.txt');
  assert.equal(out[1].detail, 'path is a symlink: a.txt');
});

test('fixture_unchanged on a plain identical file still passes', () => {
  const { base, root } = setup();
  const pristine = path.join(base, 'pristine');
  fs.mkdirSync(pristine);
  fs.copyFileSync(path.join(root, 'real.txt'), path.join(pristine, 'real.txt'));
  const [r] = runChecks(root, [{ type: 'fixture_unchanged', path: 'real.txt' }], { pristineDir: pristine });
  assert.deepEqual([r.passed, r.detail], [true, 'identical']);
});

test('the hidden-test scratch copy leaves symlinks out', () => {
  const { base, root, outside } = setup();
  fs.symlinkSync(path.join(outside, 'canary.txt'), path.join(root, 'link.txt'));
  fs.symlinkSync(outside, path.join(root, 'linked-dir'));
  const hidden = path.join(base, 'hidden');
  fs.mkdirSync(hidden);
  fs.writeFileSync(path.join(hidden, 'h.test.js'), [
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    "const fs = require('node:fs');",
    "test('links absent', () => { assert.equal(fs.existsSync('link.txt'), false); assert.equal(fs.existsSync('linked-dir'), false); });",
    "test('plain file copied', () => { assert.equal(fs.existsSync('real.txt'), true); });",
    '',
  ].join('\n'));
  const [r] = runChecks(root, [{ type: 'tests', cmd: 'node --test h.test.js', min: 2 }], { hiddenDir: hidden, scratchDir: path.join(base, 'scratch') });
  assert.equal(r.detail, '2/2 hidden tests passed');
  assert.equal(r.passed, true);
});
