'use strict';

const FIELDS = ['id', 'startedAt', 'endedAt', 'minutes', 'project', 'description', 'billable', 'tags'];

function valueFor(raw, field) {
  if (raw === null || raw === undefined) return '';
  if (field === 'tags') return Array.isArray(raw) ? raw.join(';') : String(raw);
  if (field === 'startedAt' || field === 'endedAt') return new Date(raw).toISOString();
  return String(raw);
}

function protect(value) {
  let text = value;
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function renderLine(record) {
  return FIELDS.map(field => protect(valueFor(record[field], field))).join(',');
}

function renderCsv(records) {
  const header = FIELDS.join(',');
  return header + '\n' + records.map(renderLine).join('\n') + '\n';
}

function exportTimesheet(entries, options = {}) {
  const format = typeof options === 'string' ? options : options.format || 'json';
  switch (format) {
    case 'json':
      return JSON.stringify(entries, null, 2) + '\n';
    case 'csv':
      return renderCsv(entries);
    default:
      throw new Error('Unsupported export format: ' + format);
  }
}

module.exports = { exportTimesheet };
