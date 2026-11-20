'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSettings, ExpansionError } = require('../src/loader');
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

test('expands ${NAME} references', () => {
  const dir = temporaryDirectory();
  try {
    const file = writeEnv(dir, 'test.env', 'HOST=localhost\nURL=http://${HOST}:8080\n');
    const settings = loadSettings({ files: [file], env: {} });
    assert.equal(settings.get('URL'), 'http://localhost:8080');
  } finally {
    require('node:fs').rmSync(dir, { recursive: true, force: true });
  }
});

test('expands ${NAME:-default} with default value', () => {
  const dir = temporaryDirectory();
  try {
    const file = writeEnv(dir, 'test.env', 'HOST=\nURL=http://${HOST:-localhost}:8080\n');
    const settings = loadSettings({ files: [file], env: {} });
    assert.equal(settings.get('URL'), 'http://localhost:8080');
  } finally {
    require('node:fs').rmSync(dir, { recursive: true, force: true });
  }
});

test('uses non-empty value without default', () => {
  const dir = temporaryDirectory();
  try {
    const file = writeEnv(dir, 'test.env', 'HOST=example.com\nURL=http://${HOST:-localhost}:8080\n');
    const settings = loadSettings({ files: [file], env: {} });
    assert.equal(settings.get('URL'), 'http://example.com:8080');
  } finally {
    require('node:fs').rmSync(dir, { recursive: true, force: true });
  }
});

test('expands defaults containing references', () => {
  const dir = temporaryDirectory();
  try {
    const file = writeEnv(dir, 'test.env', 'BASE=api\nHOST=\nURL=${HOST:-${BASE}.local}\n');
    const settings = loadSettings({ files: [file], env: {} });
    assert.equal(settings.get('URL'), 'api.local');
  } finally {
    require('node:fs').rmSync(dir, { recursive: true, force: true });
  }
});

test('resolves references to env-supplied values', () => {
  const dir = temporaryDirectory();
  try {
    const file = writeEnv(dir, 'test.env', 'HOST=localhost\nURL=http://${HOST}:8080\n');
    const settings = loadSettings({ files: [file], env: { HOST: 'envhost' } });
    assert.equal(settings.get('URL'), 'http://envhost:8080');
  } finally {
    require('node:fs').rmSync(dir, { recursive: true, force: true });
  }
});

test('treats \\${NAME} as literal', () => {
  const dir = temporaryDirectory();
  try {
    const file = writeEnv(dir, 'test.env', 'HOST=localhost\nURL=\\${HOST}\n');
    const settings = loadSettings({ files: [file], env: {} });
    assert.equal(settings.get('URL'), '${HOST}');
  } finally {
    require('node:fs').rmSync(dir, { recursive: true, force: true });
  }
});

test('throws error for missing reference', () => {
  const dir = temporaryDirectory();
  try {
    const file = writeEnv(dir, 'test.env', 'URL=http://${HOST}:8080\n');
    assert.throws(
      () => loadSettings({ files: [file], env: {} }),
      /missing reference: HOST/
    );
  } finally {
    require('node:fs').rmSync(dir, { recursive: true, force: true });
  }
});

test('throws error for reference cycle', () => {
  const dir = temporaryDirectory();
  try {
    const file = writeEnv(dir, 'test.env', 'A=${B}\nB=${A}\n');
    assert.throws(
      () => loadSettings({ files: [file], env: {} }),
      /reference cycle detected/
    );
  } finally {
    require('node:fs').rmSync(dir, { recursive: true, force: true });
  }
});

test('error includes setting name and source file', () => {
  const dir = temporaryDirectory();
  try {
    const file = writeEnv(dir, 'test.env', 'URL=http://${MISSING}:8080\n');
    try {
      loadSettings({ files: [file], env: {} });
      assert.fail('should have thrown');
    } catch (err) {
      assert.match(err.message, /setting: URL/);
      assert.match(err.message, /source: .*test\.env/);
    }
  } finally {
    require('node:fs').rmSync(dir, { recursive: true, force: true });
  }
});

test('expand: false returns raw values', () => {
  const dir = temporaryDirectory();
  try {
    const file = writeEnv(dir, 'test.env', 'HOST=localhost\nURL=http://${HOST}:8080\n');
    const settings = loadSettings({ files: [file], env: {}, expand: false });
    assert.equal(settings.get('URL'), 'http://${HOST}:8080');
  } finally {
    require('node:fs').rmSync(dir, { recursive: true, force: true });
  }
});

test('expansion is on by default', () => {
  const dir = temporaryDirectory();
  try {
    const file = writeEnv(dir, 'test.env', 'HOST=localhost\nURL=http://${HOST}:8080\n');
    const settings = loadSettings({ files: [file], env: {} });
    assert.equal(settings.get('URL'), 'http://localhost:8080');
  } finally {
    require('node:fs').rmSync(dir, { recursive: true, force: true });
  }
});
