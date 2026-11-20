const gridline = require('../vendor/gridline/v2');

function buildReport(report, options = {}) {
  const format = options.format || 'table';
  if (format === 'json') return JSON.stringify(report, null, 2);
  if (format === 'csv') return gridline.renderCsv(report.rows);
  if (options.compact) return gridline.renderTable(report.rows);
  return `${report.title}\n${gridline.renderTable(report.rows)}`;
}

module.exports = { buildReport };
