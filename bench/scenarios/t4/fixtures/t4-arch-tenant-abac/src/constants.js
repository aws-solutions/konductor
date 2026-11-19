"use strict";

module.exports = Object.freeze({
  objectRoot: 'tenants',
  exportRoot: 'exports',
  maxDocumentBytes: 10 * 1024 * 1024,
  supportedExtensions: Object.freeze(['pdf', 'txt', 'json'])
});
