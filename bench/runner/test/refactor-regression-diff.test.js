// SPDX-License-Identifier: Apache-2.0
'use strict';

// The diff tool of the refactor regression net (bench/ops/refactor-regression/diff.js): it sets two study trees side by
// side after taking out what differs on every run (paths, times, ids) and the fields the refactors added on purpose.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { normalize, diffJson, diffText, diffTrees } = require('../../ops/refactor-regression/diff.js');

test('normalize replaces the study root, scratch dirs, times and ids, and drops volatile and added keys', () => {
  const v = {
    dir: '/var/tmp/s-a/root/out/vanilla', cwd: '/tmp/w-AbC123/work', at: '2026-11-23T05:00:00.123Z', wallClockMs: 812,
    note: 'started 2026-11-23T05:00:00Z in /var/tmp/s-a/root', session: '3f2a9c1e-1b2c-4d5e-8f90-123456789abc',
    schemaVersion: 1, plugins: [{ name: 'strands', sha256: 'f'.repeat(64) }], nested: { latencyMs: 3, keep: 'x', createdAt: 'now' },
  };
  assert.deepEqual(normalize(v, { roots: ['/var/tmp/s-a/root'] }), {
    dir: '<ROOT>/out/vanilla', cwd: '<SCRATCH>/work', note: 'started <TIME> in <ROOT>', session: '<UUID>', nested: { keep: 'x' },
  });
});

test('normalize keeps a sorted key order, so two objects with the same content compare equal', () => {
  assert.deepEqual(Object.keys(normalize({ b: 1, a: 2 })), ['a', 'b']);
});

test('diffJson lists each differing path with both values; equal values give none', () => {
  assert.deepEqual(diffJson({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } }), []);
  assert.deepEqual(diffJson({ a: 1, b: { c: [1, 2] }, gone: true }, { a: 2, b: { c: [1, 3] }, added: 'x' }), [
    { path: 'a', base: 1, head: 2 },
    { path: 'added', base: undefined, head: 'x' },
    { path: 'b.c[1]', base: 2, head: 3 },
    { path: 'gone', base: true, head: undefined },
  ]);
});

test('diffText names the lines only on one side, after normalising them', () => {
  const r = diffText('one\nat /var/tmp/s-a/root\nthree\n', 'one\nat /var/tmp/s-b/root\nfour\n', { baseRoots: ['/var/tmp/s-a/root'], headRoots: ['/var/tmp/s-b/root'] });
  assert.deepEqual(r, { onlyBase: ['three'], onlyHead: ['four'] });
});

test('diffTrees pairs files by relative path, lists files on one side only, and reads json as json', () => {
  const root = tmp();
  try {
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    write(path.join(a, 'kiro/run-config.json'), JSON.stringify({ model: 'm', schemaVersion: 1, dir: `${a}/x` }));
    write(path.join(b, 'kiro/run-config.json'), JSON.stringify({ model: 'm', dir: `${b}/x`, plugins: [] }));
    write(path.join(a, 'kiro/report.md'), 'same\n');
    write(path.join(b, 'kiro/report.md'), 'same\n');
    write(path.join(a, 'only-a.txt'), 'x\n');
    write(path.join(b, 'kiro/r/result.json'), JSON.stringify({ status: 'success' }));
    const d = diffTrees(a, b);
    assert.deepEqual(d.onlyBase, ['only-a.txt']);
    assert.deepEqual(d.onlyHead, ['kiro/r/result.json']);
    assert.deepEqual(d.changed, [], 'run-config differs only in its root, schemaVersion and plugins');
    assert.equal(d.same, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a log clock time is normalised too', () => {
  assert.equal(normalize('[bench 06:55:54] done'), '[bench <CLOCK>] done');
});

test('report.js lists a real difference and marks one that also differs between two head runs as noise', () => {
  const { renderDiff } = require('../../ops/refactor-regression/report.js');
  const root = tmp();
  try {
    const study = (name, result) => {
      const dir = path.join(root, name);
      write(path.join(dir, 'study.json'), JSON.stringify({ tree: path.join(root, `tree-${name}`), steps: [{ name: 'run-kiro-a', exitCode: 0 }] }));
      write(path.join(dir, 'commands', 'run-kiro-a.out.txt'), '');
      write(path.join(dir, 'runs', 'kiro-a', 'r', 'result.json'), JSON.stringify(result));
      return dir;
    };
    const base = study('base', { status: 'success', order: 1, credits: 1 });
    const head = study('head', { status: 'success', order: 2, credits: 3 });
    const noise = study('head2', { status: 'success', order: 3, credits: 3 });
    const { text } = renderDiff({ base, head, noise });
    assert.match(text, /\| `credits` \| 1 \| 3 \|/);
    assert.doesNotMatch(text, /`order`/);
    assert.match(text, /1 path\(s\) also differ between two head runs \(noise\), not listed\./);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
