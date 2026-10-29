// SPDX-License-Identifier: Apache-2.0
'use strict';

// Runner side of the real-repository track. A task names a manifest entry (`real`); the base tree of that
// entry is written from the local cache into each run's working directory. Nothing here uses the network:
// bench/real/fetch.js is the only step that does, and it runs before the benchmark.

const fs = require('node:fs');
const path = require('node:path');
const reallib = require('../../real/lib.js');
const { materialize } = require('../../real/materialize.js');
const { realMasks } = require('./real-mask.js');

const manifests = new Map();

function loadEntries(benchDir) {
  const file = path.join(benchDir, 'real', 'manifest.json');
  if (!manifests.has(file)) {
    const m = fs.existsSync(file) ? reallib.loadManifest(file) : { tasks: [] };
    manifests.set(file, new Map(m.tasks.map((t) => [t.id, t])));
  }
  return manifests.get(file);
}

function entryOf(benchDir, id) {
  const e = loadEntries(benchDir).get(id);
  if (!e) throw new Error(`no manifest entry "${id}" in ${path.join(benchDir, 'real', 'manifest.json')}`);
  return e;
}

const missing = (entry, cache) => new Error(
  `real task ${entry.id}: the upstream checkout is not in ${cache}. Run \`node bench/real/fetch.js\` first; it is the only step that uses the network.`,
);

// Fails fast when the cache has nothing for this entry.
function requireCached(entry, cache) {
  const { gitDir } = reallib.entryPaths(cache, entry.id);
  if (!fs.existsSync(gitDir)) throw missing(entry, cache);
  const r = reallib.git(gitDir, ['cat-file', '-e', `${entry.baseSha}^{commit}`], { allowFail: true });
  if (r.status !== 0) throw missing(entry, cache);
}

/**
 * Writes the base tree of the task's manifest entry into `dest` (absent or empty): the files only, with no
 * .git directory and no history. The tree hash must equal the manifest pin.
 * Returns {contentSha256, fileCount}.
 */
function materializeInto(task, dest, { cache } = {}) {
  const dir = reallib.resolveCache(cache);
  requireCached(task.realEntry, dir);
  const { contentSha256, fileCount } = materialize(task.realEntry, dest, { cache: dir });
  return { contentSha256, fileCount };
}

// The pristine base tree used by fixture_unchanged and by the judge. Built once per process, hash-checked.
const pristine = new Map();
function pristineDir(task, { cache } = {}) {
  const dir = reallib.resolveCache(cache);
  const { base } = reallib.entryPaths(dir, task.realEntry.id);
  const key = `${dir}\0${task.realEntry.id}`;
  if (pristine.get(key) === base && fs.existsSync(base)) return base;
  requireCached(task.realEntry, dir);
  fs.rmSync(base, { recursive: true, force: true });
  materialize(task.realEntry, base, { cache: dir });
  pristine.set(key, base);
  return base;
}

// Gives a task loaded from a task file its manifest entry and a fixtureDir that is built on first use.
function attach(task, benchDir) {
  const entry = entryOf(benchDir, task.real);
  Object.defineProperty(task, 'realEntry', { value: entry, enumerable: false });
  Object.defineProperty(task, 'realP2pDir', { value: path.join(benchDir, 'real', 'p2p'), enumerable: false });
  Object.defineProperty(task, 'fixtureDir', { get: () => pristineDir(task), enumerable: false, configurable: true });
}

// Everything the `tests` check needs besides the workspace: the command, FAIL_TO_PASS and PASS_TO_PASS.
function testSpec(task) {
  return {
    spec: task.realEntry.test,
    failToPass: task.realEntry.failToPass,
    passToPass: reallib.loadP2p(task.realEntry, task.realP2pDir),
  };
}

/**
 * Checks that every selected real task can run before anything is built: the cache holds the commit and the
 * materialized tree hashes to the manifest pin. Returns the records written to run-config.json.
 */
function preflight(tasks, { cache } = {}) {
  const dir = reallib.resolveCache(cache);
  const out = {};
  for (const t of tasks.filter((x) => x.real)) {
    requireCached(t.realEntry, dir);
    const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'real-pre-'));
    try {
      const m = materialize(t.realEntry, path.join(tmp, 'tree'), { cache: dir });
      const spec = testSpec(t);
      out[t.real] = {
        repo: t.realEntry.repo.name, baseSha: t.realEntry.baseSha, contentSha256: m.contentSha256, fileCount: m.fileCount,
        failToPass: spec.failToPass.length, passToPass: spec.passToPass.length,
      };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  return out;
}

// Absolute paths the namespace hides from the agent and from the checks of this task: host copies of the
// project that already hold the fix, the package caches and the upstream cache. Bench directories are
// hidden separately through benchMask.
function hidePaths(task, { cache } = {}) {
  return realMasks([task.realEntry], { cacheDir: reallib.resolveCache(cache) }).paths;
}

// The upstream change to everything that is not a test file, read from the local cache.
function fixPatchText(task, { cache } = {}) {
  const dir = reallib.resolveCache(cache);
  requireCached(task.realEntry, dir);
  return reallib.fixPatch(reallib.entryPaths(dir, task.realEntry.id).gitDir, task.realEntry).patch;
}

module.exports = { hidePaths, fixPatchText, attach, entryOf, loadEntries, materializeInto, pristineDir, preflight, requireCached, testSpec };
