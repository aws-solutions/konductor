'use strict';

// The one place that knows the formats. A new format is one more entry in FORMATS; nothing else names a format.

const { csvField } = require('./csv');
const { ExportError } = require('./errors');

const isEmpty = (v) => v === undefined || v === null;
const text = (v) => (isEmpty(v) ? '' : String(v));
const tsvField = (v) => String(v);

/** Lines of `fields` joined by `separator`, each line ended by \n. */
const delimited = (rows, columns, field, separator) => [columns.map(field), ...rows.map((row) => columns.map((c) => field(text(row[c]))))]
  .map((fields) => fields.join(separator)).join('\n') + '\n';

/** Each format: its content type, its file extension and render(rows, columns) returning the file text. */
const FORMATS = {
  csv: { contentType: 'text/csv; charset=utf-8', extension: '.csv', render: (rows, columns) => delimited(rows, columns, csvField, ',') },
  json: {
    contentType: 'application/json',
    extension: '.json',
    render: (rows, columns) => JSON.stringify(rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c] === undefined ? null : row[c]]))), null, 2) + '\n',
  },
  tsv: { contentType: 'text/tab-separated-values; charset=utf-8', extension: '.tsv', render: (rows, columns) => delimited(rows, columns, tsvField, '\t') },
};

const listFormats = () => Object.keys(FORMATS);

/** The format called `name`, or an UNKNOWN_FORMAT error that lists the formats that exist. */
function formatOf(name) {
  if (!Object.prototype.hasOwnProperty.call(FORMATS, name)) {
    throw new ExportError('UNKNOWN_FORMAT', `unknown format "${name}" (available: ${listFormats().join(', ')})`);
  }
  return FORMATS[name];
}

module.exports = { formatOf, listFormats };
