#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'fixture');
const stage = process.argv[2] || 'final';
function write(name, text) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}
const wipExport = `'use strict';

const CSV_COLUMNS = ['id', 'startedAt', 'endedAt', 'minutes', 'project'];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join(';') : String(value);
  const escaped = text.replace(/"/g, '""');
  return /[,\"]/.test(text) ? '"' + escaped + '"' : escaped;
}

function csvExport(entries) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const entry of entries) {
    lines.push(CSV_COLUMNS.map(column => csvCell(entry[column])).join(','));
  }
  return lines.join('\\n') + '\\n';
}

function exportTimesheet(entries, options = {}) {
  const format = typeof options === 'string' ? options : options.format || 'json';
  if (format === 'json') return JSON.stringify(entries, null, 2) + '\\n';
  if (format === 'csv') return csvExport(entries);
  throw new Error('Unsupported export format: ' + format);
}

module.exports = { exportTimesheet };
`;
const utcReviewText = `# CSV export handoff

The export work is in progress and the checklist below reflects the original handoff. Read the branch history alongside it when making changes.

- [x] Route the export command through a format option.
- [ ] Add one header row with the agreed columns.
- [ ] Keep timestamps in the user's local time.
- [x] Expose the export function from the package entry point.
- [ ] Handle commas, quotes, line breaks, and spreadsheet formula-like values.

Loose notes:
- The first sample used five columns while the shape was being discussed.
- Tags should remain easy to read when opened as a spreadsheet.
- The command should continue to read the normal JSON ledger.
`;
if (stage === 'source' || stage === 'final') write('src/export.js', wipExport);
if (stage === 'cli') {
  const file = path.join(root, 'bin/timesheet.js');
  let text = fs.readFileSync(file, 'utf8');
  text = text.replace("const format = valueAfter(args, '--format', 'json');", "const format = valueAfter(args, '--format', 'json').toLowerCase();");
  fs.writeFileSync(file, text);
}
if (stage === 'notes' || stage === 'final') write('NOTES-csv-export.md', utcReviewText);
if (stage === 'decision' || stage === 'final') {
  write('docs/csv-export.md', `# CSV export\n\nCSV output follows the entry order and uses a stable set of fields. Timestamp policy is recorded with the export review notes.\n`);
}
if (stage === 'final') {
  write('CHANGELOG.md', fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8') + `\n## Unreleased\n\n- Began the tabular export work for ledger entries.\n`);
}
console.log('applied branch stage ' + stage);
