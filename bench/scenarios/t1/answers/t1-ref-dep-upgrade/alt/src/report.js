const { renderTable, renderCsv } = require('../vendor/gridline/v2');

function buildReport(report, options = {}) {
  const format = options.format || 'table';
  const columns = report.columns;

  if (format === 'json') {
    return JSON.stringify(report, null, 2);
  }

  if (format === 'csv') {
    return renderCsv(report.rows, columns);
  }

  if (options.compact) {
    return renderTable(report.rows, { columns, compact: true });
  }

  return `${report.title}\n${renderTable(report.rows, { columns })}`;
}

module.exports = { buildReport };
