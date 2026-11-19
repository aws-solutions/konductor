import { badRequest } from '../errors.js';

export function merchantFrom(request) {
  const value = request.headers['x-merchant-id'];
  if (!value) throw badRequest('x-merchant-id is required');
  return value;
}
