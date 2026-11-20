'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { temporaryDirectory, writeEnv } = require('./helpers');

test('command prints selected file as JSON', () => {
  const dir = temporaryDirectory();
  try {
    const file = writeEnv(dir, 'service.env', 'SERVICE_NAME=cli-test\nPORT=4010\n');
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin/settings.js'), '--file', file], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).PORT, '4010');
  } finally {
    require('node:fs').rmSync(dir, { recursive: true, force: true });
  }
});
