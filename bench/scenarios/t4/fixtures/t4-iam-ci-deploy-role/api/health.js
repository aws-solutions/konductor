'use strict';

function health(request = {}) {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, requestId: request.requestId || null })
  };
}

module.exports = { health };
