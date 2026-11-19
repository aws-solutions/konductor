'use strict';

function logRequest(method, pathname, status, requestId) {
  process.stdout.write(`${JSON.stringify({ method, pathname, status, requestId })}\n`);
}

module.exports = { logRequest };
