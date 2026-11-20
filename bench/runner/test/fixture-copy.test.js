// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { copyFixture } = require('../lib/sandbox.js');
const { mkScratch } = require('./scratch.js');

test('copyFixture never copies the answer key into the agent working directory', () => {
  const root = mkScratch('fixcopy-');
  try {
    const src = path.join(root, 'src');
    fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(src, 'a.txt'), 'a');
    fs.writeFileSync(path.join(src, '.bench-answer-key.md'), 'secret');
    fs.writeFileSync(path.join(src, 'sub', '.bench-answer-key.md'), 'secret');
    fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'b');
    const dest = path.join(root, 'dest');
    copyFixture(src, dest);
    assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8'), 'a');
    assert.equal(fs.readFileSync(path.join(dest, 'sub', 'b.txt'), 'utf8'), 'b');
    assert.equal(fs.existsSync(path.join(dest, '.bench-answer-key.md')), false);
    assert.equal(fs.existsSync(path.join(dest, 'sub', '.bench-answer-key.md')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('copyFixture renames a fixture dotgit directory to .git', () => {
  const root = mkScratch('fixcopy-git-');
  try {
    const src = path.join(root, 'src');
    fs.mkdirSync(path.join(src, 'dotgit'), { recursive: true });
    fs.writeFileSync(path.join(src, 'dotgit', 'HEAD'), 'ref: refs/heads/main\n');
    const dest = path.join(root, 'dest');
    copyFixture(src, dest);
    assert.equal(fs.readFileSync(path.join(dest, '.git', 'HEAD'), 'utf8'), 'ref: refs/heads/main\n');
    assert.equal(fs.existsSync(path.join(dest, 'dotgit')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('copyFixture puts back the empty refs dirs a git checkout of a dotgit drops, so git sees a repository', () => {
  const root = mkScratch('fixcopy-refs-');
  try {
    const src = path.join(root, 'src');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'f', GIT_AUTHOR_EMAIL: 'f@example.invalid', GIT_COMMITTER_NAME: 'f', GIT_COMMITTER_EMAIL: 'f@example.invalid' };
    const git = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8' }).trim();
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'a.txt'), 'a');
    git(src, 'init', '-q', '-b', 'main', '--template=');
    git(src, 'add', '-A');
    git(src, 'commit', '-q', '-m', 'one');
    git(src, 'pack-refs', '--all');
    fs.renameSync(path.join(src, '.git'), path.join(src, 'dotgit'));
    // what a checkout of the fixture holds: git stores no empty directory
    for (const d of ['refs/heads', 'refs/tags', 'refs']) fs.rmSync(path.join(src, 'dotgit', d), { recursive: true, force: true });
    const dest = path.join(root, 'dest');
    copyFixture(src, dest);
    assert.equal(git(dest, 'log', '--format=%s', 'main'), 'one');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
