// SPDX-License-Identifier: Apache-2.0
/**
 * Slug unit tests: the name checks that keep a skill name or task id from leaving its directory.
 * Run: node --test bench/test/slug.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { isSlug, isFileKey, assertSlug, assertFileKey, assertUnder } = require('../lib/slug');

test('a slug is lower-case letters and digits, then those plus . _ -, with no ".." and no leading dot', () => {
  for (const ok of ['a', 'e2e-test-strategy', 'k-quality-assurance', 'x.y_z-1', '0abc']) {
    assert.ok(isSlug(ok), ok);
  }
  for (const bad of [
    '',
    '.hidden',
    '-lead',
    '_lead',
    'Upper',
    'a/b',
    'a\\b',
    '../x',
    'a..b',
    'a b',
    'a\nb',
    'a\u0000b',
    'a+b',
    'x'.repeat(161),
    null,
    undefined,
    7,
    {},
  ]) {
    assert.ok(!isSlug(bad), JSON.stringify(bad));
  }
  assert.ok(isSlug('x'.repeat(160)));
});

test('a file key may also carry "+", as the joined skill list of a batch file name does', () => {
  assert.ok(isFileKey('a+b+c'));
  assert.ok(isFileKey('a-b+and-3-more-0f1e2d3c'));
  assert.ok(!isSlug('a+b'));
  assert.ok(!isFileKey('+a'));
  assert.ok(!isFileKey('a/b'));
  assert.ok(!isFileKey('a+..+b'));
});

test('the assert variants return the value and name what was wrong', () => {
  assert.equal(assertSlug('ok-name', 'skill'), 'ok-name');
  assert.equal(assertFileKey('a+b', 'skill'), 'a+b');
  assert.throws(() => assertSlug('../x', 'skill'), /invalid skill "\.\.\/x"/);
  assert.throws(() => assertFileKey('a/b'), /invalid name/);
  assert.throws(
    () => assertSlug('x'.repeat(500)),
    (e) => e.message.length < 300,
    'a long value is cut in the message',
  );
});

test('assertUnder accepts a path inside the directory and refuses the directory itself, a sibling and a traversal', () => {
  const dir = path.resolve('/data/store');
  assert.equal(assertUnder(dir, path.join(dir, 'pairs', 'a.json')), path.join(dir, 'pairs', 'a.json'));
  assert.throws(() => assertUnder(dir, dir), /outside/);
  assert.throws(() => assertUnder(dir, path.join(dir, '..', 'other', 'a.json')), /outside/);
  assert.throws(() => assertUnder(dir, '/data/store-evil/a.json'), /outside/);
  assert.throws(() => assertUnder(dir, path.join(dir, 'a', '..', '..', 'x')), /outside/);
  assert.throws(() => assertUnder(dir, '/etc/passwd'), /outside/);
});
