// SPDX-License-Identifier: Apache-2.0
'use strict';

// The diff of the refactor regression net: two study output trees (study.js, one per bench commit) side by side.
// Before comparing, each value is normalised: the study root becomes <ROOT>, a run's scratch dir <SCRATCH>, times
// <TIME>, uuids <UUID>; keys that change on every run (times, durations, pids) are dropped, and so are the fields the
// refactors added on purpose (schemaVersion and the plugin hash list). What is left differing is a finding.

const fs = require('node:fs');
const path = require('node:path');

// Keys whose value changes on every run.
const VOLATILE_KEY = /(At|Ms|Sec|Seconds|Time|Timestamp)$|^(at|pid|pgid|elapsed|duration|uptime|hostname)$/;
// Fields the refactors added on purpose (FW-7 plugin hashes, FW-8 schemaVersion); not a regression.
const ADDED_KEYS = new Set(['schemaVersion', 'plugins']);
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const CLOCK = /\b\d{2}:\d{2}:\d{2}\b/g;
const SCRATCH = /\/tmp\/(w|r|bench-judge|kplant|b-cache)-[A-Za-z0-9_]+/g;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `s` with each root replaced by <ROOT> (longest first) and the run-to-run parts of a string replaced. */
function normString(s, roots) {
  let out = s;
  for (const r of [...roots].sort((a, b) => b.length - a.length)) out = out.replace(new RegExp(escape(r), 'g'), '<ROOT>');
  return out.replace(SCRATCH, '<SCRATCH>').replace(ISO_TIME, '<TIME>').replace(CLOCK, '<CLOCK>').replace(UUID, '<UUID>');
}

/**
 * A normalised deep copy of `v`: strings through normString, volatile and added keys dropped, object keys sorted.
 * @param {*} v a parsed JSON value
 * @param {{roots?: string[]}} [o] absolute paths that become <ROOT>
 */
function normalize(v, { roots = [] } = {}) {
  if (typeof v === 'string') return normString(v, roots);
  if (Array.isArray(v)) return v.map((x) => normalize(x, { roots }));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (VOLATILE_KEY.test(k) || ADDED_KEYS.has(k)) continue;
      out[k] = normalize(v[k], { roots });
    }
    return out;
  }
  return v;
}

/** [{path, base, head}] for every leaf that differs between two normalised values, sorted by path. */
function diffJson(base, head, at = '') {
  const isObj = (x) => x && typeof x === 'object';
  if (!isObj(base) || !isObj(head) || Array.isArray(base) !== Array.isArray(head)) {
    return JSON.stringify(base) === JSON.stringify(head) ? [] : [{ path: at || '.', base, head }];
  }
  const keys = Array.isArray(base) ? [...Array(Math.max(base.length, head.length)).keys()] : [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
  const sub = (k) => (Array.isArray(base) ? `${at}[${k}]` : at ? `${at}.${k}` : String(k));
  return keys.flatMap((k) => (base[k] === undefined || head[k] === undefined
    ? (base[k] === head[k] ? [] : [{ path: sub(k), base: base[k], head: head[k] }])
    : diffJson(base[k], head[k], sub(k))));
}

/** The lines only in one text, after normalising each side with its own roots (a multiset difference, order ignored). */
function diffText(base, head, { baseRoots = [], headRoots = [] } = {}) {
  const lines = (t, roots) => t.split('\n').map((l) => normString(l, roots)).filter((l) => l.trim());
  const a = lines(base, baseRoots);
  const b = lines(head, headRoots);
  const minus = (x, y) => {
    const left = new Map();
    for (const l of y) left.set(l, (left.get(l) ?? 0) + 1);
    return x.filter((l) => { const n = left.get(l) ?? 0; if (n) { left.set(l, n - 1); return false; } return true; });
  };
  return { onlyBase: minus(a, b), onlyHead: minus(b, a) };
}

/** Relative paths of the files under `dir`, sorted. */
function filesOf(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk('');
  return out.sort();
}

/**
 * Two study trees side by side. Returns { onlyBase, onlyHead, changed: [{file, json?: diffs, text?: {onlyBase, onlyHead}}],
 * same }. A `.json` file is compared as normalised JSON, a `.jsonl` file line by line as JSON, anything else as text.
 */
function diffTrees(baseDir, headDir, { baseRoots = [baseDir], headRoots = [headDir] } = {}) {
  const a = filesOf(baseDir);
  const b = filesOf(headDir);
  const inB = new Set(b);
  const out = { onlyBase: a.filter((f) => !inB.has(f)), onlyHead: b.filter((f) => !a.includes(f)), changed: [], same: 0 };
  for (const f of a.filter((x) => inB.has(x))) {
    const ta = fs.readFileSync(path.join(baseDir, f), 'utf8');
    const tb = fs.readFileSync(path.join(headDir, f), 'utf8');
    let entry = null;
    if (f.endsWith('.json') || f.endsWith('.jsonl')) {
      const parse = (t) => (f.endsWith('.json') ? JSON.parse(t) : t.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)));
      try {
        const d = diffJson(normalize(parse(ta), { roots: baseRoots }), normalize(parse(tb), { roots: headRoots }));
        if (d.length) entry = { file: f, json: d };
      } catch (e) {
        entry = { file: f, error: `not JSON: ${e.message}` };
      }
    } else {
      const d = diffText(ta, tb, { baseRoots, headRoots });
      if (d.onlyBase.length || d.onlyHead.length) entry = { file: f, text: d };
    }
    if (entry) out.changed.push(entry);
    else out.same++;
  }
  return out;
}

module.exports = { normalize, normString, diffJson, diffText, diffTrees, filesOf, VOLATILE_KEY, ADDED_KEYS };
