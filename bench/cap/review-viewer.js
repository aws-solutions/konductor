// SPDX-License-Identifier: Apache-2.0
'use strict';

// The static review page for `cap review`. One HTML file with the data, CSS and script inline; a Content-Security-Policy
// allows only the page's own script and style by hash, so it loads nothing and connects nowhere. Ratings are kept in the
// browser's localStorage and exported as a downloaded JSON file.
//
// The functions above viewerMain run in the browser as written (their source is copied into the page) and are also
// exported here so the tests can check them without a browser. They must stay free of Node-only code.

const crypto = require('node:crypto');
const { esc } = require('../report/charts.js');

const VERDICTS = ['pass', 'partial', 'fail'];
const RATINGS_KIND = 'bench-review-ratings';
const RATINGS_SCHEMA = 1;

/** A blank rating for every output of every group. */
function emptyState(data) {
  const items = {};
  for (const g of data.groups) {
    for (const o of g.outputs) {
      const labels = {};
      for (const c of g.task.rubric) labels[c.id] = null;
      items[o.itemId] = { labels, evidence: {}, notes: '' };
    }
  }
  return { rater: '', items };
}

/** Copies labels, evidence and notes from a loaded ratings file into state. Throws when the file is for another page. */
function mergeRatings(data, state, loaded) {
  if (!loaded || loaded.kind !== 'bench-review-ratings') throw new Error('not a ratings file from this viewer');
  if (loaded.viewerId !== data.viewerId) throw new Error(`ratings are for viewer ${loaded.viewerId}, this page is ${data.viewerId}`);
  let applied = 0;
  let skipped = 0;
  if (typeof loaded.rater === 'string') state.rater = loaded.rater;
  for (const it of Array.isArray(loaded.items) ? loaded.items : []) {
    const cur = state.items[it && it.itemId];
    if (!cur) { skipped++; continue; }
    for (const [cid, v] of Object.entries(it.labels || {})) {
      if (cid in cur.labels && (v === null || ['pass', 'partial', 'fail'].includes(v))) cur.labels[cid] = v;
    }
    for (const [cid, q] of Object.entries(it.evidence || {})) {
      if (cid in cur.labels && typeof q === 'string') cur.evidence[cid] = q;
    }
    if (typeof it.notes === 'string') cur.notes = it.notes;
    applied++;
  }
  return { applied, skipped };
}

/** The file the Download button saves. Empty evidence strings are left out. */
function ratingsPayload(data, state, exportedAt) {
  const items = [];
  for (const g of data.groups) {
    for (const o of g.outputs) {
      const cur = state.items[o.itemId];
      const evidence = {};
      for (const [cid, q] of Object.entries(cur.evidence)) if (q && q.trim()) evidence[cid] = q;
      items.push({ itemId: o.itemId, labels: { ...cur.labels }, evidence, notes: cur.notes });
    }
  }
  return { schemaVersion: 1, kind: 'bench-review-ratings', viewerId: data.viewerId, rater: state.rater, exportedAt, items };
}

/** Outputs with every criterion labeled, out of all outputs. */
function progress(data, state) {
  let done = 0;
  let total = 0;
  for (const g of data.groups) {
    for (const o of g.outputs) {
      total++;
      if (Object.values(state.items[o.itemId].labels).every((v) => v !== null)) done++;
    }
  }
  return { done, total };
}

