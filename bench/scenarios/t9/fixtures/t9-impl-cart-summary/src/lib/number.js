export function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

export function integerOr(value, fallback = 0) {
  return Number.isInteger(value) ? value : fallback;
}
