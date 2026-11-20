'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadSettings } = require('../src/loader');
const { temporaryDirectory, writeEnv } = require('./helpers');

test('expands across layers and recursively expands defaults', () => {
  const dir = temporaryDirectory();
  try {
    const base = writeEnv(dir, 'base.env', 'HOST=example.test\nURL=https://${HOST}${PATH:-/${SEGMENT:-api}}\n');
    const override = writeEnv(dir, 'override.env', 'HOST=internal.test\nSEGMENT=v2\n');
    const settings = loadSettings({ files: [base, override], env: {} });
    assert.equal(settings.get('URL'), 'https://internal.test/v2');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('expansion can be disabled for the loader', () => {
  const dir = temporaryDirectory();
  try {
    const file = writeEnv(dir, 'raw.env', 'NAME=world\nMESSAGE=hello ${NAME}\n');
    assert.equal(loadSettings({ files: [file], env: {}, expand: false }).get('MESSAGE'), 'hello ${NAME}');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
