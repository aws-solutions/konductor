import { errorResponse, json } from './response.js';
import { requestId } from './request-id.js';

function bodyJson(body) {
  if (!body) return {};
  return typeof body === 'string' ? JSON.parse(body) : body;
}

export function makeRouter({ inventory, warehouses, logger }) {
  return async function route(request) {
    const id = requestId(request.headers);
    try {
      if (request.method === 'GET' && request.path.startsWith('/stock/')) {
        const [, , warehouseId, sku] = request.path.split('/');
        const value = await inventory.getStock(warehouseId, sku);
        return value ? json(200, value) : json(404, { code: 'not_found', message: 'stock not found' });
      }
      if (request.method === 'GET' && request.path === '/warehouses') return json(200, warehouses.active());
      if (request.method === 'POST' && request.path === '/reservations') {
        const input = bodyJson(request.body);
        const value = await inventory.reserve(input.warehouseId, input.sku, input.quantity, id);
        return json(201, value);
      }
      if (request.method === 'DELETE' && request.path.startsWith('/reservations/')) {
        const idToRelease = request.path.split('/')[2];
        const value = await inventory.release(idToRelease, id);
        return value ? json(200, value) : json(404, { code: 'not_found', message: 'reservation not found' });
      }
      if (request.method === 'POST' && request.path === '/reservations/sweep') {
        return json(200, { released: await inventory.sweepExpired() });
      }
      return json(404, { code: 'not_found', message: 'route not found' });
    } catch (error) {
      logger.error('request failed', { requestId: id, error: error.message });
      return errorResponse(error);
    }
  };
}
