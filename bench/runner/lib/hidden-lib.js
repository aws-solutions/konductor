// SPDX-License-Identifier: Apache-2.0
'use strict';

// Shared hidden test helpers. A task's hidden dir may hold `.bench-lib.json`, a map from a path inside the hidden dir
// to the name of a helper in bench/scenarios/lib/hidden (for example {"hidden/py_bridge.test.js": "py_bridge.test.js"}).
// The `tests` check copies each helper to its path when it lays the hidden dir over the workspace copy, so no task
// commits its own copy of a helper. The manifest itself never reaches the test run.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MANIFEST = '.bench-lib.json';
const LIB_DIR = path.join(__dirname, '..', '..', 'scenarios', 'lib', 'hidden');

/** [[relative destination, absolute helper path]] of a hidden dir; [] without a manifest. Throws on a bad entry. */
function sharedHelpers(hiddenDir, libDir = LIB_DIR) {
  const file = hiddenDir ? path.join(hiddenDir, MANIFEST) : null;
  if (!file || !fs.existsSync(file)) return [];
  const map = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Object.entries(map).map(([dest, name]) => {
    const norm = path.posix.normalize(dest);
    if (path.isAbsolute(dest) || norm.startsWith('..') || norm === '.') throw new Error(`${file}: destination ${dest} leaves the hidden dir`);
    if (typeof name !== 'string' || path.basename(name) !== name) throw new Error(`${file}: helper ${name} is not a file name in ${libDir}`);
    const src = path.join(libDir, name);
    if (!fs.existsSync(src)) throw new Error(`${file}: no helper ${name} in ${libDir}`);
    return [norm, src];
  });
}

/** Copies the helpers of `hiddenDir` into `dest` (the hidden dir's copy) and removes the copied manifest. */
function addSharedHelpers(hiddenDir, dest, libDir = LIB_DIR) {
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

module.exports = { MANIFEST, LIB_DIR, sharedHelpers, addSharedHelpers, helpersHash };
