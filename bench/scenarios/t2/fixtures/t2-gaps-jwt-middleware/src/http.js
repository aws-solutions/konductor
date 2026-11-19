function jsonResponse(status, body, headers = {}) {
  return { status, headers: { 'content-type': 'application/json', ...headers }, body };
}

function requestPath(request) {
  return new URL(request.url || '/', 'http://roster.test').pathname;
}

module.exports = { jsonResponse, requestPath };
