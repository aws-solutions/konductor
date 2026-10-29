#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The only code in the real-repository track that uses the network. For each manifest task it fetches
// the two pinned commits (base and merge) of the public upstream repository over https, read-only, into a
// bare repository under the cache directory. Nothing is written into the konductor repository.
//
//   node bench/real/fetch.js [--cache DIR] [--ids id,id]
//
// Default cache: /tmp/konductor-bench/realrepos (or $BENCH_REAL_CACHE). Safe to repeat: a commit that is
// already present with the pinned tree is not fetched again. Every commit is checked against the pinned
// tree id in the manifest, so a moved or rewritten upstream is detected.

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const lib = require('./lib.js');

const HTTPS_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/;

function has(gitDir, sha) {
  return lib.git(gitDir, ['cat-file', '-e', `${sha}^{commit}`], { allowFail: true }).status === 0;
}

function treeOf(gitDir, sha) {
  return lib.git(gitDir, ['rev-parse', '--verify', `${sha}^{tree}`]).trim();
}

// opts.allowLocal accepts file:// and plain paths (unit tests use a local upstream).
function fetchEntry(entry, { cache, log = () => {}, allowLocal = false } = {}) {
  const url = entry.repo.url;
  if (!allowLocal && !HTTPS_URL.test(url)) throw new Error(`${entry.id}: only https://github.com/<org>/<repo> URLs are fetched (got ${url})`);
  for (const sha of [entry.baseSha, entry.mergeSha]) {
    if (!lib.SHA_RE.test(sha || '')) throw new Error(`${entry.id}: "${sha}" is not a full commit SHA`);
  }
  const { root, gitDir } = lib.entryPaths(lib.resolveCache(cache), entry.id);
  fs.mkdirSync(root, { recursive: true });
  if (!fs.existsSync(gitDir)) {
    const init = spawnSync('git', ['init', '--bare', '-q', gitDir], { encoding: 'utf8' });
    if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
    lib.git(gitDir, ['config', 'remote.origin.url', url]);
    lib.git(gitDir, ['config', 'gc.auto', '0']);
  }
  const pins = [[entry.baseSha, entry.baseTreeSha, 'base'], [entry.mergeSha, entry.mergeTreeSha, 'merge']];
  const status = [];
  for (const [sha, pinnedTree, label] of pins) {
    if (has(gitDir, sha) && (!pinnedTree || treeOf(gitDir, sha) === pinnedTree)) { status.push(`${label} cached`); continue; }
    log(`${entry.id}: fetching ${label} ${sha.slice(0, 12)} from ${url}`);
    const r = spawnSync('git', ['--git-dir', gitDir, 'fetch', '--no-tags', '--depth', '1', 'origin', sha], {
      encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    if (r.status !== 0) throw new Error(`${entry.id}: git fetch of ${sha} failed: ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
    lib.git(gitDir, ['update-ref', `refs/pinned/${label}`, sha]);
    status.push(`${label} fetched`);
  }
  for (const [sha, pinnedTree, label] of pins) {
    const tree = treeOf(gitDir, sha);
    if (pinnedTree && tree !== pinnedTree) throw new Error(`${entry.id}: ${label} commit ${sha} has tree ${tree}, manifest pins ${pinnedTree}`);
    const actual = lib.git(gitDir, ['rev-parse', '--verify', `${sha}^{commit}`]).trim();
    if (actual !== sha) throw new Error(`${entry.id}: ${label} resolved to ${actual}, expected ${sha}`);
  }
  return { id: entry.id, status: status.join(', '), gitDir };
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  const manifest = lib.loadManifest();
  const ids = args.ids ? args.ids.split(',') : manifest.tasks.map((t) => t.id);
  const cache = lib.resolveCache(args.cache);
  console.error(`cache: ${cache}`);
  let failed = 0;
  for (const id of ids) {
    try {
      const r = fetchEntry(lib.findEntry(manifest, id), { cache, log: (m) => console.error(m) });
      console.log(`${id}: ${r.status}`);
    } catch (e) {
      failed++;
      console.error(`${id}: FAILED: ${e.message}`);
    }
  }
  if (failed) process.exit(1);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}

module.exports = { fetchEntry };
