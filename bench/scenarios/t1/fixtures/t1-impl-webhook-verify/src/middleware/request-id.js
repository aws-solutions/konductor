let nextId = 1;

function requestId(req) {
  const supplied = req.headers['x-request-id'];
  if (typeof supplied === 'string' && supplied.length > 0 && supplied.length < 100) return supplied;
  return `req-${nextId++}`;
}

module.exports = { requestId };
