// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runChecks } = require('../lib/checks.js');

function workspace(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-checks-'));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

test('file_exists, contains and not_contains', () => {
  const dir = workspace({ 'a.txt': 'hello world', 'sub/b.md': 'x' });
  try {
    const r = runChecks(dir, [
      { type: 'file_exists', path: 'a.txt' },
      { type: 'file_exists', path: 'missing.txt' },
      { type: 'contains', path: 'a.txt', pattern: 'hel+o' },
      { type: 'contains', path: 'a.txt', pattern: 'goodbye' },
      { type: 'not_contains', path: 'a.txt', pattern: 'goodbye' },
      { type: 'not_contains', path: 'a.txt', pattern: 'world' },
    ]);
    assert.deepEqual(r.map((c) => c.passed), [true, false, true, false, true, false]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('contains on a missing file fails with a detail', () => {
  const dir = workspace({});
  try {
    const [r] = runChecks(dir, [{ type: 'contains', path: 'nope.txt', pattern: 'x' }]);
    assert.equal(r.passed, false);
    assert.equal(r.detail, 'file missing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an invalid regex fails the check for contains and not_contains', () => {
  const dir = workspace({ 'a.txt': 'cost (usd' });
  try {
    const r = runChecks(dir, [
      { type: 'contains', path: 'a.txt', pattern: '(usd' },
      { type: 'not_contains', path: 'a.txt', pattern: '(?i)foo' },
    ]);
    assert.deepEqual(r.map((c) => c.passed), [false, false]);
    assert.match(r[0].detail, /invalid pattern/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patterns match case-insensitively and across lines (flags im)', () => {
  const dir = workspace({ 'a.md': 'intro\n## Usage\nbody' });
  try {
    const r = runChecks(dir, [
      { type: 'contains', path: 'a.md', pattern: '^## usage$' },
      { type: 'contains', path: 'a.md', pattern: 'INTRO' },
    ]);
    assert.deepEqual(r.map((c) => c.passed), [true, true]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('file_exists requires a regular file, not a directory', () => {
  const dir = workspace({ 'sub/x.txt': 'x' });
  try {
    const r = runChecks(dir, [{ type: 'file_exists', path: 'sub' }, { type: 'file_exists', path: 'sub/x.txt' }]);
    assert.deepEqual(r.map((c) => c.passed), [false, true]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cmd checks run under sh, not bash', () => {
  const dir = workspace({});
  try {
    const [r] = runChecks(dir, [{ type: 'cmd', cmd: '[[ a == a ]]', expectExit: 0 }]);
    const shIsBash = require('node:fs').realpathSync('/bin/sh').endsWith('bash');
    assert.equal(r.passed, shIsBash);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('min_matches counts regex matches', () => {
  const dir = workspace({ 'a.txt': 'src/a.js:10\nsrc/b.js:20\nnote' });
  try {
    const r = runChecks(dir, [
      { type: 'min_matches', path: 'a.txt', pattern: '\\w+\\.js:\\d+', min: 2 },
      { type: 'min_matches', path: 'a.txt', pattern: '\\w+\\.js:\\d+', min: 3 },
      { type: 'min_matches', path: 'missing.txt', pattern: 'x', min: 1 },
      { type: 'min_matches', path: 'a.txt', pattern: '(', min: 1 },
    ]);
    assert.deepEqual(r.map((c) => c.passed), [true, false, false, false]);
    assert.equal(r[0].min, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fixture_unchanged compares a file or tree with the pristine fixture byte for byte', () => {
  const pristine = workspace({ 'test/a.test.js': 'ok', 'test/b.test.js': 'ok', 'src/x.js': 'v1' });
  const work = workspace({ 'test/a.test.js': 'ok', 'test/b.test.js': 'ok', 'src/x.js': 'v2' });
  try {
    const opts = { pristineDir: pristine };
    const r = runChecks(work, [
      { type: 'fixture_unchanged', path: 'test' },
      { type: 'fixture_unchanged', path: 'test/a.test.js' },
      { type: 'fixture_unchanged', path: 'src/x.js' },
      { type: 'fixture_unchanged', path: 'nope' },
    ], opts);
    assert.deepEqual(r.map((c) => c.passed), [true, true, false, false]);
    fs.writeFileSync(path.join(work, 'test/new.test.js'), 'extra');
    const [added] = runChecks(work, [{ type: 'fixture_unchanged', path: 'test' }], opts);
    assert.equal(added.passed, false);
    assert.match(added.detail, /extra 1/);
    const [noPristine] = runChecks(work, [{ type: 'fixture_unchanged', path: 'test' }]);
    assert.equal(noPristine.passed, false);
  } finally {
    fs.rmSync(pristine, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('fixture_unchanged ignores node_modules and the answer key', () => {
  const pristine = workspace({ 'd/a.txt': 'a', 'd/.bench-answer-key.md': 'key' });
  const work = workspace({ 'd/a.txt': 'a', 'd/node_modules/m/i.js': 'x' });
  try {
    const [r] = runChecks(work, [{ type: 'fixture_unchanged', path: 'd' }], { pristineDir: pristine });
    assert.equal(r.passed, true);
  } finally {
    fs.rmSync(pristine, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('cmd runs in the workspace and honours expectExit', () => {
  const dir = workspace({ 'a.txt': 'x' });
  try {
    const r = runChecks(dir, [
      { type: 'cmd', cmd: 'test -f a.txt' },
      { type: 'cmd', cmd: 'exit 3', expectExit: 3 },
      { type: 'cmd', cmd: 'exit 3' },
    ]);
    assert.deepEqual(r.map((c) => c.passed), [true, true, false]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('paths that escape the workspace fail instead of reading outside', () => {
  const dir = workspace({});
  try {
    const [r] = runChecks(dir, [{ type: 'file_exists', path: '../../etc/passwd' }]);
    assert.equal(r.passed, false);
    assert.match(r.detail, /escapes workspace/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unknown check type fails', () => {
  const [r] = runChecks(os.tmpdir(), [{ type: 'bogus' }]);
  assert.equal(r.passed, false);
});
