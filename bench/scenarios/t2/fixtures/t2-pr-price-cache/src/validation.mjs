import { HttpError } from './errors.mjs';

export function tenantFrom(headers) {
  const tenant = headers['x-tenant-id'];
  if (!tenant || !/^[a-z0-9-]+$/.test(tenant)) {
    throw new HttpError(400, 'x-tenant-id is required');
  }
  return tenant;
}

export function parseJsonBody(body) {
  try { return JSON.parse(body || '{}'); } catch { throw new HttpError(400, 'body must be JSON'); }
}
