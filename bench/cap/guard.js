// SPDX-License-Identifier: Apache-2.0
'use strict';

// The konductor CLI records every install under $HOME/.konductor/installs. A cap command that builds or installs
// must leave that registry alone, so its hash is compared before and after.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const REGISTRY = path.join('.konductor', 'installs');

// The homes to watch: the process HOME and the account's own home, which differ when a scratch HOME is set.
// BENCH_CAP_INSTALLS_HOMES (a path-delimited list) replaces that default so tests stay hermetic and never read the real home.
function defaultHomes() {
  const out = new Set();
  const override = process.env.BENCH_CAP_INSTALLS_HOMES;
  const candidates = override === undefined ? [process.env.HOME, os.userInfo().homedir] : override.split(path.delimiter);
  for (const h of candidates.filter(Boolean)) {
    try { out.add(fs.realpathSync(h)); } catch { out.add(path.resolve(h)); }
  }
  return [...out];
}

function hashDir(dir, h, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = path.join(dir, e.name);
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) { h.update(`d${r}\0`); hashDir(abs, h, r); }
    else if (e.isSymbolicLink()) h.update(`l${r}\0${fs.readlinkSync(abs)}\0`);
    else if (e.isFile()) h.update(`f${r}\0`).update(fs.readFileSync(abs)).update('\0');
  }
}

/** One hash over every watched registry directory; a missing directory hashes as absent. */
function installsHash(homes = defaultHomes()) {
  const h = crypto.createHash('sha256');
  for (const home of homes) {
    const dir = path.join(home, REGISTRY);
    h.update(`${dir}\0`);
    let st = null;
    try { st = fs.lstatSync(dir); } catch { /* absent */ }
    if (!st) h.update('absent\0');
    else if (st.isDirectory()) hashDir(dir, h);
    else if (st.isSymbolicLink()) h.update(`l\0${fs.readlinkSync(dir)}\0`);
    else h.update('f\0').update(fs.readFileSync(dir)).update('\0');
  }
  return h.digest('hex');
}

class InstallsChanged extends Error {}

/** Runs `fn` (sync or async) and throws if ~/.konductor/installs changed meanwhile, over any error `fn` raised. */
function guardInstalls(fn, { homes = defaultHomes() } = {}) {
  const before = installsHash(homes);
  const check = (err) => {
    if (installsHash(homes) !== before) throw new InstallsChanged(`~/.konductor/installs changed during the command (${homes.join(', ')}); a konductor CLI call wrote to the real install registry`);
    if (err) throw err;
  };
  let result;
  try { result = fn(); } catch (e) { check(e); }
  if (result && typeof result.then === 'function') return result.then((v) => { check(null); return v; }, (e) => { check(e); });
  check(null);
  return result;
}

module.exports = { guardInstalls, installsHash, InstallsChanged, defaultHomes };
