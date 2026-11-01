// SPDX-License-Identifier: Apache-2.0
'use strict';

// An arm records which skills its change touches, and whether the change is only skills. The orchestrator-pass verdict
// uses it to tell a skill change that never loaded from one that had no effect.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmp, write } = require('./helpers.js');
const { resolveArm } = require('../lib/arms.js');
const src = require('../lib/arm-source.js');
const { provenanceOf } = require('../lib/runconfig.js');

const git = (repo, ...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();

test('skillsIn names the skills under skills/ and says whether nothing else changed', () => {
  assert.deepEqual(src.skillsIn(['skills/a/SKILL.md', 'skills/a/ref/x.md', 'skills/b/SKILL.md']), { names: ['a', 'b'], onlySkills: true });
  assert.deepEqual(src.skillsIn(['skills/a/SKILL.md', 'agents/k.json']), { names: ['a'], onlySkills: false });
  assert.deepEqual(src.skillsIn(['agents/k.json']), { names: [], onlySkills: false });
  assert.deepEqual(src.skillsIn([]), { names: [], onlySkills: false });
  assert.deepEqual(src.skillsIn(['skills/README.md']), { names: [], onlySkills: true }, 'a file directly under skills/ names no skill');
});

function repoWith(branches) {
  const repo = tmp();
  git(repo, 'init', '-q', '-b', 'main');
  write(path.join(repo, 'cli/konductor-rs/Cargo.toml'), '[package]\n');
  write(path.join(repo, 'mcp/Cargo.toml'), '[workspace]\n');
  write(path.join(repo, 'skills/x/SKILL.md'), 'one\n');
  write(path.join(repo, 'agents/k.json'), '{}\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'one');
  git(repo, 'update-ref', 'refs/remotes/origin/main', git(repo, 'rev-parse', 'HEAD'));
  for (const [name, files] of Object.entries(branches)) {
    git(repo, 'checkout', '-q', '-b', name, 'main');
    for (const [f, t] of Object.entries(files)) write(path.join(repo, f), t);
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', name);
  }
  git(repo, 'checkout', '-q', 'main');
  return repo;
}

test('a git arm records its changed skills and onlySkills, and the result carries them', () => {
  const repo = repoWith({ 'feat/skills': { 'skills/x/SKILL.md': 'two\n', 'skills/y/SKILL.md': 'new\n' }, 'feat/mixed': { 'skills/x/SKILL.md': 'three\n', 'agents/k.json': '{"a":1}\n' } });
  try {
    const a = resolveArm('s=feat/skills', repo);
    assert.deepEqual(a.changedSkills, { names: ['x', 'y'], onlySkills: true });
    assert.deepEqual(provenanceOf(a).changedSkills, { names: ['x', 'y'], onlySkills: true });
    assert.deepEqual(resolveArm('m=feat/mixed', repo).changedSkills, { names: ['x'], onlySkills: false });
    assert.deepEqual(resolveArm('main', repo).changedSkills, { names: [], onlySkills: false });
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('a directory arm records them from the working tree against the merge base', () => {
  const repo = repoWith({});
  const wt = path.join(tmp(), 'wt');
  try {
    git(repo, 'worktree', 'add', '-q', '--detach', wt, 'main');
    write(path.join(wt, 'skills/x/SKILL.md'), 'wip\n');
    assert.deepEqual(resolveArm(`w=dir:${wt}`, repo).changedSkills, { names: ['x'], onlySkills: true });
  } finally {
    try { git(repo, 'worktree', 'remove', '--force', wt); } catch { /* already gone */ }
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(path.dirname(wt), { recursive: true, force: true });
  }
});

test('an arm with no origin/main to compare against records null, not an empty list', () => {
  const repo = repoWith({ 'feat/skills': { 'skills/x/SKILL.md': 'two\n' } });
  try {
    git(repo, 'update-ref', '-d', 'refs/remotes/origin/main');
    assert.equal(resolveArm('s=feat/skills', repo).changedSkills, null);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
