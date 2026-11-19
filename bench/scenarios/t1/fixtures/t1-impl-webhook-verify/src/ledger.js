class Ledger {
  constructor(label = 'harbor-main') {
    this.label = label;
    this.balance = 0;
    this.events = new Map();
  }

  apply(event) {
    if (this.events.has(event.id)) return { duplicate: true };
    this.events.set(event.id, { ...event });
    this.balance += event.amount;
    return { duplicate: false };
  }

  snapshot() {
    return { label: this.label, balance: this.balance, eventIds: [...this.events.keys()] };
  }
}

module.exports = { Ledger };
