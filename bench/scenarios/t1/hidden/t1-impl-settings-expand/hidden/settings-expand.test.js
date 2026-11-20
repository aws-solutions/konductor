'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadSettings } = require('../src/loader');

function directory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'layered-settings-hidden-'));
}

function envFile(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

function clean(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('expands a reference in a value', () => {
  const dir = directory();
  try {
    const file = envFile(dir, 'basic.env', 'NAME=world\nMESSAGE=hello ${NAME}\n');
    assert.equal(loadSettings({ files: [file], env: {} }).get('MESSAGE'), 'hello world');
  } finally { clean(dir); }
});

test('resolves references after later layers override names', () => {
  const dir = directory();
  try {
    const base = envFile(dir, 'base.env', 'HOST=old.example\nURL=https://${HOST}/v1\n');
    const later = envFile(dir, 'later.env', 'HOST=new.example\n');
    assert.equal(loadSettings({ files: [base, later], env: {} }).get('URL'), 'https://new.example/v1');
  } finally { clean(dir); }
});

test('uses environment values for references and file keys', () => {
  const dir = directory();
  try {
    const file = envFile(dir, 'environment.env', 'NAME=file\nMESSAGE=${OUTSIDE}-${NAME}\n');
    const settings = loadSettings({ files: [file], env: { NAME: 'process', OUTSIDE: 'value' } });
    assert.equal(settings.get('NAME'), 'process');
    assert.equal(settings.get('MESSAGE'), 'value-process');
  } finally { clean(dir); }
});

test('supports defaults, including defaults with references', () => {
  const dir = directory();
  try {
    const file = envFile(dir, 'defaults.env', 'EMPTY=\nONE=${EMPTY:-fallback}\nTWO=${MISSING:-${OTHER:-last}}\n');
    const settings = loadSettings({ files: [file], env: {} });
    assert.equal(settings.get('ONE'), 'fallback');
    assert.equal(settings.get('TWO'), 'last');
  } finally { clean(dir); }
});

test('keeps an escaped reference literal', () => {
  const dir = directory();
  try {
    const file = envFile(dir, 'escape.env', 'NAME=world\nLITERAL=\\${NAME}\n');
    assert.equal(loadSettings({ files: [file], env: {} }).get('LITERAL'), '${NAME}');
  } finally { clean(dir); }
});

test('can disable expansion in the loader', () => {
  const dir = directory();
  try {
    const file = envFile(dir, 'disabled.env', 'NAME=world\nMESSAGE=hello ${NAME}\n');
    assert.equal(loadSettings({ files: [file], env: {}, expand: false }).get('MESSAGE'), 'hello ${NAME}');
  } finally { clean(dir); }
});

test('reports a missing reference with its key and source file', () => {
  const dir = directory();
  try {
    const file = envFile(dir, 'missing.env', 'MESSAGE=hello ${ABSENT}\n');
    assert.throws(() => loadSettings({ files: [file], env: {} }), error =>
      /Missing variable ABSENT/.test(error.message) && /MESSAGE/.test(error.message) && /missing\.env/.test(error.message));
  } finally { clean(dir); }
});

test('reports a reference cycle with its key and source file', () => {
  const dir = directory();
  try {
    const file = envFile(dir, 'cycle.env', 'FIRST=${SECOND}\nSECOND=${FIRST}\n');
    assert.throws(() => loadSettings({ files: [file], env: {} }), error =>
      /Reference cycle/.test(error.message) && /FIRST/.test(error.message) && /cycle\.env/.test(error.message));
  } finally { clean(dir); }
});

test('expands repeated references without losing surrounding text', () => {
  const dir = directory();
  try {
    const file = envFile(dir, 'repeat.env', 'WORD=ok\nVALUE=[${WORD}]-${WORD}!\n');
    assert.equal(loadSettings({ files: [file], env: {} }).get('VALUE'), '[ok]-ok!');
  } finally { clean(dir); }
});

test('an empty environment value uses a default', () => {
  const dir = directory();
  try {
    const file = envFile(dir, 'empty-env.env', 'VALUE=${FROM_ENV:-chosen}\n');
    assert.equal(loadSettings({ files: [file], env: { FROM_ENV: '' } }).get('VALUE'), 'chosen');
  } finally { clean(dir); }
});

test('command line output expands values by default', () => {
  const dir = directory();
  try {
    const file = envFile(dir, 'cli.env', 'NAME=command\nMESSAGE=hello ${NAME}\n');
    const result = spawnSync(process.execPath, [path.join(process.cwd(), 'bin/settings.js'), '--file', file], {
      encoding: 'utf8', env: { ...process.env, NAME: 'command' }
    });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).MESSAGE, 'hello command');
  } finally { clean(dir); }
});

test('command line --no-expand prints raw values', () => {
  const dir = directory();
  try {
    const file = envFile(dir, 'cli-raw.env', 'NAME=command\nMESSAGE=hello ${NAME}\n');
    const result = spawnSync(process.execPath, [path.join(process.cwd(), 'bin/settings.js'), '--file', file, '--no-expand'], {
      encoding: 'utf8', env: { ...process.env, NAME: 'command' }
    });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).MESSAGE, 'hello ${NAME}');
  } finally { clean(dir); }
});

test('help documents the expansion switch', () => {
  const result = spawnSync(process.execPath, [path.join(process.cwd(), 'bin/settings.js'), '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--no-expand/);
});

test('retains typed settings while exposing expanded raw values', () => {
  const dir = directory();
  try {
    const file = envFile(dir, 'typed.env', 'PORT=4123\nDEBUG=true\nLABEL=port-${PORT}\n');
    const settings = loadSettings({ files: [file], env: {} });
    assert.equal(settings.port, 4123);
    assert.equal(settings.debug, true);
    assert.equal(settings.raw.LABEL, 'port-4123');
  } finally { clean(dir); }
});
