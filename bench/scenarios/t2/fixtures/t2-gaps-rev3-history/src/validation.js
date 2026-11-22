export function customerId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9-]{3,40}$/.test(value)) {
    throw new Error('customer id is invalid');
  }
  return value;
}

export function positivePoints(value) {
  const points = Number(value);
  if (!Number.isFinite(points) || points <= 0) throw new Error('points must be positive');
  return points;
}

export function tierName(value) {
  return typeof value === 'string' && value.length > 0 ? value : 'standard';
}
