'use strict';

/** The column names to export: `requested` when given, else the keys of the first row. */
function columnsOf(rows, requested) {
  if (Array.isArray(requested) && requested.length) return requested;
  return rows.length ? Object.keys(rows[0]) : [];
}

module.exports = { columnsOf };
