// SPDX-License-Identifier: Apache-2.0
'use strict';

// Grades a review, design or planning output against a task's `findingsKey`, with no model in the loop.
// The agent writes its findings as a fenced JSON block (an array, or {"findings": [...]}), each item with
// `location`, `severity` and `fix` (or `text`). The key lists seeded items: { id, location, severity, fix }.
//   location: a string or list; an item matches when its location holds one of them (case-insensitive, on a token edge).
//   severity: critical, high, medium, low or nit.
//   fix:      keywords; the fix counts when the item's fix or text holds `fixMin` of them (default 1).
// Score = recall quality x length term. A found item earns 0.5, plus 0.25 for the right severity (half for one level off)
// and 0.25 for the fix. The length term caps a long list: more than 1.5 x the key size scales the score by allowed / reported,
// so listing everything does not win. Precision (matched / reported) is reported beside it.

const fs = require('node:fs');

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'nit'];
const LENGTH_ALLOWANCE = 1.5;

const norm = (s) => String(s ?? '').toLowerCase();
const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The first fenced block tagged json (or untagged) that parses to a list of findings, else null.
function readFindingsBlock(text) {
  for (const m of String(text).matchAll(/^```([a-z]*)[ \t]*\n([\s\S]*?)^```[ \t]*$/gim)) {
    if (m[1] && m[1].toLowerCase() !== 'json') continue;
    let data;
    try { data = JSON.parse(m[2]); } catch { continue; }
    const list = Array.isArray(data) ? data : Array.isArray(data?.findings) ? data.findings : null;
    if (list && list.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return list;
  }
  return null;
}

const locationHit = (reported, key) => asList(key.location).some((loc) => {
  const needle = norm(loc).trim();
  return needle !== '' && new RegExp(`(?<![a-z0-9])${escapeRe(needle)}(?![a-z0-9])`).test(norm(reported.location));
});

function severityCredit(want, got) {
  const a = SEVERITIES.indexOf(norm(want));
  const b = SEVERITIES.indexOf(norm(got));
  if (a < 0 || b < 0) return 0;
  return a === b ? 1 : Math.abs(a - b) === 1 ? 0.5 : 0;
}

function fixCredit(reported, key) {
  const words = asList(key.fix).map(norm).filter(Boolean);
  if (!words.length) return 1;
  const text = norm(`${reported.fix ?? ''} ${reported.text ?? ''}`);
  return words.filter((w) => text.includes(w)).length >= (key.fixMin ?? 1) ? 1 : 0;
}

/**
 * Pure grader. `reported` is the parsed list (or null), `key` the task's findingsKey.
 * Each reported item matches at most one key item and each key item at most one reported item.
 */
function gradeFindings(reported, key) {
  const n = key.length;
  const zero = { recall: 0, severityAccuracy: 0, fixAccuracy: 0, precision: 0, lengthTerm: 1, score: 0, reported: 0, matched: [], missed: key.map((k) => k.id) };
  if (!Array.isArray(reported)) return { ...zero, error: 'no findings block' };
  const used = new Set();
  const hits = [];
  for (const k of key) {
    const i = reported.findIndex((r, idx) => !used.has(idx) && locationHit(r, k));
    if (i < 0) continue;
    used.add(i);
    hits.push({ id: k.id, sev: severityCredit(k.severity, reported[i].severity), fix: fixCredit(reported[i], k) });
  }
  const found = hits.length;
  const allowed = Math.ceil(n * LENGTH_ALLOWANCE);
  const lengthTerm = reported.length > allowed ? allowed / reported.length : 1;
  const quality = hits.reduce((s, h) => s + 0.5 + 0.25 * h.sev + 0.25 * h.fix, 0) / (n || 1);
  return {
    recall: n ? found / n : 0,
    severityAccuracy: found ? hits.reduce((s, h) => s + h.sev, 0) / found : 0,
    fixAccuracy: found ? hits.reduce((s, h) => s + h.fix, 0) / found : 0,
    precision: reported.length ? found / reported.length : 0,
    lengthTerm,
    score: quality * lengthTerm,
    reported: reported.length,
    matched: hits.map((h) => h.id),
    missed: key.filter((k) => !hits.some((h) => h.id === k.id)).map((k) => k.id),
  };
}

/** Reads `file` and grades it; a missing or unparsable file scores 0 with an `error`, never throws. */
function gradeFindingsFile(file, key) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { ...gradeFindings(null, key), error: 'output file missing' }; }
  return gradeFindings(readFindingsBlock(text), key);
}

module.exports = { gradeFindings, gradeFindingsFile, readFindingsBlock, SEVERITIES, LENGTH_ALLOWANCE };
