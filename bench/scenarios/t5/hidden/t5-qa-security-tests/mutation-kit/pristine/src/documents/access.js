'use strict';

const documents = [
  { id: 'handbook', ownerId: 'u-admin', title: 'Operations handbook', body: 'Keep the service available.' },
  { id: 'notes-7', ownerId: 'u-editor', title: 'Release notes', body: 'The next release is ready.' },
  { id: 'brief-2', ownerId: 'u-reviewer', title: 'Customer brief', body: 'Review before sharing.' },
];

function findDocument(id) {
  return documents.find((document) => document.id === id) || null;
}

function canRead(user, document) {
  return Boolean(user && document && (user.role === 'admin' || document.ownerId === user.id));
}

function allDocuments() {
  return documents.map((document) => ({ ...document }));
}

module.exports = { findDocument, canRead, allDocuments };
