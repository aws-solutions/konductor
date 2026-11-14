// SPDX-License-Identifier: Apache-2.0
'use strict';

// Looks for credential material in run outputs. Reports file names and pattern names, never the matched text.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scrubString, SHAPES, MASK } = require('./scrub.js');

const PATTERNS = [
  { name: 'access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'secret key setting', re: /aws_secret_access_key|AWS_SECRET_ACCESS_KEY/i },
  { name: 'session token setting', re: /aws_session_token|AWS_SESSION_TOKEN/i },
];
// Files up to this size are read whole; larger ones are streamed in chunks.
const MAX_BYTES = 8 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
// The longest text one credential shape is expected to match. Private key blocks are the longest real case (an RSA-4096 PEM is
// about 3.3 KB); every other shape is a run of token characters. A run longer than this is not held back: the file is reported
// as unscrubbed instead. A literal secret can be longer, so the overlap takes the larger of the two.
const SHAPE_MAX_BYTES = 64 * 1024;

/** Bytes kept back between chunks: any secret that starts before the held-back region ends inside the window, plus one byte for a trailing \b or greedy stop. */
const overlapFor = (literals) => Math.max(SHAPE_MAX_BYTES, ...literals.map((l) => Buffer.byteLength(l))) + 1;

function* files(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.isFile()) yield p;
  }
}

function readText(file) {
  try {
    if (fs.statSync(file).size > MAX_BYTES) return null;
    return fs.readFileSync(file, 'latin1');
  } catch { return null; }
}

/**
 * Calls fn(window) over a large file in chunks. Each window is the last `overlap` bytes of the one before plus the next chunk,
 * so a secret of at most `overlap` bytes lies whole inside some window.
 */
function eachWindow(file, overlap, chunkBytes, fn) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const buf = Buffer.alloc(chunkBytes);
    let tail = '';
    for (;;) {
      const n = fs.readSync(fd, buf, 0, chunkBytes, null);
      if (n === 0) return;
      const window = tail + buf.toString('latin1', 0, n);
      if (fn(window)) return;
      tail = window.slice(-overlap);
    }
  } finally { fs.closeSync(fd); }
}

/**
 * `literals` are exact secret values to look for as well. Returns [{file, pattern}]. A file that cannot be read is reported
 * with the pattern "unreadable file" instead of being passed over.
 */
function scanTree(dir, { literals = [], chunkBytes = CHUNK_BYTES } = {}) {
  const hits = [];
  const live = literals.filter(Boolean);
  const overlap = overlapFor(live);
  const patterns = PATTERNS.map((p) => ({ ...p, re: new RegExp(p.re.source, p.re.flags.replace('g', '')) }));
  for (const w of walkTree(dir)) {
    if (w.unreadable) { hits.push({ file: w.path, pattern: 'unreadable file' }); continue; }
    if (!w.file) continue;
    const file = w.path;
    try {
      const found = new Set();
      const check = (text) => {
        for (const p of patterns) if (p.re.test(text)) found.add(p.name);
        if (live.some((l) => text.includes(l))) found.add('exact secret value');
        return false;
      };
      if (w.size > MAX_BYTES) eachWindow(file, overlap, chunkBytes, check);
      else check(fs.readFileSync(file, 'latin1'));
      for (const name of found) hits.push({ file, pattern: name });
    } catch { hits.push({ file, pattern: 'unreadable file' }); }
  }
  return hits;
}

/** Every [start, end) span of `text` that scrubbing would replace: literal occurrences and, with `shapes`, credential shapes. */
function secretSpans(text, literals, shapes) {
  const spans = [];
  for (const l of literals) {
    for (let i = text.indexOf(l); i !== -1; i = text.indexOf(l, i + l.length)) spans.push([i, i + l.length]);
  }
  if (shapes) {
    for (const [re] of SHAPES) {
      for (const m of text.matchAll(new RegExp(re.source, re.flags))) spans.push([m.index, m.index + m[0].length]);
    }
  }
  return spans;
}

/** The largest cut point at or below `want` that falls inside no span. */
function safeCut(spans, want) {
  let cut = want;
  for (let moved = true; moved;) {
    moved = false;
    for (const [s, e] of spans) {
      if (s < cut && cut < e) { cut = s; moved = true; }
    }
  }
  return cut;
}

const literalsOnly = (live) => (text) => live.reduce((t, l) => t.split(l).join(MASK), text);

/**
 * Rewrites one large file through a temp file in the same directory and renames it over the original, so a reader never sees
 * a half-written file and the mode is kept. The file is left alone (and the temp file removed) when nothing changed.
 * Returns true when the file was rewritten. Throws when a secret-like run is longer than the held-back window.
 */
