'use strict';

const { csvField } = require('./csv');
const { columnsOf } = require('./columns');
const { ExportError } = require('./errors');

const valueOf = (row, column) => (row[column] === undefined || row[column] === null ? '' : String(row[column]));

/** The rows as text in `format`; `columns` picks and orders the columns (default: keys of the first row). */
function exportReport(rows, { format, columns } = {}) {
  const cols = columnsOf(rows, columns);
  switch (format) {
    case 'csv': {
      const lines = [cols.map(csvField), ...rows.map((row) => cols.map((c) => csvField(valueOf(row, c))))];
      return lines.map((fields) => fields.join(',')).join('\n') + '\n';
    }
    case 'json': {
      const picked = rows.map((row) => Object.fromEntries(cols.map((c) => [c, row[c] === undefined ? null : row[c]])));
      return JSON.stringify(picked, null, 2) + '\n';
    }
    default:
      throw new ExportError('UNKNOWN_FORMAT', `unknown format "${format}" (expected csv or json)`);
  }
}

module.exports = { exportReport };
