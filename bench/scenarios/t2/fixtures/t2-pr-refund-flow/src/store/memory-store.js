export class MemoryStore {
  constructor(seed = {}) {
    this.orders = new Map((seed.orders || []).map((o) => [o.id, structuredClone(o)]));
    this.entries = [];
    this.events = [];
    this.outbox = [];
    this.idempotency = new Map();
  }

  order(id) { return this.orders.get(id); }
  saveOrder(order) { this.orders.set(order.id, order); return order; }
  addEntry(entry) { this.entries.push(entry); return entry; }
  addEvent(event) { this.events.push(event); return event; }
}
