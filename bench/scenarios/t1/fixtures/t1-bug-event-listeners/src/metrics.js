'use strict';

class Metrics {
  constructor() {
    this.values = new Map();
  }

  increment(name, amount = 1) {
    this.values.set(name, (this.values.get(name) || 0) + amount);
  }

  get(name) {
    return this.values.get(name) || 0;
  }

  snapshot() {
    return Object.fromEntries(this.values);
  }
}

module.exports = { Metrics };
