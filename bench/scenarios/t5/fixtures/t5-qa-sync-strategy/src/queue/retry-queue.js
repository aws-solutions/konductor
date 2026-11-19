class RetryQueue {
  constructor() { this.items = []; }
  push(item) { this.items.push(item); }
  take() { return this.items.shift() || null; }
  get size() { return this.items.length; }
}
module.exports = { RetryQueue };
