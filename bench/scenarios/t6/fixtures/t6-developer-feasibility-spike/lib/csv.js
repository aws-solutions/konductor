'use strict';

const fs = require('node:fs');

/**
 * Streaming CSV reader.
 *
 * readRows(source)    yields one array of strings per record, header included.
 * readRecords(source) yields { row, cells } per data record: `row` is 1-based and
 *                     does not count the header, `cells` is an object keyed by
 *                     header name (missing cells are '', extra cells are dropped).
 *
 * `source` is a file path or any readable stream. Handles a leading BOM, CRLF or LF
 * line ends, quoted fields with embedded delimiters, doubled quotes and line breaks.
 * Lines with no characters at all are skipped.
 */
async function* readRows(source, { delimiter = ',' } = {}) {
  const stream = typeof source === 'string'
    ? fs.createReadStream(source, { encoding: 'utf8', highWaterMark: 64 * 1024 })
    : source;
  if (typeof stream.setEncoding === 'function') stream.setEncoding('utf8');

  let row = [];
  let field = '';
  let state = 0; // 0 outside quotes, 1 inside quotes, 2 just saw a quote inside quotes
  let atStart = true; // nothing consumed yet for the current field
  let quoted = false; // the current row has had a quoted field
  let first = true;

  const finishRow = () => {
    row.push(field);
    const blank = row.length === 1 && row[0] === '' && !quoted;
    const out = blank ? null : row;
    row = [];
    field = '';
    atStart = true;
    quoted = false;
    return out;
  };

  for await (let chunk of stream) {
    if (first) {
      first = false;
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
    }
    const done = [];
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (state === 2) {
        if (ch === '"') { field += '"'; state = 1; continue; }
        state = 0;
      }
      if (state === 1) {
        if (ch === '"') state = 2; else field += ch;
        continue;
      }
      if (ch === '"' && atStart) { state = 1; atStart = false; quoted = true; }
      else if (ch === delimiter) { row.push(field); field = ''; atStart = true; }
      else if (ch === '\n') { const r = finishRow(); if (r) done.push(r); }
      else if (ch === '\r') { /* dropped */ }
      else { field += ch; atStart = false; }
    }
    for (const r of done) yield r;
  }
  if (row.length > 0 || field !== '' || quoted) {
    const r = finishRow();
    if (r) yield r;
  }
}

async function* readRecords(source, options) {
  let header = null;
  let n = 0;
  for await (const values of readRows(source, options)) {
    if (!header) { header = values; continue; }
    n += 1;
    const cells = {};
    header.forEach((name, i) => { cells[name] = values[i] ?? ''; });
    yield { row: n, cells };
  }
}

module.exports = { readRows, readRecords };
