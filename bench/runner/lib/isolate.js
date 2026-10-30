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
//
// On macOS, where there is no unshare, `sandbox-exec` applies a generated profile with the same
// layout: writes to the real home, /tmp and the user temp dir are denied (except ~/Library, where
// system frameworks keep caches and keychains), the scratch root stays writable, the same
// credential paths and masks are denied for reading too, and GUI launchers cannot run.
// `offline` denies outbound connections except to localhost.

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
// kiro-cli keeps its auth database under ~/.local/share on Linux and ~/Library/Application Support on macOS.
const MASK_IN_HOME = ['.local/share/kiro-cli', 'Library/Application Support/kiro-cli']
  .flatMap((d) => ['data.sqlite3', 'data.sqlite3-wal', 'data.sqlite3-shm'].map((f) => `${d}/${f}`));
const SANDBOX_BIN = 'sandbox-exec';
const GUI_LAUNCHERS = ['/usr/bin/open', '/usr/bin/osascript', '/usr/bin/xdg-open', '/usr/local/bin/xdg-open', '/opt/homebrew/bin/xdg-open'];
// macOS also reaches every path under /Users through the data volume.
const DATA_VOLUME = '/System/Volumes/Data';
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

function hideTargets(homes, hide, masks) {
  const targets = [];
  for (const h of homes) {
    for (const d of [...HIDE_IN_HOME, ...hide]) targets.push(path.isAbsolute(d) ? d : path.join(h, d));
    for (const f of MASK_IN_HOME) targets.push(path.join(h, f));
  }
  return uniq([...targets, ...masks]);
}

const sbq = (s) => `"${String(s).replace(/[\\"]/g, '\\$&')}"`;
const withDataVolume = (p) => (p.startsWith('/Users/') ? [p, DATA_VOLUME + p] : [p]);
const subpaths = (ps) => uniq(ps.flatMap(withDataVolume)).map((p) => `  (subpath ${sbq(p)})`);
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The last matching rule wins, so each allow follows the deny it carves out of, and the read denies come last.
function buildProfile({ scratchRoot, homes, systemDirs, hide, masks, readOnlyTrees, offline = false }) {
  const block = (head, ps) => (ps.length ? [`(${head}`, ...subpaths(ps), ')'] : []);
  const hidden = hideTargets(homes, hide, masks);
  // A Time Machine local snapshot exposes another copy of the home's dot-dirs under /private/var/folders.
  const snapshotRe = homes.map((h) => `  (regex #"^(${reEscape(DATA_VOLUME)})?/private/var/folders/.*/persist-com\\.apple\\.TimeMachine[^/]*${reEscape(h)}/\\.(claude|kiro|konductor)(/|$)")`);
  return [
    '(version 1)',
    '(allow default)',
    ...block('deny file-write*', [...homes, ...systemDirs, ...readOnlyTrees]),
    ...block('allow file-write*', homes.map((h) => path.join(h, 'Library'))),
    ...block('allow file-write*', [scratchRoot]),
    ...block('deny file-read* file-write*', hidden),
    ...(homes.length ? ['(deny file-read* file-write*', ...snapshotRe, ')'] : []),
    '(deny process-exec', ...GUI_LAUNCHERS.map((p) => `  (literal ${sbq(p)})`), ')',
    ...(offline ? ['(deny network-outbound (remote ip "*:*"))', '(allow network-outbound (remote ip "localhost:*"))'] : []),
  ].join('\n');
}

function buildScript({ scratchRoot, homes, systemDirs, hide, masks, readOnlyTrees, offline = false }) {
  const lines = ['set -e', 'ro() { mount --rbind "$1" "$1" && mount -o remount,ro,bind "$1"; }'];
  for (const d of [...homes, ...systemDirs, ...readOnlyTrees]) lines.push(`ro ${shq(d)}`);
  lines.push(`mount --bind ${shq(scratchRoot)} ${shq(scratchRoot)} && mount -o remount,rw,bind ${shq(scratchRoot)}`);
  for (const t of hideTargets(homes, hide, masks)) {
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
  if (mode !== 'unshare' && mode !== SANDBOX_BIN) return { mode: 'none', wrap: (file, args) => ({ file, args }) };
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
  if (mode === SANDBOX_BIN) {
    const profile = buildProfile({ scratchRoot: scratch, homes, systemDirs, hide, masks, readOnlyTrees, offline });
    return { mode, profile, wrap: (file, args) => ({ file: SANDBOX_BIN, args: ['-p', profile, file, ...args] }) };
  }
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

// Same proof under the sandbox profile. access(2) honours the profile, so nothing is written outside scratch.
function probeSandboxExec(home = os.homedir()) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
  try {
    const iso = makeIsolation({ mode: SANDBOX_BIN, scratchRoot: scratch, home });
    const homeDir = realHomes(home)[0];
    const test = [
      `touch ${shq(path.join(fs.realpathSync(scratch), 'ok'))} || exit 2`,
      `if [ -w ${shq(homeDir)} ]; then exit 3; fi`,
      `if [ -w ${shq(fs.realpathSync(os.tmpdir()))} ]; then exit 4; fi`,
      'exit 0',
    ].join('; ');
    const w = iso.wrap('/bin/sh', ['-c', test]);
    const r = spawnSync(w.file, w.args, { encoding: 'utf8', timeout: 20000 });
    const reasons = { 2: 'scratch dir not writable', 3: 'real home still writable', 4: 'tmp still writable' };
    if (r.status === 0) return { ok: true, reason: null };
    const why = r.error ? r.error.message : (reasons[r.status] || (r.stderr || '').trim().split('\n').pop() || `exit ${r.status}`);
    return { ok: false, reason: why };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

const ISOLATE_MODES = ['auto', 'unshare', SANDBOX_BIN, 'none'];
const PROBES = { unshare: probeUnshare, [SANDBOX_BIN]: probeSandboxExec };
const LABELS = { unshare: 'mount namespace', [SANDBOX_BIN]: 'sandbox-exec' };
const autoMode = (platform = process.platform) => (platform === 'darwin' ? SANDBOX_BIN : 'unshare');

/**
 * Resolves --isolate. `auto` uses sandbox-exec on macOS and the namespace elsewhere, and aborts when
 * the probe fails: an unattended trust-all-tools agent must not silently run uncontained.
 * `none` is the explicit opt-out. `probeFn` replaces the probe of the chosen mode (for tests).
 */
function resolveIsolation(requested, home, probeFn) {
  if (requested === 'none') return { mode: 'none', reason: 'requested' };
  if (!ISOLATE_MODES.includes(requested)) throw new Error(`--isolate must be one of ${ISOLATE_MODES.join(', ')}`);
  const mode = requested === 'auto' ? autoMode() : requested;
  const probe = (probeFn || PROBES[mode])(home);
  if (probe.ok) return { mode, reason: requested === 'auto' ? 'auto: probe passed' : 'requested' };
  if (requested !== 'auto') throw new Error(`--isolate ${mode} is not usable here: ${probe.reason}`);
  throw new Error(`${LABELS[mode]} isolation is unavailable (${probe.reason}). Fix that, or pass --isolate none to run without containment.`);
}

// The mode `auto` would pick, or null when its probe fails here (recheck then runs uncontained, as before).
function workingMode(home) {
  const mode = autoMode();
  return PROBES[mode](home).ok ? mode : null;
}

module.exports = {
  makeIsolation, probeUnshare, probeSandboxExec, resolveIsolation, workingMode, autoMode, realHomes, writableTrees, runtimeSockets, findAnswerKeys,
  UNSHARE_FLAGS, HIDE_IN_HOME, ISOLATE_MODES,
};
