export function requireId(value, label = 'id') {
  if (typeof value !== 'string' || !/^[a-z0-9-]+$/.test(value)) {
    throw new Error(`${label} must be a lowercase identifier`);
  }
  return value;
}

export function requestId() {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
