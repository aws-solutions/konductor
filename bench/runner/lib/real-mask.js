// SPDX-License-Identifier: Apache-2.0
'use strict';

// Where the fix of a real-repository task could be read on the host, and what the namespace hides.
//
// The selected projects are installed on the host in a newer release that already contains the fix, and
// package caches hold more copies. The task's own tree is the only place the code under test may come from,
// so every host copy that can be hidden without breaking Python or Node themselves is masked for these
// tasks. A copy that sits inside another package (pip vendors its own rich) cannot be masked without
// breaking that package; findVendored lists those so the validator can drop a task whose fix they hold.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Caches that keep unpacked or wheel copies of many package versions. Hidden whole: the agent has no need
// of a package cache, and a cache holds hundreds of copies of the same project.
const CACHE_DIRS = ['.cache/uv', '.cache/pip', '.npm/_cacache'];

const exists = (p) => { try { fs.statSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const subdirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)); } catch { return []; } };

// site-packages of every Python the user has installed, including the ones the PATH does not select.
function sitePackagesDirs(home = os.homedir()) {
  const out = new Set();
  const add = (p) => { if (isDir(p)) out.add(fs.realpathSync(p)); };
  const installs = path.join(home, '.local/share/mise/installs/python');
  for (const v of subdirs(installs)) for (const lib of subdirs(path.join(v, 'lib'))) add(path.join(lib, 'site-packages'));
  for (const lib of subdirs(path.join(home, '.local/lib'))) add(path.join(lib, 'site-packages'));
  for (const base of ['/usr/lib', '/usr/lib64', '/usr/local/lib']) for (const lib of subdirs(base)) add(path.join(lib, 'site-packages'));
  return [...out];
}

// Global node_modules of every installed Node (the project's package name sits directly below).
function nodeModulesDirs(home = os.homedir()) {
  const out = new Set();
  const installs = path.join(home, '.local/share/mise/installs/node');
  for (const v of subdirs(installs)) { const d = path.join(v, 'lib/node_modules'); if (isDir(d)) out.add(fs.realpathSync(d)); }
  for (const d of ['/usr/lib/node_modules', '/usr/local/lib/node_modules']) if (isDir(d)) out.add(d);
  return [...out];
}

const norm = (n) => n.toLowerCase().replace(/[-_.]+/g, '_');

// The package directories (or single-file modules) of the project in a site-packages. Its dist-info stays visible
// on purpose: it holds the version and the file list but no source, and an empty dist-info makes
// importlib.metadata.version() raise, which turns a test that only fails today into a collection error that
// stops the whole run.
function pythonCopies(sitePackages, names) {
  const want = new Set(names.map(norm));
  const out = [];
  for (const e of safeReaddir(sitePackages)) {
    if (/\.(dist-info|egg-info)$/.test(e.name)) continue;
    if (want.has(norm(e.name.replace(/\.py$/, '')))) out.push(path.join(sitePackages, e.name));
  }
  return out;
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

// Copies of a project that live inside another package, for example pip/_vendor/rich. Not maskable.
function findVendored(sitePackages, names) {
  const out = [];
  for (const pkg of subdirs(sitePackages)) {
    for (const vendor of ['_vendor', 'vendor', '_vendored']) {
      const dir = path.join(pkg, vendor);
      for (const n of names) if (isDir(path.join(dir, n))) out.push(path.join(dir, n));
    }
  }
  return out;
}

/**
 * Paths the namespace must hide for the given manifest entries. Only paths that exist are returned.
 * entries: manifest entries (repo.packageNames, hostCopies, language). cacheDir: the real-repository cache.
 * extra: more paths (the real track's own directories).
 */
function realMasks(entries, { home = os.homedir(), cacheDir = null, extra = [] } = {}) {
  const py = entries.filter((e) => e.language === 'python');
  const js = entries.filter((e) => e.language === 'javascript');
  const paths = [];
  const notes = [];
  if (py.length) {
    const names = [...new Set(py.flatMap((e) => [...e.repo.packageNames, ...(e.test.probeModules || [])]))];
    for (const sp of sitePackagesDirs(home)) paths.push(...pythonCopies(sp, names));
  }
  if (js.length) {
    const names = [...new Set(js.flatMap((e) => e.repo.packageNames))];
    for (const nm of nodeModulesDirs(home)) for (const n of names) paths.push(path.join(nm, n));
  }
  for (const c of CACHE_DIRS) paths.push(path.join(home, c));
  if (cacheDir) paths.push(cacheDir);
  paths.push(...extra);
  const found = [...new Set(paths.map((p) => { try { return fs.realpathSync(p); } catch { return null; } }).filter(Boolean))].sort();
  return { paths: found, notes };
}

module.exports = { realMasks, sitePackagesDirs, nodeModulesDirs, pythonCopies, findVendored, CACHE_DIRS, norm, exists };
