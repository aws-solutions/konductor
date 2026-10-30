// SPDX-License-Identifier: Apache-2.0
'use strict';

// The tree a cap command reads: a git ref exported with `git archive` (the working tree is never read), or a directory in place.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArmSpec, resolveMain } = require('../runner/lib/arms.js');
const armSource = require('../runner/lib/arm-source.js');

const CAP_DIRS = ['skills', 'agents', 'agent-sops', 'context'];

function hasPath(repo, sha, p) {
  return spawnSync('git', ['-C', repo, 'cat-file', '-e', `${sha}:${p}`], { stdio: 'ignore' }).status === 0;
}

// Only the capability directories are exported, so an audit does not unpack the whole repository.
function exportCapDirs(repo, sha, dir) {
  const paths = CAP_DIRS.filter((p) => hasPath(repo, sha, p));
  fs.mkdirSync(dir, { recursive: true });
  if (!paths.length) return;
  const archive = spawnSync('git', ['-C', repo, 'archive', sha, ...paths], { maxBuffer: 1 << 30 });
  if (archive.status !== 0) throw new Error(`git archive ${sha} failed: ${archive.stderr}`);
  const tar = spawnSync('tar', ['-x', '-C', dir], { input: archive.stdout });
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
}

function gitBase(repo, ref, label) {
  const { sha } = armSource.resolveRef(repo, ref);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-base-'));
  try { exportCapDirs(repo, sha, dir); } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
  return { spec: label, kind: 'git', ref, commitSha: sha, tree: armSource.treeOf(repo, sha), dir, label: `${ref}@${sha.slice(0, 7)}`, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function dirBase(p, label) {
  const dir = path.resolve(p);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`directory not found: ${dir}`);
  return { spec: label, kind: 'dir', ref: `dir:${dir}`, commitSha: null, tree: null, dir, label: `dir:${path.basename(dir)}`, cleanup: () => {} };
}

/**
 * Resolves a --base value: a release tag, branch, remote-tracking ref or commit (resolved locally, never fetched),
 * `main` (the local origin/main), `dir:<path>`, or an arm spec `name=<ref>` / `name=dir:<path>`.
 */
function resolveBase(spec, repo) {
  if (typeof spec !== 'string' || !spec) throw new Error('--base needs a ref or dir:<path>');
  if (spec.startsWith('dir:')) return dirBase(spec.slice(4), spec);
  if (spec.includes('=')) {
    const parsed = parseArmSpec(spec);
    if (parsed.kind === 'dir') return dirBase(parsed.path, spec);
    return gitBase(repo, parsed.ref, spec);
  }
  if (spec === 'main') return gitBase(repo, resolveMain(repo).ref, spec);
  if (spec === 'vanilla') throw new Error('--base vanilla has no capabilities to read');
  return gitBase(repo, spec, spec);
}

module.exports = { resolveBase, exportCapDirs, CAP_DIRS };
