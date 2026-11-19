'use strict';

class InMemoryRepository {
  constructor() { this.invoices = new Map(); this.events = new Set(); this.entries = []; }
  saveInvoice(invoice) { this.invoices.set(invoice.id, structuredClone(invoice)); return invoice; }
  getInvoice(id) { const value = this.invoices.get(id); return value ? structuredClone(value) : null; }
  saveEvent(id) { this.events.add(id); }
  hasEvent(id) { return this.events.has(id); }
  addEntry(entry) { this.entries.push(structuredClone(entry)); return entry; }
  listEntries() { return structuredClone(this.entries); }
}

module.exports = { InMemoryRepository };
