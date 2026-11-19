'use strict';

function jsonResponse(response) {
  if (Buffer.isBuffer(response.body)) {
    return { status: response.status, type: 'application/octet-stream', body: response.body };
  }
  return { status: response.status, type: 'application/json', body: Buffer.from(JSON.stringify(response.body)) };
}

module.exports = { jsonResponse };
