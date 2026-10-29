// SPDX-License-Identifier: Apache-2.0
'use strict';

// OS isolation for the agent and its check commands.
//
// With `unshare --user --map-root-user --mount --pid --fork --kill-child --mount-proc`
// the command runs in its own mount and pid namespace. The real home, /tmp, /var/tmp
// and /dev/shm are remounted read-only, the run's scratch root is writable again,
// credential paths are hidden, container-runtime sockets and other user-writable trees
// are masked, and the capability sets are emptied before the agent starts, so it
// cannot remount anything. --kill-child ends every process in the namespace (including
// setsid grandchildren) when the first one exits. The network is not isolated, except with
// `offline`, which adds a network namespace (loopback only) for check commands that must run without one.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const UNSHARE_FLAGS = ['--user', '--map-root-user', '--mount', '--pid', '--fork', '--kill-child', '--mount-proc'];
// Names relative to the real home; directories get an empty tmpfs, files /dev/null.
// --hide and BENCH_HIDE_EXTRA add more (for example site-specific cookie or token paths).
const HIDE_IN_HOME = [
  '.aws', '.ssh', '.gnupg', '.kiro', '.konductor', '.claude', '.claude.json', '.config', '.docker',
  '.git-credentials', '.netrc', '.npmrc', '.pypirc',
  '.bash_history', '.zsh_history', '.zhistory', '.sh_history', '.python_history', '.node_repl_history',
  '.psql_history', '.mysql_history', '.lesshst', '.viminfo',
];
const MASK_IN_HOME = ['.local/share/kiro-cli/data.sqlite3', '.local/share/kiro-cli/data.sqlite3-wal', '.local/share/kiro-cli/data.sqlite3-shm'];
const RO_SYSTEM_DIRS = ['/tmp', '/var/tmp', '/dev/shm'];
const SOCKET_DIRS = ['/run', '/var/run'];
const SOCKET_RE = /docker|containerd|podman|crio|buildkit/i;
const TREE_BASES = ['/', '/var', '/opt', '/srv', '/mnt', '/media'];
const SYSTEM_TOPS = new Set(['bin', 'boot', 'dev', 'etc', 'home', 'lib', 'lib32', 'lib64', 'lost+found', 'proc', 'root', 'run', 'sbin', 'snap', 'sys', 'tmp', 'usr', 'var', 'opt', 'srv', 'mnt', 'media']);

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const uniq = (xs) => [...new Set(xs)];

function realDirs(paths) {
  const out = new Set();
  for (const p of paths) {
    try {
      if (fs.statSync(p).isDirectory()) out.add(fs.realpathSync(p));
    } catch { /* absent */ }
  }
  return [...out];
}

function realHomes(home = os.homedir()) {
  const user = os.userInfo().username;
  return realDirs([home, os.userInfo().homedir, `/home/${user}`]);
}

const statOrNull = (p) => { try { return fs.statSync(p); } catch { return null; } };
const realOrNull = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch { return []; }
}

function writable(p) {
  try { fs.accessSync(p, fs.constants.W_OK); return true; } catch { return false; }
}

// Directories the current user can write outside the home and /tmp (for example a shared
// work tree or an audit spool), found one or two levels below the usual roots.
function writableTrees() {
  const out = new Set();
  for (const base of TREE_BASES) {
    for (const d of listDirs(base)) {
      if (base === '/' && SYSTEM_TOPS.has(path.basename(d))) continue;
      if (writable(d)) out.add(d);
      else if (base === '/') for (const c of listDirs(d)) if (writable(c)) out.add(c);
    }
  }
  return [...out];
}

// Container runtime sockets (docker.sock and friends) are root-equivalent and ignore read-only mounts.
function runtimeSockets(dirs = SOCKET_DIRS) {
  const out = [];
  for (const d of dirs) {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) if (e.isSocket() && SOCKET_RE.test(e.name)) out.push(path.join(d, e.name));
  }
  return uniq(out.map((p) => realOrNull(p) || p));
}

function sshAgentDirs(tmp = os.tmpdir()) {
  return listDirs(tmp).filter((d) => path.basename(d).startsWith('ssh-'));
}

function runtimeDir() {
  const dir = `/run/user/${os.userInfo().uid}`;
  return statOrNull(dir)?.isDirectory() ? dir : null;
}

function findAnswerKeys(root, name = '.bench-answer-key.md', depth = 6) {
  const out = [];
  const walk = (dir, d) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name === name) out.push(p);
      else if (e.isDirectory() && d > 0 && e.name !== 'node_modules' && e.name !== '.git') walk(p, d - 1);
    }
  };
  walk(root, depth);
  return out;
}

// Directory: empty tmpfs. File or socket: /dev/null. Absent paths are skipped.
function maskLine(p) {
  const st = statOrNull(p);
  if (!st) return null;
  return st.isDirectory() ? `mount -t tmpfs tmpfs ${shq(p)}` : `mount --bind /dev/null ${shq(p)}`;
}

