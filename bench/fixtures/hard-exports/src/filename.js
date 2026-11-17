'use strict';

const { ExportError } = require('./errors');

const EXTENSIONS = { csv: '.csv', json: '.json' };

/** The download file name: `base` plus the extension of `format`. */
function fileNameFor(base, format) {
  const ext = EXTENSIONS[format];
  if (!ext) throw new ExportError('UNKNOWN_FORMAT', `unknown format "${format}"`);
  return `${base}${ext}`;
}

module.exports = { fileNameFor };
