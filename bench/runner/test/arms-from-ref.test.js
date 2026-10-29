// SPDX-License-Identifier: Apache-2.0
'use strict';

// Arms built from any git ref or working-tree directory. Uses temp repos with a fake layout; no cargo, no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmp, write } = require('./helpers.js');
const { resolveArm, resolveArms, parseArmSpec, formatArmRows } = require('../lib/arms.js');
const src = require('../lib/arm-source.js');
const sandbox = require('../lib/sandbox.js');
const rc = require('../lib/runconfig.js');
const { errorResult } = require('../lib/result.js');
const { prepareAll, preflightTable } = require('../lib/orchestrate.js');

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
}

// main (2 commits) with the layout the build needs; origin/main = main; branch feat/x two commits ahead.
function makeRepo() {
  const repo = tmp();
  git(repo, 'init', '-q', '-b', 'main');
  write(path.join(repo, 'cli/konductor-rs/Cargo.toml'), '[package]\nname = "k"\n');
  write(path.join(repo, 'mcp/Cargo.toml'), '[workspace]\n');
  write(path.join(repo, 'skills/x/SKILL.md'), 'one\n');
  write(path.join(repo, '.gitignore'), 'ignored.log\ntarget/\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'one');
  const first = git(repo, 'rev-parse', 'HEAD');
  write(path.join(repo, 'a.txt'), 'main\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'two');
  const mainSha = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'update-ref', 'refs/remotes/origin/main', mainSha);
  git(repo, 'tag', 'v1.0.0', first);
  git(repo, 'checkout', '-q', '-b', 'feat/x');
  write(path.join(repo, 'skills/x/SKILL.md'), 'changed\n');
  git(repo, 'commit', '-qam', 'skill change');
  write(path.join(repo, 'docs/new.md'), 'new\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'doc');
  const featSha = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'update-ref', 'refs/remotes/origin/feat/y', featSha);
  git(repo, 'update-ref', 'refs/pull/95/head', featSha);
  return { repo, first, mainSha, featSha };
}
const rm = (...dirs) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));

test('name=ref resolves a local branch, a tag, a remote-tracking ref, refs/pull/<n>/head and full or abbreviated SHAs', () => {
  const { repo, first, mainSha, featSha } = makeRepo();
  try {
    const cases = [
      ['a=feat/x', featSha, 'refs/heads/feat/x'],
      ['b=v1.0.0', first, 'refs/tags/v1.0.0'],
      ['c=origin/feat/y', featSha, 'refs/remotes/origin/feat/y'],
      ['d=refs/pull/95/head', featSha, 'refs/pull/95/head'],
      ['e=pull/95/head', featSha, 'refs/pull/95/head'],
      [`f=${mainSha}`, mainSha, 'sha'],
      [`g=${mainSha.slice(0, 9)}`, mainSha, 'sha'],
    ];
    for (const [spec, sha, resolved] of cases) {
      const arm = resolveArm(spec, repo);
      assert.equal(arm.commitSha, sha, spec);
      assert.equal(arm.refResolved, resolved, spec);
      assert.equal(arm.source, 'git');
      assert.equal(arm.dirty, false);
      assert.equal(arm.ref, spec.slice(2));
      assert.equal(arm.label, `${spec[0]}@${sha.slice(0, 7)}`);
      assert.equal(arm.vanilla, false);
    }
  } finally { rm(repo); }
});

test('a missing ref fails with what was tried and how to make it available; nothing is fetched', () => {
  const { repo } = makeRepo();
  try {
    const before = git(repo, 'for-each-ref');
    let msg;
    try { resolveArm('pr-95=pr-95', repo); } catch (e) { msg = e.message; }
    assert.ok(msg, 'throws');
    assert.match(msg, /ref "pr-95" not found/);
    for (const t of ['refs/heads/pr-95', 'refs/tags/pr-95', 'refs/remotes/pr-95']) assert.ok(msg.includes(t), t);
    assert.match(msg, /never fetches/);
    assert.ok(msg.includes('git -C ' + repo + ' fetch origin pull/95/head:pr-95'));
    assert.equal(git(repo, 'for-each-ref'), before);
  } finally { rm(repo); }
});

