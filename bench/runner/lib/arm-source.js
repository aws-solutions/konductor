// SPDX-License-Identifier: Apache-2.0
'use strict';

// Where an arm's content comes from: a git ref resolved locally, or a working-tree directory snapshot.
// Nothing here fetches; a ref that is not in the local repository is an error with instructions.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const PLAIN_COPY_EXCLUDES = new Set(['.git', 'node_modules', 'target', 'dist', 'build']);
const MAX_TOP_LEVEL = 100;

function git(repo, args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).trim();
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

const commitOf = (repo, rev) => git(repo, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { allowFail: true }) || null;

// A ref the runner passes to git must not be readable as an option or as revision syntax (~, ^, :, @{}, ..).
function validRefName(ref) {
  return /^[A-Za-z0-9][A-Za-z0-9._/+-]*$/.test(ref) && !ref.includes('..') && !ref.includes('//') && !/(\.lock|\/|\.)$/.test(ref);
}

const isHex = (s) => /^[0-9a-f]{7,40}$/i.test(s);

function candidateRefs(ref) {
  if (/^[0-9a-f]{40}$/i.test(ref)) return [];
  if (ref.startsWith('refs/')) return [ref];
  return [`refs/heads/${ref}`, `refs/tags/${ref}`, `refs/remotes/${ref}`, `refs/${ref}`];
}

function notFoundMessage(repo, ref, tried) {
  const n = /(\d+)/.exec(ref)?.[1] ?? '<n>';
  return [
    `ref "${ref}" not found in ${repo} (resolved locally; the runner never fetches).`,
    `Tried: ${tried.join(', ')}`,
    'Make the ref available yourself, then run again:',
    `  git -C ${repo} fetch origin pull/${n}/head:pr-${n}     (a GitHub pull request; then use name=pr-${n})`,
    `  git -C ${repo} fetch origin <branch>                (then use name=origin/<branch>)`,
  ].join('\n');
}

/**
 * Resolves `ref` to a full commit SHA using only objects already in `repo`.
 * Order: refs/heads, refs/tags, refs/remotes, refs/<ref> (covers pull/95/head), then a commit SHA or abbreviation.
 * Two namespaces that name different commits are an error, not a silent pick.
 */
function resolveRef(repo, ref) {
  if (!validRefName(ref)) throw new Error(`"${ref}" is not a valid git ref name (letters, digits, . _ - + and / only; no revision syntax such as ~ ^ : @{ or ..)`);
  const tried = [];
  const hits = [];
  for (const full of candidateRefs(ref)) {
    tried.push(full);
    const sha = commitOf(repo, full);
    if (sha) hits.push({ ref: full, sha });
  }
  const distinct = [...new Set(hits.map((h) => h.sha))];
  if (distinct.length > 1) {
    throw new Error(`ref "${ref}" is ambiguous in ${repo}: ${hits.map((h) => `${h.ref} -> ${h.sha.slice(0, 10)}`).join(', ')}. Qualify it, for example name=${hits[0].ref}`);
  }
  if (hits.length) return { sha: hits[0].sha, refResolved: hits[0].ref, tried };
  if (isHex(ref)) {
    tried.push('commit SHA');
    const sha = commitOf(repo, ref);
    if (sha) return { sha, refResolved: 'sha', tried };
  }
  throw new Error(notFoundMessage(repo, ref, tried));
}

const topLevelOf = (files) => [...new Set(files.map((f) => f.split('/')[0]))].sort().slice(0, MAX_TOP_LEVEL);

function filesChanged(files) {
  return { count: files.length, topLevel: topLevelOf(files) };
}

// Distance from origin/main as the local repository knows it. All null when it cannot be computed.
function distanceFromMain(repo, sha, { dir = null } = {}) {
  const none = { mergeBase: null, commitsAhead: null, filesChanged: null };
  if (!sha) return none;
  const origin = commitOf(repo, 'refs/remotes/origin/main');
  if (!origin) return none;
  const mergeBase = git(repo, ['merge-base', origin, sha], { allowFail: true });
  if (!mergeBase) return none;
  const ahead = Number(git(repo, ['rev-list', '--count', `${mergeBase}..${sha}`]));
  let files;
  if (dir) {
    // Working tree against the merge-base, plus untracked files. The directory must share the repo's objects.
    const changed = git(dir, ['diff', '--name-only', '-z', mergeBase], { allowFail: true });
    if (changed === null) return { mergeBase, commitsAhead: ahead, filesChanged: null };
    const untracked = git(dir, ['ls-files', '--others', '--exclude-standard', '-z'], { allowFail: true }) || '';
    files = [...new Set([...changed.split('\0'), ...untracked.split('\0')].filter(Boolean))];
  } else {
    files = git(repo, ['diff', '--name-only', '-z', mergeBase, sha]).split('\0').filter(Boolean);
  }
  return { mergeBase, commitsAhead: ahead, filesChanged: filesChanged(files) };
}

const treeOf = (repo, sha) => git(repo, ['rev-parse', `${sha}^{tree}`]);

function isGitWorkTreeRoot(dir) {
  const top = git(dir, ['rev-parse', '--show-toplevel'], { allowFail: true });
  if (!top) return false;
  try { return fs.realpathSync(top) === fs.realpathSync(dir); } catch { return false; }
}

