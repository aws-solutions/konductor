const queuedEvents = [];

export function recordLocalEvent(name, detail = {}) {
  queuedEvents.push({ name, detail, at: Date.now() });
  if (queuedEvents.length > 20) queuedEvents.shift();
}

export function recentLocalEvents() {
  return queuedEvents.slice();
}