// Wires the page. Every piece of run content goes in through textContent, never as markup.
function viewerMain(data, doc, win) {
  const storeKey = `bench-review:${data.viewerId}`;
  let state = emptyState(data);
  let at = 0;
  let dirty = false;
  try {
    const saved = win.localStorage.getItem(storeKey);
    if (saved) mergeRatings(data, state, JSON.parse(saved));
  } catch (e) { /* no storage under this browser's file:// rules, or a stale entry: start blank */ }

  const el = (tag, attrs, kids) => {
    const n = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else n.setAttribute(k, v);
    }
    for (const k of kids || []) if (k) n.appendChild(k);
    return n;
  };
  const save = () => {
    dirty = true;
    try { win.localStorage.setItem(storeKey, JSON.stringify(ratingsPayload(data, state, null))); } catch (e) { /* storage unavailable */ }
    status();
  };
  const statusEl = doc.getElementById('status');
  const status = (msg) => {
    const p = progress(data, state);
    statusEl.textContent = `${p.done} of ${p.total} outputs fully rated${dirty ? ', changes not yet downloaded' : ''}${msg ? `. ${msg}` : ''}`;
  };

  function criterionRow(g, o, c) {
    const cur = state.items[o.itemId];
    const name = `${o.itemId}:${c.id}`;
    const choices = ['pass', 'partial', 'fail'].map((v) => {
      const input = el('input', { type: 'radio', name, value: v, id: `${name}:${v}` });
      input.checked = cur.labels[c.id] === v;
      input.addEventListener('change', () => { cur.labels[c.id] = v; save(); });
      return el('label', { class: `choice ${v}`, for: `${name}:${v}` }, [input, el('span', { text: v })]);
    });
    const clear = el('button', { type: 'button', class: 'clear', text: 'clear' });
    clear.addEventListener('click', () => { cur.labels[c.id] = null; for (const ch of choices) ch.firstChild.checked = false; save(); });
    const quote = el('input', { type: 'text', class: 'quote', placeholder: 'evidence quote (optional)' });
    quote.value = cur.evidence[c.id] || '';
    quote.addEventListener('input', () => { cur.evidence[c.id] = quote.value; save(); });
    return el('div', { class: 'crit' }, [el('div', { class: 'cid', text: c.id }), el('div', { class: 'choices' }, [...choices, clear]), quote]);
  }

  function render() {
    const root = doc.getElementById('group');
    root.textContent = '';
    const g = data.groups[at];
    doc.getElementById('where').textContent = `Task ${at + 1} of ${data.groups.length}`;
    root.appendChild(el('h2', { text: `Task ${at + 1}` }));
    root.appendChild(el('h3', { text: 'Task given to the agent' }));
    root.appendChild(el('pre', { class: 'prompt', text: g.task.prompt }));
    const rub = el('ul', { class: 'rubric' });
    for (const c of g.task.rubric) rub.appendChild(el('li', {}, [el('b', { text: c.id }), el('span', { text: ` (weight ${c.weight}): ${c.criterion}` })]));
    root.appendChild(el('h3', { text: 'Rubric' }));
    root.appendChild(rub);
    root.appendChild(el('details', {}, [el('summary', { text: 'Answer key' }), el('pre', { text: g.task.answerKey == null ? '(none)' : g.task.answerKey })]));
    const cols = el('div', { class: `cols n${Math.min(g.outputs.length, 4)}` });
    for (const o of g.outputs) {
      const cur = state.items[o.itemId];
      const notes = el('textarea', { class: 'notes', rows: '2', placeholder: 'notes (optional)' });
      notes.value = cur.notes;
      notes.addEventListener('input', () => { cur.notes = notes.value; save(); });
      cols.appendChild(el('section', { class: 'out' }, [
        el('h3', { text: `Output ${o.label}` }),
        el('div', { class: 'crits' }, g.task.rubric.map((c) => criterionRow(g, o, c))),
        notes,
        el('pre', { class: 'bundle', text: o.bundle }),
      ]));
    }
    root.appendChild(cols);
    status();
    win.scrollTo(0, 0);
  }

  const go = (i) => { at = Math.max(0, Math.min(data.groups.length - 1, i)); render(); };
  const rater = doc.getElementById('rater');
  rater.value = state.rater;
  rater.addEventListener('input', () => { state.rater = rater.value; save(); });
  doc.getElementById('prev').addEventListener('click', () => go(at - 1));
  doc.getElementById('next').addEventListener('click', () => go(at + 1));
  doc.getElementById('unrated').addEventListener('click', () => {
    const i = data.groups.findIndex((g) => g.outputs.some((o) => Object.values(state.items[o.itemId].labels).some((v) => v === null)));
    if (i >= 0) go(i); else status('every output is rated');
  });
  doc.getElementById('download').addEventListener('click', () => {
    const body = JSON.stringify(ratingsPayload(data, state, new Date().toISOString()), null, 2);
    const url = win.URL.createObjectURL(new win.Blob([body], { type: 'application/json' }));
    const a = el('a', { href: url, download: `ratings-${data.viewerId}.json` });
    doc.body.appendChild(a);
    a.click();
    a.remove();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
    dirty = false;
    status('downloaded');
  });
  doc.getElementById('load').addEventListener('change', (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new win.FileReader();
    reader.onload = () => {
      try {
        const next = emptyState(data);
        const r = mergeRatings(data, next, JSON.parse(String(reader.result)));
        state = next;
        rater.value = state.rater;
        save();
        render();
        status(`loaded ${r.applied} output(s)${r.skipped ? `, ${r.skipped} not on this page` : ''}`);
      } catch (e) { status(`not loaded: ${e.message}`); }
    };
    reader.readAsText(file);
  });
  doc.addEventListener('keydown', (ev) => {
    const tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (ev.key === 'ArrowLeft') go(at - 1);
    if (ev.key === 'ArrowRight') go(at + 1);
  });
  win.addEventListener('beforeunload', (ev) => { if (dirty) { ev.preventDefault(); ev.returnValue = ''; } });
  render();
}

