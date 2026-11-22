'use strict';

function accountRoutes({ accounts, sessions, audit }) {
  return {
    password(request) {
      const session = sessions.findBySessionToken(request.cookies.sid);
      if (!session) return { status: 401, body: { error: 'sign in required' } };
      const account = accounts.findById(session.accountId);
      const changed = accounts.changePassword(account.id, request.body.currentPassword, request.body.newPassword);
      if (!changed) return { status: 400, body: { error: 'password not changed' } };
      audit.add('password_changed', { accountId: account.id });
      return { status: 204, body: null };
    }
  };
}

module.exports = { accountRoutes };
