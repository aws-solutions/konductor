'use strict';

let sequence = 0;

function requestId(request) {
  const supplied = request.headers['x-request-id'];
  if (typeof supplied === 'string' && supplied.length > 0 && supplied.length < 80) return supplied;
  sequence += 1;
  return `req-${Date.now().toString(36)}-${sequence}`;
}

module.exports = { requestId };
