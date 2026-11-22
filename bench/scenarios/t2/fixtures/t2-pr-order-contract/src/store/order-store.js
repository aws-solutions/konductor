import rules from '../../config/order-rules.json' with { type: 'json' };

export class OrderStore {
  #orders = new Map();
  #items = new Map();

  constructor(seed = []) {
    for (const record of seed) {
      const { items = [], ...order } = structuredClone(record);
      this.#orders.set(order.id, order);
      this.#items.set(order.id, items);
    }
  }

  get(id) {
    const order = this.#orders.get(id);
    if (!order) return null;
    return { ...structuredClone(order), items: structuredClone(this.#items.get(id) ?? []) };
  }

  has(id) {
    return this.#orders.has(id);
  }

  list({ status } = {}) {
    return [...this.#orders.values()]
      .filter((order) => status === undefined || order.status === status)
      .map((order) => this.get(order.id));
  }

  save(order) {
    if (!/^[A-Z]{3}$/.test(order.currency)) throw new Error('currency must be three uppercase letters');
    if (!rules.orderStatuses.includes(order.status)) throw new Error(`unknown status: ${order.status}`);
    this.#orders.set(order.id, structuredClone(order));
    return this.get(order.id);
  }

  replaceItems(id, items) {
    if (!this.#orders.has(id)) throw new Error(`unknown order: ${id}`);
    if (items.length > rules.maxItemsPerOrder) throw new Error('too many items');
    if (items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1)) {
      throw new Error('item quantity must be positive');
    }
    this.#items.set(id, structuredClone(items));
  }

  remove(id) {
    const removed = this.#orders.delete(id);
    this.#items.delete(id);
    return removed;
  }

  updateWithItems(order, items) {
    const previousOrder = this.#orders.get(order.id);
    const previousItems = this.#items.get(order.id);
    try {
      this.save(order);
      this.replaceItems(order.id, items);
      return this.get(order.id);
    } catch (error) {
      if (previousOrder) this.#orders.set(order.id, previousOrder);
      if (previousItems) this.#items.set(order.id, previousItems);
      throw error;
    }
  }
}
