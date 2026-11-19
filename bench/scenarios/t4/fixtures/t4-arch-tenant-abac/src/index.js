"use strict";

const { createRequestContext } = require('./request-context');
const { documentKey, exportKey, metadataKey } = require('./storage-path');
const { validateDocumentName } = require('./document-name');

function prepareRead(input) {
  const context = createRequestContext(input);
  if (!validateDocumentName(input.documentName)) throw new Error('invalid document name');
  return { context, key: documentKey(context.tenantId, input.documentName), metadataKey: metadataKey(context.tenantId) };
}

function prepareExport(input) {
  const context = createRequestContext(input);
  if (context.tier !== 'premium') throw new Error('export requires premium tier');
  if (!validateDocumentName(input.documentName)) throw new Error('invalid document name');
  return { context, key: exportKey(context.tenantId, input.documentName) };
}

module.exports = { prepareRead, prepareExport };
