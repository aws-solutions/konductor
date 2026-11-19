'use strict';

class EventStore {
  constructor() {
    this.events = [];
  }

  put(event) {
    const copy = { ...event, storedAt: event.storedAt ?? new Date().toISOString() };
    this.events.push(copy);
    return copy;
  }

  list(tenantId) {
    return this.events
      .filter((event) => event.tenantId === tenantId)
      .map((event) => JSON.parse(JSON.stringify(event)));
  }
}

module.exports = { EventStore };
