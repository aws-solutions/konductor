'use strict';

let nextId = 100;

function requestId(request) {
  const supplied = request.headers?.['x-request-id'];
  if (typeof supplied === 'string' && supplied.length > 0 && supplied.length < 80) return supplied;
  nextId += 1;
  return `req_${nextId}`;
}

module.exports = { requestId };
