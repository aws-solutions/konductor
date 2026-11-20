'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/config');

test('default config has the documented shape', () => {
  const config = loadConfig();
  assert.deepEqual(config, { mode: 'safe', color: false, root: '.' });
});

test('invalid mode is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-config-'));
  const file = path.join(dir, 'bad.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ mode: 'unknown', color: false, root: '.' }));
    assert.throws(() => loadConfig(file), /Invalid config: mode/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
