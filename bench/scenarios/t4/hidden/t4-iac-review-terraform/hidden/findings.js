// SPDX-License-Identifier: Apache-2.0
'use strict';

// Helpers for the hidden tests of T4 review and threat-model tasks. The agent's document carries one fenced JSON
// block: a list of findings (or {"findings": [...]}), each an object. The hidden tests read it with `readFindings`
// and ask, item by item, whether a seeded issue was found (`findItem`), with what severity, and whether a decoy
// was wrongly raised. Matching is on text fields, case-insensitive, on word edges, so wording may vary.

const fs = require('node:fs');

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const norm = (s) => String(s ?? '').toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const textOf = (item, fields) => norm((fields || Object.keys(item)).map((k) => (typeof item[k] === 'string' ? item[k] : JSON.stringify(item[k] ?? ''))).join(' \n '));
const hasWord = (text, word) => new RegExp(`(?<![a-z0-9])${escapeRe(norm(word))}(?![a-z0-9])`).test(text);

/** The first fenced json (or untagged) block that parses to a list of objects, else null. */
function readFindingsBlock(text) {
  for (const m of String(text).matchAll(/^```([a-z]*)[ \t]*\n([\s\S]*?)^```[ \t]*$/gim)) {
    if (m[1] && m[1].toLowerCase() !== 'json') continue;
    let data;
    try { data = JSON.parse(m[2]); } catch { continue; }
    const list = Array.isArray(data) ? data : Array.isArray(data?.findings) ? data.findings : Array.isArray(data?.threats) ? data.threats : null;
    if (list && list.length && list.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return list;
  }
  return null;
}

/** Reads `file` (relative to the cwd) and returns its findings list, or [] when the file or block is missing. */
function readFindings(file) {
  try { return readFindingsBlock(fs.readFileSync(file, 'utf8')) || []; } catch { return []; }
}

/**
 * The first finding whose `where` fields hold one of `where` (a location, file or component name) and whose text holds
 * at least `min` (default 1) of the `about` words. `about` entries may be strings or arrays of synonyms (any one counts).
 */
function findItem(list, { where = [], about = [], min = 1, whereFields, aboutFields } = {}) {
  return list.find((it) => {
    const w = textOf(it, whereFields);
    if (where.length && !where.some((x) => hasWord(w, x))) return false;
    const a = textOf(it, aboutFields);
    const hits = about.filter((group) => (Array.isArray(group) ? group : [group]).some((x) => hasWord(a, x) || a.includes(norm(x)))).length;
    return hits >= Math.min(min, about.length);
  }) || null;
}

/** 0 for critical up to 4 for info; -1 when the item has no known severity. */
const severityRank = (item) => SEVERITIES.indexOf(norm(item?.severity).trim());

/** True when the item's severity is `at least` as serious as the given level. */
const atLeast = (item, level) => {
  const r = severityRank(item);
  return r >= 0 && r <= SEVERITIES.indexOf(level);
};

module.exports = { readFindings, readFindingsBlock, findItem, severityRank, atLeast, SEVERITIES };
