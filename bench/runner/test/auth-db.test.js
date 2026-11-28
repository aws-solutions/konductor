// SPDX-License-Identifier: Apache-2.0
'use strict';

// kiro-cli keeps its auth database in a platform-specific data dir; the runner reads and copies it there.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const { defaultAuthDb, copyAuthDb, removeAuthCopy } = require('../lib/sandbox.js');

test('the auth database lives under ~/Library/Application Support on macOS and ~/.local/share elsewhere', () => {
  assert.equal(defaultAuthDb('/Users/u', 'darwin'), '/Users/u/Library/Application Support/kiro-cli/data.sqlite3');
  assert.equal(defaultAuthDb('/home/u', 'linux'), '/home/u/.local/share/kiro-cli/data.sqlite3');
});

for (const [platform, rel] of [['darwin', 'Library/Application Support/kiro-cli'], ['linux', '.local/share/kiro-cli']]) {
  test(`on ${platform} the scratch copy goes where kiro-cli looks and is removed from there`, () => {
    const root = tmp();
    try {
      const src = path.join(root, 'src.sqlite3');
      fs.writeFileSync(src, 'auth');
      const home = path.join(root, 'home');
      const dest = copyAuthDb(src, home, platform);
      assert.equal(dest, path.join(home, rel, 'data.sqlite3'));
      assert.equal(fs.readFileSync(dest, 'utf8'), 'auth');
      assert.equal(fs.statSync(dest).mode & 0o777, 0o600);
      removeAuthCopy(home, platform);
      assert.equal(fs.existsSync(dest), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('removeAuthCopy does not delete through a data folder the agent replaced with a link', () => {
  const root = tmp();
  try {
    const real = path.join(root, 'real-kiro-data');
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(path.join(real, 'data.sqlite3'), 'REAL_LOGIN');
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, '.local/share'), { recursive: true });
    fs.symlinkSync(real, path.join(home, '.local/share/kiro-cli'));
    removeAuthCopy(home, 'linux');
    assert.equal(fs.readFileSync(path.join(real, 'data.sqlite3'), 'utf8'), 'REAL_LOGIN');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// 2026-11-28: a paid reviewer call in a scratch HOME let kiro-cli 3.5.0 update itself to 3.7.0 in place, over the
// pinned binary. Every scratch HOME gets the auth copy, so the copy also turns automatic updates off (D-305).
test('copyAuthDb turns kiro-cli automatic updates off in the scratch HOME and keeps settings already there', () => {
  const root = tmp();
  try {
    const src = path.join(root, 'src.sqlite3');
    fs.writeFileSync(src, 'auth');
    const home = path.join(root, 'home');
    const settings = path.join(home, '.kiro/settings/cli.json');
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, JSON.stringify({ 'chat.disableAutoCompaction': true, 'chat.defaultAgent': 'konductor' }));
    copyAuthDb(src, home, 'linux');
    assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), { 'chat.disableAutoCompaction': true, 'chat.defaultAgent': 'konductor', 'app.disableAutoupdates': true });
    const bare = path.join(root, 'bare');
    copyAuthDb(src, bare, 'linux');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(bare, '.kiro/settings/cli.json'), 'utf8')), { 'app.disableAutoupdates': true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
