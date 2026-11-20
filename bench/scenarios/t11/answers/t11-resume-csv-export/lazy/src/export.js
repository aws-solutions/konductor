'use strict';

const CSV_COLUMNS = ['id', 'startedAt', 'endedAt', 'minutes', 'project', 'description', 'billable', 'tags'];

function cell(value) {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join(';') : String(value);
  const doubled = text.replace(/"/g, '""');
  return /[,\"]/.test(text) ? '"' + doubled + '"' : doubled;
}

function makeCsv(entries) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const entry of entries) lines.push(CSV_COLUMNS.map(name => cell(entry[name])).join(','));
  return lines.join('\n') + '\n';
}

function exportTimesheet(entries, options = {}) {
  const format = options && typeof options === 'object' ? options.format || 'json' : undefined;
  if (format === 'json') return JSON.stringify(entries, null, 2) + '\n';
  if (format === 'csv') return makeCsv(entries);
  throw new Error('Unsupported export format: ' + format);
}

module.exports = { exportTimesheet };
