const http = require('node:http');

function request(server, { method = 'GET', path = '/', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({ port: address.port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function withServer(server, fn) {
  await new Promise((resolve) => server.listen(0, resolve));
  try { return await fn(server); } finally { await new Promise((resolve) => server.close(resolve)); }
}

module.exports = { request, withServer };
