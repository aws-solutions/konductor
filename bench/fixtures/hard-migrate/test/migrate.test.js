'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const bin = path.join(__dirname, '..', 'bin', 'migrate.js');
const sample = fs.readFileSync(path.join(__dirname, '..', 'data', 'orders.jsonl'), 'utf8');

function tmpDir(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-'));
  fs.writeFileSync(path.join(dir, 'orders.jsonl'), content);
  return dir;
}

test('up migrates the sample and keeps a backup', () => {
  const dir = tmpDir(sample);
  const r = spawnSync(process.execPath, [bin, 'up', '--dir', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).migrated, 3);
  assert.equal(fs.readFileSync(path.join(dir, 'orders.v1.bak'), 'utf8'), sample);
  const first = JSON.parse(fs.readFileSync(path.join(dir, 'orders.jsonl'), 'utf8').split('\n')[0]);
  assert.equal(first.schema, 2);
  assert.equal(first.placedAt, '2024-03-14');
});

test('a missing directory is a usage error', () => {
  assert.equal(spawnSync(process.execPath, [bin, 'up'], { encoding: 'utf8' }).status, 2);
});
