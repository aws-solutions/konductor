'use strict';

const CSV_COLUMNS = ['id', 'startedAt', 'endedAt', 'minutes', 'project'];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join(';') : String(value);
  const escaped = text.replace(/"/g, '""');
  return /[,"]/.test(text) ? '"' + escaped + '"' : escaped;
}

function csvExport(entries) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const entry of entries) {
    lines.push(CSV_COLUMNS.map(column => csvCell(entry[column])).join(','));
  }
  return lines.join('\n') + '\n';
}

function exportTimesheet(entries, options = {}) {
  const format = typeof options === 'string' ? options : options.format || 'json';
  if (format === 'json') return JSON.stringify(entries, null, 2) + '\n';
  if (format === 'csv') return csvExport(entries);
  throw new Error('Unsupported export format: ' + format);
}

module.exports = { exportTimesheet };
