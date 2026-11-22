import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { OrderStore } from './store/order-store.js';
import { CustomerStore } from './store/customer-store.js';
import { MemoryQueue } from './events/queue.js';
import { createOrderRoutes } from './routes/orders-route.js';
import { debugCustomerId, debugCustomerRoute, isDebugPath } from './routes/debug-route.js';
import { healthRoute } from './routes/health-route.js';

const seed = JSON.parse(await readFile(new URL('../data/orders.json', import.meta.url)));
const store = new OrderStore(seed);
const customerStore = new CustomerStore();
const queue = new MemoryQueue();
const routes = createOrderRoutes({ store, queue });

export function createServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/health') return send(response, healthRoute());
    if (request.method === 'GET' && url.pathname.startsWith('/orders/')) {
      return send(response, routes.getOrder(url.pathname.split('/')[2]));
    }
    if (request.method === 'GET' && isDebugPath(url.pathname)) {
      return send(response, debugCustomerRoute({
        customerStore,
        customerId: debugCustomerId(url.pathname)
      }));
    }
    return send(response, { statusCode: 404, body: { error: 'not found' } });
  });
}

function send(response, result) {
  response.statusCode = result.statusCode;
  for (const [name, value] of Object.entries(result.headers ?? {})) {
    response.setHeader(name, value);
  }
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(result.body));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const port = Number(process.env.PORT ?? 8080);
  createServer().listen(port, () => console.log(`orders listening on ${port}`));
}
