// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/physical/ci/run-release-guard.sh, the steps of the plant release guard workflow, on throwaway git
// repositories with a fake hash file and a fake runner environment. No release content is committed anywhere.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { lineHashes } = require('../../physical/ci/release-guard.js');
const { mkScratch } = require('./scratch.js');

const SCRIPT = path.join(__dirname, '../../physical/ci/run-release-guard.sh');
const FAKE_LINE = 'a fake release line written only by the release guard CI test';

function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

/** A repository with a base commit and one more commit adding `files`; returns `{dir, base}`. */
function repoWith(files) {
  const dir = mkScratch('guard-ci-repo-');
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'change');
  return { dir, base };
}

/** Runs the script in `dir` with a fake runner temp dir; returns the exit code, output and what was left in temp. */
function run(dir, env) {
  const runnerTemp = mkScratch('guard-ci-temp-');
  const r = spawnSync('bash', [SCRIPT], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, RUNNER_TEMP: runnerTemp, ...env } });
  return { code: r.status, out: r.stdout + r.stderr, left: fs.readdirSync(runnerTemp) };
}

const HASHES = `# fake release-line hashes\n${lineHashes(FAKE_LINE)[0]}\n`;

test('with the secret, a clean history passes and the hash file is removed', () => {
  const { dir, base } = repoWith({ 'bench/physical/sim/x.py': 'print(1)\n' });
  const r = run(dir, { PLANT_RELEASE_HASHES: HASHES, GUARD_BASE: base });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no release content in history/);
  assert.deepEqual(r.left, []);
});

test('a hashed release line in history fails, without printing the line or the secret', () => {
  const { dir, base } = repoWith({ 'docs/notes.txt': `${FAKE_LINE}\n` });
  const r = run(dir, { PLANT_RELEASE_HASHES: HASHES, GUARD_BASE: base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /docs\/notes\.txt .*hashed release line/);
  assert.doesNotMatch(r.out, new RegExp(`${FAKE_LINE}|${lineHashes(FAKE_LINE)[0]}`));
  assert.deepEqual(r.left, []);
});

test('without the secret, a plant change fails and names the secret, as does a push with no usable before SHA', () => {
  const { dir, base } = repoWith({ 'bench/runner/lib/plant/x.js': '1\n' });
  for (const GUARD_BASE of [base, '', '0'.repeat(40), 'f'.repeat(40)]) {
    const r = run(dir, { PLANT_RELEASE_HASHES: '', GUARD_BASE });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /PLANT_RELEASE_HASHES secret is empty.*Fork PRs never get repository secrets/);
  }
  const other = repoWith({ 'bench/README.md': 'x\n' });
  assert.equal(run(other.dir, { PLANT_RELEASE_HASHES: '', GUARD_BASE: '' }).code, 1);
});

test('without the secret, a change to other bench files runs the path and type checks only', () => {
  const clean = repoWith({ 'bench/README.md': 'docs\n' });
  const r = run(clean.dir, { PLANT_RELEASE_HASHES: '', GUARD_BASE: clean.base });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /paths, file types and encrypted headers only/);
  const bad = repoWith({ 'bench/fixtures/x.cedar': 'stub\n' });
  assert.equal(run(bad.dir, { PLANT_RELEASE_HASHES: '', GUARD_BASE: bad.base }).code, 1);
});

test('a shallow clone fails before the scan', () => {
  const { dir } = repoWith({ 'a.txt': 'x\n' });
  const shallow = path.join(mkScratch('guard-ci-shallow-'), 'clone');
  assert.equal(spawnSync('git', ['clone', '-q', '--depth', '1', `file://${dir}`, shallow]).status, 0);
  const r = run(shallow, { PLANT_RELEASE_HASHES: HASHES, GUARD_BASE: '' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /shallow/);
});
