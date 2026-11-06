// SPDX-License-Identifier: Apache-2.0
'use strict';

// Ownership marker. A directory the bench created, and may later reclaim, holds `.bench-owner.json`.
// `bench.js gc` deletes only marked directories; an unmarked directory is never touched. The marker holds no secrets:
// no environment, and any command-line value that follows a credential-looking flag is replaced.
//
//   node bench/runner/lib/owned.js mark DIR KIND [--id ID]     (for shell drivers; always exits 0 once the arguments parse)

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const MARKER_FILE = '.bench-owner.json';
const SCHEMA_VERSION = 1;
const KINDS = ['run-out', 'cache', 'cargo-target', 'scratch', 'archive', 'study-driver-dir'];
const MAX_MARKER_BYTES = 64 * 1024;
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SECRET_FLAG = /(token|secret|passw|cred|api-?key|access-?key|session)/i;

let commitCache;
function benchCommit() {
  if (commitCache !== undefined) return commitCache;
  try {
    commitCache = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000, encoding: 'utf8' }).trim() || null;
  } catch { commitCache = null; }
  return commitCache;
}

/** The command line without the node binary, the script path made repo-relative and the value of any credential-looking flag removed. */
function sanitizedCommand(argv = process.argv) {
  const rest = argv.slice(1).map(String);
  if (rest.length) {
    const rel = path.relative(REPO_ROOT, rest[0]);
    rest[0] = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : path.basename(rest[0]);
  }
  const out = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 0 && SECRET_FLAG.test(a.slice(0, eq))) { out.push(`${a.slice(0, eq)}=[redacted]`); continue; }
    out.push(a);
    if (a.startsWith('--') && SECRET_FLAG.test(a) && i + 1 < rest.length && !rest[i + 1].startsWith('--')) { out.push('[redacted]'); i++; }
  }
  return out.join(' ').slice(0, 2000);
}

/** Start time of a process (clock ticks since boot, /proc only), so a recycled pid is not mistaken for the original. Null when unknown. */
function pidStartTicks(pid, procRoot = '/proc') {
  try {
    const stat = fs.readFileSync(path.join(procRoot, String(pid), 'stat'), 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return fields[19] || null;
  } catch { return null; }
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { mode: 0o644, flag: 'wx' });
    fs.chmodSync(tmp, 0o644);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw e;
  }
}

/** Why `m` is not a usable marker, or null. */
function markerProblem(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return 'not a JSON object';
  if (m.schemaVersion !== SCHEMA_VERSION) return `unsupported schemaVersion ${JSON.stringify(m.schemaVersion)}`;
  if (!KINDS.includes(m.kind)) return `unknown kind ${JSON.stringify(m.kind)}`;
  if (typeof m.createdAt !== 'string' || Number.isNaN(Date.parse(m.createdAt))) return 'createdAt is not a date';
  if (typeof m.protect !== 'boolean') return 'protect is not a boolean';
  if (m.pid !== null && !Number.isInteger(m.pid)) return 'pid is not an integer or null';
  return null;
}

/** { state: 'absent' | 'invalid' | 'valid', marker?, error? } for the marker of `dir`. A symlinked or oversized marker is invalid. */
function inspectMarker(dir) {
  const file = path.join(dir, MARKER_FILE);
  let st;
  try { st = fs.lstatSync(file); } catch (e) { return e.code === 'ENOENT' || e.code === 'ENOTDIR' ? { state: 'absent' } : { state: 'invalid', error: e.code || e.message }; }
  if (!st.isFile()) return { state: 'invalid', error: 'marker is not a regular file' };
  if (st.size > MAX_MARKER_BYTES) return { state: 'invalid', error: 'marker is too large' };
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { state: 'invalid', error: `unreadable JSON: ${e.message}` }; }
  const problem = markerProblem(parsed);
  return problem ? { state: 'invalid', error: problem } : { state: 'valid', marker: parsed };
}

/** The valid marker of `dir`, or null when there is none or it is unusable. */
function readMarker(dir) {
  const r = inspectMarker(dir);
  return r.state === 'valid' ? r.marker : null;
}

/**
 * Writes or refreshes `dir/.bench-owner.json`. extra: { id, protect, createdAt, adopted, adoptedAt, command, pid }.
 * An existing marker keeps its createdAt, id and protect flag and gets a new lastUsedAt, pid and command. A marker that is
 * protected or of another kind is only touched (lastUsedAt), except that kind `archive` always takes over.
 */
function markOwned(dir, kind, extra = {}) {
  if (!KINDS.includes(kind)) throw new Error(`unknown kind "${kind}" (${KINDS.join(', ')})`);
  const st = fs.lstatSync(dir);
  if (!st.isDirectory()) throw new Error(`${dir} is not a directory (a symlink is not marked)`);
  const now = new Date().toISOString();
  const pid = extra.pid !== undefined ? extra.pid : process.pid;
  const prior = readMarker(dir);
  let marker;
  if (prior && kind !== 'archive' && (prior.kind !== kind || prior.protect)) {
    marker = { ...prior, lastUsedAt: now };
  } else {
    marker = {
      schemaVersion: SCHEMA_VERSION,
      kind,
      createdAt: prior?.createdAt ?? extra.createdAt ?? now,
      lastUsedAt: now,
      benchCommit: prior?.benchCommit ?? benchCommit(),
      command: extra.command ?? sanitizedCommand(),
      pid,
      pidStart: pid ? pidStartTicks(pid) : null,
      id: extra.id ?? prior?.id ?? path.basename(path.resolve(dir)),
      protect: extra.protect !== undefined ? Boolean(extra.protect) : (prior?.protect ?? false),
    };
    if (extra.adopted) { marker.adopted = true; marker.adoptedAt = extra.adoptedAt ?? now; }
    else if (prior?.adopted) { marker.adopted = true; marker.adoptedAt = prior.adoptedAt; }
  }
  writeAtomic(path.join(dir, MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`);
  return marker;
}

/** markOwned for wiring into run code: a marker problem must never stop a run. Returns the marker or null. */
function tryMark(dir, kind, extra) {
  try { return markOwned(dir, kind, extra); } catch { return null; }
}

/**
 * mkdir -p `dir`; marks it when this call created it, or when it already carries a valid marker (a refresh).
 * An existing unmarked directory stays unmarked: it was not created by the bench, so `gc` never touches it unless
 * the user adopts it. Returns true when the directory was created here.
 */
function ensureOwnedDir(dir, kind, extra) {
  const existed = fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  if (!existed || readMarker(dir)) tryMark(dir, kind, extra);
  return !existed;
}

if (require.main === module) {
  const [verb, dir, kind, ...rest] = process.argv.slice(2);
  if (verb !== 'mark' || !dir || !kind) { console.error('usage: node owned.js mark DIR KIND [--id ID]'); process.exit(2); }
  const i = rest.indexOf('--id');
  const marker = tryMark(path.resolve(dir), kind, { pid: process.ppid, ...(i >= 0 ? { id: rest[i + 1] } : {}) });
  process.exit(marker ? 0 : 1);
}

module.exports = {
  MARKER_FILE, SCHEMA_VERSION, KINDS, markOwned, readMarker, inspectMarker, tryMark, ensureOwnedDir, markerProblem,
  sanitizedCommand, pidStartTicks, writeAtomic,
};
