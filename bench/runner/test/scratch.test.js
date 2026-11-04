// SPDX-License-Identifier: Apache-2.0
'use strict';

// scratch.js removes the directories it made on a normal exit, after a thrown error and on SIGTERM.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { mkScratch } = require('./scratch.js');

const SCRATCH = path.join(__dirname, 'scratch.js');

function parentDir() { return mkScratch('scratch-test-'); }

function child(parent, body) {
  return spawn(process.execPath, ['-e', `const { mkScratch } = require(${JSON.stringify(SCRATCH)}); ${body}`], { env: { PATH: process.env.PATH, TMPDIR: parent }, stdio: ['ignore', 'pipe', 'ignore'] });
}

test('a directory is removed when the process ends normally', () => {
  const parent = parentDir();
  const r = spawnSync(process.execPath, ['-e', `const { mkScratch } = require(${JSON.stringify(SCRATCH)}); require('fs').writeFileSync(mkScratch('a-') + '/f', 'x');`], { env: { PATH: process.env.PATH, TMPDIR: parent } });
  assert.equal(r.status, 0);
  assert.deepEqual(fs.readdirSync(parent), []);
});

test('a directory is removed when the process dies from an uncaught error', () => {
  const parent = parentDir();
  const r = spawnSync(process.execPath, ['-e', `const { mkScratch } = require(${JSON.stringify(SCRATCH)}); mkScratch('b-'); throw new Error('boom');`], { env: { PATH: process.env.PATH, TMPDIR: parent } });
  assert.notEqual(r.status, 0);
  assert.deepEqual(fs.readdirSync(parent), []);
});

test('a directory is removed when the process gets SIGTERM', async () => {
  const parent = parentDir();
  const p = child(parent, "mkScratch('c-'); console.log('ready'); setInterval(() => {}, 1000);");
  const exited = new Promise((resolve) => p.on('exit', (code, signal) => resolve({ code, signal })));
  await new Promise((resolve) => p.stdout.once('data', resolve));
  assert.equal(fs.readdirSync(parent).length, 1);
  p.kill('SIGTERM');
  const { code } = await exited;
  assert.equal(code, 143);
  assert.deepEqual(fs.readdirSync(parent), []);
});
