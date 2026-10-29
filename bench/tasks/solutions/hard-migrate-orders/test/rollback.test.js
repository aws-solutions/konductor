'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const bin = path.join(__dirname, '..', 'bin', 'migrate.js');
const run = (args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
const line = '{"id":"a","customer":"A","total":1.005,"placed":"02/29/2024","status":"DONE","address":"1 X St, Y, CA 90210-1234"}\r\n';

test('up twice changes nothing and down restores the original bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-'));
  const file = path.join(dir, 'orders.jsonl');
  fs.writeFileSync(file, line);
  run(['up', '--dir', dir]);
  const once = fs.readFileSync(file, 'utf8');
  assert.match(once, /"totalCents":101,/);
  assert.equal(JSON.parse(run(['up', '--dir', dir]).stdout).migrated, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), once);
  assert.equal(run(['down', '--dir', dir]).status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), line);
  assert.deepEqual(fs.readdirSync(dir), ['orders.jsonl']);
});
