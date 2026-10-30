// SPDX-License-Identifier: Apache-2.0
'use strict';

// A tiny upstream repository, a bench directory that points at it and a filled cache, for the real-repository tests.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const reallib = require('../../real/lib.js');
const { fetchEntry } = require('../../real/fetch.js');
const { materialize } = require('../../real/materialize.js');

const tmp = (p = 'rt-') => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.org', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.org' } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

// The fix adds a long docstring line so a verbatim copy is long enough for the recall check.
const FIXED_MOD = 'def add(a, b):\n    """Return the sum of a and b, computed with the plus operator on the two given arguments."""\n    return a + b\n';
// The fake upstream project's tests run under pytest; without it these tests can only report "unparsed".
// They skip when pytest is missing, unless BENCH_REQUIRE_PYTEST=1 makes them run (and fail) anyway.
const HAS_PYTEST = spawnSync('python3', ['-m', 'pytest', '--version'], { encoding: 'utf8' }).status === 0;
const PYTEST_SKIP = HAS_PYTEST || process.env.BENCH_REQUIRE_PYTEST === '1' ? false : 'python3 -m pytest is not installed (set BENCH_REQUIRE_PYTEST=1 to fail instead)';
const RUBRIC = [1, 2, 3].map((n) => ({ id: `c${n}`, criterion: `Criterion ${n}.`, weight: 1 }));

// useEnv points BENCH_REAL_CACHE at the cache until done() runs, as `--real-cache` does for a run.
function makeRealBench({ fetched = true, useEnv = false } = {}) {
  const up = tmp('rt-up-');
  git(up, 'init', '-q', '-b', 'main');
  git(up, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  write(path.join(up, 'pkg/__init__.py'), '');
  write(path.join(up, 'pkg/mod.py'), 'def add(a, b):\n    return a - b\n');
  write(path.join(up, 'tests/test_ident.py'), 'def test_ident():\n    assert 1 == 1\n');
  write(path.join(up, 'run.sh'), '#!/bin/sh\necho hi\n');
  fs.chmodSync(path.join(up, 'run.sh'), 0o755);
  fs.symlinkSync('pkg/mod.py', path.join(up, 'link.py'));
  git(up, 'add', '-A'); git(up, 'commit', '-q', '-m', 'base');
  const baseSha = git(up, 'rev-parse', 'HEAD');
  write(path.join(up, 'pkg/mod.py'), `${FIXED_MOD}`);
  write(path.join(up, 'tests/test_add.py'), 'from pkg.mod import add\n\n\ndef test_add():\n    assert add(1, 2) == 3\n');
  git(up, 'add', '-A'); git(up, 'commit', '-q', '-m', 'fix');
  const mergeSha = git(up, 'rev-parse', 'HEAD');

  const bench = tmp('rt-bench-');
  const cache = tmp('rt-cache-');
  const id = 'demo-1-add';
  const entry = {
    id, kind: 'bug', language: 'python',
    repo: { name: 'example/demo', url: up, license: 'MIT', licenseFile: 'LICENSE', packageNames: ['pkg'] },
    baseSha, mergeSha, baseTreeSha: git(up, 'rev-parse', `${baseSha}^{tree}`), mergeTreeSha: git(up, 'rev-parse', `${mergeSha}^{tree}`),
    pr: { number: 1, url: 'https://example.org/pr/1', title: 't', mergedAt: '2026-01-01T00:00:00Z' },
    fixFiles: ['pkg/mod.py'], testFiles: ['tests/test_add.py'],
    test: { runner: 'pytest', cmd: 'python3 -m pytest -p no:cacheprovider --color=no -v tests', env: { PYTHONDONTWRITEBYTECODE: '1' }, timeoutSec: 60, probeModules: ['pkg'] },
    failToPass: ['tests/test_add.py::test_add'],
  };
  fetchEntry(entry, { cache, allowLocal: true });
  const probeDir = tmp('rt-m-');
  const m = materialize(entry, path.join(probeDir, 'x'), { cache });
  entry.contentSha256 = m.contentSha256;
  entry.fileCount = m.fileCount;
  fs.rmSync(probeDir, { recursive: true, force: true });
  entry.passToPass = reallib.writeP2p(id, ['tests/test_ident.py::test_ident'], path.join(bench, 'real/p2p'));
  write(path.join(bench, 'real/manifest.json'), JSON.stringify({ version: 1, tasks: [entry], dropped: [] }));
  write(path.join(bench, `tasks/real-${id}.json`), JSON.stringify({
    id: `real-${id}`, class: 'real', target: null, prompt: 'Fix add.', real: id, hidden: id, timeoutSec: 900, tiers: ['real'],
    checks: [{ type: 'tests', manifest: true }, { type: 'fixture_unchanged', path: 'tests/test_ident.py' }], rubric: RUBRIC,
  }));
  write(path.join(bench, `tasks/hidden/${id}/overlay/tests/test_add.py`), fs.readFileSync(path.join(up, 'tests/test_add.py')));
  write(path.join(bench, 'suites/real.json'), JSON.stringify({ tasks: [`real-${id}`], arms: ['vanilla'], replicates: 1, judges: [], parallel: 1 }));
  if (!fetched) fs.rmSync(path.join(cache, id), { recursive: true, force: true });
  const prev = process.env.BENCH_REAL_CACHE;
  if (useEnv) process.env.BENCH_REAL_CACHE = cache;
  const done = () => {
    if (useEnv) { if (prev === undefined) delete process.env.BENCH_REAL_CACHE; else process.env.BENCH_REAL_CACHE = prev; }
    for (const d of [up, bench, cache]) fs.rmSync(d, { recursive: true, force: true });
  };
  return { up, bench, cache, entry, id, done };
}

module.exports = { makeRealBench, tmp, write, git, RUBRIC, FIXED_MOD, PYTEST_SKIP };
