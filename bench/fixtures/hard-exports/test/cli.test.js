'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { run } = require('../src/cli');

const SALES = path.join(__dirname, '..', 'examples', 'sales.json');

function capture() {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (t) => { out.stdout += t; } }, stderr: { write: (t) => { out.stderr += t; } } } };
}

test('the command line writes csv with the chosen columns', () => {
  const { out, io } = capture();
  assert.equal(run(['--format', 'csv', '--input', SALES, '--columns', 'region,total'], io), 0);
  assert.equal(out.stdout, 'region,total\nnorth,120\nsouth,80\neast,95\n');
});

test('the command line exits 2 on an unknown format', () => {
  const { io } = capture();
  assert.equal(run(['--format', 'pdf', '--input', SALES], io), 2);
});
