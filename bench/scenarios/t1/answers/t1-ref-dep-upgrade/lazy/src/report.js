const gridline = require('../vendor/gridline/v2');

function buildReport(report, options = {}) {
  const format = options.format || 'table';
  if (format === 'json') return JSON.stringify(report, null, 2);
  if (format === 'csv') return gridline.renderCsv(report.rows, report.columns);
  if (options.compact) return gridline.renderTable(report.rows, { columns: report.columns, compact: true });
  return `${report.title}\n${gridline.renderTable(report.rows, { columns: report.columns })}`;
}

module.exports = { buildReport };
