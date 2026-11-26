// SPDX-License-Identifier: Apache-2.0
'use strict';

// The coverage audit of a read-view call. The backend reports the judge's tool calls (`readTrace`: dirs, steps, tools
// with name, input and status); a reply is scored only when every tool is read, glob or grep, every path is inside the
// copy, and the completed reads cover every line of every copied file.
//
// A read's lines follow opencode 1.19.5's read tool (tool/read.ts): `offset` is the first line, counted from 1, `limit`
// lines at most (2000 by default), and the output stops before it passes 50 KB. The audit counts a line only when its
// bytes, with one byte for its newline, still fit under that cap, so it never credits a line the tool did not return.
// shortcut: the 1-based offset and the byte rule are read from the source, not seen on a real call; the paid check pins them (DEBT).

const path = require('node:path');

const READ_TOOLS = Object.freeze(['read', 'glob', 'grep']);
const DEFAULT_LIMIT = 2000;
const MAX_READ_BYTES = 50 * 1024;

/** The path a tool call names (read: filePath; glob and grep: path, else the working folder). */
const pathOf = (t) => (t.tool === 'read' ? t.input.filePath : t.input.path ?? '.');

/** `p` relative to the first of `dirs` that holds it, or null when it is outside all of them. */
function relInside(p, dirs) {
  for (const d of dirs) {
    const abs = path.resolve(d, String(p));
    if (abs === d) return '';
    if (abs.startsWith(`${d}${path.sep}`)) return path.relative(d, abs).split(path.sep).join('/');
  }
  return null;
}

/** The 1-based line numbers one read of `lines` (the file's lines, each without its newline) returns. */
function linesOfRead(lines, input) {
  const first = Math.max(1, Math.floor(Number(input.offset ?? 1)) || 1);
  const limit = Math.max(0, Math.floor(Number(input.limit ?? DEFAULT_LIMIT)) || 0);
  const got = [];
  let bytes = 0;
  for (let n = first; n <= lines.length && got.length < limit; n++) {
    bytes += Buffer.byteLength(lines[n - 1]) + 1;
    if (bytes > MAX_READ_BYTES) break;
    got.push(n);
  }
  return got;
}

/** The first unread range of each file, as "lo-hi" (or "never read"); empty when every line was read. */
function unreadRanges(files, seen) {
  const out = [];
  for (const f of files) {
    const n = f.lines.length;
    const got = seen.get(f.rel);
    if (!got) { out.push(`${f.rel} (never read)`); continue; }
    const lo = Array.from({ length: n }, (_, i) => i + 1).find((x) => !got.has(x));
    if (lo === undefined) continue;
    let hi = lo;
    while (hi < n && !got.has(hi + 1)) hi++;
    out.push(`${f.rel} (lines ${lo}-${hi})`);
  }
  return out;
}

const splitLines = (text) => {
  const l = text.split('\n');
  if (text.endsWith('\n')) l.pop();
  return l;
};

/**
 * Audits `trace` against the copy `files` ([{ rel, text }]). Returns { error } when the reply must not be scored, else
 * { record }: the read order (each file once, first read first), the step count and the tool call count.
 */
function auditReads(trace, files) {
  if (!trace || !Array.isArray(trace.tools) || !Array.isArray(trace.dirs)) return { error: 'read view: the backend returned no record of the judge\'s reads' };
  const byRel = new Map(files.map((f) => [f.rel, { rel: f.rel, lines: splitLines(f.text) }]));
  const seen = new Map();
  const order = [];
  for (const t of trace.tools) {
    if (!READ_TOOLS.includes(t.tool)) return { error: `read view: the judge used ${t.tool}; only ${READ_TOOLS.join(', ')} may be used` };
    const p = pathOf(t);
    const rel = relInside(p, trace.dirs);
    if (rel === null) return { error: `read view: the judge reached outside its copy (${p})` };
    const f = byRel.get(rel);
    if (t.tool !== 'read' || t.status !== 'completed' || !f) continue;
    if (!seen.has(rel)) { seen.set(rel, new Set()); order.push(rel); }
    for (const n of linesOfRead(f.lines, t.input)) seen.get(rel).add(n);
    // An empty file has no line to cover; one completed read of it counts.
  }
  const missing = unreadRanges([...byRel.values()], seen);
  if (missing.length) return { error: `read view: not every line was read: ${missing.join(', ')}; the judgment is not scored` };
  return { record: { order, steps: trace.steps ?? null, toolCalls: trace.tools.length } };
}

module.exports = { auditReads, linesOfRead, relInside, READ_TOOLS, MAX_READ_BYTES, DEFAULT_LIMIT };