test('a name that is both a branch and a tag on different commits is ambiguous until qualified', () => {
  const { repo, first, featSha } = makeRepo();
  try {
    git(repo, 'branch', 'dup', featSha);
    git(repo, 'tag', 'dup', first);
    assert.throws(() => resolveArm('p=dup', repo), (e) => /ambiguous/.test(e.message) && e.message.includes('refs/heads/dup') && e.message.includes('refs/tags/dup'));
    assert.equal(resolveArm('p=refs/heads/dup', repo).commitSha, featSha);
    assert.equal(resolveArm('p=refs/tags/dup', repo).commitSha, first);
    git(repo, 'tag', 'same', featSha);
    git(repo, 'branch', 'same', featSha);
    assert.equal(resolveArm('p=same', repo).commitSha, featSha, 'same commit under two names is not ambiguous');
  } finally { rm(repo); }
});

test('ref names that could be read as git options or revision syntax are refused', () => {
  const { repo } = makeRepo();
  try {
    for (const bad of ['--upload-pack=x', 'main~1', 'main^', 'a..b', 'feat/x:y', 'a b', 'x@{1}']) {
      assert.throws(() => resolveArm(`p=${bad}`, repo), /not a valid git ref name/, bad);
    }
  } finally { rm(repo); }
});

test('arm names: pattern, reserved names, tag-like names only as themselves, bare refs need a name, duplicates are refused', () => {
  const { repo } = makeRepo();
  try {
    for (const bad of ['Bad=feat/x', '-x=feat/x', '.x=feat/x', 'a/b=feat/x', `${'a'.repeat(42)}=feat/x`, '=feat/x', 'vanilla=feat/x', 'main=feat/x', 'v1.2.0=feat/x', 'a b=feat/x']) {
      assert.throws(() => parseArmSpec(bad), /arm name|reserved|name=ref/i, bad);
    }
    assert.throws(() => parseArmSpec('p='), /needs a ref/);
    assert.throws(() => parseArmSpec('p=dir:'), /needs a path/);
    assert.throws(() => resolveArm('feat/x', repo), /name=ref/);
    assert.equal(resolveArm('v1.0.0', repo).label, 'v1.0.0');
    assert.equal(resolveArm('v1.0.0=v1.0.0', repo).label, 'v1.0.0');
    assert.equal(parseArmSpec('a.b_c-1=origin/feat/x').name, 'a.b_c-1');
    assert.equal(parseArmSpec(`${'a'.repeat(41)}=x`).name.length, 41);
    assert.throws(() => resolveArms(['v1.0.0', 'v1.0.0=v1.0.0'], repo), /given twice/);
    assert.throws(() => resolveArms(['p=feat/x', 'p=v1.0.0'], repo), /given twice/);
    assert.deepEqual(resolveArms(['vanilla', 'v1.0.0', 'main', 'p=feat/x'], repo).map((a) => a.id), ['vanilla', 'v1.0.0', 'main', 'p']);
  } finally { rm(repo); }
});

test('oc- prefix still selects opencode and keeps the inner arm identity', () => {
  const { repo, featSha } = makeRepo();
  try {
    const a = resolveArm('oc-p=feat/x', repo);
    assert.equal(a.id, 'oc-p');
    assert.equal(a.runtime, 'opencode');
    assert.equal(a.commitSha, featSha);
    assert.equal(resolveArm('oc-vanilla', repo).vanilla, true);
  } finally { rm(repo); }
});

test('git arms record merge-base with origin/main, commits ahead and changed top-level paths only', () => {
  const { repo, mainSha, featSha } = makeRepo();
  try {
    const arm = resolveArm('p=feat/x', repo);
    assert.equal(arm.mergeBase, mainSha);
    assert.equal(arm.commitsAhead, 2);
    assert.deepEqual(arm.filesChanged, { count: 2, topLevel: ['docs', 'skills'] });
    assert.equal(arm.contentHash, git(repo, 'rev-parse', `${featSha}^{tree}`));
    const main = resolveArm('main', repo);
    assert.equal(main.commitsAhead, 0);
    assert.deepEqual(main.filesChanged, { count: 0, topLevel: [] });
    git(repo, 'update-ref', '-d', 'refs/remotes/origin/main');
    const noOrigin = resolveArm('p=feat/x', repo);
    assert.equal(noOrigin.mergeBase, null);
    assert.equal(noOrigin.commitsAhead, null);
    assert.equal(noOrigin.filesChanged, null);
  } finally { rm(repo); }
});

function makeWorktree(repo) {
  const wt = path.join(tmp(), 'wt');
  git(repo, 'worktree', 'add', '-q', '--detach', wt, 'main');
  return wt;
}

