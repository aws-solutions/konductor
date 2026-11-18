'use strict';

// Matches the findings of a review document to a fixed key of planted items, so recall, false alarms and severity are
// counted without a judge. The same file sits in the hidden directory of each review task in bench/sdlc; a bench test
// keeps the copies identical.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'nit'];
const ITEM = /^\s*[-*]\s+\[(critical|high|medium|low|nit)\]\s*(?:`?([\w./-]+\.\w+):(\d+)`?)?\s*(.*)$/i;

/** The text of `rel` under the workspace, or '' when it is missing. */
function readDoc(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; }
}

/** The part of `text` under the first heading matching `heading`, up to the next heading of the same or a higher level. */
function section(text, heading) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^#{1,4}\s/.test(l) && heading.test(l));
  if (i < 0) return '';
  const level = lines[i].match(/^#+/)[0].length;
  let j = i + 1;
  while (j < lines.length && !(/^#{1,4}\s/.test(lines[j]) && lines[j].match(/^#+/)[0].length <= level)) j++;
  return lines.slice(i + 1, j).join('\n');
}

/**
 * The findings of a review: list items that start with a severity in brackets, then an optional `file:line`.
 * `text` of an item holds its first line and any indented lines under it.
 */
function parseItems(doc) {
  const out = [];
  let current = null;
  for (const line of doc.split('\n')) {
    const m = line.match(ITEM);
    if (m) {
      current = { severity: m[1].toLowerCase(), file: m[2] || null, line: m[3] ? Number(m[3]) : null, text: m[4] };
      out.push(current);
    } else if (current && /^\s{2,}\S/.test(line)) current.text += ` ${line.trim()}`;
    else if (line.trim()) current = null;
  }
  return out;
}

/** The 1-based line of the first line of `file` that holds `anchor`. Throws when the anchor is gone, so a key never silently misses. */
function lineOf(file, anchor) {
  const i = readDoc(file).split('\n').findIndex((l) => l.includes(anchor));
  if (i < 0) throw new Error(`key anchor not found in ${file}: ${anchor}`);
  return i + 1;
}

/**
 * Whether a finding names a planted item. `item` has file, anchor and span (a finding within `span` lines of the
 * anchor in the same file matches), or phrases (regexes; a finding whose text matches one matches, in the same file
 * when the finding names one).
 */
function matches(finding, item) {
  if (item.file && finding.file && finding.file !== item.file) return false;
  if (item.anchor && finding.file === item.file && finding.line !== null && Math.abs(finding.line - lineOf(item.file, item.anchor)) <= item.span) return true;
  return (item.phrases || []).some((re) => re.test(finding.text));
}

const found = (findings, item) => findings.filter((f) => matches(f, item));
const rank = (s) => SEVERITIES.indexOf(s);

/**
 * Each finding given to at most one planted item, so a finding between two neighbours is not counted twice: among the
 * items it matches, one whose phrases match its text wins, then the nearest anchor. Returns a Map of item id to findings.
 */
function assign(findings, items) {
  const out = new Map(items.map((it) => [it.id, []]));
  for (const f of findings) {
    const cands = items.filter((it) => matches(f, it));
    if (!cands.length) continue;
    const byPhrase = cands.filter((it) => (it.phrases || []).some((re) => re.test(f.text)));
    const pool = byPhrase.length ? byPhrase : cands;
    const dist = (it) => (it.anchor && f.line !== null ? Math.abs(f.line - lineOf(it.file, it.anchor)) : Infinity);
    out.get(pool.sort((a, b) => dist(a) - dist(b))[0].id).push(f);
  }
  return out;
}

module.exports = { readDoc, section, parseItems, lineOf, matches, found, assign, rank, SEVERITIES };
