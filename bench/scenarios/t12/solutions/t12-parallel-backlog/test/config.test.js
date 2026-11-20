'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('../src/config');

function withDir(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
  try {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('reads config/app.json when it is there', () => {
  const v = withDir({ 'app.json': '{"session.ttlMinutes": 45}', 'app.ini': 'session.ttlMinutes = 30\n' }, load);
  assert.equal(v['session.ttlMinutes'], 45);
});

test('falls back to config/app.ini when app.json is missing', () => {
  const v = withDir({ 'app.ini': '# old\nsession.ttlMinutes = 30\n' }, load);
  assert.equal(v['session.ttlMinutes'], '30');
});
