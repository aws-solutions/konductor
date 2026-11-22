'use strict';

const { createApp } = require('../src/app');

function request(path, body = {}, cookies = {}) {
  return { method: 'POST', path, body, cookies, headers: {} };
}

function signedInApp() {
  const app = createApp();
  const result = app.handle(request('/login', { email: 'alex@example.test', password: 'correct horse' }));
  return Promise.resolve(result).then((login) => ({ app, login }));
}

module.exports = { request, signedInApp };
