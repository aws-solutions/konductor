'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ResetService } = require('../src/reset-service');

test('creates a reset token only for a known account', () => {
  let now = 10;
  const accounts = [{ id: 'a', email: 'a@example.test' }];
  const service = new ResetService(accounts, { now: () => now, passwordResetSeconds: 20 }, () => now);
  assert.equal(service.request('unknown@example.test').token, undefined);
  const issued = service.request('a@example.test');
  assert.equal(service.consume(issued.token).id, 'a');
  assert.equal(service.consume(issued.token), null);
});

test('rejects an expired reset token', () => {
  let now = 10;
  const accounts = [{ id: 'a', email: 'a@example.test' }];
  const service = new ResetService(accounts, { now: () => now, passwordResetSeconds: 20 }, () => now);
  const issued = service.request('a@example.test');
  now = 20_011;
  assert.equal(service.consume(issued.token), null);
});
