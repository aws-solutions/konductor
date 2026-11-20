#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Mechanical lazy and alternative answers, made from a task's reference with no model call (plan 4.6 gates: the
// lazy answer scores 40 or less, the alternative 80 or more).
//   lazy  keeps the reference's shape and drops half its substance: half of each list (the first, obvious half), the
//         decoys the batch names added to id lists, numbers at 0.7x, dates 21 days early, half of each section's
//         paragraphs, half of the rows of a table file, half of the code files.
//   alt   changes what a correct answer may change: list order (except lists whose key says order matters), the
//         answer's own item ids (and the lists that refer to them), free-text wording, key order, section order and
//         row order. Code files are copied unchanged, so a task whose reference is only code gets no alternative.
// Fenced JSON blocks (```json, or a tag the batch names) inside Markdown, whole .json files and .csv files are
// transformed; other text files keep their headings and lose half their paragraphs (lazy) or have their sections
// reordered (alt).
//   node bench/scenarios/lib/answers.js --config bench/scenarios/tN/scenario.config.js lazy|alt [id ...]
// writes answers/<id>/<kind>/ (the batch's answerDir); prints one line per task.
// shortcut: one scripted shallow reading and one scripted rewrite for every task, not each brief's own; a batch that
// needs a different shallow answer to test its key writes it by hand into answerDir.

const fs = require('node:fs');
const path = require('node:path');
const { listTree } = require('./workspace.js');
const { loadConfig } = require('./config.js');

