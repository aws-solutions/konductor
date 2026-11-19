import http from 'node:http';
import { requestId } from './id.mjs';
import { HttpError } from './errors.mjs';

export function createHttpServer(route, logger = console) {
  return http.createServer(async (incoming, response) => {
    const id = requestId();
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const body = () => Promise.resolve(Buffer.concat(chunks).toString('utf8'));
      const value = await route({ method: incoming.method, url: incoming.url, headers: incoming.headers, body });
      response.writeHead(200, { 'content-type': 'application/json', 'x-request-id': id });
      response.end(JSON.stringify(value));
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      logger.error(error.message, { id, status });
      response.writeHead(status, { 'content-type': 'application/json', 'x-request-id': id });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
}
