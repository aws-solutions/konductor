'use strict';

class RetryQueue {
  constructor() {
    this.items = [];
  }

  enqueue(delivery) {
    this.items.push({ ...delivery, attempt: delivery.attempt ?? 1 });
    return this.items.length;
  }

  next() {
    return this.items.shift() ?? null;
  }

  get size() {
    return this.items.length;
  }
}

module.exports = { RetryQueue };
