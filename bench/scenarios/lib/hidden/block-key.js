// SPDX-License-Identifier: Apache-2.0
'use strict';

// Grades the structured JSON block at the end of an ops document (incident report, postmortem, rollout plan, runbook,
// decision record) against a hidden key, with no model in the loop. Each key item is one pass/fail check; the hidden
// test registers one test per item (times its `weight`), so the score is the share of items met.
//
// The block: the last fenced ```json block of the document that parses to a JSON object.
// Paths are dotted ("rootCause.evidence", "rollback.trigger.metric"); a path that ends on an object where a list is
// wanted is read as a one-item list.
//
// A matcher (`match`, `first`, `then`) tests one list element:
//   { field?, all?: [regex], none?: [regex], num?: {gt, gte, lt, lte}, timeNear?: {time, tolMin}, timeIn?: [from, to], timeField? }
//   `field` picks a dotted field of the element (default: the whole element as JSON text); regexes are case-insensitive.
//   Times are read from `timeField` when given, else from `field`, else from the element's `time`.
//
// Item types:
//   text      {path, all?, none?}                       the value at path, as text, matches every `all` and no `none`
//   some      {path, match, min?=1}                    at least `min` elements match
//   none      {path, match}                            no element matches
//   every     {path, match, min?=1}                    at least `min` elements, and all of them match
//   order     {path, first, then}                      the first element matching `first` comes before the first matching `then`
//   number    {path, value, tol? | tolPct?}            a number (or numeric string) within the tolerance
//   maxLen    {path, max, min?=1}                      the list has between min and max elements
//   inSet     {path, field, values? | fromFile?, pattern?, min?=1}
//             every non-empty `field` value across the list is in the allowed set; at least `min` values present.
//             `fromFile` (workspace-relative) supplies the set: each match of `pattern` (first group) per line, or each trimmed line.
//   evidence  {path, groups: [{all, file?}], min?=all} cited refs ("file:line" or "file:line-line") hit at least `min` groups;
//             a group is hit when a cited line's text matches all its regexes (and the file path matches `file`)
//   evidencePrecision {path, relevant: [regex], min}  of the cited lines, the share whose text matches a `relevant` regex is >= min
//
// Cited files resolve against the workspace root: the exact relative path, else the one file whose path ends with it.
//
// Key options (block.test.js): `gate: true` on an item makes its failure fail every test (a wrong cause or call earns
// nothing); `"scoring": "sections"` with a `section` on each item scores each section complete (2), one item missed
// (1) or more missed (0), so a report that covers half of each section earns little.

const fs = require('node:fs');
const path = require('node:path');

const MAX_RANGE = 20;
const MAX_REFS = 200;

function readBlock(text) {
  let found = null;
  for (const m of String(text).matchAll(/^```([a-z]*)[ \t]*\n([\s\S]*?)^```[ \t]*$/gim)) {
    if (m[1] && m[1].toLowerCase() !== 'json') continue;
    try {
      const data = JSON.parse(m[2]);
      if (data && typeof data === 'object' && !Array.isArray(data)) found = data;
    } catch { /* not this block */ }
  }
  return found;
}

const get = (obj, p) => (p ? p.split('.') : []).reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const asText = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));
const re = (s) => new RegExp(s, 'i');
const toNum = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v.replace(/[,_%\s]/g, ''))) ? Number(v.replace(/[,_%\s]/g, '')) : NaN);
const toTime = (v) => (typeof v === 'string' ? Date.parse(v) : NaN);

function textOk(text, { all = [], none = [] }) {
  return all.every((r) => re(r).test(text)) && !none.some((r) => re(r).test(text));
}

function matches(el, m) {
  const v = m.field ? get(el, m.field) : el;
  if (!textOk(asText(v), m)) return false;
  if (m.num) {
    const n = toNum(v);
    if (Number.isNaN(n)) return false;
    const { gt, gte, lt, lte } = m.num;
    if ((gt !== undefined && !(n > gt)) || (gte !== undefined && !(n >= gte)) || (lt !== undefined && !(n < lt)) || (lte !== undefined && !(n <= lte))) return false;
  }
  if (m.timeNear || m.timeIn) {
    const t = toTime(m.timeField ? get(el, m.timeField) : m.field ? v : el && el.time);
    if (Number.isNaN(t)) return false;
    if (m.timeNear && Math.abs(t - Date.parse(m.timeNear.time)) > m.timeNear.tolMin * 60000) return false;
    if (m.timeIn && !(t >= Date.parse(m.timeIn[0]) && t <= Date.parse(m.timeIn[1]))) return false;
  }
  return true;
}

function listFiles(root) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(root, p).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out;
}

