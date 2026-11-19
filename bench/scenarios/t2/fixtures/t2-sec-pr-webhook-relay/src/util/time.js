export function secondsSince(epochSeconds, now = Date.now()) {
  return Math.abs(Math.floor(now / 1000) - Number(epochSeconds));
}