test('dir: snapshots tracked changes and untracked files, leaves out ignored files, .git and deleted files', () => {
  const { repo, mainSha } = makeRepo();
  const wt = makeWorktree(repo);
  const dest = tmp();
  try {
    write(path.join(wt, 'skills/x/SKILL.md'), 'wip edit\n');
    write(path.join(wt, 'brand-new.md'), 'untracked\n');
    write(path.join(wt, 'ignored.log'), 'noise\n');
    write(path.join(wt, 'target/debug/big'), 'noise\n');
    fs.rmSync(path.join(wt, 'a.txt'));
    const arm = resolveArm(`wip=dir:${wt}`, repo);
    assert.equal(arm.source, 'dir');
    assert.equal(arm.dirty, true);
    assert.equal(arm.baseSha, mainSha);
    assert.equal(arm.commitSha, null);
    assert.equal(arm.ref, `dir:${wt}`);
    assert.equal(arm.label, `wip@${arm.contentHash.slice(0, 12)}`);
    assert.equal(arm.mergeBase, mainSha);
    assert.equal(arm.commitsAhead, 0);
    assert.deepEqual(arm.filesChanged.topLevel, ['a.txt', 'brand-new.md', 'skills']);
    assert.equal(arm.filesChanged.count, 3);
    sandbox.exportArm(arm, { repo }, dest);
    const names = fs.readdirSync(dest, { recursive: true }).map(String).filter((n) => fs.statSync(path.join(dest, n)).isFile()).sort();
    assert.deepEqual(names, ['.gitignore', 'brand-new.md', 'cli/konductor-rs/Cargo.toml', 'mcp/Cargo.toml', 'skills/x/SKILL.md']);
    assert.equal(fs.readFileSync(path.join(dest, 'skills/x/SKILL.md'), 'utf8'), 'wip edit\n');
  } finally { rm(repo, dest, path.dirname(wt)); }
});

