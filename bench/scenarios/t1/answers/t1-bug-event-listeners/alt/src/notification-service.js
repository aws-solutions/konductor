'use strict';

const { EventBus } = require('./event-bus');
const { Heartbeat } = require('./heartbeat');

function topicFor(userId) {
  return `notification:${userId}`;
}

class NotificationService {
  constructor(options = {}) {
    this.bus = options.bus || new EventBus();
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30000;
    this.sessions = new Map();
  }

  connect(userId, connection) {
    const existing = this.sessions.get(userId);
    if (existing && existing.connection === connection) {
      return existing;
    }
    if (existing) {
      existing.heartbeat.stop();
      this.bus.off(topicFor(userId), existing.listener);
      this.sessions.delete(userId);
    }
    const topic = topicFor(userId);
    const listener = (payload) => {
      if (connection.readyState === 'OPEN') {
        connection.send(payload);
      }
    };
    this.bus.on(topic, listener);
    const heartbeat = new Heartbeat(connection, this.heartbeatIntervalMs).start();
    const session = { userId, connection, listener, heartbeat };
    this.sessions.set(userId, session);
    return session;
  }

  disconnect(userId, connection) {
    const session = this.sessions.get(userId);
    if (!session || session.connection !== connection) {
      return false;
    }
    this.sessions.delete(userId);
    session.heartbeat.stop();
    this.bus.off(topicFor(userId), session.listener);
    return true;
  }

  subscribe(userId, handler) {
    return this.bus.subscribe(topicFor(userId), handler);
  }

  async notify(userId, payload) {
    await this.bus.publish(topicFor(userId), payload);
  }

  listenerCount(userId) {
    return this.bus.listenerCount(topicFor(userId));
  }

  connectionCount(userId) {
    return this.sessions.has(userId) ? 1 : 0;
  }

  close() {
    for (const [userId, session] of this.sessions) {
      session.heartbeat.stop();
      this.bus.off(topicFor(userId), session.listener);
    }
    this.sessions.clear();
  }
}

module.exports = { NotificationService, topicFor };
