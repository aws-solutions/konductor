// SPDX-License-Identifier: Apache-2.0
'use strict';

// Small HTML helpers. Every value that comes from a run goes through `esc` or a formatter built on it before it is
// written into the page, so a tool name, an argument or a reason can never add markup.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** `value` as text safe in HTML text and in a quoted attribute. null and undefined become the empty string. */
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** A pill. `tone` is one of ok, warn, bad, or '' for a plain one; `text` is escaped; `title` is the hover text. */
const pill = (text, tone = '', title = '') => `<span class="pill ${esc(tone)}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;

/** The label for a missing number: `n/a` in the muted style, never 0. `why` is the hover text. */
const na = (why = '') => `<span class="na"${why ? ` title="${esc(why)}"` : ''}>n/a</span>`;

/** `ms` as `412 ms` or `3.4 s`; a number is expected, anything else prints as n/a. */
function fmtMs(ms) {
  if (!Number.isFinite(ms)) return na();
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Integer with thousands separators, or n/a. */
const fmtInt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : na());

const MAX_JSON = 4000;
/** `value` as indented JSON in a <pre>, cut after MAX_JSON characters. */
function jsonBlock(value) {
  const text = JSON.stringify(value ?? null, null, 2) ?? 'null';
  return `<pre>${esc(text.length > MAX_JSON ? `${text.slice(0, MAX_JSON)}\n... [cut]` : text)}</pre>`;
}

/** `value` as one line of JSON, cut to `max` characters. */
function oneLine(value, max = 70) {
  const text = JSON.stringify(value ?? null) ?? 'null';
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** A definition list from `[label, html]` rows; the html of each value must already be escaped. */
const factList = (rows) => `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;

module.exports = { esc, pill, na, fmtMs, fmtInt, jsonBlock, oneLine, factList };
