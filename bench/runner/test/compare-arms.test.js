// SPDX-License-Identifier: Apache-2.0
'use strict';

// compare matches arms by name and by resolved commit, and reports a changed arm instead of refusing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { compareRuns, formatCompare } = require('../../report/compare.js');

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const reps = (arm, over = {}, n = 3) => Array.from({ length: n }, (_, i) => ({ arm, rep: i + 1, credits: 1, ...over }));

function pair(baseSpecs, headSpecs, { baseCfg, headCfg } = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const base = makeRun(path.join(root, 'base'), bench, baseSpecs, baseCfg);
  const head = makeRun(path.join(root, 'head'), bench, headSpecs, headCfg);
  return { root, base, head, bench };
}
const run = (p, opts = {}) => compareRuns({ baseDir: p.base, headDir: p.head, benchDir: p.bench, ...opts });
const done = (p) => fs.rmSync(p.root, { recursive: true, force: true });

test('the same arm name on a different commit is reported as "arm changed" with both SHAs, not refused', () => {
  const p = pair(
    reps('pr-95', { commitSha: A, source: 'git', commitsAhead: 2 }),
    reps('pr-95', { commitSha: B, source: 'git', commitsAhead: 5 }),
  );
  try {
    const r = run(p);
    assert.equal(r.refusals.length, 0);
    assert.equal(r.exitCode, 0);
    assert.equal(r.armChanged.length, 1);
    assert.equal(r.armChanged[0].arm, 'pr-95');
    assert.equal(r.armChanged[0].base.commitSha, A);
    assert.equal(r.armChanged[0].head.commitSha, B);
    const text = formatCompare(r);
    assert.match(text, /arm changed/i);
    assert.ok(text.includes(A.slice(0, 12)) && text.includes(B.slice(0, 12)));
  } finally { done(p); }
});

test('a changed arm is still compared, so a regression on the new commit is reported', () => {
  const p = pair(reps('pr-95', { commitSha: A, source: 'git' }), reps('pr-95', { commitSha: B, source: 'git', credits: 3 }));
  try {
    const r = run(p);
    assert.equal(r.exitCode, 1);
    assert.equal(r.armChanged.length, 1);
    assert.ok(r.regressions.some((x) => x.arm === 'pr-95' && x.metric === 'credits'));
  } finally { done(p); }
});

test('a directory arm changes identity with its content hash', () => {
  const p = pair(
    reps('wip', { commitSha: null, source: 'dir', contentHash: 'h1'.repeat(32) }),
    reps('wip', { commitSha: null, source: 'dir', contentHash: 'h2'.repeat(32) }),
  );
  try {
    const r = run(p);
    assert.equal(r.armChanged.length, 1);
    assert.match(formatCompare(r), /dir:h1h1h1h1h1h1/);
  } finally { done(p); }
});

test('the same name and the same commit is not a change; vanilla has no identity and never changes', () => {
  const p = pair(
    [...reps('pr-95', { commitSha: A, source: 'git' }), ...reps('vanilla')],
    [...reps('pr-95', { commitSha: A, source: 'git' }), ...reps('vanilla')],
  );
  try {
    assert.deepEqual(run(p).armChanged, []);
  } finally { done(p); }
});

test('arms with different names but the same resolved commit are matched by commit', () => {
  const p = pair(
    reps('main', { commitSha: A, source: 'git' }),
    reps('main-snap', { commitSha: A, source: 'git', credits: 3 }),
  );
  try {
    const r = run(p);
    assert.deepEqual(r.matchedBySha, [{ base: 'main', head: 'main-snap' }]);
    assert.deepEqual(r.onlyInBase, []);
    assert.deepEqual(r.onlyInHead, []);
    assert.equal(r.exitCode, 1, 'the matched pair is compared');
    assert.match(formatCompare(r), /matched by commit.*main.*main-snap/s);
  } finally { done(p); }
});

test('a name present on one side only stays unmatched when no commit matches', () => {
  const p = pair(reps('a', { commitSha: A }), reps('b', { commitSha: B }));
  try {
    const r = run(p);
    assert.deepEqual(r.onlyInBase, ['a']);
    assert.deepEqual(r.onlyInHead, ['b']);
    assert.deepEqual(r.matchedBySha, []);
  } finally { done(p); }
});

test('model, effort, task-set and content-hash differences still refuse, with or without an arm change', () => {
  const p = pair(
    reps('pr-95', { commitSha: A, source: 'git' }),
    reps('pr-95', { commitSha: B, source: 'git' }),
    { headCfg: { model: 'other-model' } },
  );
  try {
    const r = run(p);
    assert.equal(r.exitCode, 2);
    assert.match(r.refusals.join('\n'), /model pin differs/);
    const hash = pair(reps('x', { commitSha: A }), reps('x', { commitSha: B }), { baseCfg: { contentHash: 'h1' }, headCfg: { contentHash: 'h2' } });
    try { assert.match(run(hash).refusals.join('\n'), /content hash differs/); } finally { done(hash); }
  } finally { done(p); }
});

test('identity falls back to run-config arm records when result.json predates the provenance fields', () => {
  const baseCfg = { arms: [{ id: 'pr-95', commitSha: A, source: 'git' }] };
  const headCfg = { arms: [{ id: 'pr-95', commitSha: B, source: 'git' }] };
  const p = pair(reps('pr-95', { commitSha: undefined }), reps('pr-95', { commitSha: undefined }), { baseCfg, headCfg });
  try {
    assert.equal(run(p).armChanged.length, 1);
  } finally { done(p); }
});
