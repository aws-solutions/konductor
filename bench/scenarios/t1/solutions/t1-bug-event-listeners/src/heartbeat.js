'use strict';

class Heartbeat {
  constructor(connection, intervalMs = 30000) {
    this.connection = connection;
    this.intervalMs = intervalMs;
    this.timer = null;
  }

  start() {
    if (this.timer) return this;
    this.timer = setInterval(() => this.connection.ping(), this.intervalMs);
    this.timer.unref();
    return this;
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  get running() {
    return this.timer !== null;
  }
}

module.exports = { Heartbeat };
