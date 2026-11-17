// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { buildBundle } = require('../../judge/bundle.js');
const { DEFAULT_REDACTIONS, compileRedactions } = require('../../judge/redact.js');
const { DEFAULTS } = require('../../judge/config.js');
const { changeStats, redactedChanges } = require('../../judge/pack/index.js');
const { artifactBytesOf } = require('../../report/length.js');
const { isEphemeralDir, isEphemeralFile } = require('../../judge/ephemeral.js');

// What a pytest, mypy or ruff run leaves in a workspace, next to one real change.
const LITTER = {
  '.pytest_cache/.gitignore': '# Created by pytest automatically.\n*\n',
  '.pytest_cache/v/cache/lastfailed': '{}\n',
  'src/__pycache__/core.cpython-312.pyc': 'compiled\n',
  'tests/__pycache__/test_core.cpython-312-pytest-8.3.pyc': 'compiled\n',
  'legacy.pyc': 'compiled\n',
  '.mypy_cache/3.12/core.meta.json': '{}\n',
  '.ruff_cache/0.6.0/123': 'x\n',
  'node_modules/.cache/babel/x.json': '{}\n',
};

function litteredRun() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'v1.2.0', files: { 'a.txt': 'alpha fixed\n', ...LITTER } }]);
  const dir = path.join(runDir, 'v1.2.0/t1/1');
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  const fixtureDir = path.join(bench, 'fixtures/fx');
  const build = () => buildBundle({ runDir: dir, result, fixtureDir, limits: DEFAULTS.limits, redactions: compileRedactions(DEFAULT_REDACTIONS) });
  return { root, dir, fixtureDir, build };
}

test('test and lint caches are not part of the change the judge sees', () => {
  const { root, build } = litteredRun();
  try {
    const { text, changed, files, meta } = build();
    assert.deepEqual(changed, ['a.txt']);
    assert.deepEqual(files.map((f) => f.rel), ['a.txt']);
    assert.match(text, /## Files created or changed \(1\)/);
    assert.doesNotMatch(text, /pytest_cache|__pycache__|\.pyc|mypy_cache|ruff_cache|babel/);
    // .pytest_cache, two __pycache__, legacy.pyc, .mypy_cache, .ruff_cache; node_modules is tool state and counted there.
    assert.equal(meta.ephemeral, 6);
    assert.equal(meta.excluded, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the quality pack\'s diff (what chg-scoped grades) leaves the caches out', () => {
  const { root, build } = litteredRun();
  try {
    const diff = redactedChanges(changeStats(build().files), compileRedactions(DEFAULT_REDACTIONS));
    assert.match(diff, /^--- a\.txt \(modified: \+1 -1\)/);
    assert.doesNotMatch(diff, /pytest_cache|__pycache__|\.pyc|mypy_cache|ruff_cache/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a cache in the fixture is not reported as deleted when the run cleared it', () => {
  const { root, dir, fixtureDir, build } = litteredRun();
  try {
    write(path.join(fixtureDir, '__pycache__/old.cpython-311.pyc'), 'compiled\n');
    fs.rmSync(path.join(dir, 'workspace/src/__pycache__'), { recursive: true, force: true });
    const { deleted, text } = build();
    assert.deepEqual(deleted, []);
    assert.doesNotMatch(text, /## Files deleted/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('artifact bytes in reports count the change, not the caches', () => {
  const { root, dir, fixtureDir } = litteredRun();
  try {
    assert.equal(artifactBytesOf(dir, fixtureDir), Buffer.byteLength('alpha fixed\n'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the ignore list matches cache names only, not files that look like them', () => {
  for (const name of ['.pytest_cache', '__pycache__', '.mypy_cache', '.ruff_cache']) assert.ok(isEphemeralDir(name), name);
  for (const name of ['pytest_cache', 'cache', '.cache', 'src', '__pycache__x']) assert.ok(!isEphemeralDir(name), name);
  for (const name of ['m.pyc', 'm.cpython-312.pyc', 'm.pyo']) assert.ok(isEphemeralFile(name), name);
  for (const name of ['m.py', 'pyc', 'm.pyc.md', 'notes.pycon']) assert.ok(!isEphemeralFile(name), name);
});
