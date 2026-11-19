'use strict';

const { getSession } = require('../auth/session');
const { downloadFile } = require('../storage/download');

function download(request, storageDir, now = Date.now()) {
  const header = request && request.headers && request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ') || !getSession(header.slice(7), now)) {
    return { status: 401, error: 'Authentication required' };
  }
  return downloadFile(storageDir, request.params && request.params.name);
}

module.exports = { download };
