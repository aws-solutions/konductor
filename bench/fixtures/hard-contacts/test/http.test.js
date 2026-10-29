'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createContactService, handleRequest } = require('../src');

test('POST then GET', () => {
  const s = createContactService();
  const created = handleRequest(s, { method: 'POST', path: '/contacts', body: { fullName: 'Ada', email: 'ada@example.com' } });
  assert.equal(created.status, 201);
  const got = handleRequest(s, { method: 'GET', path: `/contacts/${created.body.id}` });
  assert.equal(got.body.fullName, 'Ada');
});

test('validation errors become 400 and unknown ids 404', () => {
  const s = createContactService();
  const bad = handleRequest(s, { method: 'POST', path: '/contacts', body: { email: 'x@y.z' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.field, 'fullName');
  assert.equal(handleRequest(s, { method: 'GET', path: '/contacts/zzz' }).status, 404);
});

test('export returns csv text', () => {
  const s = createContactService();
  s.create({ fullName: 'Ada', email: 'ada@example.com' });
  const r = handleRequest(s, { method: 'GET', path: '/contacts/export' });
  assert.equal(r.status, 200);
  assert.match(r.body, /^id,fullName,email,phone\n/);
});
