// SPDX-License-Identifier: Apache-2.0
'use strict';

// Shared helpers for the real-repository track: manifest access, cache layout, git calls that only
// read the local cache, and the content hash of a materialized tree. Nothing here touches the network;
// fetch.js is the only module that does.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REAL_DIR = __dirname;
const BENCH_DIR = path.resolve(REAL_DIR, '..');
const REPO_ROOT = path.resolve(BENCH_DIR, '..');
const MANIFEST_FILE = path.join(REAL_DIR, 'manifest.json');
const DEFAULT_CACHE = '/tmp/konductor-bench/realrepos';
const ANSWER_KEY = '.bench-answer-key.md';
const SHA_RE = /^[0-9a-f]{40}$/;

const realOrSelf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

// The cache holds upstream objects, including the fix. It must live outside the repository.
function resolveCache(arg) {
  const raw = arg || process.env.BENCH_REAL_CACHE || DEFAULT_CACHE;
  let dir = path.resolve(raw);
  let probe = dir;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const resolved = path.join(realOrSelf(probe), path.relative(probe, dir));
  const root = realOrSelf(REPO_ROOT);
  if (resolved === root || resolved.startsWith(root + path.sep)) {
    throw new Error(`cache directory ${dir} is inside the repository; choose a path outside ${root}`);
  }
  return dir;
}

function loadManifest(file = MANIFEST_FILE) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(m.tasks)) throw new Error(`${file}: "tasks" must be an array`);
  return m;
}

function findEntry(manifest, id) {
  const e = manifest.tasks.find((t) => t.id === id);
  if (!e) throw new Error(`no manifest entry "${id}"`);
  return e;
}

const entryPaths = (cache, id) => ({ root: path.join(cache, id), gitDir: path.join(cache, id, 'repo.git'), base: path.join(cache, id, 'base') });

// Local-only git call. Network access is never needed here, so a missing object is an error, not a fetch.
function git(gitDir, args, opts = {}) {
  const r = spawnSync('git', ['--git-dir', gitDir, ...args], {
    encoding: opts.binary ? null : 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', ...(opts.env || {}) },
    input: opts.input,
  });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`git ${args.join(' ')} failed (exit ${r.status}): ${String(r.stderr || '').trim().split('\n').slice(-5).join(' | ')}`);
  }
  return opts.allowFail ? r : r.stdout;
}

function listFiles(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (r === ANSWER_KEY) continue;
    if (e.isDirectory()) out.push(...listFiles(dir, r));
    else out.push(r);
  }
  return out.sort();
}

// sha256 over `path NUL kind NUL digest LF` for each file in path order; kind is f, x or l (symlink).
function hashTree(dir) {
  const files = listFiles(dir);
  const h = crypto.createHash('sha256');
  for (const f of files) {
    const full = path.join(dir, f);
    const st = fs.lstatSync(full);
    const kind = st.isSymbolicLink() ? 'l' : (st.mode & 0o111 ? 'x' : 'f');
    const body = kind === 'l' ? Buffer.from(fs.readlinkSync(full)) : fs.readFileSync(full);
    h.update(f).update('\0').update(kind).update('\0').update(crypto.createHash('sha256').update(body).digest('hex')).update('\n');
  }
  return { sha256: h.digest('hex'), files };
}

// A path in the PR's diff is a test path when it sits in a tests directory or has a test file name.
const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|(^|\/)test_[^/]*$|_test\.(py|js|mjs|cjs|ts)$|\.(test|spec)\.(js|mjs|cjs|ts)$/;
const isTestPath = (p) => TEST_PATH.test(p);

// The PR's net change to everything that is not a test file, as a patch against the base tree.
function fixPatch(gitDir, entry) {
  const names = git(gitDir, ['diff', '--name-only', '-z', entry.baseSha, entry.mergeSha]).split('\0').filter(Boolean);
  const skip = new Set(entry.testFiles);
  const files = names.filter((n) => !skip.has(n));
  if (!files.length) return { patch: '', files };
  return { patch: git(gitDir, ['diff', '--binary', entry.baseSha, entry.mergeSha, '--', ...files]), files };
}

// Wraps a shell command so it runs without any network: a new user and network namespace, loopback up.
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
function netlessWrap(cmd) {
  return { file: 'unshare', args: ['--user', '--map-root-user', '--net', 'sh', '-c', 'ip link set lo up >/dev/null 2>&1; exec sh -c "$1"', 'sh', cmd] };
}

function netlessAvailable() {
  const r = spawnSync('unshare', ['--user', '--map-root-user', '--net', 'true'], { encoding: 'utf8' });
  return r.status === 0;
}

module.exports = {
  REAL_DIR, BENCH_DIR, REPO_ROOT, MANIFEST_FILE, DEFAULT_CACHE, ANSWER_KEY, SHA_RE,
  resolveCache, loadManifest, findEntry, entryPaths, git, listFiles, hashTree, isTestPath, netlessWrap, netlessAvailable, shq, fixPatch,
};
