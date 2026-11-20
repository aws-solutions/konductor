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
    const topic = topicFor(userId);
    const listener = async (payload) => connection.send(payload);
    this.bus.on(topic, listener);
    const heartbeat = new Heartbeat(connection, this.heartbeatIntervalMs).start();
    const session = { userId, connection, listener, heartbeat };
    if (!this.sessions.has(userId)) this.sessions.set(userId, []);
    this.sessions.get(userId).push(session);
    return session;
  }

  disconnect(userId, connection) {
    const sessions = this.sessions.get(userId) || [];
    const index = sessions.findIndex((session) => session.connection === connection);
    if (index === -1) return false;
    const [session] = sessions.splice(index, 1);
    session.heartbeat.stop();
    this.bus.off(topicFor(userId), session.listener);
    if (sessions.length === 0) this.sessions.delete(userId);
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
    return (this.sessions.get(userId) || []).length;
  }

  close() {
    for (const [userId, sessions] of this.sessions) {
      for (const session of [...sessions]) this.disconnect(userId, session.connection);
    }
  }
}

module.exports = { NotificationService, topicFor };
