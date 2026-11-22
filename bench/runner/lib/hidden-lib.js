// SPDX-License-Identifier: Apache-2.0
'use strict';

// Shared hidden test helpers. A task's hidden dir may hold `.bench-lib.json`, a map from a path inside the hidden dir
// to the name of a helper in bench/scenarios/lib/hidden (for example {"hidden/py_bridge.test.js": "py_bridge.test.js"}).
// The `tests` check copies each helper to its path when it lays the hidden dir over the workspace copy, so no task
// commits its own copy of a helper. The manifest itself never reaches the test run.
// The value "@pristine" instead copies the task's untouched fixture (the check's pristineDir) to that path, so a hidden
// test that compares against the code before the agent's change keeps no hand-synced copy of it (DEBT D-120). Any
// file the agent left at that path is removed first.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MANIFEST = '.bench-lib.json';
const LIB_DIR = path.join(__dirname, '..', '..', 'scenarios', 'lib', 'hidden');
const PRISTINE = '@pristine';

/** [[relative destination, value]] of a hidden dir's manifest, with each destination checked; [] without one. */
function manifestEntries(hiddenDir) {
  const file = hiddenDir ? path.join(hiddenDir, MANIFEST) : null;
  if (!file || !fs.existsSync(file)) return [];
  return Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))).map(([dest, name]) => {
    const norm = path.posix.normalize(dest).replace(/\/$/, '');
    if (path.isAbsolute(dest) || norm.startsWith('..') || norm === '.') throw new Error(`${file}: destination ${dest} leaves the hidden dir`);
    return [norm, name];
  });
}

/** The destinations a hidden dir's manifest fills with the untouched fixture. */
function pristineTargets(hiddenDir) {
  return manifestEntries(hiddenDir).filter(([, name]) => name === PRISTINE).map(([dest]) => dest);
}

/** [[relative destination, absolute helper path]] of a hidden dir; [] without a manifest. Throws on a bad entry. */
function sharedHelpers(hiddenDir, libDir = LIB_DIR) {
  const file = path.join(hiddenDir ?? '', MANIFEST);
  return manifestEntries(hiddenDir).filter(([, name]) => name !== PRISTINE).map(([norm, name]) => {
    if (typeof name !== 'string' || path.basename(name) !== name) throw new Error(`${file}: helper ${name} is not a file name in ${libDir}`);
    const src = path.join(libDir, name);
    if (!fs.existsSync(src)) throw new Error(`${file}: no helper ${name} in ${libDir}`);
    return [norm, src];
  });
}

/**
 * Copies the helpers of `hiddenDir` into `dest` (the hidden dir's copy), and `pristineDir` (the untouched fixture) to
 * each @pristine destination, then removes the copied manifest. Throws when a @pristine entry has no pristineDir.
 */
function addSharedHelpers(hiddenDir, dest, libDir = LIB_DIR, { pristineDir = null } = {}) {
  for (const rel of pristineTargets(hiddenDir)) {
    if (!pristineDir || !fs.existsSync(pristineDir)) throw new Error(`${path.join(hiddenDir, MANIFEST)}: ${rel} needs the untouched fixture, and the check has none`);
    fs.rmSync(path.join(dest, rel), { recursive: true, force: true });
    fs.cpSync(pristineDir, path.join(dest, rel), { recursive: true });
  }
  for (const [rel, src] of sharedHelpers(hiddenDir, libDir)) {
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
    fs.copyFileSync(src, path.join(dest, rel));
  }
  fs.rmSync(path.join(dest, MANIFEST), { force: true });
}

/** Hash of the helper bytes a hidden dir pulls in, so a helper change counts as a task input change; null without any. */
function helpersHash(hiddenDir, libDir = LIB_DIR) {
  const list = sharedHelpers(hiddenDir, libDir);
  if (!list.length) return null;
  const h = crypto.createHash('sha256');
  for (const [rel, src] of list.sort(([a], [b]) => a.localeCompare(b))) h.update(`${rel}\0`).update(fs.readFileSync(src)).update('\0');
  return h.digest('hex');
}

module.exports = { MANIFEST, LIB_DIR, PRISTINE, sharedHelpers, pristineTargets, addSharedHelpers, helpersHash };
