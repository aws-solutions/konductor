const fs = require('node:fs');

function readReport(filename) {
  let text;
  try {
    text = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${filename}: ${error.message}`);
  }
  try {
    const report = JSON.parse(text);
    validateReport(report);
    return report;
  } catch (error) {
    if (error.message.startsWith('invalid report')) throw error;
    throw new Error(`invalid report in ${filename}: ${error.message}`);
  }
}

function validateReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('invalid report: root must be an object');
  }
  if (typeof report.title !== 'string' || !report.title) throw new Error('invalid report: title is required');
  if (!Array.isArray(report.columns) || report.columns.some((column) => !column.key || !column.label)) {
    throw new Error('invalid report: columns must contain key and label');
  }
  if (!Array.isArray(report.rows)) throw new Error('invalid report: rows must be an array');
}

module.exports = { readReport, validateReport };
