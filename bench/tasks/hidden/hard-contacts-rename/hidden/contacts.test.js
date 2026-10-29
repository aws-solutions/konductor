'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createContactService, handleRequest, toCsv, ValidationError } = require('../src');

const svc = () => createContactService();
const mk = (s, displayName, email = `${displayName.replace(/\W/g, '').toLowerCase()}@x.org`, extra = {}) => s.create({ displayName, email, ...extra });
const names = (list) => list.map((c) => c.displayName);
const req = (s, method, path, o = {}) => handleRequest(s, { method, path, ...o });

test('create returns displayName, the fullName alias, and the default locale', () => {
  assert.deepEqual(mk(svc(), 'Ada Lovelace', 'ADA@Example.com'), {
    id: 'c1', displayName: 'Ada Lovelace', fullName: 'Ada Lovelace', email: 'ada@example.com', phone: null, locale: 'en',
  });
});

test('the legacy fullName input still works', () => {
  const c = svc().create({ fullName: '  Alan Turing ', email: 'alan@x.org', phone: ' 1 ' });
  assert.deepEqual([c.displayName, c.fullName, c.phone], ['Alan Turing', 'Alan Turing', '1']);
});

test('both names may be given when they are equal after trimming', () => {
  const c = svc().create({ displayName: 'Ada', fullName: ' Ada ', email: 'a@x.org' });
  assert.equal(c.displayName, 'Ada');
});

test('both names with different values are rejected with a name error', () => {
  const s = svc();
  assert.throws(() => s.create({ displayName: 'A', fullName: 'B', email: 'a@x.org' }), (e) => e instanceof ValidationError && e.field === 'fullName');
  assert.equal(mk(s, 'Next').id, 'c1');
});

test('name problems report the field fullName', () => {
  const s = svc();
  for (const input of [{ email: 'a@x.org' }, { displayName: '   ', email: 'a@x.org' }, { displayName: 'x'.repeat(81), email: 'a@x.org' }, { displayName: 42, email: 'a@x.org' }]) {
    assert.throws(() => s.create(input), (e) => e instanceof ValidationError && e.field === 'fullName');
  }
  assert.doesNotThrow(() => s.create({ displayName: 'x'.repeat(80), email: 'a@x.org' }));
});

test('locale defaults to en and must look like xx or xx-XX', () => {
  const s = svc();
  assert.equal(mk(s, 'A', 'a@x.org', { locale: 'pt-BR' }).locale, 'pt-BR');
  assert.equal(mk(s, 'B', 'b@x.org', { locale: 'fr' }).locale, 'fr');
  for (const locale of ['EN', 'en_GB', 'en-gb', 'eng', 'e', '', null, 5, 'en-GB-x']) {
    assert.throws(() => mk(s, 'C', 'c@x.org', { locale }), (e) => e instanceof ValidationError && e.field === 'locale', String(locale));
  }
});

test('a failed create uses no id', () => {
  const s = svc();
  assert.throws(() => s.create({ displayName: 'A', email: 'bad' }));
  assert.throws(() => mk(s, 'B', 'b@x.org', { locale: 'zz-zz' }));
  assert.equal(mk(s, 'C').id, 'c1');
});

test('update with displayName, the fullName alias and locale', () => {
  const s = svc();
  mk(s, 'Ada');
  assert.deepEqual([s.update('c1', { displayName: 'Ada L' }).fullName, s.get('c1').displayName], ['Ada L', 'Ada L']);
  assert.deepEqual([s.update('c1', { fullName: 'Ada M' }).displayName, s.get('c1').fullName], ['Ada M', 'Ada M']);
  assert.equal(s.update('c1', { locale: 'de-DE' }).locale, 'de-DE');
  assert.equal(s.get('c1').displayName, 'Ada M');
});

test('update validates, leaves the contact unchanged on failure, and returns null for unknown ids', () => {
  const s = svc();
  mk(s, 'Ada');
  assert.throws(() => s.update('c1', { displayName: 'B', fullName: 'C' }), (e) => e.field === 'fullName');
  assert.throws(() => s.update('c1', { locale: 'xx_YY' }), (e) => e.field === 'locale');
  assert.throws(() => s.update('c1', { email: 'nope' }), (e) => e.field === 'email');
  assert.equal(s.get('c1').displayName, 'Ada');
  assert.equal(s.update('zzz', { displayName: 'X' }), null);
});

test('update can clear the phone and does not touch other fields', () => {
  const s = svc();
  mk(s, 'Ada', 'ada@x.org', { phone: '555', locale: 'fr' });
  const c = s.update('c1', { phone: null });
  assert.deepEqual([c.phone, c.locale, c.email], [null, 'fr', 'ada@x.org']);
});

