'use strict';

const { ExportError } = require('./errors');

/** The Content-Type header for a download in `format`. */
function contentTypeFor(format) {
  if (format === 'csv') return 'text/csv; charset=utf-8';
  if (format === 'json') return 'application/json';
  if (format === 'tsv') return 'text/tab-separated-values; charset=utf-8';
  throw new ExportError('UNKNOWN_FORMAT', `unknown format "${format}"`);
}

module.exports = { contentTypeFor };
