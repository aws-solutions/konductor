export class SyncEmitter {
  constructor() { this.messages = []; }

  async publish(topic, payload) {
    await new Promise((resolve) => setImmediate(resolve));
    this.messages.push({ topic, payload: structuredClone(payload) });
  }

  all() { return this.messages.map((message) => ({ ...message })); }
}
