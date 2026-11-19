export function nowUtc() {
  return new Date().toISOString();
}

export function addMinutes(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}
