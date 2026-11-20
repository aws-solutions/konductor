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
    const handlers = this.listeners(topic);
    let delivered = 0;
    let failed = 0;
    for (const handler of handlers) {
      try {
        await handler(payload);
        delivered += 1;
      } catch (error) {
        failed += 1;
        this.emit('handlerError', { topic, payload, error });
      }
    }
    return { delivered, failed };
  }
}

module.exports = { EventBus };
