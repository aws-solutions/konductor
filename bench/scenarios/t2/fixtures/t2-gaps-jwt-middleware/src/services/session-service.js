const crypto = require('node:crypto');

class SessionService {
  constructor(clock = Date) { this.clock = clock; this.sessions = new Map(); }
  create(userId) { const id = crypto.randomUUID(); this.sessions.set(id, { userId, created: this.clock.now() }); return id; }
  get(id) { return this.sessions.get(id) || null; }
  destroy(id) { this.sessions.delete(id); }
}

module.exports = { SessionService };