const CSS = `
body{font:14px/1.45 Helvetica,Arial,sans-serif;color:#222;margin:0}
header{position:sticky;top:0;background:#f6f6f6;border-bottom:1px solid #ccc;padding:8px 16px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;z-index:1}
header h1{font-size:16px;margin:0 12px 0 0}
#status{color:#555}
main{padding:0 16px 32px}
pre{white-space:pre-wrap;word-break:break-word;background:#fafafa;border:1px solid #e3e3e3;padding:8px;margin:4px 0}
.cols{display:grid;gap:12px;grid-template-columns:1fr}
.cols.n2{grid-template-columns:repeat(2,minmax(0,1fr))}
.cols.n3{grid-template-columns:repeat(3,minmax(0,1fr))}
.cols.n4{grid-template-columns:repeat(4,minmax(0,1fr))}
.out{border:1px solid #ccc;padding:8px;min-width:0}
.bundle{max-height:70vh;overflow:auto;font-size:12px}
.crit{border-bottom:1px solid #eee;padding:4px 0}
.cid{font-weight:bold}
.choices{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.choice{padding:2px 6px;border-radius:3px;cursor:pointer}
.choice.pass{background:#d7f0e4}.choice.partial{background:#fdebc4}.choice.fail{background:#f6cdbb}
.quote,.notes{width:100%;box-sizing:border-box;margin-top:4px}
.note{color:#555;font-size:12px}
`;

function sha256b64(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('base64');
}

// JSON inside <script type="application/json">: a "<" could close the element, and U+2028/2029 are fine in JSON but escaped for old parsers.
function embedJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function pageScript() {
  return [
    '"use strict";',
    emptyState.toString(), mergeRatings.toString(), ratingsPayload.toString(), progress.toString(), viewerMain.toString(),
    'viewerMain(JSON.parse(document.getElementById("review-data").textContent), document, window);',
  ].join('\n');
}

/** The whole page as one string. data: { viewerId, groups: [{ task: { prompt, rubric, answerKey }, outputs: [{ itemId, label, bundle }] }] }. */
function renderViewer(data) {
  const script = pageScript();
  const csp = [
    "default-src 'none'", `script-src 'sha256-${sha256b64(script)}'`, `style-src 'sha256-${sha256b64(CSS)}'`,
    "img-src 'none'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'",
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">
<meta name="referrer" content="no-referrer">
<title>Bench review ${esc(data.viewerId)}</title>
<style>${CSS}</style></head><body>
<header><h1>Bench review</h1>
<label>Rater <input id="rater" type="text" size="12"></label>
<button id="prev" type="button">Previous</button><span id="where"></span><button id="next" type="button">Next</button>
<button id="unrated" type="button">First unrated</button>
<button id="download" type="button">Download ratings</button>
<label>Load ratings <input id="load" type="file" accept="application/json,.json"></label>
<span id="status"></span></header>
<main>
<p class="note">Rate each output against the rubric and answer key: pass, partial or fail per criterion. Outputs are labeled A, B and so on in a random order per task; the letters do not name the setup that produced them. Ratings stay in this browser until you download them. Arrow keys move between tasks. Viewer ${esc(data.viewerId)}.</p>
<div id="group"></div>
</main>
<script type="application/json" id="review-data">${embedJson(data)}</script>
<script>${script}</script>
</body></html>
`;
}

module.exports = { VERDICTS, RATINGS_KIND, RATINGS_SCHEMA, emptyState, mergeRatings, ratingsPayload, progress, renderViewer, pageScript, embedJson, CSS };
