const { DedupeStore } = require('./dedupe-store');

class WebhookWorker {
  constructor({ handle, clock } = {}) {
    this.handle = handle || (() => undefined);
    this.store = new DedupeStore({ clock });
  }

  async accept(delivery) {
    const key = delivery && delivery.idempotencyKey;
    if (!this.store.remember(key)) {
      return { status: 'duplicate', key };
    }
    await this.handle(delivery.payload, delivery);
    return { status: 'processed', key };
  }
}

function createWebhookWorker(options) {
  return new WebhookWorker(options);
}

module.exports = { WebhookWorker, createWebhookWorker };
