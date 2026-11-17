'use strict';

const { columnsOf } = require('./columns');
const { formatOf } = require('./formats');

/** The rows as text in `format`; `columns` picks and orders the columns (default: keys of the first row). */
function exportReport(rows, { format, columns } = {}) {
  return formatOf(format).render(rows, columnsOf(rows, columns));
}

module.exports = { exportReport };
