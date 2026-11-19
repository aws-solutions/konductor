"use strict";

const { supportedExtensions, maxDocumentBytes } = require('./constants');

function validateDocumentName(name, byteLength = 0) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 180) return false;
  if (name.includes('..') || name.startsWith('/') || name.includes('\\')) return false;
  const extension = name.split('.').pop().toLowerCase();
  return supportedExtensions.includes(extension) && byteLength <= maxDocumentBytes;
}

module.exports = { validateDocumentName };
