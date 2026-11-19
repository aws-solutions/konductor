export function createMetrics() {
  const counters = new Map();
  return {
    increment(name) { counters.set(name, (counters.get(name) ?? 0) + 1); },
    read(name) { return counters.get(name) ?? 0; },
    snapshot() { return Object.fromEntries(counters); }
  };
}
