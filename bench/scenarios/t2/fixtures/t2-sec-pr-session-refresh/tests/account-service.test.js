'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AccountService } = require('../src/account-service');
const { passwordDigest } = require('../src/passwords');

test('authenticates a known account and resets failed attempts', () => {
  const account = { id: 'a', email: 'A@EXAMPLE.TEST', passwordHash: passwordDigest('long password'), failedLogins: 2, lockedUntil: null };
  const service = new AccountService([account], {});
  assert.equal(service.authenticate('a@example.test', 'long password'), account);
  assert.equal(account.failedLogins, 0);
});

test('rejects a short replacement password', () => {
  const account = { id: 'a', email: 'a@example.test', passwordHash: passwordDigest('long password'), failedLogins: 0, lockedUntil: null };
  const service = new AccountService([account], {});
  assert.equal(service.changePassword('a', 'long password', 'short'), false);
});
