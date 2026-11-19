let nextId = 1;

function requestId(request, response, next) {
  const supplied = request.headers['x-request-id'];
  const id = typeof supplied === 'string' && supplied.length < 100 ? supplied : `req-${nextId++}`;
  response.setHeader('x-request-id', id);
  request.id = id;
  next();
}

module.exports = { requestId };
