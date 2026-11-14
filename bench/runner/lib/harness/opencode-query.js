// SPDX-License-Identifier: Apache-2.0
'use strict';

// The post-run usage query runs `opencode db` on the host, outside the sandbox, as the real user. The agent
// could write its scratch HOME for the whole run, so nothing in it may steer that process. The query gets a
// fresh directory made by the runner after the agent exited: a config written by the runner, a copy of the
// session database files, an empty cwd, and an allowlisted environment that points only into that directory.

const fs = require('node:fs');
const path = require('node:path');

const MAX_COPY_BYTES = 512 * 1024 * 1024;
const PASS = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'USER', 'LOGNAME'];
// opencode.db, its -wal and -shm files, and the same names for a non-default release channel.
const DB_FILE = /^opencode(-[\w.]+)?\.db(-wal|-shm)?$/;
const CHUNK = 1024 * 1024;

// Each component of `target` below `home` must be a real directory the runner can see, never a link.
function assertPlainDirs(home, target) {
  let cur = home;
  for (const part of path.relative(home, target).split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    const st = fs.lstatSync(cur);
    if (!st.isDirectory()) throw new Error(`${cur} is not a plain directory`);
  }
}

// Copies one regular file without following a link. Returns the bytes written.
function copyRegular(src, dest, budget) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const from = fs.openSync(src, flags);
  try {
    const st = fs.fstatSync(from);
    if (!st.isFile()) throw new Error(`${src} is not a regular file`);
    if (st.size > budget) throw new Error(`database copy would exceed ${budget} bytes`);
    const to = fs.openSync(dest, 'wx', 0o600);
    try {
      const buf = Buffer.allocUnsafe(Math.min(CHUNK, Math.max(1, st.size)));
      let total = 0;
      for (;;) {
        const n = fs.readSync(from, buf, 0, buf.length, null);
        if (n === 0) break;
        total += n;
        if (total > budget) throw new Error(`database copy would exceed ${budget} bytes`);
        fs.writeSync(to, buf, 0, n);
      }
      return total;
    } finally {
      fs.closeSync(to);
    }
  } finally {
    fs.closeSync(from);
  }
}

// Copies the opencode database files from the scratch data home into `destDataHome`. A link, a non-regular
// file or too many bytes is an error. A missing data directory copies nothing.
function copyData({ home, dataHome, destDataHome, maxBytes = MAX_COPY_BYTES }) {
  const src = path.join(dataHome, 'opencode');
  try {
    assertPlainDirs(home, src);
  } catch (e) {
    if (e.code === 'ENOENT') return 0;
    throw e;
  }
  const dest = path.join(destDataHome, 'opencode');
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  let total = 0;
  for (const name of fs.readdirSync(src).filter((n) => DB_FILE.test(n)).sort()) {
    const st = fs.lstatSync(path.join(src, name));
    if (!st.isFile()) throw new Error(`refusing ${name}: not a regular file`);
    total += copyRegular(path.join(src, name), path.join(dest, name), maxBytes - total);
  }
  return total;
}

/**
 * Builds the clean query directory under `outDir`. `config` is the opencode config the harness installs;
 * `flags` are fixed variables that make opencode run offline. Returns `{ dir, cwd, env, cleanup }`.
 */
function prepareQueryDir({ outDir, home, dataHome, config, flags = {}, baseEnv = process.env, maxBytes = MAX_COPY_BYTES }) {
  const dir = fs.mkdtempSync(path.join(outDir, 'post-'));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  try {
    const sub = (...p) => path.join(dir, ...p);
    for (const d of ['xdg-config/opencode', 'xdg-cache', 'xdg-state', 'tmp', 'cwd']) fs.mkdirSync(sub(d), { recursive: true, mode: 0o700 });
    fs.writeFileSync(sub('xdg-config', 'opencode', 'opencode.json'), JSON.stringify(config, null, 2) + '\n');
    copyData({ home, dataHome, destDataHome: sub('xdg-data'), maxBytes });
    fs.mkdirSync(sub('xdg-data'), { recursive: true, mode: 0o700 });
    const env = {};
    for (const k of PASS) if (baseEnv[k] !== undefined) env[k] = baseEnv[k];
    Object.assign(env, flags, {
      HOME: dir,
      TMPDIR: sub('tmp'),
      TERM: 'dumb',
      XDG_CONFIG_HOME: sub('xdg-config'),
      XDG_DATA_HOME: sub('xdg-data'),
      XDG_CACHE_HOME: sub('xdg-cache'),
      XDG_STATE_HOME: sub('xdg-state'),
    });
    return { dir, cwd: sub('cwd'), env, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

module.exports = { prepareQueryDir, copyData, MAX_COPY_BYTES, PASS, DB_FILE };
