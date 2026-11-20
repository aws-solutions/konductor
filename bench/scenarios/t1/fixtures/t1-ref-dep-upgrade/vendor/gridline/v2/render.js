const { columnsFor, valueFor } = require('./normalize');

function renderTable(rows, options = {}) {
  const columns = columnsFor(rows, options.columns);
  const lines = [];
  if (!options.compact) lines.push(columns.map((column) => column.label).join(' | '));
  lines.push(...rows.map((row) => columns.map((column) => valueFor(row[column.key], options.numberStyle)).join(options.compact ? '\t' : ' | ')));
  return lines.join('\n');
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return text.includes(',') || text.includes('"') || text.includes('\n') ? `"${text.replaceAll('"', '""')}"` : text;
}

function renderCsv(rows, columns) {
  const selected = columnsFor(rows, columns);
  const lines = [selected.map((column) => csvCell(column.label)).join(',')];
  lines.push(...rows.map((row) => selected.map((column) => csvCell(row[column.key])).join(',')));
  return `${lines.join('\n')}\n`;
}

module.exports = { renderTable, renderCsv };
