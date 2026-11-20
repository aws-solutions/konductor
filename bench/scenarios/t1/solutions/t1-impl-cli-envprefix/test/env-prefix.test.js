'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/config');

test('environment values win over file values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncer-env-test-'));
  try {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ bucket: 'from-file' }));
    const result = loadConfig(file, { SYNCER_BUCKET: 'from-env' }, {});
    assert.equal(result.values.bucket, 'from-env');
    assert.equal(result.sources.bucket, 'environment');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('custom prefixes are exposed by the loader default', () => {
  const result = loadConfig('/path/that/does/not/exist.json', {}, {});
  assert.equal(result.envPrefix, 'SYNCER_');
});
