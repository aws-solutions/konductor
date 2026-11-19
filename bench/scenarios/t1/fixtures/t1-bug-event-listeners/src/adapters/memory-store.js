'use strict';

class MemoryNotificationStore {
  constructor() {
    this.items = new Map();
  }

  put(userId, notification) {
    const list = this.items.get(userId) || [];
    list.push(notification);
    this.items.set(userId, list);
  }

  list(userId) {
    return [...(this.items.get(userId) || [])];
  }
}

module.exports = { MemoryNotificationStore };
