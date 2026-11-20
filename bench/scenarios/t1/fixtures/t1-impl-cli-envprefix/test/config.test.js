'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/config');

test('defaults are stable', () => {
  const config = loadConfig(path.join(os.tmpdir(), 'file-that-is-not-there.json'));
  assert.equal(config.bucket, 'local');
  assert.equal(config.concurrency, 4);
});

test('json values are loaded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncer-config-'));
  try {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ bucket: 'nightly', dryRun: true }));
    const config = loadConfig(file);
    assert.equal(config.bucket, 'nightly');
    assert.equal(config.dryRun, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
