// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { filesNamed } = require('../../ops/prompt-fixes/study.js');

test('filesNamed finds a file by name at any depth, and returns [] for an absent or empty dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'files-named-'));
  try {
    fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(root, 'result.json'), '{}');
    fs.writeFileSync(path.join(root, 'a', 'b', 'result.json'), '{}');
    fs.writeFileSync(path.join(root, 'a', 'other.json'), '{}');
    assert.deepEqual(filesNamed(root, 'result.json').sort(), [path.join(root, 'a', 'b', 'result.json'), path.join(root, 'result.json')].sort());
    assert.deepEqual(filesNamed(path.join(root, 'none'), 'result.json'), []);
    assert.deepEqual(filesNamed(undefined, 'result.json'), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
