'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createContactService, ValidationError } = require('../src');

test('displayName is the main field and fullName stays as an alias', () => {
  const s = createContactService();
  const c = s.create({ displayName: 'Ada', email: 'a@x.y' });
  assert.deepEqual([c.displayName, c.fullName, c.locale], ['Ada', 'Ada', 'en']);
  assert.equal(s.create({ fullName: 'Bob', email: 'b@x.y' }).displayName, 'Bob');
});

test('differing displayName and fullName are rejected', () => {
  assert.throws(() => createContactService().create({ displayName: 'A', fullName: 'B', email: 'a@x.y' }), (e) => e instanceof ValidationError);
});

test('search sees updates and returned contacts are copies', () => {
  const s = createContactService();
  s.create({ displayName: 'Ada', email: 'a@x.y' });
  s.update('c1', { displayName: 'Zoe' });
  assert.equal(s.search('ada').length, 0);
  assert.equal(s.search('zoe').length, 1);
  s.get('c1').displayName = 'Hacked';
  assert.equal(s.get('c1').displayName, 'Zoe');
});
