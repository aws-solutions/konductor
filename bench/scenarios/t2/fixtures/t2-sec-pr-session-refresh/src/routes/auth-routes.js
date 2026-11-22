'use strict';

const { createRefreshToken, createSessionToken } = require('../token-service');

function authRoutes({ accounts, sessions, resets, audit, config }) {
  return {
    login(request) {
      const account = accounts.authenticate(request.body.email, request.body.password);
      if (!account) return { status: 401, body: { error: 'invalid credentials' } };
      const sessionToken = createSessionToken();
      const refreshToken = createRefreshToken();
      const rememberMe = request.body.rememberMe === true;
      sessions.create(account.id, sessionToken, refreshToken, rememberMe);
      audit.add('login_succeeded', { accountId: account.id, rememberMe });
      const cookies = { sid: sessionToken, refresh: refreshToken };
      const cookieOptions = {
        sid: { httpOnly: true, secure: true },
        refresh: { httpOnly: true, secure: true }
      };
      if (rememberMe) {
        cookies.remember = '1';
        cookieOptions.remember = { maxAge: config.absoluteSeconds };
      }
      return { status: 200, body: { account: { id: account.id } }, cookies, cookieOptions };
    },

    refresh(request) {
      const current = sessions.findByRefreshToken(request.cookies.refresh);
      if (!current) return { status: 401, body: { error: 'refresh expired' } };
      const sessionToken = createSessionToken();
      const refreshToken = createRefreshToken();
      const replacement = sessions.rotateRefreshToken(current, sessionToken, refreshToken);
      audit.add('session_refreshed', { accountId: replacement.accountId, sessionId: replacement.id });
      return {
        status: 200,
        body: { account: { id: replacement.accountId } },
        cookies: { sid: sessionToken, refresh: refreshToken },
        cookieOptions: {
          sid: { httpOnly: true, secure: true },
          refresh: { httpOnly: true, secure: true }
        }
      };
    },

    logout(request) {
      audit.add('logout', { sessionId: request.cookies.sid ?? null });
      return { status: 204, body: null, clearCookies: ['sid', 'refresh', 'remember'] };
    },

    resetRequest(request) {
      const result = resets.request(request.body.email);
      audit.add('password_reset_requested', { accountId: result.accountId ?? null });
      return { status: 202, body: { accepted: result.accepted } };
    }
  };
}

module.exports = { authRoutes };
