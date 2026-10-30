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
