'use strict';

const { getSession } = require('../auth/session');
const { findDocument, canRead } = require('../documents/access');
const { renderDocumentExport } = require('../export/html');
const { validateDocumentInput } = require('../validation/input');

function sessionFrom(request, now) {
  const header = request && request.headers && request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  return getSession(header.slice(7), now);
}

function getDocument(request, now = Date.now()) {
  const session = sessionFrom(request, now);
  if (!session) return { status: 401, error: 'Authentication required' };
  const document = findDocument(request.params && request.params.id);
  if (!document) return { status: 404, error: 'Document not found' };
  if (!canRead(session.user, document)) return { status: 403, error: 'Forbidden' };
  return { status: 200, body: { ...document } };
}

function exportDocument(request, now = Date.now()) {
  const response = getDocument(request, now);
  if (response.status !== 200) return response;
  return { status: 200, body: renderDocumentExport(response.body), contentType: 'text/html' };
}

function validateCreate(request) {
  const result = validateDocumentInput(request && request.body);
  return result.ok ? { status: 204 } : { status: 400, errors: result.errors };
}

module.exports = { getDocument, exportDocument, validateCreate };
