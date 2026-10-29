// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmp } = require('./helpers.js');
const { resolveArm } = require('../lib/arms.js');
const sandbox = require('../lib/sandbox.js');

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
}

function makeRepo() {
  const repo = tmp();
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'one');
  const first = git(repo, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
  git(repo, 'commit', '-qam', 'two');
  const second = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'tag', 'v1.0.0', first);
  return { repo, first, second };
}

test('main resolves to the remote-tracking origin/main and records the gap to local main', () => {
  const { repo, first, second } = makeRepo();
  try {
    git(repo, 'update-ref', 'refs/remotes/origin/main', second);
    git(repo, 'reset', '-q', '--soft', first);
    const arm = resolveArm('main', repo);
    assert.equal(arm.commitSha, second);
    assert.equal(arm.originMainSha, second);
    assert.equal(arm.localMainSha, first);
    assert.equal(arm.behindOrigin, 1);
    assert.equal(arm.ref, 'origin/main');
    assert.equal(arm.label, `main-unreleased@${second.slice(0, 7)}`);
    assert.deepEqual(arm.warnings, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('without origin/main the arm falls back to local main and warns', () => {
  const { repo, second } = makeRepo();
  try {
    const arm = resolveArm('main', repo);
    assert.equal(arm.commitSha, second);
    assert.equal(arm.originMainSha, null);
    assert.equal(arm.ref, 'main');
    assert.equal(arm.behindOrigin, null);
    assert.match(arm.warnings[0], /origin\/main not found/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('resolveArm("main") and the exported tree ignore a dirty working tree', () => {
  const { repo, second } = makeRepo();
  const out = tmp();
  try {
    git(repo, 'update-ref', 'refs/remotes/origin/main', second);
    const before = resolveArm('main', repo);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'DIRTY\n');
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'x\n');
    git(repo, 'add', 'untracked.txt');
    const after = resolveArm('main', repo);
    assert.equal(after.commitSha, before.commitSha);
    sandbox.exportRef(repo, after.commitSha, path.join(out, 'src'));
    assert.equal(fs.readFileSync(path.join(out, 'src/a.txt'), 'utf8'), 'two\n');
    assert.equal(fs.existsSync(path.join(out, 'src/untracked.txt')), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('tag arms resolve to their tag and vanilla has no commit', () => {
  const { repo, first } = makeRepo();
  try {
    assert.equal(resolveArm('v1.0.0', repo).commitSha, first);
    const v = resolveArm('vanilla', repo);
    assert.equal(v.vanilla, true);
    assert.equal(v.commitSha, null);
    assert.throws(() => resolveArm('v9.9.9', repo));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('normalizeAgentModels rewrites every installed agent and reports the ones that changed', () => {
  const home = tmp();
  try {
    const dir = path.join(home, '.kiro/agents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ name: 'a', model: 'claude-sonnet-5' }));
    fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ name: 'b', model: 'claude-sonnet-5.5' }));
    fs.writeFileSync(path.join(dir, 'c.json'), JSON.stringify({ name: 'c' }));
    assert.deepEqual(sandbox.normalizeAgentModels(home, 'claude-sonnet-5.5'), ['a', 'c']);
    for (const n of ['a', 'b', 'c']) assert.equal(JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`))).model, 'claude-sonnet-5.5');
    assert.deepEqual(sandbox.normalizeAgentModels(home, 'claude-sonnet-5.5'), []);
    assert.deepEqual(sandbox.normalizeAgentModels(path.join(home, 'none'), 'm'), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('findAnswerKey finds a key at any depth and ignores node_modules', () => {
  const d = tmp();
  try {
    fs.mkdirSync(path.join(d, 'a/b'), { recursive: true });
    assert.equal(sandbox.findAnswerKey(d), null);
    fs.writeFileSync(path.join(d, 'a/b/.bench-answer-key.md'), 'k');
    assert.equal(sandbox.findAnswerKey(d), path.join(d, 'a/b/.bench-answer-key.md'));
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
