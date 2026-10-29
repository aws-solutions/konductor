// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { copyFixture } = require('../lib/sandbox.js');

test('copyFixture never copies the answer key into the agent working directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fixcopy-'));
  try {
    const src = path.join(root, 'src');
    fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(src, 'a.txt'), 'a');
    fs.writeFileSync(path.join(src, '.bench-answer-key.md'), 'secret');
    fs.writeFileSync(path.join(src, 'sub', '.bench-answer-key.md'), 'secret');
    fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'b');
    const dest = path.join(root, 'dest');
    copyFixture(src, dest);
    assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8'), 'a');
    assert.equal(fs.readFileSync(path.join(dest, 'sub', 'b.txt'), 'utf8'), 'b');
    assert.equal(fs.existsSync(path.join(dest, '.bench-answer-key.md')), false);
    assert.equal(fs.existsSync(path.join(dest, 'sub', '.bench-answer-key.md')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
