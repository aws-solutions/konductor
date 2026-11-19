'use strict';

const http = require('node:http');
const { loadConfig } = require('./config');
const { jsonResponse } = require('./format');
const { uploadFile, downloadFile, listFolder, importArchive } = require('./handlers');

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) reject(new Error('request too large'));
      else chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function createServer(options = {}) {
  const config = { ...loadConfig(), ...options };
  return http.createServer(async (request, response) => {
    const userId = request.headers['x-account-id'] || '111122223333';
    try {
      const url = new URL(request.url, 'http://paper-lantern.invalid');
      let result;
      if (request.method === 'GET' && url.pathname === '/files') {
        result = await downloadFile(config.storageRoot, userId, { path: url.searchParams.get('path') || '' });
      } else if (request.method === 'GET' && url.pathname === '/folders') {
        result = await listFolder(config.storageRoot, userId, { path: url.searchParams.get('path') || '' });
      } else if (request.method === 'POST' && url.pathname === '/files') {
        const payload = JSON.parse((await readBody(request, config.maxUploadBytes)).toString('utf8'));
        result = await uploadFile(config.storageRoot, userId, payload);
      } else if (request.method === 'POST' && url.pathname === '/imports') {
        result = await importArchive(config.storageRoot, userId, { archive: await readBody(request, config.maxUploadBytes) });
      } else {
        result = { status: 404, body: { error: 'route not found' } };
      }
      const formatted = jsonResponse(result);
      response.writeHead(formatted.status, { 'content-type': formatted.type });
      response.end(formatted.body);
    } catch (error) {
      response.writeHead(error.message === 'request too large' ? 413 : 400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
}

if (require.main === module) {
  const config = loadConfig();
  createServer(config).listen(config.port, () => {
    process.stdout.write(`paper lantern listening on ${config.port}\n`);
  });
}

module.exports = { createServer, readBody };
