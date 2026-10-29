'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createContactService, ValidationError } = require('../src');

test('trims the name and lower-cases the email', () => {
  const c = createContactService().create({ fullName: '  Ada ', email: ' ADA@Example.com ' });
  assert.equal(c.fullName, 'Ada');
  assert.equal(c.email, 'ada@example.com');
  assert.equal(c.phone, null);
});

test('rejects a missing name and a bad email', () => {
  const s = createContactService();
  assert.throws(() => s.create({ email: 'a@b.c' }), (e) => e instanceof ValidationError && e.field === 'fullName');
  assert.throws(() => s.create({ fullName: 'A', email: 'nope' }), (e) => e.field === 'email');
});

test('a partial update only checks the given fields', () => {
  const s = createContactService();
  s.create({ fullName: 'A', email: 'a@b.c' });
  assert.equal(s.update('c1', { phone: ' 123 ' }).phone, '123');
});
