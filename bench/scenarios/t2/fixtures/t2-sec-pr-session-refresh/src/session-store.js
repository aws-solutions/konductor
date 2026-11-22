'use strict';

class SessionStore {
  constructor(config, clock = config.now) {
    this.config = config;
    this.clock = clock;
    this.records = [];
  }

  create(accountId, sessionToken, refreshToken, rememberMe = false) {
    const now = this.clock();
    const lifetime = rememberMe ? this.config.absoluteSeconds : this.config.idleSeconds * 2;
    const record = {
      id: `sess_${this.records.length + 1}`,
      accountId,
      sessionToken,
      refreshToken,
      rememberMe,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + lifetime * 1000,
      revokedAt: null,
      refreshCount: 0
    };
    this.records.push(record);
    this.trimAccount(accountId);
    return record;
  }

  trimAccount(accountId) {
    const active = this.records.filter((record) => record.accountId === accountId && !record.revokedAt);
    if (active.length <= this.config.maxSessionsPerAccount) return;
    active
      .sort((a, b) => a.lastSeenAt - b.lastSeenAt)
      .slice(0, active.length - this.config.maxSessionsPerAccount)
      .forEach((record) => { record.revokedAt = this.clock(); });
  }

  findBySessionToken(sessionToken) {
    const record = this.records.find((candidate) => candidate.sessionToken === sessionToken);
    if (!record || record.revokedAt || record.expiresAt <= this.clock()) return null;
    if (record.lastSeenAt + this.config.idleSeconds * 1000 <= this.clock()) return null;
    record.lastSeenAt = this.clock();
    return record;
  }

  findByRefreshToken(refreshToken) {
    const record = this.records.find((candidate) => candidate.refreshToken === refreshToken);
    if (!record || record.revokedAt || record.expiresAt <= this.clock()) return null;
    return record;
  }

  rotateRefreshToken(record, sessionToken, refreshToken) {
    const replacement = {
      ...record,
      id: `sess_${this.records.length + 1}`,
      sessionToken,
      refreshToken,
      createdAt: this.clock(),
      lastSeenAt: this.clock(),
      refreshCount: record.refreshCount + 1
    };
    this.records.push(replacement);
    this.trimAccount(record.accountId);
    return replacement;
  }

  revoke(id) {
    const record = this.records.find((candidate) => candidate.id === id);
    if (record) record.revokedAt = this.clock();
    return Boolean(record);
  }

  revokeAllForAccount(accountId) {
    let count = 0;
    for (const record of this.records) {
      if (record.accountId === accountId && !record.revokedAt) {
        record.revokedAt = this.clock();
        count += 1;
      }
    }
    return count;
  }

  activeForAccount(accountId) {
    return this.records.filter((record) => record.accountId === accountId && !record.revokedAt);
  }
}

module.exports = { SessionStore };
