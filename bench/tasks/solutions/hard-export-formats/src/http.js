'use strict';

const { formatOf } = require('./formats');

/** The Content-Type header for a download in `format`. */
const contentTypeFor = (format) => formatOf(format).contentType;

module.exports = { contentTypeFor };