test('the fullName alias never goes stale after a rename', () => {
  const s = svc();
  mk(s, 'Old Name');
  s.update('c1', { displayName: 'New Name' });
  assert.equal(s.get('c1').fullName, 'New Name');
  assert.equal(s.list()[0].fullName, 'New Name');
  assert.equal(s.search('new')[0].fullName, 'New Name');
});

test('returned contacts are copies of the stored data', () => {
  const s = svc();
  const created = mk(s, 'Ada');
  created.displayName = 'Changed';
  created.phone = 'x';
  const got = s.get('c1');
  got.email = 'evil@x.org';
  s.list()[0].displayName = 'Changed again';
  s.search('ada')[0].locale = 'xx';
  assert.deepEqual(s.get('c1'), { id: 'c1', displayName: 'Ada', fullName: 'Ada', email: 'ada@x.org', phone: null, locale: 'en' });
});

test('search finds a renamed contact by its new name and not by the old one', () => {
  const s = svc();
  mk(s, 'Ada Lovelace', 'ada@one.org');
  mk(s, 'Bob', 'bob@two.org');
  s.update('c1', { displayName: 'Countess Augusta' });
  assert.deepEqual(names(s.search('countess')), ['Countess Augusta']);
  assert.deepEqual(names(s.search('lovelace')), []);
});

test('search sees an email change at once and matches name or email ignoring case', () => {
  const s = svc();
  mk(s, 'Ada', 'ada@one.org');
  s.update('c1', { email: 'Ada@Other.net' });
  assert.deepEqual(names(s.search('OTHER')), ['Ada']);
  assert.deepEqual(names(s.search('one.org')), []);
  assert.deepEqual(names(s.search('  ADA ')), ['Ada']);
});

test('search results are in creation order and a blank query matches nothing', () => {
  const s = svc();
  mk(s, 'Zed Smith'); mk(s, 'Amy Smith'); mk(s, 'Bo Jones');
  assert.deepEqual(names(s.search('smith')), ['Zed Smith', 'Amy Smith']);
  assert.deepEqual(s.search(''), []);
  assert.deepEqual(s.search('   '), []);
});

test('list sorts by displayName ignoring case, ties keep creation order', () => {
  const s = svc();
  mk(s, 'bob', 'b1@x.org'); mk(s, 'Alice', 'a@x.org'); mk(s, 'Bob', 'b2@x.org'); mk(s, 'carol', 'c@x.org');
  assert.deepEqual(s.list().map((c) => c.email), ['a@x.org', 'b1@x.org', 'b2@x.org', 'c@x.org']);
  assert.deepEqual(s.list({ sort: 'displayName' }).map((c) => c.email), s.list().map((c) => c.email));
});

test('list accepts fullName as an alias and sorts by email or id', () => {
  const s = svc();
  mk(s, 'B', 'z@x.org'); mk(s, 'A', 'Y@x.org');
  assert.deepEqual(names(s.list({ sort: 'fullName' })), ['A', 'B']);
  assert.deepEqual(names(s.list({ sort: 'email' })), ['A', 'B']);
  for (let i = 0; i < 11; i++) mk(s, `n${i}`, `n${i}@x.org`);
  assert.deepEqual(s.list({ sort: 'id' }).map((c) => c.id).slice(0, 4), ['c1', 'c2', 'c3', 'c4']);
});

test('list rejects an unknown sort key', () => {
  assert.throws(() => svc().list({ sort: 'phone' }), (e) => e instanceof ValidationError && e.field === 'sort');
});

test('csv version 1 keeps the legacy header and columns', () => {
  const s = svc();
  mk(s, 'Zed', 'z@x.org', { phone: '5', locale: 'fr' }); mk(s, 'Amy', 'a@x.org');
  assert.equal(s.exportCsv(), 'id,fullName,email,phone\nc2,Amy,a@x.org,\nc1,Zed,z@x.org,5\n');
  assert.equal(s.exportCsv({ version: 1 }), s.exportCsv());
});

test('csv version 2 has displayName and locale', () => {
  const s = svc();
  mk(s, 'Zed', 'z@x.org', { phone: '5', locale: 'fr' }); mk(s, 'Amy', 'a@x.org');
  assert.equal(s.exportCsv({ version: 2 }), 'id,displayName,email,phone,locale\nc2,Amy,a@x.org,,en\nc1,Zed,z@x.org,5,fr\n');
});

test('csv rejects other versions', () => {
  for (const version of [0, 3, '2', null]) assert.throws(() => svc().exportCsv({ version }), (e) => e instanceof ValidationError && e.field === 'version', String(version));
});

test('csv quotes commas, quotes and line breaks in both versions', () => {
  const s = svc();
  mk(s, 'Doe, Jane', 'j@x.org', { phone: '1,2' }); mk(s, 'The "Boss"', 'b@x.org'); mk(s, 'Two\nLines', 'l@x.org');
  const v1 = s.exportCsv();
  assert.ok(v1.includes('"Doe, Jane"'));
  assert.ok(v1.includes('"The ""Boss"""'));
  assert.ok(v1.includes('"Two\nLines"'));
  assert.ok(s.exportCsv({ version: 2 }).includes('c1,"Doe, Jane",j@x.org,"1,2",en\n'));
});