function scrubLargeFile(file, st, { live, shapes, chunkBytes }) {
  const apply = shapes ? (t) => scrubString(t, live) : literalsOnly(live);
  const overlap = overlapFor(live);
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.scrub-${process.pid}-${Date.now().toString(36)}.tmp`);
  const src = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let dst = null;
  let renamed = false;
  try {
    dst = fs.openSync(tmp, 'wx', st.mode & 0o7777);
    fs.fchmodSync(dst, st.mode & 0o7777);
    const buf = Buffer.alloc(chunkBytes);
    let pending = '';
    let changed = false;
    const emit = (raw) => {
      const out = apply(raw);
      if (out !== raw) changed = true;
      if (out.length) fs.writeSync(dst, Buffer.from(out, 'latin1'));
    };
    for (let n = fs.readSync(src, buf, 0, chunkBytes, null); n > 0; n = fs.readSync(src, buf, 0, chunkBytes, null)) {
      const window = pending + buf.toString('latin1', 0, n);
      if (window.length <= overlap) { pending = window; continue; }
      const cut = safeCut(secretSpans(window, live, shapes), window.length - overlap);
      if (window.length - cut > 2 * overlap) throw new Error(`a secret-like run longer than ${overlap} bytes`);
      emit(window.slice(0, cut));
      pending = window.slice(cut);
    }
    emit(pending);
    fs.closeSync(dst);
    dst = null;
    if (changed) {
      fs.renameSync(tmp, file);
      renamed = true;
    }
    return changed;
  } finally {
    fs.closeSync(src);
    if (dst !== null) fs.closeSync(dst);
    if (!renamed) fs.rmSync(tmp, { force: true });
  }
}

/**
 * Yields what is under dir: {path, file: true, size} for each regular file, {path, skipped} for a symlink or another kind of
 * entry (never followed or opened), and {path, unreadable} for a directory that cannot be listed.
 */
function* walkTree(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { yield { path: dir, unreadable: e.code || e.message }; return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { yield* walkTree(p); continue; }
    if (e.isSymbolicLink()) { yield { path: p, skipped: 'symlink, not followed' }; continue; }
    if (!e.isFile()) { yield { path: p, skipped: 'not a regular file' }; continue; }
    try {
      const st = fs.lstatSync(p);
      if (!st.isFile()) yield { path: p, skipped: 'not a regular file' };
      else yield { path: p, file: true, size: st.size, st };
    } catch (err) { yield { path: p, unreadable: err.code || err.message }; }
  }
}

/**
 * Replaces each literal with <redacted> in every file under dir; with `shapes`, credential-shaped text too (see scrub.js).
 * Files over MAX_BYTES are scrubbed in chunks. Symlinks and other non-regular entries are not followed or opened; they are
 * listed in `skipped`. A file or directory that cannot be scrubbed is listed in `unscrubbed` with the reason, and the walk
 * goes on with the rest.
 * Returns {scrubbed: files rewritten, files: regular files seen, unscrubbed: [{file, reason}], skipped: [{file, reason}]}.
 */
function scrubTreeDetailed(dir, literals, { shapes = false, chunkBytes = CHUNK_BYTES } = {}) {
  const live = literals.filter(Boolean);
  const out = { scrubbed: 0, files: 0, unscrubbed: [], skipped: [] };
  for (const w of walkTree(dir)) {
    if (w.skipped) { out.skipped.push({ file: w.path, reason: w.skipped }); continue; }
    if (w.unreadable) { out.unscrubbed.push({ file: w.path, reason: `cannot read: ${w.unreadable}` }); continue; }
    out.files++;
    try {
      if (w.size > MAX_BYTES) {
        if (scrubLargeFile(w.path, w.st, { live, shapes, chunkBytes })) out.scrubbed++;
        continue;
      }
      const text = fs.readFileSync(w.path, 'latin1');
      const next = shapes ? scrubString(text, live) : literalsOnly(live)(text);
      if (next === text) continue;
      fs.writeFileSync(w.path, next, 'latin1');
      out.scrubbed++;
    } catch (e) {
      out.unscrubbed.push({ file: w.path, reason: e.code || e.message });
    }
  }
  return out;
}

/** The number of files rewritten by scrubTreeDetailed. Callers that must know about files left unscrubbed use that instead. */
function scrubTree(dir, literals, opts = {}) {
  return scrubTreeDetailed(dir, literals, opts).scrubbed;
}

/**
 * The host's home directory and user name as they could appear in a saved file: the home path of the process, its
 * /home, /local/home and /Users forms for the current user. Returned as [RegExp, replacement] pairs.
 */
function hostPathRules(env = process.env, user = os.userInfo().username) {
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules = [];
  if (user && user.length > 2) rules.push([new RegExp(`(?:/local)?/(?:home|Users)/${esc(user)}(?![\\w-])`, 'g'), '<host-home>']);
  const homes = new Set([os.homedir(), env.HOME].filter((h) => typeof h === 'string' && h.length > 6 && h !== os.tmpdir()));
  for (const h of [...homes].sort((a, b) => b.length - a.length)) rules.push([new RegExp(`${esc(h)}(?![\\w-])`, 'g'), '<host-home>']);
  return rules;
}

/**
 * Replaces the host's home path in every file under dir with <host-home>. A session saved from a sandboxed run holds the
 * run's scratch paths; this removes the real user's, should one appear. Returns the number of files rewritten.
 */
function redactHostPaths(dir, rules = hostPathRules()) {
  let n = 0;
  for (const file of files(dir)) {
    const text = readText(file);
    if (text === null) continue;
    const next = rules.reduce((t, [re, to]) => t.replace(re, to), text);
    if (next === text) continue;
    fs.writeFileSync(file, next, 'latin1');
    n++;
  }
  return n;
}

module.exports = { scanTree, scrubTree, scrubTreeDetailed, redactHostPaths, hostPathRules, PATTERNS, MAX_BYTES, CHUNK_BYTES, SHAPE_MAX_BYTES, overlapFor };
