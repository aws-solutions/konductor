const http = require('node:http');
const { saveUpload, readUpload } = require('./upload');

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/files') {
    const name = url.searchParams.get('name');
    try {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(readUpload(name));
    } catch (err) {
      res.writeHead(404);
      res.end('not found');
    }
    return;
  }
  if (req.method === 'PUT' && url.pathname === '/files') {
    const name = url.searchParams.get('name');
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        saveUpload(name, body);
        res.writeHead(201);
        res.end('stored');
      } catch (err) {
        res.writeHead(400);
        res.end('bad request');
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
}

if (require.main === module) {
  http.createServer(handler).listen(8080, '127.0.0.1');
}

module.exports = { handler };
