const gridline = require('../vendor/gridline/v1');

function buildReport(report, options = {}) {
  const format = options.format || 'table';
  if (format === 'json') return JSON.stringify(report, null, 2);
  if (format === 'csv') return gridline.formatCsv(report.rows, report.columns);
  if (options.compact) return gridline.quickTable(report.rows, report.columns);
  return `${report.title}\n${gridline.formatTable(report.rows, { columns: report.columns })}`;
}

module.exports = { buildReport };
