import { parseJsonBody, tenantFrom } from './validation.mjs';
import { HttpError } from './errors.mjs';

export function createRoutes({ catalog, prices, tenants }) {
  return async function route(request) {
    const tenantId = tenantFrom(request.headers);
    if (!(await tenants.exists(tenantId))) throw new HttpError(404, 'tenant was not found');
    const parts = new URL(request.url, 'http://catalog.local').pathname.split('/').filter(Boolean);
    if (parts[0] !== 'v1') throw new HttpError(404, 'route was not found');
    if (parts[1] === 'products' && request.method === 'GET') return catalog.products(tenantId);
    if (parts[1] === 'prices' && request.method === 'GET') return prices.list(tenantId, parts[2] ?? 'retail');
    if (parts[1] === 'prices' && request.method === 'PATCH') {
      const body = parseJsonBody(await request.body());
      return prices.update(tenantId, parts[2] ?? 'retail', parts[3], body);
    }
    if (parts[1] === 'prices' && request.method === 'PUT') {
      const body = parseJsonBody(await request.body());
      return prices.replace(tenantId, parts[2] ?? 'retail', body);
    }
    throw new HttpError(404, 'route was not found');
  };
}
