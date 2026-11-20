let next = 1;
export function requestId(headers = {}) {
  return headers['x-request-id'] || `local-${next++}`;
}
