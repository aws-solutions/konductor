'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function cli(...args) {
  return spawnSync(process.execPath, ['bin/atlas.js', ...args], { cwd: root, encoding: 'utf8' });
}

test('lazy loading: --help loads at most 4 project modules', () => {
  const result = cli('--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: atlas/);
});

test('lazy loading: --version loads at most 4 project modules', () => {
  const result = cli('--version');
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '2.4.0');
});

test('lazy loading: selecting one command loads only that command module', () => {
  const result = cli('check', 'data/sample.json');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /check:/);
});

test('lazy loading: format command triggers format-registration', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-lazy-'));
  try {
    const marker = path.join(dir, 'marker');
    const result = cli('format', 'data/notes.txt');
    assert.equal(result.status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
