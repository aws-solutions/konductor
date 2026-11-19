// SPDX-License-Identifier: Apache-2.0
'use strict';

// Grades a planning or status document against a T7 key, with no model in the loop.
// The agent's document holds one fenced JSON block whose info string is the key's `block` (for example ```status).
// The key lists assertions; each one is graded on its own, so a hidden test file can turn each into one test and the
// pass share is the score. Assertion ops:
//   cites      some element of the list at `path` names at least `min` (default 1) of `ids` in `field` (or anywhere in it);
//              with `where: {field: value}` that element must also have those values (strings ignore case), so a
//              risk's kind or owner is checked on the risk that names the ticket, wherever it sits in the list
//   absent     no element of the list at `path` names any of `ids` (a decoy: a ticket that looks risky and is not)
//   includes   the list at `path` holds every one of `ids` (`any: true`: at least one)
//   excludes   the list at `path` holds none of `ids`
//   order      `ids` appear in the list at `path` in this order (other items may sit between them)
//   date       the value at `path` is an ISO date within `tolDays` (default 0) of `value`
//   number     the value at `path` is within `tol` (absolute, default 0) or `tolPct` percent of `value`
//   equals     the value at `path` equals `value` (strings ignore case and outer spaces); `oneOf` takes a list
//   precision  of the elements of the list at `path`, at least `min` (a share, default 0.5) name one of `ids`,
//              and there are at most `maxCount` of them (so a long list does not win)
// A `path` that holds an object is read as the list of its values. Paths are dot-separated keys; a key matches an object key ignoring case, and a number indexes a list.
// Ids match on a token edge, ignoring case: "PAY-21" does not match "PAY-212".

const fs = require('node:fs');
const path = require('node:path');

const norm = (s) => String(s ?? '').toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The first fenced block with info string `name` (case-insensitive) whose body parses as JSON, else null. */
function readBlock(text, name) {
  const want = norm(name);
  for (const m of String(text).matchAll(/^[ \t]*```[ \t]*([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm)) {
    if (norm(m[1]) !== want) continue;
    try { return JSON.parse(m[2]); } catch { /* try the next block */ }
  }
  return null;
}

/** The value at a dot path; object keys match ignoring case and surrounding spaces. */
function getPath(obj, dotPath) {
  if (dotPath === undefined || dotPath === '') return obj;
  let cur = obj;
  for (const part of String(dotPath).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(part)) { cur = cur[Number(part)]; continue; }
    if (typeof cur !== 'object') return undefined;
    const key = Object.keys(cur).find((k) => norm(k).trim() === norm(part).trim());
    cur = key === undefined ? undefined : cur[key];
  }
  return cur;
}

const textOf = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const names = (v, id) => new RegExp(`(?<![a-z0-9])${escapeRe(norm(id))}(?![a-z0-9])`).test(norm(textOf(v)));
const elementText = (el, field) => (field && el && typeof el === 'object' && !Array.isArray(el) ? getPath(el, field) : el);
// A list, or the values of an object (a plan keyed by sprint is a list of sprints).
const list = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
const hitsIn = (el, field, ids) => ids.filter((id) => names(elementText(el, field), id));
const toDay = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '').trim());
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : null;
};
const same = (got, want) => (typeof want === 'string' ? norm(got).trim() === norm(want).trim() : got === want);
const toNum = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

const OPS = {
  cites(doc, a) {
    const els = list(getPath(doc, a.path));
    const fits = (el) => Object.entries(a.where || {}).every(([f, v]) => same(getPath(el, f), v));
    const ok = els.some((el) => hitsIn(el, a.field, a.ids).length >= (a.min ?? 1) && fits(el));
    const what = a.where ? ` with ${JSON.stringify(a.where)}` : '';
    return { ok, detail: ok ? 'cited' : `no element of ${a.path} names ${a.ids.join(', ')}${what}` };
  },
  absent(doc, a) {
    const bad = list(getPath(doc, a.path)).filter((el) => hitsIn(el, a.field, a.ids).length > 0);
    return { ok: bad.length === 0, detail: bad.length ? `${a.path} names decoy ${a.ids.join(', ')}` : 'decoy not named' };
  },
  includes(doc, a) {
    const els = list(getPath(doc, a.path));
    const found = a.ids.filter((id) => els.some((el) => names(el, id)));
    const ok = a.any ? found.length > 0 : found.length === a.ids.length;
    return { ok, detail: `${found.length} of ${a.ids.length} present` };
  },
  excludes(doc, a) {
    const els = list(getPath(doc, a.path));
    const found = a.ids.filter((id) => els.some((el) => names(el, id)));
    return { ok: found.length === 0, detail: found.length ? `holds ${found.join(', ')}` : 'none present' };
  },
  order(doc, a) {
    const els = list(getPath(doc, a.path));
    const at = a.ids.map((id) => els.findIndex((el) => names(el, id)));
    const ok = at.every((i) => i >= 0) && at.every((i, k) => k === 0 || i > at[k - 1]);
    return { ok, detail: `positions ${at.join(', ')}` };
  },
  date(doc, a) {
    const got = toDay(getPath(doc, a.path));
    const want = toDay(a.value);
    if (want === null) throw new Error(`key date ${a.value} is not an ISO date`);
    const ok = got !== null && Math.abs(got - want) <= (a.tolDays ?? 0);
    return { ok, detail: got === null ? `${a.path} is not an ISO date` : `off by ${got - want} day(s)` };
  },
  number(doc, a) {
    const got = toNum(getPath(doc, a.path));
    const tol = Math.max(a.tol ?? 0, a.tolPct ? (Math.abs(a.value) * a.tolPct) / 100 : 0);
    const ok = got !== null && Math.abs(got - a.value) <= tol + 1e-9;
    return { ok, detail: got === null ? `${a.path} is not a number` : `got ${got}, want ${a.value} +/- ${tol}` };
  },
  equals(doc, a) {
    const got = getPath(doc, a.path);
    const wants = a.oneOf ?? [a.value];
    return { ok: wants.some((w) => same(got, w)), detail: `got ${textOf(got)}` };
  },
  precision(doc, a) {
    const els = list(getPath(doc, a.path));
    const good = els.filter((el) => hitsIn(el, a.field, a.ids).length > 0).length;
    const share = els.length ? good / els.length : 0;
    const ok = els.length > 0 && share >= (a.min ?? 0.5) && (a.maxCount === undefined || els.length <= a.maxCount);
    return { ok, detail: `${good} of ${els.length} name a key id${a.maxCount !== undefined ? `, at most ${a.maxCount} allowed` : ''}` };
  },
};

/** Grades one assertion against the parsed block (or null). Never throws for agent mistakes; throws for a bad key. */
function gradeAssertion(doc, a) {
  const op = OPS[a.op];
  if (!op) throw new Error(`unknown op ${a.op} in assertion ${a.id}`);
  if (doc === null || doc === undefined) return { id: a.id, ok: false, detail: 'no block' };
  return { id: a.id, ...op(doc, a) };
}

/** Reads the key's output file from `root` and grades every assertion. */
function gradeFile(root, key) {
  let text = null;
  try { text = fs.readFileSync(path.join(root, key.output), 'utf8'); } catch { /* missing output */ }
  const doc = text === null ? null : readBlock(text, key.block);
  const results = key.assertions.map((a) => gradeAssertion(doc, a));
  return { found: text !== null, parsed: doc !== null, results, score: results.length ? results.filter((r) => r.ok).length / results.length : 0 };
}

module.exports = { readBlock, getPath, gradeAssertion, gradeFile, OPS };
