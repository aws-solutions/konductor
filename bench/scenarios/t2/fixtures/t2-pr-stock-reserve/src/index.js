import { createServer } from 'node:http';
import { makeApp } from './app.js';

const app = makeApp();
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const result = await app.router({ method: req.method, path: req.url, headers: req.headers, body });
  res.writeHead(result.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(result.body));
});

if (process.env.NODE_ENV !== 'test') server.listen(app.config.port);
export { server };
