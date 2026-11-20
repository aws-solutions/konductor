'use strict';

const CSV_COLUMNS = ['id', 'startedAt', 'endedAt', 'minutes', 'project', 'description', 'billable', 'tags'];
const TIMESTAMP_COLUMNS = new Set(['startedAt', 'endedAt']);

function scalarText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(';');
  return String(value);
}

function csvText(value, column) {
  let text = TIMESTAMP_COLUMNS.has(column) && value !== null && value !== undefined && value !== ''
    ? new Date(value).toISOString()
    : scalarText(value);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function csvRow(entry) {
  return CSV_COLUMNS.map(column => csvText(entry[column], column)).join(',');
}

function csvDocument(entries) {
  return [CSV_COLUMNS.join(','), ...entries.map(csvRow)].join('\n') + '\n';
}

function exportTimesheet(entries, options = {}) {
  const format = typeof options === 'string' ? options : options.format || 'json';
  if (format === 'json') return JSON.stringify(entries, null, 2) + '\n';
  if (format === 'csv') return csvDocument(entries);
  throw new Error('Unsupported export format: ' + format);
}

module.exports = { exportTimesheet };
