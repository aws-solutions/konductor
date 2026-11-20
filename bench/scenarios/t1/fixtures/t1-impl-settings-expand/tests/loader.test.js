'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSettings } = require('../src/loader');
const { temporaryDirectory, writeEnv } = require('./helpers');

test('later files replace earlier values and environment replaces file values', () => {
  const dir = temporaryDirectory();
  try {
    const base = writeEnv(dir, 'base.env', 'PORT=7000\nLOG_LEVEL=info\n');
    const local = writeEnv(dir, 'local.env', 'LOG_LEVEL=debug\n');
    const settings = loadSettings({ files: [base, local], env: { PORT: '7100' } });
    assert.equal(settings.get('LOG_LEVEL'), 'debug');
    assert.equal(settings.port, 7100);
  } finally {
    require('node:fs').rmSync(dir, { recursive: true, force: true });
  }
});