// Each cited ref becomes { file, line, text }; refs that do not resolve to a real line are dropped.
function resolveRefs(root, refs) {
  let files = null;
  const cache = new Map();
  const lines = (rel) => {
    if (!cache.has(rel)) cache.set(rel, fs.readFileSync(path.join(root, rel), 'utf8').split('\n'));
    return cache.get(rel);
  };
  const out = [];
  for (const ref of asList(refs).slice(0, MAX_REFS)) {
    const s = typeof ref === 'string' ? ref : ref && ref.file ? `${ref.file}:${ref.line}` : '';
    const m = /^\s*\.?\/?(.+?):(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(s);
    if (!m) continue;
    const want = m[1].replace(/\\/g, '/');
    let rel = null;
    if (!want.includes('..') && fs.existsSync(path.join(root, want)) && fs.statSync(path.join(root, want)).isFile()) rel = want;
    else {
      files = files || listFiles(root);
      const hits = files.filter((f) => f === want || f.endsWith(`/${want}`));
      if (hits.length === 1) rel = hits[0];
    }
    if (!rel) continue;
    const from = Number(m[2]);
    const to = Math.min(m[3] ? Number(m[3]) : from, from + MAX_RANGE - 1);
    for (let n = from; n <= to; n++) {
      const text = lines(rel)[n - 1];
      if (text !== undefined) out.push({ file: rel, line: n, text });
    }
  }
  return out;
}

function allowedSet(root, item) {
  if (item.values) return new Set(item.values);
  const text = fs.readFileSync(path.join(root, item.fromFile), 'utf8');
  const set = new Set();
  for (const line of text.split('\n')) {
    if (item.pattern) {
      const m = re(item.pattern).exec(line);
      if (m) set.add(m[1] ?? m[0]);
    } else if (line.trim()) set.add(line.trim());
  }
  return set;
}

// One item against the block: { pass, detail }.
function checkItem(block, item, root) {
  if (!block) return { pass: false, detail: 'no JSON block' };
  const v = get(block, item.path);
  const list = asList(v);
  switch (item.type) {
    case 'text': return { pass: v !== undefined && textOk(asText(v), item), detail: asText(v).slice(0, 160) };
    case 'some': {
      const n = list.filter((el) => matches(el, item.match)).length;
      return { pass: n >= (item.min ?? 1), detail: `${n} matching of ${list.length}` };
    }
    case 'none': {
      const bad = list.filter((el) => matches(el, item.match));
      return { pass: bad.length === 0, detail: bad.length ? asText(bad[0]).slice(0, 160) : 'none' };
    }
    case 'every': {
      const bad = list.filter((el) => !matches(el, item.match));
      return { pass: list.length >= (item.min ?? 1) && bad.length === 0, detail: `${list.length} items, ${bad.length} not matching` };
    }
    case 'order': {
      const a = list.findIndex((el) => matches(el, item.first));
      const b = list.findIndex((el) => matches(el, item.then));
      return { pass: a >= 0 && b >= 0 && a < b, detail: `first at ${a}, then at ${b}` };
    }
    case 'number': {
      const n = toNum(v);
      const tol = item.tolPct !== undefined ? Math.abs(item.value) * item.tolPct / 100 : item.tol ?? 0;
      return { pass: !Number.isNaN(n) && Math.abs(n - item.value) <= tol, detail: `got ${asText(v)}, want ${item.value} +/- ${tol}` };
    }
    case 'maxLen': return { pass: list.length >= (item.min ?? 1) && list.length <= item.max, detail: `${list.length} items` };
    case 'inSet': {
      const set = allowedSet(root, item);
      const vals = list.map((el) => get(el, item.field)).filter((x) => x !== undefined && x !== null && x !== '');
      const bad = vals.filter((x) => !set.has(String(x)));
      return { pass: vals.length >= (item.min ?? 1) && bad.length === 0, detail: bad.length ? `unknown: ${bad.slice(0, 5).join(', ')}` : `${vals.length} values` };
    }
    case 'evidence': {
      const cited = resolveRefs(root, v);
      const hit = item.groups.filter((g) => cited.some((c) => (!g.file || re(g.file).test(c.file)) && textOk(c.text, g))).length;
      return { pass: hit >= (item.min ?? item.groups.length), detail: `${hit} of ${item.groups.length} groups, ${cited.length} lines cited` };
    }
    case 'evidencePrecision': {
      const cited = resolveRefs(root, v);
      const good = cited.filter((c) => item.relevant.some((r) => re(r).test(c.text))).length;
      return { pass: cited.length > 0 && good / cited.length >= item.min, detail: `${good} of ${cited.length} cited lines relevant` };
    }
    default: return { pass: false, detail: `unknown item type ${item.type}` };
  }
}

function gradeBlock(text, items, root, { scoring } = {}) {
  const block = readBlock(text);
  const results = items.map((it) => ({ id: it.id, weight: it.weight ?? 1, ...checkItem(block, it, root) }));
  const gated = items.some((it, i) => it.gate && !results[i].pass);
  if (scoring === 'sections') {
    const sections = sectionResults(block, items, root);
    const earned = gated ? 0 : sections.reduce((n, s) => n + (s.missed.length === 0 ? 2 : s.missed.length === 1 ? 1 : 0), 0);
    return { found: Boolean(block), score: sections.length ? earned / (2 * sections.length) : 0, results, sections, gated };
  }
  const total = results.reduce((n, r) => n + r.weight, 0);
  const passed = gated ? 0 : results.reduce((n, r) => n + (r.pass ? r.weight : 0), 0);
  return { found: Boolean(block), score: total ? passed / total : 0, results, gated };
}

/** [{ section, missed: [item ids] }] in first-seen order; an item with no `section` is its own section. */
function sectionResults(block, items, root) {
  const by = new Map();
  for (const it of items) {
    const s = it.section || it.id;
    if (!by.has(s)) by.set(s, { section: s, missed: [] });
    if (!checkItem(block, it, root).pass) by.get(s).missed.push(it.id);
  }
  return [...by.values()];
}

module.exports = { readBlock, checkItem, gradeBlock, sectionResults, resolveRefs };
