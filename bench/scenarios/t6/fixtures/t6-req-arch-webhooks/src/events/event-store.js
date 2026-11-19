'use strict';

class InMemoryEventStore {
  constructor() { this.events = []; }
  append(event) {
    const stored = { ...event, position: this.events.length };
    this.events.push(stored);
    return stored;
  }
  list(accountId) { return this.events.filter((event) => event.accountId === accountId); }
}

module.exports = { InMemoryEventStore };
