'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load, get } = require('../src/config');

test('the shipped config/app.json gives the same settings as the old app.ini', () => {
  assert.equal(get('session.ttlMinutes'), 30);
  assert.equal(get('export.delimiter'), ',');
});

test('a directory with only app.ini is still read', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'app.ini'), 'session.ttlMinutes = 15\n');
  assert.deepEqual(load(dir), { 'session.ttlMinutes': '15' });
});
