function columnsFor(rows, columns) {
  if (columns) return columns;
  return Object.keys(rows[0] || {}).map((key) => ({ key, label: key }));
}

function valueFor(value, numberStyle = 'grouped') {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'number') return String(value);
  if (numberStyle === 'plain') return String(value);
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTable(rows, options = {}) {
  const columns = columnsFor(rows, options.columns);
  const cells = rows.map((row) => columns.map((column) => valueFor(row[column.key], options.numberStyle)));
  const lines = [];
  if (!options.compact) lines.push(columns.map((column) => column.label).join(' | '));
  lines.push(...cells.map((row) => row.join(' | ')));
  return lines.join('\n');
}

function quickTable(rows, columns) {
  return formatTable(rows, { columns, compact: true });
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return text.includes(',') || text.includes('"') || text.includes('\n') ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatCsv(rows, columns) {
  const selected = columnsFor(rows, columns);
  const lines = [selected.map((column) => csvCell(column.label)).join(',')];
  lines.push(...rows.map((row) => selected.map((column) => csvCell(row[column.key])).join(',')));
  return lines.join('\n');
}

module.exports = { formatTable, quickTable, formatCsv };
