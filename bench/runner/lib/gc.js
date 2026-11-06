// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js gc`: reclaim directories the bench itself created. Only a directory with a valid `.bench-owner.json` is ever
// a candidate, and every condition below is checked again right before each deletion. The default is a dry run.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { MARKER_FILE, KINDS, inspectMarker, markOwned, pidStartTicks } = require('./owned.js');

const BENCH_REPO = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_PROTECT_FILE = path.join(os.homedir(), '.konductor', 'bench-gc-protect.txt');
const DEFAULT_KINDS = ['scratch', 'cache', 'cargo-target'];
const DEFAULT_OLDER_THAN_MS = 7 * 24 * 3600 * 1000;
const SCAN_DEPTH = 3;
const SKIP_NAMES = new Set(['node_modules', '.git']);
const GC_LOG = '.bench-gc.log';

// ---------------------------------------------------------------- small helpers

const within = (p, dir) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

function realOrNull(p) { try { return fs.realpathSync(p); } catch { return null; } }

function parseDuration(text) {
  const m = /^(\d+(?:\.\d+)?)([smhdw])$/.exec(String(text).trim());
  if (!m) throw new Error(`"${text}" is not a duration; use a number and a unit: 30m, 12h, 7d or 2w`);
  return Math.round(Number(m[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[m[2]]);
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '?';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i ? v.toFixed(v >= 100 ? 0 : 1) : v} ${u[i]}`;
}

function formatAge(ms) {
  if (ms < 0) return '0m';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function cleanGitEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return env;
}

// ---------------------------------------------------------------- protect list

function parseProtectText(text) {
  const entries = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    entries.push(line);
  }
  return entries;
}

/** { file, entries, problems }. A missing file is an empty list. Entries are expanded (~) and must be absolute. */
function readProtectFile(file = DEFAULT_PROTECT_FILE) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') return { file, entries: [], problems: [`cannot read ${file}: ${e.code || e.message}`], unreadable: true }; }
  const entries = [];
  const problems = [];
  for (const raw of parseProtectText(text)) {
    const e = raw === '~' ? os.homedir() : raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw;
    if (!path.isAbsolute(e)) { problems.push(`ignored protect entry "${raw}": not an absolute path`); continue; }
    entries.push(path.normalize(e).replace(/(.)\/+$/, '$1'));
  }
  return { file, entries, problems, unreadable: false };
}

const hasWildcard = (s) => /[*?]/.test(s);

function segmentRegExp(seg) {
  let src = '';
  for (const ch of seg) src += ch === '*' ? '[^/]*' : ch === '?' ? '[^/]' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${src}$`);
}

/** Whole-path glob match: `*` and `?` stay inside a path segment, a `**` segment spans any number of segments. */
function globMatches(pattern, p) {
  const ps = pattern.split('/');
  const xs = p.split('/');
  const go = (i, j) => {
    if (i === ps.length) return j === xs.length;
    if (ps[i] === '**') { for (let k = j; k <= xs.length; k++) if (go(i + 1, k)) return true; return false; }
    return j < xs.length && segmentRegExp(ps[i]).test(xs[j]) && go(i + 1, j + 1);
  };
  return go(0, 0);
}

/** Could `pattern` match a path strictly below `dir`? True means the directory may hold something protected. */
function patternReachesBelow(pattern, dir) {
  const ps = pattern.split('/');
  const ds = dir.split('/');
  for (let i = 0; i < ds.length; i++) {
    if (i >= ps.length) return false;
    if (ps[i] === '**') return true;
    if (!segmentRegExp(ps[i]).test(ds[i])) return false;
  }
  return ps.length > ds.length;
}

/** The first protect entry that covers `dir` (it, or a parent of it, matches) or sits inside it; null if none. */
function protectedBy(dirs, entries) {
  const forms = [...new Set(dirs.filter(Boolean))];
  for (const entry of entries) {
    const variants = [entry];
    if (!hasWildcard(entry)) { const r = realOrNull(entry); if (r && r !== entry) variants.push(r); }
    for (const e of variants) {
      for (const d of forms) {
        for (let a = d; ; a = path.dirname(a)) {
          if (a !== '/' && (hasWildcard(e) ? globMatches(e, a) : a === e)) return entry;
          if (a === path.dirname(a)) break;
        }
        if (hasWildcard(e) ? patternReachesBelow(e, d) : within(e, d) && e !== d) return entry;
      }
    }
  }
  return null;
}

