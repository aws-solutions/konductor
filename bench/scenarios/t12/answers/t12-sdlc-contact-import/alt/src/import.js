'use strict';

const { EMAIL } = require('./contacts');

const MAX_ROWS = 5000;

/** Splits CSV text into rows of fields with the file line each row starts on (RFC 4180 quoting, CRLF or LF). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false;
      else { if (ch === '\n') line++; field += ch; }
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push({ line: start, fields: row });
      row = []; field = ''; line++; start = line;
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push({ line: start, fields: row }); }
  return rows.filter((r) => r.fields.some((f) => f.trim() !== ''));
}

/**
 * Imports contacts from CSV text into an address book from createBook().
 * Returns { imported, skipped: [{ line, reason }] }; throws when the file has more than 5,000 data rows, before
 * importing anything.
 */
function importContacts(csvText, book) {
  const rows = parseCsv(String(csvText).replace(/^\uFEFF/, ''));
  if (!rows.length) return { imported: 0, skipped: [] };
  const header = rows[0].fields.map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  if (col('name') < 0 || col('email') < 0) throw new Error('the header row must name the name and email columns');
  const data = rows.slice(1);
  if (data.length > MAX_ROWS) throw new Error(`the file has ${data.length} rows; the limit is ${MAX_ROWS}`);
  const seen = new Set();
  const skipped = [];
  let imported = 0;
  for (const { line, fields } of data) {
    const get = (name) => (col(name) >= 0 ? (fields[col(name)] || '').trim() : '');
    const name = get('name');
    const email = get('email');
    const key = email.toLowerCase();
    if (!name) skipped.push({ line, reason: 'name is missing' });
    else if (!EMAIL.test(email)) skipped.push({ line, reason: `email "${email}" is invalid` });
    else if (seen.has(key) || book.has(email)) skipped.push({ line, reason: `duplicate: ${email} is already in the address book` });
    else {
      book.add({ name, email, phone: get('phone') });
      seen.add(key);
      imported++;
    }
  }
  return { imported, skipped };
}

module.exports = { importContacts, parseCsv, MAX_ROWS };
