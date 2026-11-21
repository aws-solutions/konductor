// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/runner/lib/util.js, and a guard that bench code does not grow its own copies again (DEBT D-23).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const u = require('../lib/util.js');
const { tmp } = require('./helpers.js');

test('sha256, readJson, readJsonOrNull and readTextOrNull', () => {
  assert.equal(u.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(u.sha256(Buffer.from('abc')), u.sha256('abc'));
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'a.json'), '{"x":1}');
    fs.writeFileSync(path.join(dir, 'bad.json'), '{');
    assert.deepEqual(u.readJson(path.join(dir, 'a.json')), { x: 1 });
    assert.throws(() => u.readJson(path.join(dir, 'bad.json')));
    assert.equal(u.readJsonOrNull(path.join(dir, 'bad.json')), null);
    assert.equal(u.readJsonOrNull(path.join(dir, 'missing.json')), null);
    assert.equal(u.readTextOrNull(path.join(dir, 'a.json')), '{"x":1}');
    assert.equal(u.readTextOrNull(path.join(dir, 'missing.json')), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('groupBy keeps first-seen key order; seededShuffle is a seeded permutation and the run order stays the same', () => {
  assert.deepEqual([...u.groupBy([3, 1, 4, 1, 5], (n) => n % 2)], [[1, [3, 1, 1, 5]], [0, [4]]]);
  const list = [...Array(20).keys()];
  const a = u.seededShuffle(list, 7);
  assert.deepEqual(a, u.seededShuffle(list, 7));
  assert.notDeepEqual(a, u.seededShuffle(list, 8));
  assert.deepEqual([...a].sort((x, y) => x - y), list);
  assert.deepEqual(list, [...Array(20).keys()], 'the input is not changed');
  // The plan order of a run comes from these; a change would reorder every recorded study.
  assert.deepEqual(u.seededShuffle([1, 2, 3, 4, 5, 6], 1), require('../lib/orchestrate.js').shuffle([1, 2, 3, 4, 5, 6], require('../lib/orchestrate.js').mulberry32(1)));
});

// The one-liner forms util.js replaced. Task content (fixtures, solutions, hidden tests) keeps its own code.
const COPIES = [
  /^const sha256 = \(\w+\) => crypto\.createHash\('sha256'\)/m,
  /^const readJson = \(\w+\) => (?:\{ try \{ return )?JSON\.parse\(fs\.readFileSync\(/m,
  /^const readText = \(\w+\) => \{ try \{ return fs\.readFileSync\(/m,
];
const TASK_CONTENT = /\/(fixtures|solutions|partials|hidden|answers|physical)\//;

test('no bench module outside util.js writes its own sha256, readJson or readText one-liner', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const files = execFileSync('git', ['-C', root, 'ls-files', 'bench/**/*.js'], { encoding: 'utf8' }).split('\n')
    .filter((f) => f && !TASK_CONTENT.test(`/${f}`) && !f.includes('/test/') && f !== 'bench/runner/lib/util.js');
  const found = files.filter((f) => { const t = fs.readFileSync(path.join(root, f), 'utf8'); return COPIES.some((re) => re.test(t)); });
  assert.deepEqual(found, [], 'require the helper from bench/runner/lib/util.js instead');
});