// Symlinks stay in the snapshot only when they point to a relative target inside the directory.
function linkIsContained(rel, target) {
  if (path.isAbsolute(target)) return false;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), target));
  return !resolved.startsWith('../') && resolved !== '..';
}

function listWithGit(dir) {
  const out = execFileSync('git', ['-C', dir, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return [...new Set(out.split('\0').filter(Boolean))];
}

function listPlain(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (PLAIN_COPY_EXCLUDES.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listPlain(dir, r));
    else out.push(r);
  }
  return out;
}

/**
 * The files of a directory that an arm is built from, with one content hash over their paths, exec bits and bytes.
 * A git work tree contributes tracked and untracked files that are not ignored; any other directory is copied whole
 * minus .git, node_modules, target, dist and build. Ignored files, deleted files, sockets and escaping symlinks are left out.
 */
function snapshotDir(dir) {
  const isGit = isGitWorkTreeRoot(dir);
  const rels = (isGit ? listWithGit(dir) : listPlain(dir)).sort();
  const files = [];
  const skipped = [];
  const h = crypto.createHash('sha256');
  for (const rel of rels) {
    const abs = path.join(dir, rel);
    let st;
    try { st = fs.lstatSync(abs); } catch { continue; }
    if (st.isSymbolicLink()) {
      const target = fs.readlinkSync(abs);
      if (!linkIsContained(rel, target)) { skipped.push({ rel, reason: 'symlink leaves the directory' }); continue; }
      files.push({ rel, abs, kind: 'link', target });
      h.update(rel).update('\0l\0').update(target).update('\0');
    } else if (st.isFile()) {
      const exec = (st.mode & 0o111) !== 0;
      files.push({ rel, abs, kind: 'file', exec });
      h.update(rel).update(exec ? '\0x\0' : '\0-\0').update(fs.readFileSync(abs)).update('\0');
    }
  }
  return { isGit, files, skipped, hash: h.digest('hex') };
}

// Copies the snapshot into `dest`. Refuses when the directory no longer matches the hash recorded at resolve time.
function copySnapshot(dir, dest, expectedHash) {
  const snap = snapshotDir(dir);
  if (expectedHash && snap.hash !== expectedHash) {
    throw new Error(`directory ${dir} changed after it was hashed (${expectedHash.slice(0, 12)} -> ${snap.hash.slice(0, 12)}); stop editing it while a run is preparing, then run again`);
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const f of snap.files) {
    const to = path.join(dest, f.rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (f.kind === 'link') fs.symlinkSync(f.target, to);
    else { fs.copyFileSync(f.abs, to); fs.chmodSync(to, f.exec ? 0o755 : 0o644); }
  }
  return snap.hash;
}

function describeDir(repo, dir) {
  let st;
  try { st = fs.statSync(dir); } catch { throw new Error(`directory not found: ${dir}`); }
  if (!st.isDirectory()) throw new Error(`not a directory: ${dir}`);
  const snap = snapshotDir(dir);
  const isGit = snap.isGit;
  const baseSha = isGit ? git(dir, ['rev-parse', 'HEAD'], { allowFail: true }) : null;
  const dirty = isGit ? (git(dir, ['status', '--porcelain', '--untracked-files=all']) || '').length > 0 : true;
  const shared = baseSha && commitOf(repo, baseSha) === baseSha;
  const dist = shared ? distanceFromMain(repo, baseSha, { dir }) : { mergeBase: null, commitsAhead: null, filesChanged: null };
  const warnings = [
    dirty ? 'working-tree snapshot, not a commit: uncommitted and untracked files are part of the arm' : 'working-tree snapshot of a clean checkout',
    ...snap.skipped.map((s) => `${s.rel} left out: ${s.reason}`),
  ];
  return { contentHash: snap.hash, dirty, baseSha, warnings, ...dist };
}

/**
 * Null when the arm has what the build needs, else the reason. A ref that predates `cli/konductor-rs`
 * cannot be built by this runner, and should fail before any other arm spends time building.
 */
function layoutProblem(arm, repo, required) {
  if (arm.vanilla || !required.length) return null;
  let missing;
  if (arm.source === 'dir') {
    missing = required.filter((p) => !fs.existsSync(path.join(arm.dir, p)));
  } else {
    if (!arm.commitSha || !commitOf(repo, arm.commitSha)) return `commit ${arm.commitSha ? arm.commitSha.slice(0, 10) : '(none)'} is not in ${repo}`;
    missing = required.filter((p) => spawnSync('git', ['-C', repo, 'cat-file', '-e', `${arm.commitSha}:${p}`], { stdio: 'ignore' }).status !== 0);
  }
  if (!missing.length) return null;
  return `${arm.source === 'dir' ? 'directory' : 'ref'} ${arm.ref ?? arm.id} has no ${missing.join(', ')}; it predates the layout this runner builds from (cli/konductor-rs and mcp)`;
}

module.exports = {
  resolveRef, validRefName, distanceFromMain, treeOf, snapshotDir, copySnapshot, describeDir, layoutProblem, commitOf, git, topLevelOf, filesChanged,
};
