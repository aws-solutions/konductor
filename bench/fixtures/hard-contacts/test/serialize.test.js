'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toCsv, createContactService } = require('../src');

test('csv has the legacy header and one row per contact', () => {
  const csv = toCsv([{ id: 'c1', fullName: 'Ada', email: 'a@x.y', phone: null }, { id: 'c2', fullName: 'Bob', email: 'b@x.y', phone: '1' }]);
  assert.equal(csv, 'id,fullName,email,phone\nc1,Ada,a@x.y,\nc2,Bob,b@x.y,1\n');
});

test('exportCsv follows list order', () => {
  const s = createContactService();
  s.create({ fullName: 'Zed', email: 'z@x.y' });
  s.create({ fullName: 'Amy', email: 'a@x.y' });
  assert.match(s.exportCsv(), /^id,fullName,email,phone\nc2,Amy/);
});
