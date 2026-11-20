'use strict';

const { records } = require('./csv-records');

const ROW_LIMIT = 5000;
const BOM = '\uFEFF';

class RowLimitError extends Error {
  constructor(rows) {
    super(`This file has ${rows.toLocaleString('en-US')} contacts; an import takes at most ${ROW_LIMIT.toLocaleString('en-US')}. Nothing was imported.`);
    this.name = 'RowLimitError';
    this.rows = rows;
  }
}

// Turns the header record into a reader of named columns, whatever their order.
function columnsOf(header) {
  const at = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
  for (const need of ['name', 'email']) if (!at.has(need)) throw new Error(`The header row has no "${need}" column.`);
  return (fields, name) => (at.has(name) ? (fields[at.get(name)] ?? '').trim() : '');
}

/**
 * importContacts(csvText, book) -> { imported, skipped: [{ line, reason }] }
 * The whole file is read before the first contact is added, so a file over the limit changes nothing. Each row is
 * then offered to book.add(), which owns the name and email rules; its refusal becomes the skip reason.
 */
function importContacts(csvText, book) {
  const text = String(csvText).startsWith(BOM) ? String(csvText).slice(1) : String(csvText);
  const [header, ...rows] = [...records(text)];
  if (!header) return { imported: 0, skipped: [] };
  if (rows.length > ROW_LIMIT) throw new RowLimitError(rows.length);
  const col = columnsOf(header.fields);

  const inThisFile = new Set();
  const result = { imported: 0, skipped: [] };
  for (const { line, fields } of rows) {
    const contact = { name: col(fields, 'name'), email: col(fields, 'email'), phone: col(fields, 'phone') };
    const key = contact.email.toLowerCase();
    if (inThisFile.has(key) || book.has(contact.email)) {
      result.skipped.push({ line, reason: `${contact.email} is already in your address book (duplicate)` });
      continue;
    }
    try {
      book.add(contact);
    } catch (err) {
      result.skipped.push({ line, reason: err.message });
      continue;
    }
    inThisFile.add(key);
    result.imported++;
  }
  return result;
}

module.exports = { importContacts, RowLimitError, ROW_LIMIT };
