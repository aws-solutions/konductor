'use strict';

const { formatOf } = require('./formats');

/** The download file name: `base` plus the extension of `format`. */
const fileNameFor = (base, format) => `${base}${formatOf(format).extension}`;

module.exports = { fileNameFor };
