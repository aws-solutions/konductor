class DeliveryQueue {
  constructor() {
    this.items = [];
  }

  push(item) {
    this.items.push(item);
  }

  drain() {
    const current = this.items;
    this.items = [];
    return current;
  }
}

module.exports = { DeliveryQueue };
