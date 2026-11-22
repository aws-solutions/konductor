export class MemoryQueue {
  #messages = [];

  publish(topic, message) {
    this.#messages.push({ topic, message: structuredClone(message) });
  }

  all() {
    return structuredClone(this.#messages);
  }
}
