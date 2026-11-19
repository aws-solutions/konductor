'use strict';

function sendJson(response, status, body, requestId) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-request-id': requestId,
  });
  response.end(payload);
}

function sendError(response, error, requestId) {
  sendJson(response, error.status || 500, {
    error: { code: error.code || 'internal_error', message: error.message || 'Internal server error' },
  }, requestId);
}

module.exports = { sendJson, sendError };
