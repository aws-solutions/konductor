'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { request } = require('./fixtures');

test('logs in and logs out a browser session', async () => {
  const app = createApp();
  const login = await app.handle(request('/login', { email: 'alex@example.test', password: 'correct horse' }));
  assert.equal(login.status, 200);
  assert.ok(login.cookies.refresh.startsWith('r_'));
  const logout = await app.handle(request('/logout', {}, { sid: login.cookies.sid }));
  assert.equal(logout.status, 204);
  assert.deepEqual(logout.clearCookies, ['sid', 'refresh', 'remember']);
});

test('creates a longer-lived cookie set when remember me is selected', async () => {
  const app = createApp();
  const response = await app.handle(request('/login', {
    email: 'alex@example.test',
    password: 'correct horse',
    rememberMe: true
  }));
  assert.equal(response.status, 200);
  assert.equal(response.cookies.remember, '1');
  assert.equal(response.cookieOptions.remember.maxAge, 2592000);
});

test('refreshes an active session with a replacement cookie pair', async () => {
  const app = createApp();
  const login = await app.handle(request('/login', { email: 'alex@example.test', password: 'correct horse' }));
  const refreshed = await app.handle(request('/refresh', {}, { refresh: login.cookies.refresh }));
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.cookies.sid, login.cookies.sid);
  assert.notEqual(refreshed.cookies.refresh, login.cookies.refresh);
});

test('rejects bad login credentials', async () => {
  const app = createApp();
  const response = await app.handle(request('/login', { email: 'alex@example.test', password: 'not it' }));
  assert.equal(response.status, 401);
});
