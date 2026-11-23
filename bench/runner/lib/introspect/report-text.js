// SPDX-License-Identifier: Apache-2.0
'use strict';

// Small text helpers the introspection readers share. Split out of report.js (DEBT D-25).

const fs = require('node:fs');

/** The non-empty lines of `file`, or [] when it cannot be read. */
const readLines = (file) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
/** `s` as one line, runs of white space made one space. */
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** `s` as one line, cut to `n` characters with "..." when longer. */
const clip = (s, n) => { const t = oneLine(s); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };
/** `v` as a finite number, or null when it is absent or not a number. */
const numOrNull = (v) => { const n = Number(v); return v === undefined || v === null || v === '' || !Number.isFinite(n) ? null : n; };
/** A rough token count for `n` characters (4 characters a token). */
const tok = (n) => Math.round(n / 4);

module.exports = { readLines, oneLine, clip, numOrNull, tok };
