import http from 'node:http';
import { createProduct, getProduct } from '../catalog/product-service.js';

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function body(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true });
      const match = req.url?.match(/^\/v2\/products\/([^/]+)$/);
      if (req.method === 'GET' && match) {
        const product = await getProduct(match[1]);
        return product ? json(res, 200, product) : json(res, 404, { error: 'not found' });
      }
      if (req.method === 'POST' && req.url === '/v2/products') {
        return json(res, 201, await createProduct(await body(req)));
      }
      return json(res, 404, { error: 'not found' });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  });
}

if (process.argv[1]?.endsWith('server.js')) {
  const server = createServer();
  server.listen(Number(process.env.PORT ?? 8080));
}
