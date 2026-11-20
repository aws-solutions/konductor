'use strict';

const byId = new Map([
  ['handbook', { id: 'handbook', ownerId: 'u-admin', title: 'Operations handbook', body: 'Keep the service available.' }],
  ['notes-7', { id: 'notes-7', ownerId: 'u-editor', title: 'Release notes', body: 'The next release is ready.' }],
  ['brief-2', { id: 'brief-2', ownerId: 'u-reviewer', title: 'Customer brief', body: 'Review before sharing.' }],
]);

const findDocument = (id) => byId.get(id) ?? null;

function canRead(user, document) {
  if (!user || !document) return false;
  return user.role === 'admin' || document.ownerId === user.id;
}

const allDocuments = () => [...byId.values()].map((document) => ({ ...document }));

module.exports = { findDocument, canRead, allDocuments };