test('toCsv takes the version option and still reads legacy shaped rows', () => {
  const legacy = [{ id: 'c1', fullName: 'Ada', email: 'a@x.y', phone: null }];
  assert.equal(toCsv(legacy), 'id,fullName,email,phone\nc1,Ada,a@x.y,\n');
  assert.equal(toCsv(legacy, { version: 2 }), 'id,displayName,email,phone,locale\nc1,Ada,a@x.y,,en\n');
  const modern = [{ id: 'c1', displayName: 'Ada', fullName: 'Ada', email: 'a@x.y', phone: '7', locale: 'de' }];
  assert.equal(toCsv(modern), 'id,fullName,email,phone\nc1,Ada,a@x.y,7\n');
  assert.equal(toCsv(modern, { version: 2 }), 'id,displayName,email,phone,locale\nc1,Ada,a@x.y,7,de\n');
});

test('POST creates with displayName or fullName and returns the new shape', () => {
  const s = svc();
  const a = req(s, 'POST', '/contacts', { body: { displayName: 'Ada', email: 'a@x.org', locale: 'en-GB' } });
  assert.equal(a.status, 201);
  assert.deepEqual(a.body, { id: 'c1', displayName: 'Ada', fullName: 'Ada', email: 'a@x.org', phone: null, locale: 'en-GB' });
  assert.equal(req(s, 'POST', '/contacts', { body: { fullName: 'Bob', email: 'b@x.org' } }).body.displayName, 'Bob');
});

test('POST validation failures are 400 with the field', () => {
  const s = svc();
  assert.deepEqual(req(s, 'POST', '/contacts', { body: { email: 'a@x.org' } }).body.error.field, 'fullName');
  const bad = req(s, 'POST', '/contacts', { body: { displayName: 'A', email: 'a@x.org', locale: 'bad' } });
  assert.deepEqual([bad.status, bad.body.error.field], [400, 'locale']);
});

test('GET and PATCH by id', () => {
  const s = svc();
  mk(s, 'Ada');
  assert.equal(req(s, 'GET', '/contacts/c1').body.displayName, 'Ada');
  const p = req(s, 'PATCH', '/contacts/c1', { body: { fullName: 'Ada L', locale: 'es' } });
  assert.deepEqual([p.status, p.body.displayName, p.body.locale], [200, 'Ada L', 'es']);
  assert.equal(req(s, 'PATCH', '/contacts/c9', { body: {} }).status, 404);
  assert.equal(req(s, 'PATCH', '/contacts/c1', { body: { locale: 'x' } }).status, 400);
  assert.equal(req(s, 'GET', '/contacts/c9').body.error.message, 'not found');
});

test('GET /contacts lists, sorts and searches', () => {
  const s = svc();
  mk(s, 'zed'); mk(s, 'Amy'); mk(s, 'Bob');
  assert.deepEqual(names(req(s, 'GET', '/contacts').body.contacts), ['Amy', 'Bob', 'zed']);
  assert.deepEqual(names(req(s, 'GET', '/contacts', { query: { sort: 'fullName' } }).body.contacts), ['Amy', 'Bob', 'zed']);
  assert.deepEqual(names(req(s, 'GET', '/contacts', { query: { q: 'AM' } }).body.contacts), ['Amy']);
  const bad = req(s, 'GET', '/contacts', { query: { sort: 'nope' } });
  assert.deepEqual([bad.status, bad.body.error.field], [400, 'sort']);
});

test('GET /contacts/export serves csv versions 1 and 2', () => {
  const s = svc();
  mk(s, 'Amy', 'a@x.org', { locale: 'fr' });
  assert.equal(req(s, 'GET', '/contacts/export').body, 'id,fullName,email,phone\nc1,Amy,a@x.org,\n');
  const v2 = req(s, 'GET', '/contacts/export', { query: { version: '2' } });
  assert.deepEqual([v2.status, v2.body], [200, 'id,displayName,email,phone,locale\nc1,Amy,a@x.org,,fr\n']);
  const bad = req(s, 'GET', '/contacts/export', { query: { version: '9' } });
  assert.deepEqual([bad.status, bad.body.error.field], [400, 'version']);
});

test('the seed file and the examples use the new field name', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'seed.json'), 'utf8'));
  assert.ok(seed.every((r) => r.displayName && r.fullName === undefined));
  const s = svc();
  seed.forEach((r) => s.create(r));
  assert.deepEqual(names(s.list()), ['Ada Lovelace', 'Alan Turing', 'grace hopper']);
});
