import http from 'node:http';
import { match } from './router.js';
import { routes } from './routes.js';
import { AppError } from '../errors.js';

export function createServer(store) {
  const routeTable = routes({ store });
  return http.createServer(async (request, response) => {
    try {
      const found = match(routeTable, request.method, new URL(request.url, 'http://local').pathname);
      if (!found) { response.writeHead(404); return response.end(); }
      const result = await found.candidate.handler({ request, params: found.params });
      response.writeHead(result.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result.body));
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
}