// The `ip` binary lives in /usr/sbin, which is not always on a user's PATH.
function findIp() {
  for (const dir of [...(process.env.PATH || '').split(path.delimiter), '/usr/sbin', '/sbin', '/usr/bin']) {
    const p = path.join(dir, 'ip');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

function buildScript({ scratchRoot, homes, systemDirs, hide, masks, readOnlyTrees, offline = false }) {
  const lines = ['set -e', 'ro() { mount --rbind "$1" "$1" && mount -o remount,ro,bind "$1"; }'];
  for (const d of [...homes, ...systemDirs, ...readOnlyTrees]) lines.push(`ro ${shq(d)}`);
  lines.push(`mount --bind ${shq(scratchRoot)} ${shq(scratchRoot)} && mount -o remount,rw,bind ${shq(scratchRoot)}`);
  const targets = [];
  for (const h of homes) {
    for (const d of [...HIDE_IN_HOME, ...hide]) targets.push(path.isAbsolute(d) ? d : path.join(h, d));
    for (const f of MASK_IN_HOME) targets.push(path.join(h, f));
  }
  targets.push(...masks);
  for (const t of uniq(targets)) {
    const line = maskLine(t);
    if (line) lines.push(line);
  }
  // Loopback must come up while the namespace still holds its capabilities; a missing `ip` leaves it down.
  if (offline) lines.push(`${shq(findIp() || 'ip')} link set lo up >/dev/null 2>&1 || true`);
  // Empty capability sets: the agent cannot undo any mount above. Fails closed when setpriv is missing.
  lines.push('exec setpriv --no-new-privs --bounding-set -all --inh-caps -all -- "$@"');
  return lines.join('\n');
}

/**
 * Returns {mode, wrap(file, args)}. Mode 'none' passes commands through unchanged.
 * `scratchRoot` is the only path under /tmp (or anywhere) that stays writable.
 * `mask` lists extra paths to hide (bench fixtures, reference solutions, the output
 * directory); every answer key under `mask` or `keyRoots` is blanked as well. `keep` lists
 * paths that must stay visible (the agent binary). `offline` also gives the command an empty network namespace.
 */
function makeIsolation({ mode, scratchRoot, home, hide = [], mask = [], keyRoots = [], keep = [], socketDirs, sshTmp, offline = false }) {
  if (mode !== 'unshare') return { mode: 'none', wrap: (file, args) => ({ file, args }) };
  const scratch = fs.realpathSync(scratchRoot);
  const homes = realHomes(home);
  const systemDirs = realDirs([...RO_SYSTEM_DIRS, os.tmpdir()]);
  const pathDirs = (process.env.PATH || '').split(path.delimiter).map(realOrNull).filter(Boolean);
  const keepPaths = [...pathDirs, process.execPath, ...keep.map((k) => realOrNull(k)).filter(Boolean)];

  // A user-writable tree is hidden unless it holds the scratch root, a home or a tool the agent needs;
  // a tree holding a tool is made read-only instead.
  const hidden = [];
  const readOnlyTrees = [];
  for (const t of writableTrees()) {
    const r = realOrNull(t);
    if (!r || systemDirs.includes(r) || inside(scratch, r) || homes.some((h) => inside(h, r) || inside(r, h))) continue;
    (keepPaths.some((k) => inside(k, r)) ? readOnlyTrees : hidden).push(r);
  }

  const tmpMasks = [...runtimeSockets(socketDirs), ...sshAgentDirs(sshTmp), runtimeDir(), ...hidden].filter(Boolean);
  const dirMasks = mask.map((m) => realOrNull(m)).filter((m) => m && !inside(scratch, m) && !inside(m, scratch));
  const keys = uniq([...mask, ...keyRoots].flatMap((m) => findAnswerKeys(m))).filter((k) => !dirMasks.some((d) => inside(k, d)));
  const masks = uniq([...tmpMasks, ...dirMasks, ...keys]).filter((m) => !inside(scratch, m));
  const script = buildScript({ scratchRoot: scratch, homes, systemDirs, hide, masks, readOnlyTrees, offline });
  return {
    mode,
    script,
    wrap: (file, args) => ({ file: 'unshare', args: [...UNSHARE_FLAGS, ...(offline ? ['--net'] : []), 'sh', '-c', script, 'sh', file, ...args] }),
  };
}

// Proves the namespace works here: scratch is writable, the real home and /tmp are not, and
// no capabilities remain (checked with access(2), so a broken namespace never writes to the real home).
function probeUnshare(home = os.homedir()) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
  try {
    const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, home });
    const homeDir = realHomes(home)[0];
    const test = [
      `touch ${shq(path.join(scratch, 'ok'))} || exit 2`,
      `if [ -w ${shq(homeDir)} ]; then exit 3; fi`,
      `if [ -w ${shq(fs.realpathSync(os.tmpdir()))} ]; then exit 4; fi`,
      `grep -q '^CapEff:[[:space:]]*0000000000000000$' /proc/self/status || exit 5`,
      'exit 0',
    ].join('; ');
    const w = iso.wrap('sh', ['-c', test]);
    const r = spawnSync(w.file, w.args, { encoding: 'utf8', timeout: 20000 });
    const reasons = { 2: 'scratch dir not writable', 3: 'real home still writable', 4: 'tmp still writable', 5: 'capabilities not dropped' };
    if (r.status === 0) return { ok: true, reason: null };
    const why = r.error ? r.error.message : (reasons[r.status] || (r.stderr || '').trim().split('\n').pop() || `exit ${r.status}`);
    return { ok: false, reason: why };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Resolves --isolate. `auto` uses the namespace and aborts when the probe fails: an unattended
 * trust-all-tools agent must not silently run uncontained. `none` is the explicit opt-out.
 */
function resolveIsolation(requested, home, probeFn = probeUnshare) {
  if (requested === 'none') return { mode: 'none', reason: 'requested' };
  const probe = probeFn(home);
  if (probe.ok) return { mode: 'unshare', reason: requested === 'unshare' ? 'requested' : 'auto: probe passed' };
  if (requested === 'unshare') throw new Error(`--isolate unshare is not usable here: ${probe.reason}`);
  throw new Error(`mount namespace isolation is unavailable (${probe.reason}). Fix that, or pass --isolate none to run without containment.`);
}

module.exports = { makeIsolation, probeUnshare, resolveIsolation, realHomes, writableTrees, runtimeSockets, findAnswerKeys, UNSHARE_FLAGS, HIDE_IN_HOME };
