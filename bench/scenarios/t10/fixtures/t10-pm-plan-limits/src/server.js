'use strict';
const http = require('node:http');
const { createApp } = require('./app');
function startServer(options = {}) { const app = options.app || createApp(options); const server = http.createServer(async (req, res) => { let body=''; req.on('data', c => body += c); req.on('end', async () => { let parsed={}; try { parsed = body ? JSON.parse(body) : {}; } catch { res.writeHead(400, {'content-type':'application/json'}); return res.end(JSON.stringify({error:{code:'invalid_json',message:'invalid JSON'}})); } const out=await app.handle(req.method, new URL(req.url, 'http://localhost').pathname, parsed); res.writeHead(out.status, {'content-type':'application/json'}); res.end(JSON.stringify(out.body)); }); }); const port=options.port || Number(process.env.PORT || 4070); server.listen(port); return { server, app }; }
if (require.main === module) startServer();
module.exports = { startServer };