test('dir: a clean worktree is not dirty; a plain copy without git is, with no base sha and the usual excludes', () => {
  const { repo, mainSha } = makeRepo();
  const wt = makeWorktree(repo);
  const plain = path.join(tmp(), 'plain');
  try {
    const clean = resolveArm(`w=dir:${wt}`, repo);
    assert.equal(clean.dirty, false);
    assert.equal(clean.baseSha, mainSha);
    fs.cpSync(wt, plain, { recursive: true });
    fs.rmSync(path.join(plain, '.git'), { force: true });
    for (const d of ['node_modules', 'target', 'dist', 'build', '.git']) write(path.join(plain, d, 'junk.txt'), 'x');
    const arm = resolveArm(`p=dir:${plain}`, repo);
    assert.equal(arm.dirty, true);
    assert.equal(arm.baseSha, null);
    assert.equal(arm.mergeBase, null);
    assert.equal(arm.filesChanged, null);
    const snap = src.snapshotDir(plain);
    assert.equal(snap.isGit, false);
    assert.ok(snap.files.length > 0);
    assert.ok(snap.files.every((f) => !/(^|\/)(node_modules|target|dist|build|\.git)\//.test(f.rel)), 'excluded directories');
  } finally { rm(repo, path.dirname(wt), path.dirname(plain)); }
});

test('dir: a missing directory and a non-directory fail with the path', () => {
  const { repo } = makeRepo();
  const f = path.join(tmp(), 'file');
  fs.writeFileSync(f, 'x');
  try {
    assert.throws(() => resolveArm('w=dir:/nonexistent/zzz', repo), /directory not found: \/nonexistent\/zzz/);
    assert.throws(() => resolveArm(`w=dir:${f}`, repo), /not a directory/);
  } finally { rm(repo, path.dirname(f)); }
});

test('content hash: stable across mtimes and copies, changes with bytes, new files and the exec bit, not with ignored files', () => {
  const { repo } = makeRepo();
  const wt = makeWorktree(repo);
  try {
    const h0 = src.snapshotDir(wt).hash;
    assert.match(h0, /^[0-9a-f]{64}$/);
    const t = new Date(Date.now() - 86400000);
    fs.utimesSync(path.join(wt, 'a.txt'), t, t);
    assert.equal(src.snapshotDir(wt).hash, h0, 'mtime does not matter');
    write(path.join(wt, 'ignored.log'), 'ignored\n');
    assert.equal(src.snapshotDir(wt).hash, h0, 'ignored files do not matter');
    write(path.join(wt, 'a.txt'), 'main!\n');
    const h1 = src.snapshotDir(wt).hash;
    assert.notEqual(h1, h0);
    write(path.join(wt, 'untracked.txt'), 'u\n');
    const h2 = src.snapshotDir(wt).hash;
    assert.notEqual(h2, h1);
    fs.chmodSync(path.join(wt, 'untracked.txt'), 0o755);
    assert.notEqual(src.snapshotDir(wt).hash, h2, 'exec bit is part of the content');
    fs.chmodSync(path.join(wt, 'untracked.txt'), 0o644);
    assert.equal(src.snapshotDir(wt).hash, h2, 'and the hash returns when the state returns');
  } finally { rm(repo, path.dirname(wt)); }
});

test('export of a ref ignores the dirty tree; a dir arm refuses a snapshot that changed after it was hashed', () => {
  const { repo, featSha } = makeRepo();
  const wt = makeWorktree(repo);
  const out = tmp();
  try {
    git(repo, 'checkout', '-q', 'feat/x');
    write(path.join(repo, 'skills/x/SKILL.md'), 'DIRTY\n');
    write(path.join(repo, 'untracked.txt'), 'u\n');
    const arm = resolveArm('p=feat/x', repo);
    assert.equal(arm.commitSha, featSha);
    sandbox.exportArm(arm, { repo }, path.join(out, 'git'));
    assert.equal(fs.readFileSync(path.join(out, 'git/skills/x/SKILL.md'), 'utf8'), 'changed\n');
    assert.equal(fs.existsSync(path.join(out, 'git/untracked.txt')), false);

    const dirArm = resolveArm(`w=dir:${wt}`, repo);
    write(path.join(wt, 'late-edit.txt'), 'x\n');
    assert.throws(() => sandbox.exportArm(dirArm, { repo }, path.join(out, 'dir')), /changed after it was hashed/);
  } finally { rm(repo, path.dirname(wt), out); }
});

test('layoutProblem names the missing build input for a ref that predates the layout and for a dir', () => {
  const { repo, first } = makeRepo();
  const bare = tmp();
  try {
    git(repo, 'checkout', '-q', '--orphan', 'old');
    git(repo, 'rm', '-rfq', '.');
    write(path.join(repo, 'README'), 'old\n');
    git(repo, 'add', 'README');
    git(repo, 'commit', '-q', '-m', 'old');
    const old = resolveArm('old=old', repo);
    const need = ['cli/konductor-rs/Cargo.toml', 'mcp/Cargo.toml'];
    const p = src.layoutProblem(old, repo, need);
    assert.match(p, /cli\/konductor-rs\/Cargo\.toml/);
    assert.match(p, /predates/);
    assert.equal(src.layoutProblem(resolveArm('v1.0.0', repo), repo, need), null);
    assert.equal(first.length, 40);
    const dirArm = resolveArm(`d=dir:${bare}`, repo);
    assert.match(src.layoutProblem(dirArm, repo, need), /mcp\/Cargo\.toml|cli\/konductor-rs/);
  } finally { rm(repo, bare); }
});

test('prepareAll rejects arms without the build layout before building anything; --allow-partial keeps the rest', () => {
  const { repo } = makeRepo();
  const cache = tmp();
  try {
    git(repo, 'checkout', '-q', '--orphan', 'old');
    git(repo, 'rm', '-rfq', '.');
    write(path.join(repo, 'README'), 'old\n');
    git(repo, 'add', 'README');
    git(repo, 'commit', '-q', '-m', 'old');
    const old = resolveArm('old=old', repo);
    const ctx = { repo, cacheDir: cache, cargoTarget: path.join(cache, 't'), cargoOnline: false, config: { model: 'm' } };
    const logs = [];
    assert.throws(() => prepareAll({ arms: [old], ctx, log: (m) => logs.push(m) }), /arm old could not be prepared.*cli\/konductor-rs\/Cargo\.toml.*--allow-partial/s);
    assert.deepEqual(logs.filter((l) => /^preparing/.test(l)), [], 'nothing was started');
    const { prepared, errors } = prepareAll({ arms: [old], ctx, log: () => {}, allowPartial: true });
    assert.equal(prepared.size, 0);
    assert.match(errors.get('old'), /predates/);
    assert.deepEqual(fs.readdirSync(cache), [], 'no cache directory was created');
  } finally { rm(repo, cache); }
});

test('run-config arm records and every result carry ref, sha, source, dirty, content hash, merge-base, ahead and changed top-level paths', () => {
  const { repo, mainSha, featSha } = makeRepo();
  const wt = makeWorktree(repo);
  try {
    write(path.join(wt, 'brand-new.md'), 'x\n');
    const arms = resolveArms(['vanilla', 'p=feat/x', `w=dir:${wt}`], repo);
    const recs = rc.armRecords(arms, new Map(), new Map());
    const p = recs.find((r) => r.id === 'p');
    assert.deepEqual(
      { ref: p.ref, commitSha: p.commitSha, source: p.source, dirty: p.dirty, mergeBase: p.mergeBase, commitsAhead: p.commitsAhead, filesChanged: p.filesChanged },
      { ref: 'feat/x', commitSha: featSha, source: 'git', dirty: false, mergeBase: mainSha, commitsAhead: 2, filesChanged: { count: 2, topLevel: ['docs', 'skills'] } },
    );
    assert.equal(typeof p.contentHash, 'string');
    const w = recs.find((r) => r.id === 'w');
    assert.equal(w.source, 'dir');
    assert.equal(w.dirty, true);
    assert.equal(w.baseSha, mainSha);
    assert.equal(w.contentHash.length, 64);
    const v = recs.find((r) => r.id === 'vanilla');
    assert.equal(v.source, null);
    for (const arm of arms) {
      const r = errorResult({ arm, task: { id: 't1' }, replicate: 1, config: { model: 'm', effort: 'high' }, env: {}, message: 'x', meta: {} });
      assert.equal(r.source, arm.source ?? null);
      assert.equal(r.contentHash, arm.contentHash ?? null);
      assert.equal(r.mergeBase, arm.mergeBase ?? null);
      assert.deepEqual(r.filesChanged, arm.filesChanged ?? null);
      assert.equal(r.commitsAhead, arm.commitsAhead ?? null);
      assert.equal(r.dirty, arm.dirty ?? null);
      assert.equal(r.baseSha, arm.baseSha ?? null);
    }
    assert.doesNotMatch(JSON.stringify(recs), /wip edit|skills\/x|docs\/new/, 'top-level names only, no deeper paths or contents');
  } finally { rm(repo, path.dirname(wt)); }
});

test('preflight table shows a dir arm by its content hash and a git arm by its commit', () => {
  const { repo, featSha } = makeRepo();
  const wt = makeWorktree(repo);
  try {
    const arms = resolveArms(['vanilla', 'p=feat/x', `w=dir:${wt}`], repo);
    const prepared = new Map([['p', { mcpSha256: 'a'.repeat(64), cached: false }], ['w', { mcpSha256: 'b'.repeat(64), cached: true }]]);
    const table = preflightTable(arms, prepared, new Map());
    const lines = table.split('\n');
    assert.match(lines[0], /arm\s+ref\s+commit\s+mcp sha256\s+state/);
    assert.ok(lines[2].includes(featSha.slice(0, 10)) && lines[2].includes('feat/x') && lines[2].includes('ready (built)'));
    assert.ok(lines[3].includes(`dir:${arms[2].contentHash.slice(0, 10)}`) && lines[3].includes('ready (cached)') && lines[3].startsWith('w@'));
  } finally { rm(repo, path.dirname(wt)); }
});

test('formatArmRows lists source, commit or hash, dirty state and distance from origin/main', () => {
  const { repo } = makeRepo();
  try {
    const text = formatArmRows(resolveArms(['vanilla', 'v1.0.0', 'main', 'p=feat/x'], repo));
    assert.match(text, /p@[0-9a-f]{7}\s+git\s+feat\/x/);
    assert.match(text, /2 ahead/);
    assert.match(text, /vanilla\s+-/);
  } finally { rm(repo); }
});

test('an os tmpdir snapshot never reads outside the directory through a symlink', () => {
  const root = tmp();
  const outside = tmp();
  try {
    write(path.join(outside, 'secret.txt'), 'S\n');
    write(path.join(root, 'ok.txt'), 'ok\n');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'abs-link'));
    fs.symlinkSync('../x', path.join(root, 'escape-link'));
    fs.symlinkSync('ok.txt', path.join(root, 'inner-link'));
    const snap = src.snapshotDir(root);
    assert.deepEqual(snap.files.map((f) => f.rel).sort(), ['inner-link', 'ok.txt']);
    assert.deepEqual(snap.skipped.map((s) => s.rel).sort(), ['abs-link', 'escape-link']);
  } finally { rm(root, outside); }
});
