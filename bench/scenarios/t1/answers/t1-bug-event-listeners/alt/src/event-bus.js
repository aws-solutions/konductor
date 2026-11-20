'use strict';

const { EventEmitter } = require('node:events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
  }

  subscribe(topic, handler) {
    this.on(topic, handler);
    return () => this.off(topic, handler);
  }

  async publish(topic, payload) {
    const listeners = this.listeners(topic);
    const results = [];
    for (const handler of listeners) {
      try {
        results.push(handler(payload));
      } catch {
        // Continue to next handler if one fails
      }
    }
    await Promise.all(results);
  }
}

module.exports = { EventBus };
