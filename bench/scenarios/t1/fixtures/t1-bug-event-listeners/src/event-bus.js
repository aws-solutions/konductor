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
    for (const handler of this.listeners(topic)) {
      await handler(payload);
    }
  }
}

module.exports = { EventBus };
