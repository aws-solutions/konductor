// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('a committed dotgit whose refs are all packed (git kept no empty refs/) copies as a working repository', () => {
  const { execFileSync } = require('node:child_process');
  const root = mkScratch('fixcopy-packed-');
  try {
    const src = path.join(root, 'src');
    fs.mkdirSync(src);
    const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();
    git(src, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(src, 'a.txt'), 'a\n');
    git(src, 'add', '.');
    git(src, 'commit', '-q', '-m', 'one');
    git(src, 'pack-refs', '--all');
    fs.renameSync(path.join(src, '.git'), path.join(src, 'dotgit'));
    // What a checkout of the bench repository holds: the empty refs/ directories are gone.
    fs.rmSync(path.join(src, 'dotgit', 'refs'), { recursive: true, force: true });
    const dest = path.join(root, 'dest');
    copyFixture(src, dest);
    assert.match(git(dest, 'rev-parse', 'HEAD'), /^[0-9a-f]{40}$/);
    assert.equal(git(dest, 'branch', '--show-current'), 'main');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
