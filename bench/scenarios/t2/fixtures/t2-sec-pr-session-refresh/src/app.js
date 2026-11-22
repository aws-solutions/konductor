'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readConfig } = require('./config');
const { AccountService } = require('./account-service');
const { SessionStore } = require('./session-store');
const { ResetService } = require('./reset-service');
const { AuditLog } = require('./audit-log');
const { authRoutes } = require('./routes/auth-routes');
const { accountRoutes } = require('./routes/account-routes');

function loadAccounts() {
  const file = path.join(__dirname, 'data/accounts.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function createApp({ clock } = {}) {
  const config = readConfig();
  if (clock) config.now = clock;
  const rawAccounts = loadAccounts();
  const sessions = new SessionStore(config, config.now);
  const accounts = new AccountService(rawAccounts, sessions);
  const resets = new ResetService(rawAccounts, config, config.now);
  const audit = new AuditLog();
  const auth = authRoutes({ accounts, sessions, resets, audit, config });
  const account = accountRoutes({ accounts, sessions, audit });

  return {
    config,
    accounts,
    sessions,
    resets,
    audit,
    async handle(request) {
      if (request.method === 'POST' && request.path === '/login') return auth.login(request);
      if (request.method === 'POST' && request.path === '/refresh') return auth.refresh(request);
      if (request.method === 'POST' && request.path === '/logout') return auth.logout(request);
      if (request.method === 'POST' && request.path === '/password') return account.password(request);
      if (request.method === 'POST' && request.path === '/password-reset/request') return auth.resetRequest(request);
      return { status: 404, body: { error: 'not found' } };
    }
  };
}

module.exports = { createApp };