const DEFAULTS = {
  idPattern: /^[A-Z][A-Z0-9]{0,9}-\d{1,5}$/,
  orderedKeys: /path|order|chain|sequence|milestones|steps|timeline/i,
  freeTextKeys: /^(summary|why|mitigation|text|about|problem|title|reason|reasons|note|notes|rationale|description|finding|issue)$/i,
  ownIdKeys: /^id$/i,
  blockTags: ['json'],
  factor: 0.7,
  dateShiftDays: -21,
  codeExt: /\.(c?js|mjs|ts|tsx|jsx|py|go|rs|java|rb|sh|tf|ya?ml|toml|sql)$/i,
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const half = (n) => Math.ceil(n / 2);

const shiftDate = (s, days) => new Date(Date.parse(`${s}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** The shallow fake of a parsed JSON value (pure). `decoys` are added to lists of ids. */
function shallow(value, o, decoys = o.decoys || []) {
  if (Array.isArray(value)) {
    if (value.length && value.every((v) => typeof v === 'string' && o.idPattern.test(v))) {
      const kept = value.slice(0, half(value.length));
      return [...kept, ...decoys.filter((d) => !kept.includes(d))];
    }
    // Any other list (paths, names, numbers, objects): only the obvious first half, each item shallow too.
    return value.slice(0, half(value.length)).map((v) => shallow(v, o, []));
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shallow(v, o, decoys)]));
  if (typeof value === 'number') return Number.isInteger(value) ? Math.round(value * o.factor) : Math.round(value * o.factor * 100) / 100;
  if (typeof value === 'string' && DATE.test(value)) return shiftDate(value, o.dateShiftDays);
  return value;
}

/** A variant of a parsed JSON value (pure). `ids` collects renamed own ids so lists that refer to them can follow. */
function vary(value, o, key = '', ids = new Map()) {
  if (Array.isArray(value)) {
    const items = value.map((v) => vary(v, o, key, ids));
    return o.orderedKeys.test(key) ? items : items.reverse();
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).reverse()) {
      if (o.ownIdKeys.test(k) && typeof v === 'string' && !o.idPattern.test(v)) {
        if (!ids.has(v)) ids.set(v, `item-${ids.size + 1}`);
        out[k] = ids.get(v);
      } else if (o.freeTextKeys.test(k) && typeof v === 'string') out[k] = `In short: ${v}`;
      else out[k] = vary(v, o, k, ids);
    }
    return out;
  }
  return value;
}

/** Lists and fields that name a renamed own id follow the renaming. */
function follow(value, ids) {
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' && ids.has(v) ? ids.get(v) : follow(v, ids)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === 'string' && ids.has(v) && !/^id$/i.test(k) ? ids.get(v) : follow(v, ids)]));
  return value;
}

const transform = (kind, data, o) => {
  if (kind === 'lazy') return shallow(data, o);
  const ids = new Map();
  return follow(vary(data, o, '', ids), ids);
};

// Numbers in prose: each figure of two or more digits taken at 0.7x. Parts of dates, times, paths, line references
// and versions (a figure next to `-`, `:`, `/`, `.` or a letter) are left alone.
const skewProse = (text, o) => text.replace(/(?<![\w.:/#-])\d{2,}(?:,\d{3})*(?:\.\d+)?(?![\w:/-]|\.\d)/g, (m) => {
  const n = Number(m.replace(/,/g, ''));
  return Number.isFinite(n) ? String(Math.round(n * o.factor)) : m;
});

// Markdown split into a preamble and `## ` sections; each part a list of blocks separated by blank lines.
function sections(text) {
  const parts = text.split(/^(?=## )/m);
  return parts.map((p) => p.split(/\n{2,}/).filter((b) => b.trim()));
}

const FENCE = /^[ \t]*```[ \t]*([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;

/** A Markdown or text answer, transformed. Returns { text, how }. */
function textAnswer(kind, text, o) {
  let blocks = 0;
  const withBlocks = text.replace(FENCE, (all, tag, body) => {
    if (tag && !o.blockTags.includes(tag.toLowerCase())) return all;
    let data;
    try { data = JSON.parse(body); } catch { return all; }
    blocks++;
    return all.replace(body, `${JSON.stringify(transform(kind, data, o), null, 1)}\n`);
  });
  const isBlock = (b) => /^[ \t]*```/.test(b);
  const isHeading = (b) => /^#/.test(b.trim());
  const secs = sections(withBlocks);
  let out;
  if (kind === 'lazy') {
    out = secs.map((blocks_) => {
      const prose = blocks_.filter((b) => !isHeading(b) && !isBlock(b));
      const keep = new Set(prose.slice(0, half(prose.length)));
      return blocks_.filter((b) => isHeading(b) || isBlock(b) || keep.has(b)).map((b) => (isBlock(b) || isHeading(b) ? b : skewProse(b, o))).join('\n\n');
    });
  } else {
    const [head, ...rest] = secs;
    out = [head, ...rest.reverse()].map((b) => b.join('\n\n'));
  }
  const joined = out.map((s) => s.replace(/\n*$/, '')).join('\n\n');
  return { text: `${joined}\n`, how: blocks ? `${blocks} block(s) and prose` : 'prose' };
}

// A table answer. lazy: the first half of the rows, numbers at 0.7x. alt: unchanged, since a table's columns and row
// order are usually set by the request (a fixed header, rows in time order).
function csvAnswer(kind, text, o) {
  if (kind === 'alt') return text;
  const lines = text.replace(/\n$/, '').split('\n');
  const [header, ...rows] = lines;
  const cells = (r) => r.split(',');
  const body = rows.slice(0, half(rows.length)).map((r) => cells(r).map((c) => (/^-?\d+(\.\d+)?$/.test(c.trim()) ? String(shallow(Number(c), o)) : c)).join(','));
  return `${[header, ...body].join('\n')}\n`;
}

// JSON written in the reference's layout: one line when the reference is one line, else its indent.
function jsonLike(src, data) {
  const body = src.trim();
  if (!body.includes('\n')) return `${JSON.stringify(data)}\n`;
  const indent = (/\n([ \t]+)\S/.exec(body) || [, '  '])[1];
  return `${JSON.stringify(data, null, indent)}\n`;
}

/**
 * Writes the `kind` (lazy or alt) answer made from the overlay `solutionDir` into `outDir`.
 * Returns { written, files: { rel: how } }; an alternative that would equal the reference is not written.
 */
function writeAnswer(kind, solutionDir, outDir, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const files = {};
  const outputs = [];
  const all = listTree(solutionDir).filter((r) => r !== 'ASKS.json').sort();
  const code = all.filter((r) => o.codeExt.test(r) && r !== 'DELETE.txt');
  const keptCode = new Set(code.slice(0, Math.floor(code.length / 2)));
  for (const rel of all) {
    const src = fs.readFileSync(path.join(solutionDir, rel), 'utf8');
    let text = src;
    let how;
    if (rel === 'DELETE.txt') how = 'kept';
    else if (code.includes(rel)) {
      if (kind === 'lazy' && !keptCode.has(rel)) { files[rel] = 'dropped'; continue; }
      how = kind === 'lazy' ? 'kept' : 'unchanged';
    } else if (/\.json$/i.test(rel)) {
      try { text = jsonLike(src, transform(kind, JSON.parse(src), o)); how = 'json'; } catch { how = 'unchanged'; }
    } else if (/\.csv$/i.test(rel)) { text = csvAnswer(kind, src, o); how = 'csv'; } else ({ text, how } = textAnswer(kind, src, o));
    if (text === src && how !== 'kept') how = 'unchanged';
    files[rel] = how;
    outputs.push([rel, text]);
  }
  const changed = Object.values(files).some((h) => h !== 'unchanged' && h !== 'kept');
  const written = kind === 'lazy' ? Object.values(files).some((h) => h !== 'unchanged') : changed;
  fs.rmSync(outDir, { recursive: true, force: true });
  if (written) {
    for (const [rel, text] of outputs) {
      fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(outDir, rel), text);
    }
    // A dropped file stays as the fixture has it: the overlay simply omits it.
  }
  return { written, files };
}

// The free shallow answer of a code task: the reference's docs, changelog, config and test files, with none of its code
// changes. It shows how much of the score a run gets from keyword and file checks without doing the work (gate: 40 or
// less). A path is code when it has a code extension and is not a test file.
const isCode = (rel) => /\.(c?m?js|ts|py)$/.test(rel) && !/(^|\/)(tests?|__tests__)\/|(^|\/)test_[^/]*\.py$|\.test\.(c?m?js|ts)$/.test(rel);

/** A dry-run overlay (a function of the workspace) that lays the shallow answer of `solutionDir` over it. */
const shallowOverlay = (solutionDir) => (ws) => {
  for (const rel of listTree(solutionDir)) {
    if (rel === 'DELETE.txt' || rel === 'ASKS.json' || isCode(rel)) continue;
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
    fs.copyFileSync(path.join(solutionDir, rel), path.join(ws, rel));
  }
};

/** Writes the answer of `kind` for task `id` of the batch `cfg`. */
function writeTaskAnswer(cfg, kind, id) {
  const task = cfg.readTask(id);
  const opts = { ...(cfg.answers || {}) };
  if (typeof opts.decoys === 'function') opts.decoys = opts.decoys(task, cfg);
  return writeAnswer(kind, cfg.solutionDir(id), cfg.answerDir(id, kind), opts);
}

function main(argv) {
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
  const rest = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--config');
  const [kind, ...ids] = rest;
  if (!at('--config') || !['lazy', 'alt'].includes(kind)) { console.error('usage: answers.js --config FILE lazy|alt [id ...]'); return 2; }
  const cfg = loadConfig(path.resolve(at('--config')));
  for (const id of ids.length ? ids : cfg.ids()) {
    const r = writeTaskAnswer(cfg, kind, id);
    console.log(`${r.written ? 'wrote' : 'none '} ${id} ${kind}: ${Object.entries(r.files).map(([f, h]) => `${f} ${h}`).join(', ')}`);
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { shallow, vary, follow, textAnswer, csvAnswer, writeAnswer, writeTaskAnswer, isCode, shallowOverlay, DEFAULTS, main };
