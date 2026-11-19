const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { UserStore } = require('../src/store/user-store');
const { SessionService } = require('../src/services/session-service');
const { createSessionRoutes } = require('../src/routes/session-routes');

test('login creates an http-only session cookie', () => {
  const users = new UserStore(path.join(__dirname, '..', 'data', 'users.json'));
  const routes = createSessionRoutes({ users, sessions: new SessionService() });
  const response = routes.login({ body: { email: 'alex@example.test', password: 'password123' } });
  assert.equal(response.status, 200);
  assert.match(response.headers['set-cookie'], /HttpOnly/);
});

test('login rejects a short password', () => {
  const users = new UserStore(path.join(__dirname, '..', 'data', 'users.json'));
  const routes = createSessionRoutes({ users, sessions: new SessionService() });
  assert.equal(routes.login({ body: { email: 'alex@example.test', password: 'short' } }).status, 400);
});
