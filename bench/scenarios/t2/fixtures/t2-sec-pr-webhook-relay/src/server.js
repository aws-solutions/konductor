import http from 'node:http';
import { route } from './router.js';

export function startServer(config, logger, store) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = {
      method: req.method,
      path: new URL(req.url, 'http://localhost').pathname,
      rawBody: Buffer.concat(chunks).toString('utf8'),
      headers: Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, String(value)]))
    };
    const result = await route(request, { config, logger, store });
    res.writeHead(result.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result.body));
  });
  return server.listen(config.port);
}
