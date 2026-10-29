#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Works out the test lists of a manifest task from the local cache (no network):
//   - hidden overlay: the PR's test files exactly as they are at the merge commit,
//   - FAIL_TO_PASS: tests that fail (or are absent) on base + overlay and pass on the merge commit,
//   - PASS_TO_PASS: tests that pass on both.
// Tests listed in the entry's "excluded" array (with a reason) are taken out of FAIL_TO_PASS; they stay
// recorded. With --write the lists, the content hash and the vendored test files are saved.
//
//   node bench/real/discover.js --ids a,b [--cache DIR] [--write]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lib = require('./lib.js');
const { exportTree, materialize } = require('./materialize.js');
const { runRealTests } = require('../runner/lib/realtests.js');
const { buildCheckEnv } = require('../runner/lib/env.js');

const HIDDEN_DIR = path.join(lib.BENCH_DIR, 'tasks', 'hidden');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function checkEnv() {
  const home = tmp('real-home-');
  const { env } = buildCheckEnv(process.env, { home, tmpdir: path.join(home, 'tmp'), konductor: false });
  fs.mkdirSync(env.TMPDIR, { recursive: true });
  return { env, home };
}

// Writes the PR's test files, byte for byte from the merge commit, into dir.
function exportTestFiles(gitDir, entry, dir) {
  for (const f of entry.testFiles) {
    const blob = lib.git(gitDir, ['show', `${entry.mergeSha}:${f}`], { binary: true });
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), blob);
  }
}

function discover(entry, { cache, log = () => {} }) {
  const { gitDir } = lib.entryPaths(lib.resolveCache(cache), entry.id);
  const work = tmp('real-disc-');
  const { env, home } = checkEnv();
  const run = (root, overlayDir) => runRealTests(root, entry.test, { overlayDir, env, wrapCmd: lib.netlessWrap, scratchDir: path.join(work, 'scratch') });
  try {
    const base = path.join(work, 'base');
    const m = materialize(entry, base, { cache });
    const overlay = path.join(work, 'overlay');
    exportTestFiles(gitDir, entry, overlay);
    const merged = path.join(work, 'merged');
    exportTree(gitDir, entry.mergeSha, merged);

    log(`${entry.id}: running base + hidden tests`);
    const atBase = run(base, overlay);
    log(`${entry.id}: ${atBase.results.size} results in ${atBase.seconds.toFixed(1)} s (exit ${atBase.exitCode})`);
    log(`${entry.id}: running merge commit`);
    const atFix = run(merged, null);
    log(`${entry.id}: ${atFix.results.size} results in ${atFix.seconds.toFixed(1)} s (exit ${atFix.exitCode})`);

    const excludedIds = new Set((entry.excluded || []).map((e) => e.id));
    const f2pAll = [...atFix.results].filter(([id, s]) => s === 'pass' && atBase.results.get(id) !== 'pass').map(([id]) => id).sort();
    const p2p = [...atFix.results].filter(([id, s]) => s === 'pass' && atBase.results.get(id) === 'pass').map(([id]) => id).sort();
    const failToPass = f2pAll.filter((id) => !excludedIds.has(id));
    const regressed = [...atBase.results].filter(([id, s]) => s === 'pass' && atFix.results.get(id) !== 'pass').map(([id]) => id);
    return { m, overlay, work, f2pAll, failToPass, passToPass: p2p, regressed, atBase, atFix, tests: atFix.results.size };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function writeVendored(entry, found, gitDir) {
  const dir = path.join(HIDDEN_DIR, entry.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'overlay'), { recursive: true });
  fs.cpSync(found.overlay, path.join(dir, 'overlay'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'LICENSE'), lib.git(gitDir, ['show', `${entry.baseSha}:${entry.repo.licenseFile}`]));
  fs.writeFileSync(path.join(dir, 'NOTICE'), [
    `The files under overlay/ are test files of ${entry.repo.name} (${entry.repo.url}), copied unchanged`,
    `from the merge commit ${entry.mergeSha} of pull request #${entry.pr.number} (${entry.pr.url}).`,
    `They serve as hidden acceptance tests for one benchmark task.`,
    `Upstream license: ${entry.repo.license}; the license text is in the file LICENSE next to this one.`,
    '',
  ].join('\n'));
}

function main(argv) {
  const args = { write: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write') args.write = true;
    else if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
  }
  const manifestFile = lib.MANIFEST_FILE;
  const manifest = lib.loadManifest(manifestFile);
  const ids = args.ids ? args.ids.split(',') : manifest.tasks.map((t) => t.id);
  for (const id of ids) {
    const entry = lib.findEntry(manifest, id);
    let found;
    try {
      found = discover(entry, { cache: args.cache, log: (m) => console.error(m) });
    } catch (e) {
      console.error(`${id}: FAILED: ${e.message}`);
      continue;
    }
    console.log(`${id}: tests ${found.tests}, FAIL_TO_PASS ${found.failToPass.length} (before exclusions ${found.f2pAll.length}), PASS_TO_PASS ${found.passToPass.length}, passed at base but not after the fix: ${found.regressed.length}`);
    for (const t of found.f2pAll) console.log(`   F2P${(entry.excluded || []).some((e) => e.id === t) ? ' (excluded)' : ''}: ${t}`);
    if (args.write) {
      entry.failToPass = found.failToPass;
      entry.passToPass = lib.writeP2p(entry.id, found.passToPass);
      entry.contentSha256 = found.m.contentSha256;
      entry.fileCount = found.m.fileCount;
      writeVendored(entry, found, lib.entryPaths(lib.resolveCache(args.cache), entry.id).gitDir);
    }
    fs.rmSync(found.work, { recursive: true, force: true });
  }
  if (args.write) fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}

module.exports = { discover, exportTestFiles };
