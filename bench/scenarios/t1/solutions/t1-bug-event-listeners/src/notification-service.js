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
    if (typeof options.onHandlerError === 'function') {
      this.bus.on('handlerError', options.onHandlerError);
    }
  }

  connect(userId, connection) {
    const sessions = this.sessions.get(userId) || [];
    const existing = sessions.find((session) => session.connection === connection);
    if (existing) return existing;

    const topic = topicFor(userId);
    const listener = async (payload) => connection.send(payload);
    const heartbeat = new Heartbeat(connection, this.heartbeatIntervalMs).start();
    const session = { userId, connection, listener, heartbeat };
    session.closeListener = () => this.disconnect(userId, connection);
    this.bus.on(topic, listener);
    connection.once('close', session.closeListener);
    sessions.push(session);
    this.sessions.set(userId, sessions);
    return session;
  }

  disconnect(userId, connection) {
    const sessions = this.sessions.get(userId) || [];
    const index = sessions.findIndex((session) => session.connection === connection);
    if (index === -1) return false;
    const [session] = sessions.splice(index, 1);
    this.bus.off(topicFor(userId), session.listener);
    session.heartbeat.stop();
    connection.off('close', session.closeListener);
    if (sessions.length === 0) this.sessions.delete(userId);
    return true;
  }

  subscribe(userId, handler) {
    return this.bus.subscribe(topicFor(userId), handler);
  }

  async notify(userId, payload) {
    return this.bus.publish(topicFor(userId), payload);
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