function addProtectEntry(file, entry) {
  if (!path.isAbsolute(entry) && !entry.startsWith('~')) throw new Error(`protect entries must be absolute paths or globs: ${entry}`);
  if (/[\n\r]/.test(entry)) throw new Error('a protect entry is one line');
  const current = readProtectFile(file);
  if (current.unreadable) throw new Error(current.problems[0]);
  if (current.entries.includes(path.normalize(entry))) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* new file */ }
  fs.writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${entry}\n`, { mode: 0o644 });
  return true;
}

// ---------------------------------------------------------------- scanning

/**
 * Walks each root to SCAN_DEPTH without following symlinks. Returns the directories that hold a marker file (valid or not),
 * every symlink met (with its resolved target) and warnings about roots that could not be read.
 */
function scanRoots(roots) {
  const found = new Map();
  const symlinks = [];
  const warnings = [];
  const scannedRoots = [];
  for (const root of roots) {
    const real = realOrNull(root);
    if (!real) { warnings.push(`root ${root} does not exist`); continue; }
    let st;
    try { st = fs.statSync(real); } catch { warnings.push(`cannot stat root ${root}`); continue; }
    if (!st.isDirectory()) { warnings.push(`root ${root} is not a directory`); continue; }
    if (scannedRoots.includes(real)) continue;
    scannedRoots.push(real);
    const queue = [{ dir: real, depth: 0 }];
    while (queue.length) {
      const { dir, depth } = queue.shift();
      if (fs.existsSync(path.join(dir, MARKER_FILE)) || isMarkerSymlink(dir)) {
        if (!found.has(dir)) found.set(dir, { dir, root: real, depth });
      }
      if (depth >= SCAN_DEPTH) continue;
      let ents;
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { warnings.push(`cannot read ${dir}: ${e.code || e.message}`); continue; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isSymbolicLink()) { const t = realOrNull(p); if (t) symlinks.push({ link: p, target: t }); continue; }
        if (e.isDirectory() && !SKIP_NAMES.has(e.name)) queue.push({ dir: p, depth: depth + 1 });
      }
    }
  }
  return { found: [...found.values()], symlinks, warnings, roots: scannedRoots };
}

function isMarkerSymlink(dir) {
  try { return fs.lstatSync(path.join(dir, MARKER_FILE)).isSymbolicLink(); } catch { return false; }
}

/** Size on disk, newest modification time and any linked-worktree `.git` file, over the whole tree (symlinks are not followed). */
function inspectTree(dir) {
  let bytes = 0;
  let newest = 0;
  let entries = 0;
  let linkedWorktree = null;
  let top;
  try { top = fs.lstatSync(dir); } catch { return { bytes: 0, newest: 0, entries: 0, linkedWorktree: null }; }
  bytes += top.blocks * 512;
  newest = top.mtimeMs;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      let st;
      try { st = fs.lstatSync(p); } catch { continue; }
      entries++;
      bytes += st.blocks * 512;
      if (st.mtimeMs > newest) newest = st.mtimeMs;
      if (st.isDirectory()) stack.push(p);
      else if (e.name === '.git' && st.isFile() && !linkedWorktree) {
        try { if (/^gitdir:.*[\\/]worktrees[\\/]/m.test(fs.readFileSync(p, 'utf8').slice(0, 1000))) linkedWorktree = p; } catch { /* unreadable */ }
      }
    }
  }
  return { bytes, newest, entries, linkedWorktree };
}

// ---------------------------------------------------------------- processes

/** One pass over /proc: command line, cwd and open file paths of every process. ok is false when /proc cannot be listed. */
function snapshotProcesses(procRoot = '/proc') {
  let names;
  try { names = fs.readdirSync(procRoot).filter((n) => /^\d+$/.test(n)); } catch { return { ok: false, procs: [], unreadable: 0 }; }
  const procs = [];
  let unreadable = 0;
  for (const n of names) {
    const pid = Number(n);
    if (pid === process.pid) continue;
    const base = path.join(procRoot, n);
    const p = { pid, cmdline: '', cwd: null, fds: [] };
    try { p.cmdline = fs.readFileSync(path.join(base, 'cmdline'), 'utf8').split('\0').join(' '); } catch { /* gone or hidden */ }
    try { p.cwd = fs.readlinkSync(path.join(base, 'cwd')); } catch { unreadable++; }
    try {
      for (const fd of fs.readdirSync(path.join(base, 'fd'))) {
        try { p.fds.push(fs.readlinkSync(path.join(base, 'fd', fd))); } catch { /* closed meanwhile */ }
      }
    } catch { /* not ours to read */ }
    procs.push(p);
  }
  return { ok: true, procs, unreadable };
}

const mentions = (text, dir) => {
  for (let i = text.indexOf(dir); i >= 0; i = text.indexOf(dir, i + 1)) {
    const next = text[i + dir.length];
    if (next === undefined || !/[A-Za-z0-9._-]/.test(next)) return true;
  }
  return false;
};

/** Processes that use `dir`: current directory, open file, or its path on the command line. */
function holdersOf(dirs, snapshot) {
  const out = [];
  for (const p of snapshot.procs) {
    const label = p.cmdline.trim().slice(0, 80);
    for (const d of dirs) {
      if (p.cwd && within(p.cwd, d)) { out.push(`pid ${p.pid} has it as its working directory (${label})`); break; }
      if (p.fds.some((f) => within(f, d))) { out.push(`pid ${p.pid} has a file open in it (${label})`); break; }
      if (mentions(p.cmdline, d)) { out.push(`pid ${p.pid} names it on its command line (${label})`); break; }
    }
  }
  return out;
}

function markerPidAlive(marker, procRoot) {
  if (!marker.pid) return false;
  try { process.kill(marker.pid, 0); } catch (e) { if (e.code === 'ESRCH') return false; }
  if (marker.pidStart) {
    const now = pidStartTicks(marker.pid, procRoot);
    if (now && now !== marker.pidStart) return false;
  }
  return true;
}

// ---------------------------------------------------------------- git

function repoRootsAbove(dir) {
  const out = [];
  for (let a = dir; ; a = path.dirname(a)) {
    if (fs.existsSync(path.join(a, '.git'))) out.push(a);
    if (a === path.dirname(a)) break;
  }
  return out;
}

/** Registered worktree paths of the repository at `root`, or null when git cannot say. */
function worktreePaths(root, cache) {
  if (cache && cache.has(root)) return cache.get(root);
  let result = null;
  try {
    const text = execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], { env: cleanGitEnv(), stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000, encoding: 'utf8' });
    result = text.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9)).map((p) => realOrNull(p) || p);
  } catch { result = null; }
  if (cache) cache.set(root, result);
  return result;
}

// ---------------------------------------------------------------- evaluation

function makeContext(o = {}) {
  const home = realOrNull(os.homedir()) || os.homedir();
  const scan = o.scan || scanRoots(o.roots || []);
  const roots = scan.roots;
  const repoRoots = new Set([realOrNull(BENCH_REPO) || BENCH_REPO, ...(o.repoRoots || [])]);
  const never = new Set(['/', '/tmp', '/var/tmp', home, realOrNull(os.tmpdir()) || os.tmpdir(), realOrNull(process.cwd()) || process.cwd(), ...roots, ...repoRoots]);
  for (const t of ['/tmp', '/var/tmp']) { const r = realOrNull(t); if (r) never.add(r); }
  return {
    now: o.now ?? Date.now(),
    procRoot: o.procRoot || '/proc',
    protect: o.protect || { entries: [], problems: [] },
    olderThanMs: o.olderThanMs ?? DEFAULT_OLDER_THAN_MS,
    kinds: o.kinds || DEFAULT_KINDS,
    uid: o.uid ?? (typeof process.getuid === 'function' ? process.getuid() : null),
    scan, roots, never, repoRoots, home,
    snapshot: o.snapshot || snapshotProcesses(o.procRoot || '/proc'),
    worktreeCache: new Map(),
    ignoreAge: Boolean(o.ignoreAge),
  };
}

/** Locations a marked directory must never be, or contain: roots, home, temp dirs, repository roots, the working directory. */
function dangerousLocation(real, ctx) {
  for (const n of ctx.never) {
    if (real === n) return `is ${n === '/' ? 'the filesystem root' : n === ctx.home ? 'the home directory' : `the protected location ${n}`}`;
    if (within(n, real)) return `contains ${n}, which gc must keep`;
  }
  return null;
}

/** Everything that stops a directory from being deleted or adopted, apart from marker content, age and kind. */
function structuralBlockers(dir, real, ctx) {
  const why = [];
  let st = null;
  try { st = fs.lstatSync(dir); } catch { return ['no longer exists']; }
  if (st.isSymbolicLink()) return ['is a symlink'];
  if (!st.isDirectory()) return ['is not a directory'];
  if (ctx.uid !== null && st.uid !== ctx.uid) why.push('is owned by another user');
  const danger = dangerousLocation(real, ctx);
  if (danger) why.push(danger);
  const entry = protectedBy([dir, real], ctx.protect.entries);
  if (entry) why.push(`protected by ${entry}`);
  if (ctx.protect.unreadable) why.push('the protect file could not be read');
  if (fs.existsSync(path.join(real, '.git'))) why.push('holds a .git entry at its top (a checkout or a worktree)');
  const above = repoRootsAbove(path.dirname(real));
  if (above.length) why.push(`is inside the git checkout ${above[0]}`);
  const repos = new Set([...repoRootsAbove(real), ...ctx.repoRoots]);
  for (const repo of repos) {
    if (!fs.existsSync(path.join(repo, '.git'))) continue;
    const wts = worktreePaths(repo, ctx.worktreeCache);
    if (wts === null) { why.push(`cannot list the git worktrees of ${repo}`); continue; }
    const hit = wts.find((w) => within(real, w) || within(w, real));
    if (hit) why.push(`is, is inside, or holds the registered git worktree ${hit}`);
  }
  if (!ctx.snapshot.ok) why.push('cannot check running processes on this system (no /proc)');
  else {
    const holders = holdersOf([...new Set([dir, real])], ctx.snapshot);
    if (holders.length) why.push(`in use: ${holders[0]}${holders.length > 1 ? ` (+${holders.length - 1} more)` : ''}`);
  }
  const pointed = ctx.scan.symlinks.find((s) => within(s.target, real) && !within(s.link, real));
  if (pointed) why.push(`${pointed.link} is a symlink that points into it`);
  return why;
}

/** The full verdict for one directory that holds a marker file. */
function evaluateDir(found, ctx) {
  const { dir } = found;
  const real = realOrNull(dir) || dir;
  const info = inspectMarker(dir);
  const entry = { dir, real, root: found.root, depth: found.depth, kind: null, marker: null, sizeBytes: 0, lastActivityMs: null, ageMs: null, eligible: false, reasons: [] };
  if (info.state !== 'valid') { entry.reasons.push(`marker is not valid: ${info.error || info.state}`); return entry; }
  const marker = info.marker;
  entry.marker = marker;
  entry.kind = marker.kind;
  try { if (fs.lstatSync(dir).isSymbolicLink()) { entry.reasons.push('is a symlink; gc never follows symlinks'); return entry; } } catch { entry.reasons.push('no longer exists'); return entry; }
  const tree = inspectTree(real);
  entry.sizeBytes = tree.bytes;
  const stamp = Date.parse(marker.lastUsedAt || marker.createdAt);
  entry.lastActivityMs = Math.max(tree.newest, Number.isNaN(stamp) ? 0 : stamp);
  entry.ageMs = ctx.now - entry.lastActivityMs;
  if (marker.protect) entry.reasons.push('the marker says protect: true');
  if (marker.kind === 'archive') entry.reasons.push('archives are never deleted by gc');
  else if (!ctx.kinds.includes(marker.kind)) entry.reasons.push(`kind ${marker.kind} is not selected; default kinds are ${DEFAULT_KINDS.join(', ')}, pass --kind ${marker.kind} to include it`);
  if (found.depth === 0) entry.reasons.push('is a scan root; scan its parent instead');
  entry.reasons.push(...structuralBlockers(dir, real, ctx));
  if (marker.pid && markerPidAlive(marker, ctx.procRoot)) entry.reasons.push(`a study is still running (pid ${marker.pid})`);
  if (!ctx.ignoreAge && entry.ageMs < ctx.olderThanMs) entry.reasons.push(`younger than ${formatAge(ctx.olderThanMs)} (age ${formatAge(entry.ageMs)})`);
  if (tree.linkedWorktree) entry.reasons.push(`holds the linked git worktree ${path.dirname(tree.linkedWorktree)}`);
  entry.eligible = entry.reasons.length === 0;
  return entry;
}

/** Evaluates every marked directory under the roots. keepLast N spares the newest N of each kind. */
function planGc(o) {
  const protect = o.protect || (o.protectFile ? readProtectFile(o.protectFile) : { entries: [], problems: [] });
  const ctx = makeContext({ ...o, protect });
  const entries = ctx.scan.found.map((f) => evaluateDir(f, ctx));
  entries.sort((a, b) => (b.lastActivityMs ?? 0) - (a.lastActivityMs ?? 0));
  if (o.keepLast) {
    const seen = {};
    for (const e of entries) {
      if (!e.kind) continue;
      seen[e.kind] = (seen[e.kind] || 0) + 1;
      if (seen[e.kind] <= o.keepLast && e.eligible) { e.eligible = false; e.reasons.push(`one of the newest ${o.keepLast} of kind ${e.kind} (--keep-last)`); }
    }
  }
  const reclaimable = entries.filter((e) => e.eligible).reduce((n, e) => n + e.sizeBytes, 0);
  return {
    now: new Date(ctx.now).toISOString(), roots: ctx.roots, olderThanMs: ctx.olderThanMs, kinds: ctx.kinds, keepLast: o.keepLast || 0,
    protectFile: ctx.protect.file || null, protectEntries: ctx.protect.entries, warnings: [...ctx.scan.warnings, ...(ctx.protect.problems || [])],
    processesChecked: ctx.snapshot.ok, processesUnreadable: ctx.snapshot.unreadable || 0, entries, reclaimableBytes: reclaimable,
    _options: { ...o, protect },
  };
}

// ---------------------------------------------------------------- applying

function logLine(root, fields) {
  const file = path.join(root, GC_LOG);
  try { fs.appendFileSync(file, `${fields.join('\t')}\n`, { mode: 0o644 }); return null; } catch (e) { return `could not write ${file}: ${e.code || e.message}`; }
}

/**
 * Deletes the eligible entries of `plan`. Each one is evaluated again from scratch (marker, protect list, processes, worktrees,
 * symlinks, age) and removed only if it is still eligible and unchanged. Returns one result per planned entry.
 */
function applyGc(plan, hooks = {}) {
  const o = plan._options;
  const results = [];
  const eligible = plan.entries.filter((e) => e.eligible).sort((a, b) => a.real.length - b.real.length);
  const removed = [];
  for (const planned of eligible) {
    if (hooks.beforeEach) hooks.beforeEach(planned);
    const parent = removed.find((r) => within(planned.real, r));
    if (parent) { results.push({ dir: planned.dir, status: 'deleted', bytes: 0, kind: planned.kind, reason: `removed with ${parent}` }); continue; }
    const protect = o.protectFile ? readProtectFile(o.protectFile) : o.protect;
    const scan = scanRoots(o.roots);
    const ctx = makeContext({ ...o, protect, scan, now: o.nowFn ? o.nowFn() : (o.now ?? Date.now()), snapshot: undefined });
    const found = scan.found.find((f) => f.dir === planned.dir);
    if (!found) { results.push({ dir: planned.dir, status: 'skipped', reason: 'no longer found under the roots' }); continue; }
    const now = evaluateDir(found, ctx);
    const same = now.real === planned.real && now.marker && planned.marker && now.marker.createdAt === planned.marker.createdAt && now.marker.kind === planned.marker.kind;
    if (!same) { results.push({ dir: planned.dir, status: 'skipped', reason: 'changed since the plan was made' }); continue; }
    if (!now.eligible) { results.push({ dir: planned.dir, status: 'skipped', reason: now.reasons[0] }); continue; }
    try {
      fs.rmSync(now.real, { recursive: true, force: false });
    } catch (e) {
      results.push({ dir: planned.dir, status: 'failed', reason: e.code || e.message });
      continue;
    }
    removed.push(now.real);
    const warn = logLine(found.root, [new Date().toISOString(), 'deleted', now.kind, now.real, String(now.sizeBytes), formatAge(now.ageMs)]);
    results.push({ dir: planned.dir, status: 'deleted', bytes: now.sizeBytes, kind: now.kind, logWarning: warn });
  }
  return results;
}

// ---------------------------------------------------------------- adoption

/** What `gc --adopt DIR --kind KIND` would do. Never writes. */
function planAdopt({ dir, kind, protect, now, procRoot, repoRoots }) {
  if (!KINDS.includes(kind)) return { ok: false, reasons: [`--kind takes one of ${KINDS.join(', ')}`] };
  const abs = path.resolve(dir);
  const real = realOrNull(abs);
  if (!real) return { ok: false, reasons: [`${abs} does not exist`] };
  let lst;
  try { lst = fs.lstatSync(abs); } catch { return { ok: false, reasons: [`${abs} does not exist`] }; }
  if (lst.isSymbolicLink()) return { ok: false, reasons: [`${abs} is a symlink; adopt the directory it points to`] };
  const scan = { found: [], symlinks: [], warnings: [], roots: [] };
  const ctx = makeContext({ scan, protect, now, procRoot, repoRoots, snapshot: { ok: true, procs: [] } });
  const reasons = structuralBlockers(abs, real, ctx).filter((r) => !r.startsWith('in use:'));
  const existing = inspectMarker(abs);
  if (existing.state === 'valid') reasons.push(`already has a marker of kind ${existing.marker.kind}`);
  if (existing.state === 'invalid') reasons.push(`has an unusable ${MARKER_FILE} (${existing.error}); remove it first`);
  const born = lst.birthtimeMs > 0 ? lst.birthtimeMs : lst.mtimeMs;
  return { ok: reasons.length === 0, reasons, dir: abs, real, kind, createdAt: new Date(Math.min(born, lst.mtimeMs)).toISOString(), protect: kind === 'archive' };
}

/** Writes the marker of an approved adoption. The directory and the marker keep the directory's own modification time, so adopting does not make it look young. */
function applyAdopt(plan) {
  const st = fs.statSync(plan.real);
  const marker = markOwned(plan.real, plan.kind, { createdAt: plan.createdAt, lastUsedAt: plan.createdAt, adopted: true, pid: null, protect: plan.protect });
  try {
    fs.utimesSync(path.join(plan.real, MARKER_FILE), st.atime, st.mtime);
    fs.utimesSync(plan.real, st.atime, st.mtime);
  } catch { /* the marker is written; only the age display is affected */ }
  return marker;
}

module.exports = {
  DEFAULT_PROTECT_FILE, DEFAULT_KINDS, DEFAULT_OLDER_THAN_MS, GC_LOG, SCAN_DEPTH,
  parseDuration, formatBytes, formatAge, parseProtectText, readProtectFile, addProtectEntry, globMatches, patternReachesBelow, protectedBy,
  scanRoots, inspectTree, dangerousLocation, snapshotProcesses, holdersOf, markerPidAlive, planGc, applyGc, evaluateDir, makeContext, planAdopt, applyAdopt, structuralBlockers,
};
