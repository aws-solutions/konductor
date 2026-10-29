'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createContactService } = require('../src');

test('create assigns sequential ids and get returns the contact', () => {
  const s = createContactService();
  assert.equal(s.create({ fullName: 'Ada Lovelace', email: 'ada@example.com' }).id, 'c1');
  assert.equal(s.create({ fullName: 'Alan Turing', email: 'alan@example.com' }).id, 'c2');
  assert.equal(s.get('c2').fullName, 'Alan Turing');
  assert.equal(s.get('c9'), null);
});

test('a failed create does not use up an id', () => {
  const s = createContactService();
  assert.throws(() => s.create({ fullName: '', email: 'x@y.z' }));
  assert.equal(s.create({ fullName: 'B', email: 'b@y.z' }).id, 'c1');
});

test('list sorts by name', () => {
  const s = createContactService();
  s.create({ fullName: 'Zed', email: 'z@x.y' });
  s.create({ fullName: 'Amy', email: 'a@x.y' });
  assert.deepEqual(s.list().map((c) => c.fullName), ['Amy', 'Zed']);
});

test('search finds by name or email, ignoring case', () => {
  const s = createContactService();
  s.create({ fullName: 'Ada Lovelace', email: 'ada@example.com' });
  s.create({ fullName: 'Bob', email: 'bob@lovelace.org' });
  assert.deepEqual(s.search('LOVELACE').map((c) => c.id), ['c1', 'c2']);
  assert.deepEqual(s.search('  '), []);
});

test('update changes fields and returns null for an unknown id', () => {
  const s = createContactService();
  s.create({ fullName: 'Ada', email: 'ada@example.com' });
  assert.equal(s.update('c1', { phone: '555' }).phone, '555');
  assert.equal(s.update('nope', { phone: '1' }), null);
});
