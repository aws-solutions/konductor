'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { request, signedInApp } = require('./fixtures');

test('changes a password from the current session', async () => {
  const { app, login } = await signedInApp();
  const response = await app.handle(request('/password', {
    currentPassword: 'correct horse',
    newPassword: 'a newer horse password'
  }, { sid: login.cookies.sid }));
  assert.equal(response.status, 204);
});

test('requires the current session for a password change', async () => {
  const { app } = await signedInApp();
  const response = await app.handle(request('/password', {
    currentPassword: 'correct horse',
    newPassword: 'a newer horse password'
  }));
  assert.equal(response.status, 401);
});
