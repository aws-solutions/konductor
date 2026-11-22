'use strict';

const { passwordDigest, passwordMatches, passwordIsAcceptable } = require('./passwords');

class AccountService {
  constructor(accounts, sessions) {
    this.accounts = accounts;
    this.sessions = sessions;
  }

  findByEmail(email) {
    return this.accounts.find((account) => account.email.toLowerCase() === String(email).toLowerCase()) ?? null;
  }

  findById(id) {
    return this.accounts.find((account) => account.id === id) ?? null;
  }

  authenticate(email, password) {
    const account = this.findByEmail(email);
    if (!account || account.lockedUntil && account.lockedUntil > Date.now()) return null;
    if (!passwordMatches(password, account.passwordHash)) {
      account.failedLogins += 1;
      return null;
    }
    account.failedLogins = 0;
    return account;
  }

  changePassword(accountId, currentPassword, nextPassword) {
    const account = this.findById(accountId);
    if (!account || !passwordMatches(currentPassword, account.passwordHash)) return false;
    if (!passwordIsAcceptable(nextPassword)) return false;
    account.passwordHash = passwordDigest(nextPassword);
    account.passwordChangedAt = Date.now();
    return true;
  }
}

module.exports = { AccountService };
