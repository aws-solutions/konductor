'use strict';

const { digest } = require('./token-service');

class ResetService {
  constructor(accounts, config, clock = config.now) {
    this.accounts = accounts;
    this.config = config;
    this.clock = clock;
    this.pending = new Map();
  }

  request(email) {
    const account = this.accounts.find((item) => item.email.toLowerCase() === String(email).toLowerCase());
    if (!account) return { accepted: true };
    const raw = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    this.pending.set(digest(raw), {
      accountId: account.id,
      expiresAt: this.clock() + this.config.passwordResetSeconds * 1000
    });
    return { accepted: true, accountId: account.id, token: raw };
  }

  consume(raw) {
    const key = digest(raw);
    const entry = this.pending.get(key);
    if (!entry || entry.expiresAt <= this.clock()) return null;
    this.pending.delete(key);
    return this.accounts.find((account) => account.id === entry.accountId) ?? null;
  }
}

module.exports = { ResetService };
